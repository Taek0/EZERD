import { segmentCrossesBounds, type Point, type RelationBounds } from './relation-routing.js';

export interface CorridorRoute {
  id: string;
  sourceId: string;
  targetId: string;
  points: Point[];
  segments?: readonly Segment[];
}
type Box = RelationBounds & { id: string };
export type Segment = { horizontal: boolean; fixed: number; low: number; high: number };
type Lane = Segment & { route: number; segment: number; min: number; max: number };
type Group = {
  lanes: Lane[];
  horizontal: boolean;
  low: number;
  high: number;
  min: number;
  max: number;
};
const GAP = 16;
const MIN_SPAN = 64;
const MAX_LANES = 1024;
const MAX_CANDIDATES = 512;
const MAX_CENTER_EVENTS = 2048;
const MAX_PAIR_CHECKS = 100_000;
const MAX_PRIMITIVE_CHECKS = 1_000_000;
type Budget = { remaining: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
function segments(points: readonly Point[]): Segment[] {
  return points.slice(1).map((b, i) => {
    const a = points[i]!,
      horizontal = a.y === b.y;
    return {
      horizontal,
      fixed: horizontal ? a.y : a.x,
      low: Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y),
      high: Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y),
    };
  });
}
function conflicts(a: readonly Segment[], b: readonly Segment[], budget: Budget) {
  let crossings = 0,
    overlap = 0,
    spacing = 0;
  for (const x of a)
    for (const y of b) {
      if (--budget.remaining < 0) return null;
      if (x.horizontal === y.horizontal) {
        const common = Math.min(x.high, y.high) - Math.max(x.low, y.low);
        if (common <= 0) continue;
        const gap = Math.abs(x.fixed - y.fixed);
        if (gap === 0) overlap += common;
        else if (gap < 12) spacing++;
      } else {
        const h = x.horizontal ? x : y,
          v = x.horizontal ? y : x;
        if (v.fixed > h.low && v.fixed < h.high && h.fixed > v.low && h.fixed < v.high) crossings++;
      }
    }
  return { crossings, overlap, spacing };
}

