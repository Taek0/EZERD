import { centerRelationRouteCorridors } from './relation-corridor-centering.js';
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
    count * 8 +
    Math.max(0, count + 1 - capacity) * 400 +
    (blocked ? 300 : 0)
  );
}

const verticalSide = (side: Side) => side === 'left' || side === 'right';
const direction = (side: Side): Point => ({
  x: side === 'left' ? -1 : side === 'right' ? 1 : 0,
  y: side === 'top' ? -1 : side === 'bottom' ? 1 : 0,
});
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
function portPoint(box: AutoArrangeBox, anchor: RelationAnchor): Point {
  const point = sidePoint(box, anchor.side),
    axis = verticalSide(anchor.side) ? 'y' : 'x',
    delta = direction(anchor.side);
  point[axis] = box[axis] + span(box, anchor.side) * anchor.ratio;
  return { x: point.x + delta.x * 8, y: point.y + delta.y * 8 };
}
function simplifyRoute(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    if (result.length && length(result.at(-1)!, point) === 0) continue;
    while (result.length > 1) {
      const a = result.at(-2)!,
        b = result.at(-1)!;
      if (
        ((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y)) &&
        length(a, b) + length(b, point) === length(a, point)
      )
        result.pop();
      else break;
    }
    result.push(point);
  }
  return result;
}
function respectsPorts(points: readonly Point[], sourceSide: Side, targetSide: Side) {
  const outward = (tip: Point, next: Point, side: Side) => {
    const delta = direction(side);
    return (
      (next.x - tip.x) * delta.x + (next.y - tip.y) * delta.y > 0 &&
      (delta.x ? tip.y === next.y : tip.x === next.x)
    );
  };
  return (
    points.length >= 2 &&
    outward(points[0]!, points[1]!, sourceSide) &&
    outward(points.at(-1)!, points.at(-2)!, targetSide)
  );
}

/** Constant-sized alternatives, reserved for the explicit arrangement operation. */
function cheapCandidates(
  a: Point,
  b: Point,
  sourceSide: Side,
  targetSide: Side,
  boxes: readonly AutoArrangeBox[] = [],
  lanes = false,
) {
  const sd = direction(sourceSide),
    td = direction(targetSide);
  const sameAxis = verticalSide(sourceSide) === verticalSide(targetSide);
  // Match the renderer's subpixel anchor round-trip tolerance before direct checks.
  if (sameAxis) {
    const axis = verticalSide(sourceSide) ? 'y' : 'x';
    if (Math.abs(a[axis] - b[axis]) < 1e-6) a = { ...a, [axis]: b[axis] };
  }
  const facingGap = (b.x - a.x) * sd.x + (b.y - a.y) * sd.y;
  const run =
    sameAxis && sd.x === -td.x && sd.y === -td.y && facingGap > 0
      ? Math.min(28, facingGap / 2)
      : 28;
  const availableRun = (tip: Point, delta: Point) => {
    let available = run;
    for (const box of boxes) {
      if (delta.x && tip.y > box.y && tip.y < box.y + box.height) {
        const gap = delta.x > 0 ? box.x - tip.x : tip.x - box.x - box.width;
        if (gap > 0) available = Math.min(available, gap / 2);
      }
      if (delta.y && tip.x > box.x && tip.x < box.x + box.width) {
        const gap = delta.y > 0 ? box.y - tip.y : tip.y - box.y - box.height;
        if (gap > 0) available = Math.min(available, gap / 2);
      }
    }
    return available;
  };
  const sourceRun = availableRun(a, sd),
    targetRun = availableRun(b, td);
  const s = { x: a.x + sd.x * sourceRun, y: a.y + sd.y * sourceRun },
    t = { x: b.x + td.x * targetRun, y: b.y + td.y * targetRun };
  const candidates = [
    [a, b],
    [a, s, { x: s.x, y: t.y }, t, b],
    [a, s, { x: t.x, y: s.y }, t, b],
    [a, s, { x: (s.x + t.x) / 2, y: s.y }, { x: (s.x + t.x) / 2, y: t.y }, t, b],
    [a, s, { x: s.x, y: (s.y + t.y) / 2 }, { x: t.x, y: (s.y + t.y) / 2 }, t, b],
  ];
  if (lanes) {
    for (const offset of [16, 32, 48]) {
      if (verticalSide(sourceSide) && verticalSide(targetSide)) {
        for (const x of [s.x + sd.x * offset, t.x + td.x * offset])
          candidates.push([a, s, { x, y: s.y }, { x, y: t.y }, t, b]);
      } else if (!verticalSide(sourceSide) && !verticalSide(targetSide)) {
        for (const y of [s.y + sd.y * offset, t.y + td.y * offset])
          candidates.push([a, s, { x: s.x, y }, { x: t.x, y }, t, b]);
      }
    }
  }
  return candidates
    .map(simplifyRoute)
    .filter((points) => respectsPorts(points, sourceSide, targetSide));
}

