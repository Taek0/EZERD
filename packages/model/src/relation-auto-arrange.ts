import type { RelationAnchor } from './document-base.js';
import {
  createRelationRoutingContext,
  relationGeometry,
  segmentCrossesBounds,
  type Point,
  type RelationBounds,
  type RelationRoutingContext,
  type RelationRoutingSelection,
  type RelationSearchBudget,
} from './relation-routing.js';

export type AutoArrangeBox = RelationBounds & { id: string };
export interface AutoArrangeRelation {
  id: string;
  /** Existing model convention: source is FK, target is referenced PK/UNIQUE. */
  sourceTableId: string;
  targetTableId: string;
  labelWidth?: number;
}
export interface RelationAutoArrangeInput {
  tables: AutoArrangeBox[];
  notes?: AutoArrangeBox[];
  relations: AutoArrangeRelation[];
  options?: { maxImprovementPasses?: number; maxSearches?: number; maxSearchNodes?: number };
}
export interface AutoArrangedRoute {
  relationId: string;
  sourceAnchor: RelationAnchor;
  targetAnchor: RelationAnchor;
  waypoints: Point[];
}
export interface AutoArrangeMetrics {
  crossings: number;
  overlapLength: number;
  spacingViolations: number;
  totalBends: number;
  totalLength: number;
  crowdedTableIds: string[];
  searchLimitReached: boolean;
}
export type RelationAutoArrangeResult =
  | { ok: true; routes: AutoArrangedRoute[]; metrics: AutoArrangeMetrics }
  | {
      ok: false;
      error: {
        code: 'invalid-input' | 'no-valid-route' | 'search-limit';
        relationId?: string;
        message: string;
      };
    };

type Side = RelationAnchor['side'];
type Endpoint = { relationId: string; other: AutoArrangeBox; side: Side; anchor?: RelationAnchor };
type Placement = {
  relation: AutoArrangeRelation;
  source: AutoArrangeBox;
  target: AutoArrangeBox;
  sourceEnd: Endpoint;
  targetEnd: Endpoint;
};
type Routed = { placement: Placement; points: Point[]; segments: Segment[] };
const sides: Side[] = ['top', 'right', 'bottom', 'left'];
const SIDE_GAP = 18;
const MAX_COORD = 1e7;
const CROSSING_COST = 2500;
const OVERLAP_COST = 80;
const SPACING_COST = 800;
const PROXIMITY_COST = 80;
const compareId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id, 'en');
const center = (box: RelationBounds): Point => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});
const length = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const span = (box: RelationBounds, side: Side) =>
  side === 'left' || side === 'right' ? box.height : box.width;
const countKey = (box: AutoArrangeBox, side: Side) => `${box.id}\0${side}`;

function validBox(box: AutoArrangeBox) {
  return (
    typeof box.id === 'string' &&
    box.id.length > 0 &&
    [box.x, box.y, box.width, box.height].every(
      (value) => Number.isFinite(value) && Math.abs(value) <= MAX_COORD,
    ) &&
    box.width > 0 &&
    box.height > 0 &&
    box.x + box.width <= MAX_COORD &&
    box.y + box.height <= MAX_COORD
  );
}

function sidePoint(box: AutoArrangeBox, side: Side): Point {
  const p = center(box);
  if (side === 'left') p.x = box.x;
  if (side === 'right') p.x = box.x + box.width;
  if (side === 'top') p.y = box.y;
  if (side === 'bottom') p.y = box.y + box.height;
  return p;
}

function sideCost(
  box: AutoArrangeBox,
  other: AutoArrangeBox,
  side: Side,
  count: number,
  obstacles: readonly AutoArrangeBox[],
) {
  const a = center(box),
    b = center(other);
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const outward = side === 'left' ? -dx : side === 'right' ? dx : side === 'top' ? -dy : dy;
  const perpendicular = side === 'left' || side === 'right' ? Math.abs(dy) : Math.abs(dx);
  const capacity = Math.max(1, Math.floor((span(box, side) - 32) / SIDE_GAP) + 1);
  const port = sidePoint(box, side);
  const probe: Point = {
    x: port.x + (side === 'left' ? -16 : side === 'right' ? 16 : 0),
    y: port.y + (side === 'top' ? -16 : side === 'bottom' ? 16 : 0),
  };
  const blocked = obstacles.some(
    (obstacle) => obstacle.id !== box.id && segmentCrossesBounds(port, probe, obstacle),
  );
  return (
    (outward < 0 ? -outward * 2 + 96 : 0) +
    perpendicular * 0.14 +
    count * 8 +
    Math.max(0, count + 1 - capacity) * 400 +
    (blocked ? 300 : 0)
  );
}

