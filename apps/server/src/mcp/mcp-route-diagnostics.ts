import {
  isVisibleInView,
  nativeRelationLabelWidth,
  nativeTableCanvasHeaderHeight,
  nativeTableCanvasMetrics,
  relationGeometry,
  type NativeDesignDocument,
  type Point,
  type RelationBounds,
  type RelationAnchor,
} from '@ezerd/model';

export type RouteCard = RelationBounds & { objectId: string };
export type DiagnosticRoute = {
  relationId: string;
  sourceId: string;
  targetId: string;
  points: Point[];
};
export type RouteConflict = {
  code: 'relation-card-penetration' | 'relation-segment-overlap' | 'relation-crossing';
  objectId: string;
  relationId: string;
  otherObjectId?: string;
  otherRelationId?: string;
  segmentIndex: number;
  otherSegmentIndex?: number;
  intersectionKind?: 'crossing' | 'touch' | 'overlap';
  segment: { start: Point; end: Point };
  otherSegment?: { start: Point; end: Point };
  x: number;
  y: number;
  message: string;
};

const EPS = 1e-7;
const equal = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const minus = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
const at = (a: Point, b: Point, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** Open card interiors: contact with an edge or corner is not penetration. */
export function segmentCardPenetration(
  a: Point,
  b: Point,
  card: RelationBounds,
): Point | undefined {
  let low = 0;
  let high = 1;
  for (const axis of ['x', 'y'] as const) {
    const min = card[axis];
    const max = min + (axis === 'x' ? card.width : card.height);
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < EPS) {
      if (a[axis] <= min + EPS || a[axis] >= max - EPS) return;
    } else {
      const first = (min - a[axis]) / delta;
      const last = (max - a[axis]) / delta;
      low = Math.max(low, Math.min(first, last));
      high = Math.min(high, Math.max(first, last));
    }
  }
  if (high - low <= EPS || equal(a, b)) return;
  return at(a, b, (low + high) / 2);
}

export function segmentIntersection(a: Point, b: Point, c: Point, d: Point) {
  if (equal(a, b) || equal(c, d)) return;
  const r = minus(b, a),
    s = minus(d, c),
    q = minus(c, a);
  const denominator = cross(r, s);
  if (Math.abs(denominator) < EPS) {
    if (Math.abs(cross(q, r)) >= EPS) return;
    const axis = Math.abs(r.x) >= Math.abs(r.y) ? 'x' : 'y';
    const t0 = (c[axis] - a[axis]) / r[axis],
      t1 = (d[axis] - a[axis]) / r[axis];
    const low = Math.max(0, Math.min(t0, t1)),
      high = Math.min(1, Math.max(t0, t1));
    if (high < low - EPS) return;
    return {
      kind: high - low > EPS ? ('overlap' as const) : ('touch' as const),
      point: at(a, b, (low + high) / 2),
    };
  }
  const t = cross(q, s) / denominator,
    u = cross(q, r) / denominator;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return;
  return {
    kind:
      t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS ? ('crossing' as const) : ('touch' as const),
    point: at(a, b, Math.max(0, Math.min(1, t))),
  };
}

function sharedEndpoint(a: DiagnosticRoute, b: DiagnosticRoute, point: Point) {
  const endpoints = (route: DiagnosticRoute) => [
    { id: route.sourceId, point: route.points[0]! },
    { id: route.targetId, point: route.points.at(-1)! },
  ];
  return endpoints(a).some((first) =>
    endpoints(b).some(
      (second) => first.id === second.id && equal(first.point, point) && equal(second.point, point),
    ),
  );
}