/** Bounded postprocess for explicit auto arrangement; ordinary routing never calls it. */
export function centerRelationRouteCorridors(
  routes: readonly CorridorRoute[],
  boxes: readonly Box[],
): Point[][] {
  const result = routes.map((route) => route.points);
  const budget: Budget = { remaining: MAX_PRIMITIVE_CHECKS };
  const expanded = boxes.map((box) => ({
    id: box.id,
    x: box.x - 18,
    y: box.y - 18,
    width: box.width + 36,
    height: box.height + 36,
  }));
  // Both orientation indexes share the same prepared clearance bounds.
  const indexes = [false, true].map((horizontal) =>
    expanded
      .map((box) => ({
        low: horizontal ? box.x : box.y,
        high: horizontal ? box.x + box.width : box.y + box.height,
        min: horizontal ? box.y : box.x,
        max: horizontal ? box.y + box.height : box.x + box.width,
      }))
      .sort((a, b) => a.low - b.low),
  );
  const cached = routes.map((route) => route.segments ?? segments(route.points)),
    lanes: Lane[] = [];
  for (let route = 0; route < routes.length && lanes.length < MAX_LANES; route++) {
    const points = result[route]!;
    let best: Lane | undefined;
    // One lane per route keeps later groups independent of earlier changes.
    for (let segment = 1; segment + 1 < cached[route]!.length; segment++) {
      if (--budget.remaining < 0) return result;
      const value = cached[route]![segment]!;
      if (value.high - value.low < MIN_SPAN) continue;
      let min = -Infinity,
        max = Infinity;
      for (const obstacle of indexes[value.horizontal ? 1 : 0]!) {
        if (--budget.remaining < 0) return result;
        if (obstacle.low >= value.high) break;
        if (obstacle.high <= value.low) continue;
        if (obstacle.max <= value.fixed) min = Math.max(min, obstacle.max);
        else if (obstacle.min >= value.fixed) max = Math.min(max, obstacle.min);
        else {
          min = Infinity;
          break;
        }
      }
      if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) continue;
      const lane = { ...value, route, segment, min, max };
      if (!best || lane.high - lane.low > best.high - best.low) best = lane;
    }
    if (best) lanes.push(best);
  }
  lanes.sort(
    (a, b) =>
      Number(a.horizontal) - Number(b.horizontal) ||
      a.fixed - b.fixed ||
      a.low - b.low ||
      routes[a.route]!.id.localeCompare(routes[b.route]!.id, 'en'),
  );
  const groups: Group[] = [];
  for (const lane of lanes) {
    const group = groups.find(
      (value) =>
        --budget.remaining >= 0 &&
        value.horizontal === lane.horizontal &&
        Math.min(value.high, lane.high) - Math.max(value.low, lane.low) >= MIN_SPAN / 2 &&
        Math.max(value.min, lane.min) <= value.lanes[0]!.fixed &&
        Math.min(value.max, lane.max) >= lane.fixed,
    );
    if (budget.remaining < 0) return result;
    if (group) {
      group.lanes.push(lane);
      group.low = Math.max(group.low, lane.low);
      group.high = Math.min(group.high, lane.high);
      group.min = Math.max(group.min, lane.min);
      group.max = Math.min(group.max, lane.max);
    } else
      groups.push({
        lanes: [lane],
        horizontal: lane.horizontal,
        low: lane.low,
        high: lane.high,
        min: lane.min,
        max: lane.max,
      });
  }
  const valid = (routeIndex: number, candidate: readonly Point[]) => {
    const route = routes[routeIndex]!,
      original = route.points;
    if (new Set(candidate.map((p) => `${p.x},${p.y}`)).size !== candidate.length) return false;
    for (let i = 1; i < candidate.length; i++) {
      const a = candidate[i - 1]!,
        b = candidate[i]!,
        c = original[i - 1]!,
        d = original[i]!;
      // Identical segment directions preserve bend count, port faces, and no backtracking.
      if (
        Math.sign(b.x - a.x) !== Math.sign(d.x - c.x) ||
        Math.sign(b.y - a.y) !== Math.sign(d.y - c.y)
      )
        return false;
      if ((i === 1 || i === candidate.length - 1) && distance(a, b) < Math.min(28, distance(c, d)))
        return false;
      for (const box of expanded) {
        if (--budget.remaining < 0) return false;
        if (
          (i === 1 && box.id === route.sourceId) ||
          (i === candidate.length - 1 && box.id === route.targetId)
        )
          continue;
        if (segmentCrossesBounds(a, b, box)) return false;
      }
    }
    const own = segments(candidate);
    for (let i = 0; i < own.length; i++)
      for (let j = 0; j < i; j++) {
        const pair = conflicts([own[i]!], [own[j]!], budget);
        if (!pair || pair.overlap > 0 || pair.crossings > 0) return false;
      }
    return true;
  };
  let candidates = 0,
    pairChecks = 0;
  for (const group of groups) {
    const axis = group.horizontal ? 'y' : 'x';
    const offsets = group.lanes.map((_, i) => (i - (group.lanes.length - 1) / 2) * GAP);
    const ideal = (group.min + group.max) / 2;
    const originalCenter = (group.lanes[0]!.fixed + group.lanes.at(-1)!.fixed) / 2;
    const originalDistance = Math.abs(originalCenter - ideal);
    if (group.lanes.every((lane, i) => lane.fixed === ideal + offsets[i]!)) continue;
    let min = group.min - offsets[0]!,
      max = group.max - offsets.at(-1)!;
    for (let i = 0; i < group.lanes.length; i++) {
      const lane = group.lanes[i]!,
        points = result[lane.route]!,
        offset = offsets[i]!;
      for (const [tipIndex, turnIndex] of [
        [lane.segment - 1, lane.segment],
        [lane.segment + 2, lane.segment + 1],
      ]) {
        const tip = points[tipIndex!]!,
          turn = points[turnIndex!]!;
        const protection =
          tipIndex === 0 || tipIndex === points.length - 1 ? Math.min(28, distance(tip, turn)) : 1;
        if (turn[axis] > tip[axis]) min = Math.max(min, tip[axis] + protection - offset);
        else max = Math.min(max, tip[axis] - protection - offset);
      }
    }
    if (min > max) continue;
    // Adjacent runs can hit obstacles or other lanes before the middle segment does.
    // Their boundary events give a small, deterministic set of fallback centers.
    const centers = new Set<number>();
    const addCenter = (value: number) => {
      if (value < min || value > max || Math.abs(value - ideal) > originalDistance + 1e-6)
        return true;
      centers.add(value);
      return centers.size <= MAX_CENTER_EVENTS;
    };
    for (const value of [clamp(ideal, min, max), originalCenter, min, max]) addCenter(value);
    for (let i = 0; i < group.lanes.length; i++) {
      const offset = offsets[i]!;
      for (const box of expanded)
        for (const boundary of axis === 'x'
          ? [box.x, box.x + box.width]
          : [box.y, box.y + box.height]) {
          if (--budget.remaining < 0) return result;
          const value = boundary - offset;
          if (!addCenter(value)) return result;
        }
    }
    const changed = new Set(group.lanes.map((lane) => lane.route));
    for (let i = 0; i < group.lanes.length; i++) {
      const offset = offsets[i]!;
      for (let route = 0; route < cached.length; route++) {
        if (changed.has(route)) continue;
        for (const segment of cached[route]!) {
          if (--budget.remaining < 0) return result;
          const boundaries =
            segment.horizontal === group.horizontal
              ? [segment.fixed - GAP, segment.fixed, segment.fixed + GAP]
              : [segment.low, segment.high];
          for (const boundary of boundaries) {
            if (--budget.remaining < 0) return result;
            const value = boundary - offset;
            if (!addCenter(value)) return result;
          }
        }
      }
    }
    const comparisons: {
      a: number;
      b: number;
      original: NonNullable<ReturnType<typeof conflicts>>;
    }[] = [];
    for (const a of changed)
      for (let b = 0; b < routes.length; b++) {
        if (a === b || (changed.has(b) && b < a)) continue;
        if (++pairChecks > MAX_PAIR_CHECKS) return result;
        const original = conflicts(cached[a]!, cached[b]!, budget);
        if (!original) return result;
        comparisons.push({ a, b, original });
      }
    for (const coordinate of [...centers]
      .filter(
        (value) =>
          value >= min && value <= max && Math.abs(value - ideal) <= originalDistance + 1e-6,
      )
      .sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal) || a - b)
      .slice(0, 8)) {
      if (++candidates > MAX_CANDIDATES) return result;
      const proposed = new Map<number, Point[]>(),
        proposedSegments = new Map<number, Segment[]>();
      let acceptable = true;
      for (let i = 0; i < group.lanes.length; i++) {
        const lane = group.lanes[i]!,
          points = result[lane.route]!.map((p) => ({ ...p }));
        points[lane.segment]![axis] = points[lane.segment + 1]![axis] = coordinate + offsets[i]!;
        if (!valid(lane.route, points)) {
          if (budget.remaining < 0) return result;
          acceptable = false;
          break;
        }
        proposed.set(lane.route, points);
        proposedSegments.set(lane.route, segments(points));
      }
      if (!acceptable) continue;
      for (const { a, b, original } of comparisons) {
        if (++pairChecks > MAX_PAIR_CHECKS) return result;
        const pair = conflicts(
          proposedSegments.get(a) ?? cached[a]!,
          proposedSegments.get(b) ?? cached[b]!,
          budget,
        );
        if (!pair) return result;
        if (
          pair.crossings > original.crossings ||
          pair.overlap > original.overlap ||
          pair.spacing > original.spacing
        ) {
          acceptable = false;
          break;
        }
      }
      if (!acceptable) continue;
      for (const [index, points] of proposed) {
        result[index] = points;
        cached[index] = proposedSegments.get(index)!;
      }
      break;
    }
  }
  return result;
}