function chooseSides(
  source: AutoArrangeBox,
  target: AutoArrangeBox,
  counts: Map<string, number>,
  obstacles: readonly AutoArrangeBox[],
): [Side, Side] {
  let best: [Side, Side] = ['top', 'right'],
    bestCost = Infinity;
  for (const sourceSide of sides)
    for (const targetSide of sides) {
      if (source.id === target.id && sourceSide === targetSide) continue;
      const cost =
        length(sidePoint(source, sourceSide), sidePoint(target, targetSide)) +
        sideCost(
          source,
          target,
          sourceSide,
          counts.get(countKey(source, sourceSide)) ?? 0,
          obstacles,
        ) +
        sideCost(
          target,
          source,
          targetSide,
          counts.get(countKey(target, targetSide)) ?? 0,
          obstacles,
        );
      if (cost < bestCost) {
        bestCost = cost;
        best = [sourceSide, targetSide];
      }
    }
  return best;
}

function assignAnchors(table: AutoArrangeBox, side: Side, ends: Endpoint[]) {
  const axis = side === 'left' || side === 'right' ? 'y' : 'x';
  ends.sort(
    (a, b) =>
      center(a.other)[axis] - center(b.other)[axis] ||
      a.relationId.localeCompare(b.relationId, 'en'),
  );
  const extent = span(table, side),
    margin = Math.min(16, extent / 4),
    available = extent - 2 * margin;
  ends.forEach((end, index) => {
    end.anchor = { side, ratio: (margin + (available * (index + 1)) / (ends.length + 1)) / extent };
  });
}

function validPoints(points: readonly Point[], boxes: readonly AutoArrangeBox[]) {
  if (points.length < 2 || points.length > 130) return false;
  for (const point of points)
    if (
      ![point.x, point.y].every((value) => Number.isFinite(value) && Math.abs(value) <= MAX_COORD)
    )
      return false;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    if ((a.x !== b.x && a.y !== b.y) || (a.x === b.x && a.y === b.y)) return false;
    if (boxes.some((box) => segmentCrossesBounds(a, b, box))) return false;
  }
  return true;
}

/** The existing router may use a long initial stub; shorten it where a clear turn is possible. */
function shortenStubs(
  points: Point[],
  boxes: readonly AutoArrangeBox[],
  additionalScore: (points: readonly Point[]) => number,
) {
  if (points.length < 4) return points;
  let best = points;
  const pathScore = (candidate: readonly Point[]) => {
    let cost = Math.max(0, candidate.length - 2) * 48 + additionalScore(candidate);
    for (let i = 1; i < candidate.length; i++) cost += length(candidate[i - 1]!, candidate[i]!);
    return cost;
  };
  for (const index of [1, points.length - 2]) {
    const endpoint = index === 1 ? best[0]! : best.at(-1)!;
    const turn = best[index]!;
    const axis = endpoint.x === turn.x ? 'y' : 'x';
    const neighborIndex = index === 1 ? 2 : index - 1;
    if (length(endpoint, turn) <= 16) continue;
    for (const distance of [16, 24, 32]) {
      const candidate = best.map((point) => ({ ...point }));
      const coordinate = endpoint[axis] + Math.sign(turn[axis] - endpoint[axis]) * distance;
      candidate[index]![axis] = coordinate;
      candidate[neighborIndex]![axis] = coordinate;
      if (validPoints(candidate, boxes) && pathScore(candidate) <= pathScore(best)) {
        best = candidate;
        break;
      }
    }
  }
  return best;
}