/** Sweep bounding boxes before exact tests; a hard budget also bounds dense worst cases. */
export function inspectRouteConflicts(
  routes: DiagnosticRoute[],
  cards: RouteCard[],
  emit: (conflict: RouteConflict) => boolean,
  budget = 100_000,
) {
  let comparisons = 0;
  const segments = routes
    .flatMap((route) =>
      route.points.slice(1).map((end, index) => ({
        route,
        index,
        start: route.points[index]!,
        end,
        left: Math.min(route.points[index]!.x, end.x),
        right: Math.max(route.points[index]!.x, end.x),
        top: Math.min(route.points[index]!.y, end.y),
        bottom: Math.max(route.points[index]!.y, end.y),
      })),
    )
    .sort((a, b) => a.left - b.left);
  const orderedCards = [...cards].sort((a, b) => a.x - b.x);
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const base = {
      objectId: segment.route.relationId,
      relationId: segment.route.relationId,
      segmentIndex: segment.index,
      segment: { start: segment.start, end: segment.end },
    };
    for (const card of orderedCards) {
      if (++comparisons > budget) return { complete: false, comparisons };
      if (card.x > segment.right) break;
      if (
        card.x + card.width < segment.left ||
        card.y > segment.bottom ||
        card.y + card.height < segment.top
      )
        continue;
      const point = segmentCardPenetration(segment.start, segment.end, card);
      if (
        point &&
        !emit({
          ...base,
          code: 'relation-card-penetration',
          otherObjectId: card.objectId,
          ...point,
          message: '관계선이 카드 내부를 통과합니다.',
        })
      )
        return { complete: false, comparisons };
    }
    for (let j = i + 1; j < segments.length; j++) {
      const other = segments[j]!;
      if (++comparisons > budget) return { complete: false, comparisons };
      if (other.left > segment.right) break;
      if (other.top > segment.bottom || other.bottom < segment.top) continue;
      if (segment.route === other.route && Math.abs(segment.index - other.index) <= 1) continue;
      const hit = segmentIntersection(segment.start, segment.end, other.start, other.end);
      if (!hit || (hit.kind === 'touch' && sharedEndpoint(segment.route, other.route, hit.point)))
        continue;
      if (
        !emit({
          ...base,
          code: hit.kind === 'overlap' ? 'relation-segment-overlap' : 'relation-crossing',
          otherRelationId: other.route.relationId,
          otherSegmentIndex: other.index,
          otherSegment: { start: other.start, end: other.end },
          intersectionKind: hit.kind,
          ...hit.point,
          message:
            hit.kind === 'overlap'
              ? '관계선 구간이 같은 직선 위에서 겹칩니다.'
              : '관계선 구간이 교차하거나 접촉합니다.',
        })
      )
        return { complete: false, comparisons };
    }
  }
  return { complete: true, comparisons };
}

/** Reconstruct persisted native table scenes with the same pure router as the canvas. */
export function reconstructDiagnosticRoutes(
  document: NativeDesignDocument,
  cards: RouteCard[],
  viewId: string,
  mode: 'physical' | 'logical',
) {
  const byObject = new Map(cards.map((card) => [card.objectId, card]));
  const tables = new Map((document.tables ?? []).map((table) => [table.id, table]));
  const saved = new Map(
    (document.layout.relations ?? [])
      .filter((route) => route.viewId === viewId)
      .map((route) => [route.relationId, route]),
  );
  const routes: DiagnosticRoute[] = [];
  let skipped = 0;
  for (const [lane, relation] of (document.tableRelations ?? []).entries()) {
    if (!isVisibleInView(relation.scope, mode) || (mode === 'physical' && !relation.physical))
      continue;
    const source = byObject.get(relation.sourceTableId),
      target = byObject.get(relation.targetTableId);
    if (!source || !target || cards.length > 200 || routes.length >= 200) {
      skipped++;
      continue;
    }
    const route = saved.get(relation.id);
    const columnAnchor = (
      card: RouteCard,
      columnId: string | undefined,
      side: 'left' | 'right',
    ): RelationAnchor | undefined => {
      const table = tables.get(card.objectId);
      if (!table || !columnId) return;
      const rows = nativeTableCanvasMetrics(document, table, mode).rows;
      const index = rows.findIndex((row) => row.column.id === columnId);
      if (index < 0) return;
      return {
        side,
        ratio: Math.max(
          0,
          Math.min(
            1,
            (nativeTableCanvasHeaderHeight +
              rows.slice(0, index).reduce((height, row) => height + row.height, 0) +
              rows[index]!.height / 2) /
              card.height,
          ),
        ),
      };
    };
    const towardRight = target.x >= source.x;
    const sourceAnchor =
      route?.sourceAnchor ??
      (mode === 'physical'
        ? columnAnchor(
            source,
            relation.physical?.sourceColumnIds[0],
            towardRight ? 'right' : 'left',
          )
        : undefined);
    const targetAnchor =
      route?.targetAnchor ??
      (mode === 'physical'
        ? columnAnchor(
            target,
            relation.physical?.targetColumnIds[0],
            towardRight ? 'left' : 'right',
          )
        : undefined);
    const label = mode === 'physical' ? (relation.physical?.name ?? '') : relation.logical.name;
    const geometry = relationGeometry(
      source,
      target,
      nativeRelationLabelWidth(label),
      lane,
      route?.offset ?? 0,
      route?.bend,
      cards.filter((card) => card !== source && card !== target),
      {
        ...route,
        ...(sourceAnchor ? { sourceAnchor } : {}),
        ...(targetAnchor ? { targetAnchor } : {}),
      },
    );
    routes.push({
      relationId: relation.id,
      sourceId: relation.sourceTableId,
      targetId: relation.targetTableId,
      points: geometry.points,
    });
  }
  return { routes, skipped };
}