function chooseSides(
  source: AutoArrangeBox,
  target: AutoArrangeBox,
  counts: Map<string, number>,
  obstacles: readonly AutoArrangeBox[],
): [Side, Side] {
  let best: [Side, Side] = ['top', 'right'],
    bestCost = Infinity;
  const sourceCosts = new Map(
    sides.map((side) => [
      side,
      sideCost(source, target, side, counts.get(countKey(source, side)) ?? 0, obstacles),
    ]),
  );
  const targetCosts = new Map(
    sides.map((side) => [
      side,
      sideCost(target, source, side, counts.get(countKey(target, side)) ?? 0, obstacles),
    ]),
  );
  for (const sourceSide of sides)
    for (const targetSide of sides) {
      if (source.id === target.id && sourceSide === targetSide) continue;
      const sourceAnchor = { side: sourceSide, ratio: 0.5 },
        targetAnchor = { side: targetSide, ratio: 0.5 };
      // Measure facing boundaries, allowing the attachment to approach a corner.
      for (const [box, other, anchor] of [
        [source, target, sourceAnchor],
        [target, source, targetAnchor],
      ] as const) {
        const axis = verticalSide(anchor.side) ? 'y' : 'x',
          extent = span(box, anchor.side),
          margin = Math.min(16, extent / 2);
        anchor.ratio = clamp(center(other)[axis] - box[axis], margin, extent - margin) / extent;
      }
      const a = portPoint(source, sourceAnchor),
        b = portPoint(target, targetAnchor);
      let pathCost = Infinity;
      for (const points of cheapCandidates(a, b, sourceSide, targetSide, obstacles)) {
        if (!validPoints(points, obstacles)) continue;
        let cost = Math.max(0, points.length - 2) * 48;
        for (let i = 1; i < points.length; i++) cost += length(points[i - 1]!, points[i]!);
        pathCost = Math.min(pathCost, cost);
      }
      const cost =
        (Number.isFinite(pathCost) ? pathCost : length(a, b) + 700) +
        sourceCosts.get(sourceSide)! +
        targetCosts.get(targetSide)!;
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
    // Saved renderer paths reject repeated points and overlapping portions of their own path.
    for (let j = 1; j < i; j++) {
      const c = points[j - 1]!,
        d = points[j]!;
      if (
        a.x === b.x &&
        c.x === d.x &&
        a.x === c.x &&
        Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) >
          Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))
      )
        return false;
      if (
        a.y === b.y &&
        c.y === d.y &&
        a.y === c.y &&
        Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) >
          Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))
      )
        return false;
    }
  }
  return new Set(points.map((point) => `${point.x},${point.y}`)).size === points.length;
}

function clearInterior(
  points: readonly Point[],
  boxes: readonly AutoArrangeBox[],
  source: AutoArrangeBox,
  target: AutoArrangeBox,
) {
  for (let i = 1; i < points.length; i++)
    for (const box of boxes) {
      // The tip is intentionally eight units outside the card; its own terminal
      // segment may leave the expanded card. Other segments keep router clearance.
      if ((box.id === source.id && i === 1) || (box.id === target.id && i === points.length - 1))
        continue;
      if (
        segmentCrossesBounds(points[i - 1]!, points[i]!, {
          x: box.x - 18,
          y: box.y - 18,
          width: box.width + 36,
          height: box.height + 36,
        })
      )
        return false;
    }
  return true;
}