function route(
  placement: Placement,
  boxes: readonly AutoArrangeBox[],
  contexts: Map<string, RelationRoutingContext>,
  budget: RelationSearchBudget,
  occupied: readonly Routed[],
  bend?: Point,
  searchEvenWithCandidate = false,
  current?: Routed,
): Point[] | null {
  const { source, target, sourceEnd, targetEnd, relation } = placement;
  const key = `${source.id}\0${target.id}`;
  let context = contexts.get(key);
  if (!context) {
    const obstacles = boxes.filter((box) => box.id !== source.id && box.id !== target.id);
    context = createRelationRoutingContext(source, target, obstacles, budget);
    contexts.set(key, context);
  }
  const midpoint = {
    x: (center(source).x + center(target).x) / 2,
    y: (center(source).y + center(target).y) / 2,
  };
  const nearbyLanes = (horizontal: boolean) => {
    const offsetLanes = (values: readonly Segment[]) =>
      values
        .filter((segment) => segment.horizontal === horizontal)
        .flatMap((segment) => [
          segment.fixed - 16,
          segment.fixed + 16,
          segment.fixed - 32,
          segment.fixed + 32,
        ]);
    const preferred = offsetLanes(current?.segments ?? []),
      nearby = offsetLanes(
        occupied
          .filter((item) => item.placement.relation.id !== relation.id)
          .flatMap((item) => item.segments),
      ).sort(
        (a, b) =>
          Math.abs(a - (horizontal ? midpoint.y : midpoint.x)) -
            Math.abs(b - (horizontal ? midpoint.y : midpoint.x)) || a - b,
      );
    return [...new Set([...preferred, ...nearby])].slice(0, 48);
  };
  const selection: RelationRoutingSelection = {
    corridorXs: nearbyLanes(false),
    corridorYs: nearbyLanes(true),
    searchEvenWithCandidate,
    edgePenalty: (a, b) => {
      const edge = segments([a, b]);
      let penalty = 0;
      for (const item of occupied) {
        if (item.placement.relation.id === relation.id) continue;
        const pair = pairMetrics(edge, item.segments);
        penalty += conflictCost(pair);
      }
      return penalty;
    },
    additionalScore: (points) => {
      const candidate = segments(points);
      let penalty = 0;
      for (const item of occupied) {
        if (item.placement.relation.id === relation.id) continue;
        const pair = pairMetrics(candidate, item.segments);
        penalty += conflictCost(pair);
      }
      return penalty;
    },
  };
  const points = relationGeometry(
    source,
    target,
    relation.labelWidth ?? 90,
    0,
    0,
    bend,
    [],
    { sourceAnchor: sourceEnd.anchor, targetAnchor: targetEnd.anchor },
    context,
    selection,
  ).points;
  if (!validPoints(points, boxes)) return null;
  return shortenStubs(points, boxes, selection.additionalScore!);
}

type Segment = { horizontal: boolean; low: number; high: number; fixed: number };
function segments(points: readonly Point[]): Segment[] {
  return points.slice(1).map((b, index) => {
    const a = points[index]!,
      horizontal = a.y === b.y;
    return {
      horizontal,
      low: Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y),
      high: Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y),
      fixed: horizontal ? a.y : a.x,
    };
  });
}

function pairMetrics(a: readonly Segment[], b: readonly Segment[]) {
  let crossings = 0,
    overlapLength = 0,
    spacingViolations = 0,
    proximityLength = 0;
  for (const x of a)
    for (const y of b) {
      if (x.horizontal === y.horizontal) {
        const overlap = Math.max(0, Math.min(x.high, y.high) - Math.max(x.low, y.low));
        if (!overlap) continue;
        const gap = Math.abs(x.fixed - y.fixed);
        if (gap === 0) overlapLength += overlap;
        else if (gap < 12) {
          spacingViolations++;
          proximityLength += overlap;
        }
      } else {
        const horizontal = x.horizontal ? x : y,
          vertical = x.horizontal ? y : x;
        if (
          vertical.fixed > horizontal.low &&
          vertical.fixed < horizontal.high &&
          horizontal.fixed > vertical.low &&
          horizontal.fixed < vertical.high
        )
          crossings++;
      }
    }
  return { crossings, overlapLength, spacingViolations, proximityLength };
}

function conflictCost(pair: ReturnType<typeof pairMetrics>) {
  return (
    pair.crossings * CROSSING_COST +
    pair.overlapLength * OVERLAP_COST +
    pair.spacingViolations * SPACING_COST +
    pair.proximityLength * PROXIMITY_COST
  );
}

function metrics(
  routes: readonly Routed[],
  crowdedTableIds: string[],
  searchLimitReached: boolean,
) {
  const result: AutoArrangeMetrics = {
    crossings: 0,
    overlapLength: 0,
    spacingViolations: 0,
    totalBends: 0,
    totalLength: 0,
    crowdedTableIds,
    searchLimitReached,
  };
  for (let i = 0; i < routes.length; i++) {
    const points = routes[i]!.points;
    result.totalBends += Math.max(0, points.length - 2);
    for (let p = 1; p < points.length; p++)
      result.totalLength += length(points[p - 1]!, points[p]!);
    for (let j = 0; j < i; j++) {
      const pair = pairMetrics(routes[i]!.segments, routes[j]!.segments);
      result.crossings += pair.crossings;
      result.overlapLength += pair.overlapLength;
      result.spacingViolations += pair.spacingViolations;
    }
  }
  return result;
}

function routeQuality(
  index: number,
  points: Point[],
  routeSegments: Segment[],
  routes: readonly Routed[],
) {
  let result = Math.max(0, points.length - 2) * 48;
  for (let p = 1; p < points.length; p++) result += length(points[p - 1]!, points[p]!);
  for (let otherIndex = 0; otherIndex < routes.length; otherIndex++) {
    if (index === otherIndex) continue;
    const pair = pairMetrics(routeSegments, routes[otherIndex]!.segments);
    result += conflictCost(pair);
  }
  return result;
}