/** Remove redundant detours without changing the outward endpoint direction. */
function tidyRoute(
  points: Point[],
  boxes: readonly AutoArrangeBox[],
  sourceSide: Side,
  targetSide: Side,
  additionalScore: (points: readonly Point[]) => number,
  source: AutoArrangeBox,
  target: AutoArrangeBox,
) {
  const pathScore = (candidate: readonly Point[]) => {
    let cost = Math.max(0, candidate.length - 2) * 48 + additionalScore(candidate);
    for (let i = 1; i < candidate.length; i++) cost += length(candidate[i - 1]!, candidate[i]!);
    return cost;
  };
  let best = points,
    bestScore = pathScore(points);
  const consider = (candidate: Point[]) => {
    candidate = simplifyRoute(candidate);
    if (
      !respectsPorts(candidate, sourceSide, targetSide) ||
      !validPoints(candidate, boxes) ||
      !clearInterior(candidate, boxes, source, target) ||
      length(candidate[0]!, candidate[1]!) < Math.min(28, length(points[0]!, points[1]!)) ||
      length(candidate.at(-1)!, candidate.at(-2)!) <
        Math.min(28, length(points.at(-1)!, points.at(-2)!))
    )
      return;
    const cost = pathScore(candidate);
    if (cost < bestScore) {
      best = candidate;
      bestScore = cost;
    }
  };
  for (const candidate of cheapCandidates(
    points[0]!,
    points.at(-1)!,
    sourceSide,
    targetSide,
    boxes,
    true,
  ))
    consider(candidate);
  // Fold an interior staircase into either of its two orthogonal corners.
  for (let i = 1; i + 2 < best.length; i++) {
    const a = best[i]!,
      b = best[i + 2]!;
    for (const corner of [
      { x: a.x, y: b.y },
      { x: b.x, y: a.y },
    ])
      consider([...best.slice(0, i + 1), corner, ...best.slice(i + 2)]);
  }
  // Preserve a short straight launch/landing instead of the regular router's long stub.
  for (const start of [true, false]) {
    if (best.length < 4) break;
    const ordered = start ? best : [...best].reverse(),
      endpoint = ordered[0]!,
      turn = ordered[1]!;
    const axis = endpoint.x === turn.x ? 'y' : 'x';
    if (length(endpoint, turn) <= 28) continue;
    const candidate = ordered.map((point) => ({ ...point }));
    candidate[1]![axis] = candidate[2]![axis] =
      endpoint[axis] + Math.sign(turn[axis] - endpoint[axis]) * 28;
    consider(start ? candidate : candidate.reverse());
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
  const sourceSide = sourceEnd.side,
    targetSide = targetEnd.side;
  if (!bend) {
    let best: Point[] | undefined,
      bestScore = Infinity;
    for (const candidate of cheapCandidates(
      portPoint(source, sourceEnd.anchor!),
      portPoint(target, targetEnd.anchor!),
      sourceSide,
      targetSide,
      boxes,
      true,
    )) {
      if (!validPoints(candidate, boxes) || !clearInterior(candidate, boxes, source, target))
        continue;
      const penalty = selection.additionalScore!(candidate);
      if (candidate.length === 2 && penalty === 0) return candidate;
      let cost = Math.max(0, candidate.length - 2) * 48 + penalty;
      for (let i = 1; i < candidate.length; i++) cost += length(candidate[i - 1]!, candidate[i]!);
      if (cost < bestScore) {
        best = candidate;
        bestScore = cost;
      }
    }
    if (
      best &&
      (selection.additionalScore!(best) === 0 ||
        (current &&
          bestScore <
            routeQuality(
              -1,
              current.points,
              current.segments,
              occupied.filter((item) => item !== current),
            )))
    )
      return best;
  }
  selection.corridorXs = nearbyLanes(false);
  selection.corridorYs = nearbyLanes(true);
  const key = `${source.id}\0${target.id}`;
  let context = contexts.get(key);
  if (!context) {
    const obstacles = boxes.filter((box) => box.id !== source.id && box.id !== target.id);
    context = createRelationRoutingContext(source, target, obstacles, budget);
    contexts.set(key, context);
  }
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
  return tidyRoute(
    points,
    boxes,
    sourceSide,
    targetSide,
    selection.additionalScore!,
    source,
    target,
  );
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
  // Align paired ports only inside their ordered, separated feasible intervals.
  for (const placement of placements) {
    const { source, target, sourceEnd, targetEnd } = placement;
    if (source.id === target.id || verticalSide(sourceEnd.side) !== verticalSide(targetEnd.side))
      continue;
    const sd = direction(sourceEnd.side),
      td = direction(targetEnd.side);
    if (sd.x !== -td.x || sd.y !== -td.y) continue;
    const axis = verticalSide(sourceEnd.side) ? 'y' : 'x';
    const interval = (box: AutoArrangeBox, end: Endpoint) => {
      const group = endpointGroups.get(countKey(box, end.side))!,
        index = group.indexOf(end),
        extent = span(box, end.side),
        margin = Math.min(16, extent / 2),
        gap = Math.min(12, (extent - 2 * margin) / Math.max(1, group.length - 1));
      return [
        box[axis] + (index ? group[index - 1]!.anchor!.ratio * extent + gap : margin),
        box[axis] +
          (index + 1 < group.length
            ? group[index + 1]!.anchor!.ratio * extent - gap
            : extent - margin),
      ];
    };
    const a = interval(source, sourceEnd),
      b = interval(target, targetEnd),
      low = Math.max(a[0]!, b[0]!),
      high = Math.min(a[1]!, b[1]!);
    if (low > high) continue;
    const coordinate = clamp(
        (portPoint(source, sourceEnd.anchor!)[axis] + portPoint(target, targetEnd.anchor!)[axis]) /
          2,
        low,
        high,
      ),
      sourceAnchor = {
        side: sourceEnd.side,
        ratio: (coordinate - source[axis]) / span(source, sourceEnd.side),
      },
      targetAnchor = {
        side: targetEnd.side,
        ratio: (coordinate - target[axis]) / span(target, targetEnd.side),
      },
      points = [portPoint(source, sourceAnchor), portPoint(target, targetAnchor)];
    points[0]![axis] = points[1]![axis];
    if (respectsPorts(points, sourceEnd.side, targetEnd.side) && validPoints(points, boxes)) {
      sourceEnd.anchor = sourceAnchor;
      targetEnd.anchor = targetAnchor;
    }
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
  // Separate colliding interior lanes with constant-sized shifts before invoking graph search.
  // Every accepted shift reduces the existing weighted objective and preserves endpoint runs.
  if (requestedPasses > 0) {
    let laneShifts = 0;
    localRoutes: for (let index = 0; index < routed.length; index++) {
      const item = routed[index]!;
      if (
        !routed.some(
          (other, j) => j !== index && conflictCost(pairMetrics(item.segments, other.segments)) > 0,
        )
      )
        continue;
      const original = item.points;
      let best = original,
        bestSegments = item.segments,
        bestQuality = routeQuality(index, best, bestSegments, routed);
      for (let segment = 1; segment + 2 < original.length; segment++) {
        const axis = original[segment]!.x === original[segment + 1]!.x ? 'x' : 'y';
        for (const shift of [-16, 16, -32, 32]) {
          if (laneShifts++ >= 2048) break localRoutes;
          const candidate = original.map((point) => ({ ...point }));
          candidate[segment]![axis] += shift;
          candidate[segment + 1]![axis] += shift;
          if (
            !validPoints(candidate, boxes) ||
            !clearInterior(candidate, boxes, item.placement.source, item.placement.target) ||
            !respectsPorts(
              candidate,
              item.placement.sourceEnd.side,
              item.placement.targetEnd.side,
            ) ||
            length(candidate[0]!, candidate[1]!) <
              Math.min(28, length(original[0]!, original[1]!)) ||
            length(candidate.at(-1)!, candidate.at(-2)!) <
              Math.min(28, length(original.at(-1)!, original.at(-2)!))
          )
            continue;
          const candidateSegments = segments(candidate),
            quality = routeQuality(index, candidate, candidateSegments, routed);
          if (quality < bestQuality) {
            best = candidate;
            bestSegments = candidateSegments;
            bestQuality = quality;
          }
        }
      }
      item.points = best;
      item.segments = bestSegments;
    }
  }
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
  const centered = centerRelationRouteCorridors(
    routed.map(({ placement, points, segments: routeSegments }) => ({
      id: placement.relation.id,
      sourceId: placement.source.id,
      targetId: placement.target.id,
      points,
      segments: routeSegments,
    })),
    boxes,
  );
  routed.forEach((item, index) => {
    if (item.points === centered[index]) return;
    item.points = centered[index]!;
    item.segments = segments(item.points);
  });
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