/** Pure, serializable, all-or-nothing layout of relation anchors and orthogonal waypoints. */
export function arrangeRelationRoutes(input: RelationAutoArrangeInput): RelationAutoArrangeResult {
  const invalid = (message: string): RelationAutoArrangeResult => ({
    ok: false,
    error: { code: 'invalid-input', message },
  });
  if (
    !input ||
    !Array.isArray(input.tables) ||
    !Array.isArray(input.relations) ||
    (input.notes !== undefined && !Array.isArray(input.notes))
  )
    return invalid('Tables and relations are required.');
  if (
    input.tables.some((box) => !box || typeof box.id !== 'string') ||
    input.notes?.some((box) => !box || typeof box.id !== 'string') ||
    input.relations.some((relation) => !relation || typeof relation.id !== 'string')
  )
    return invalid('Card and relation IDs are required.');
  const tables = [...input.tables].sort(compareId),
    notes = [...(input.notes ?? [])].sort(compareId),
    relations = [...input.relations].sort(compareId),
    boxes = [...tables, ...notes];
  if (boxes.length > 256 || relations.length > 1000)
    return {
      ok: false,
      error: { code: 'search-limit', message: 'The layout exceeds the search budget.' },
    };
  if (
    boxes.some((box) => !validBox(box)) ||
    new Set(boxes.map((box) => box.id)).size !== boxes.length ||
    new Set(relations.map((relation) => relation.id)).size !== relations.length
  )
    return invalid('Card bounds or IDs are invalid.');
  const tableById = new Map(tables.map((table) => [table.id, table]));
  if (
    relations.some(
      (relation) =>
        !relation.id ||
        !tableById.has(relation.sourceTableId) ||
        !tableById.has(relation.targetTableId) ||
        (relation.labelWidth !== undefined &&
          (!Number.isFinite(relation.labelWidth) || relation.labelWidth < 0)),
    )
  )
    return invalid('A relation ID, endpoint, or label width is invalid.');
  const requestedPasses = input.options?.maxImprovementPasses ?? 1,
    maxSearches = input.options?.maxSearches ?? relations.length + 40,
    maxSearchNodes = input.options?.maxSearchNodes ?? 300_000;
  if (
    !Number.isInteger(requestedPasses) ||
    requestedPasses < 0 ||
    requestedPasses > 3 ||
    !Number.isInteger(maxSearches) ||
    maxSearches < relations.length ||
    maxSearches > 2048 ||
    !Number.isInteger(maxSearchNodes) ||
    maxSearchNodes < 0 ||
    maxSearchNodes > 1_000_000
  )
    return invalid('The search budget is invalid.');
  const counts = new Map<string, number>(),
    endpointGroups = new Map<string, Endpoint[]>(),
    placements: Placement[] = [];
  for (const relation of relations) {
    const source = tableById.get(relation.sourceTableId)!,
      target = tableById.get(relation.targetTableId)!;
    if (
      source.id !== target.id &&
      source.x === target.x &&
      source.y === target.y &&
      source.width === target.width &&
      source.height === target.height
    )
      return {
        ok: false,
        error: {
          code: 'no-valid-route',
          relationId: relation.id,
          message: 'Distinct relation endpoints occupy the same card bounds.',
        },
      };
    const [sourceSide, targetSide] = chooseSides(source, target, counts, boxes);
    const sourceEnd: Endpoint = { relationId: relation.id, other: target, side: sourceSide },
      targetEnd: Endpoint = { relationId: relation.id, other: source, side: targetSide };
    for (const [table, end] of [
      [source, sourceEnd],
      [target, targetEnd],
    ] as const) {
      const key = countKey(table, end.side);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      endpointGroups.set(key, [...(endpointGroups.get(key) ?? []), end]);
    }
    placements.push({ relation, source, target, sourceEnd, targetEnd });
  }
  const crowded = new Set<string>();
  for (const table of tables)
    for (const side of sides) {
      const group = endpointGroups.get(countKey(table, side));
      if (!group) continue;
      assignAnchors(table, side, group);
      const extent = span(table, side),
        margin = Math.min(16, extent / 4),
        interval = (extent - 2 * margin) / (group.length + 1);
      if (interval < 12) crowded.add(table.id);
    }
  let searches = 0;
  const budget: RelationSearchBudget = {
    maxNodes: maxSearchNodes,
    exploredNodes: 0,
    limitReached: false,
  };
  const contexts = new Map<string, RelationRoutingContext>();
  const routed: Routed[] = [];
  const routingOrder = [...placements].sort(
    (a, b) =>
      length(center(a.source), center(a.target)) - length(center(b.source), center(b.target)) ||
      a.relation.id.localeCompare(b.relation.id, 'en'),
  );
  for (const placement of routingOrder) {
    searches++;
    const points = route(placement, boxes, contexts, budget, routed);
    if (!points)
      return {
        ok: false,
        error: {
          code: budget.limitReached ? 'search-limit' : 'no-valid-route',
          relationId: placement.relation.id,
          message: 'No clear orthogonal route exists for this relation.',
        },
      };
    routed.push({ placement, points, segments: segments(points) });
  }
  const crowdedTableIds = [...crowded].sort((a, b) => a.localeCompare(b, 'en'));
  // Only troubled routes are retried, with a fixed pass and candidate budget.
  let candidateLimitReached = false;
  for (let pass = 0; pass < requestedPasses; pass++) {
    if (searches >= maxSearches) {
      candidateLimitReached = true;
      break;
    }
    const troubled = routed
      .map((item, index) => ({
        index,
        trouble: routed.reduce((sum, other, otherIndex) => {
          if (index === otherIndex) return sum;
          const pair = pairMetrics(item.segments, other.segments);
          return sum + conflictCost(pair);
        }, 0),
      }))
      .filter((item) => item.trouble > 0)
      .sort((a, b) => b.trouble - a.trouble || a.index - b.index)
      .slice(0, 8);
    if (!troubled.length) break;
    let improved = false;
    for (const { index } of troubled) {
      const item = routed[index]!,
        source = center(item.placement.source),
        target = center(item.placement.target),
        midpoint = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 };
      const original = item.points;
      let best = original,
        bestSegments = item.segments,
        bestQuality = routeQuality(index, original, item.segments, routed);
      for (const bend of [
        undefined,
        { x: midpoint.x - 36, y: midpoint.y },
        { x: midpoint.x + 36, y: midpoint.y },
        { x: midpoint.x, y: midpoint.y - 36 },
        { x: midpoint.x, y: midpoint.y + 36 },
      ]) {
        if (searches >= maxSearches) {
          candidateLimitReached = true;
          break;
        }
        searches++;
        const candidate = route(
          item.placement,
          boxes,
          contexts,
          budget,
          routed,
          bend,
          bend === undefined,
          item,
        );
        if (!candidate) continue;
        const candidateSegments = segments(candidate);
        const candidateQuality = routeQuality(index, candidate, candidateSegments, routed);
        if (candidateQuality < bestQuality) {
          best = candidate;
          bestSegments = candidateSegments;
          bestQuality = candidateQuality;
        }
      }
      item.points = best;
      item.segments = bestSegments;
      improved ||= best !== original;
    }
    if (!improved) break;
  }
  return {
    ok: true,
    routes: routed
      .map(({ placement, points }) => ({
        relationId: placement.relation.id,
        sourceAnchor: placement.sourceEnd.anchor!,
        targetAnchor: placement.targetEnd.anchor!,
        waypoints: points.slice(1, -1),
      }))
      .sort((a, b) => a.relationId.localeCompare(b.relationId, 'en')),
    metrics: metrics(routed, crowdedTableIds, candidateLimitReached || budget.limitReached),
  };
}
