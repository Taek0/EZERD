import type { Point, RelationBounds } from './relation-routing.js';

type Interval = { start: number; end: number };
type Crosses = (a: Point, b: Point, box: RelationBounds) => boolean;

/** Exact open-boundary queries over a fixed obstacle set, scoped to one route calculation. */
export function createPathClear(boxes: readonly RelationBounds[], crosses: Crosses) {
  const horizontal = new Map<number, Interval[]>();
  const vertical = new Map<number, Interval[]>();
  const indexable =
    boxes.length >= 8 &&
    boxes.every(
      (box) =>
        [box.x, box.y, box.width, box.height, box.x + box.width, box.y + box.height].every(
          Number.isFinite,
        ) &&
        box.width >= 0 &&
        box.height >= 0,
    );
  const intervalsAt = (coordinate: number, isVertical: boolean) => {
    const cache = isVertical ? vertical : horizontal;
    let intervals = cache.get(coordinate);
    if (intervals) return intervals;
    const ordered: Interval[] = [];
    for (const box of boxes) {
      const min = isVertical ? box.x : box.y;
      const max = min + (isVertical ? box.width : box.height);
      if (coordinate > min && coordinate < max) {
        const start = isVertical ? box.y : box.x;
        ordered.push({ start, end: start + (isVertical ? box.height : box.width) });
      }
    }
    ordered.sort((a, b) => a.start - b.start || a.end - b.end);
    intervals = [];
    for (const interval of ordered) {
      const last = intervals.at(-1);
      // Touching open intervals must remain separate: their shared boundary is clear.
      if (last && interval.start < last.end) last.end = Math.max(last.end, interval.end);
      else intervals.push({ ...interval });
    }
    cache.set(coordinate, intervals);
    return intervals;
  };
  const blocked = (a: Point, b: Point) => {
    if (!indexable || ![a.x, a.y, b.x, b.y].every(Number.isFinite))
      return boxes.some((box) => crosses(a, b, box));
    const isVertical = a.x === b.x;
    if (!isVertical && a.y !== b.y) return boxes.length > 0;
    const intervals = intervalsAt(isVertical ? a.x : a.y, isVertical);
    const low = Math.min(isVertical ? a.y : a.x, isVertical ? b.y : b.x);
    const high = Math.max(isVertical ? a.y : a.x, isVertical ? b.y : b.x);
    let left = 0,
      right = intervals.length;
    while (left < right) {
      const mid = (left + right) >>> 1;
      if (intervals[mid]!.end <= low) left = mid + 1;
      else right = mid;
    }
    return left < intervals.length && intervals[left]!.start < high;
  };
  return (points: readonly Point[]) => {
    for (let i = 1; i < points.length; i++) if (blocked(points[i - 1]!, points[i]!)) return false;
    return true;
  };
}

/** Shared, bounded coordinate indexes used only by an explicit automatic arrangement. */
export function createAutoObstacleQueries(boxes: readonly RelationBounds[], crosses: Crosses) {
  type Entry = { low: number; high: number; box: RelationBounds };
  type Node = { center: number; spans: Entry[]; left: Node | undefined; right: Node | undefined };
  const build = (entries: Entry[]): Node | undefined => {
    if (!entries.length) return undefined;
    const centers = entries.map((entry) => (entry.low + entry.high) / 2).sort((a, b) => a - b);
    const center = centers[centers.length >>> 1]!;
    const left: Entry[] = [],
      right: Entry[] = [],
      spans: Entry[] = [];
    for (const entry of entries) {
      if (entry.high < center) left.push(entry);
      else if (entry.low > center) right.push(entry);
      else spans.push(entry);
    }
    return { center, spans, left: build(left), right: build(right) };
  };
  const indexable = boxes.every(
    (box) =>
      [box.x, box.y, box.width, box.height, box.x + box.width, box.y + box.height].every(
        Number.isFinite,
      ) &&
      box.width >= 0 &&
      box.height >= 0,
  );
  const xIndex = indexable
    ? build(boxes.map((box) => ({ low: box.x, high: box.x + box.width, box })))
    : undefined;
  const yIndex = indexable
    ? build(boxes.map((box) => ({ low: box.y, high: box.y + box.height, box })))
    : undefined;
  const horizontal = new Map<number, Interval[]>(),
    vertical = new Map<number, Interval[]>();
  const intervalsAt = (coordinate: number, isVertical: boolean) => {
    const cache = isVertical ? vertical : horizontal;
    const cached = cache.get(coordinate);
    if (cached) return cached;
    const ordered: Interval[] = [];
    let node = isVertical ? xIndex : yIndex;
    while (node) {
      for (const { low, high, box } of node.spans) {
        if (coordinate > low && coordinate < high) {
          const start = isVertical ? box.y : box.x;
          ordered.push({ start, end: start + (isVertical ? box.height : box.width) });
        }
      }
      node =
        coordinate < node.center ? node.left : coordinate > node.center ? node.right : undefined;
    }
    ordered.sort((a, b) => a.start - b.start || a.end - b.end);
    const intervals: Interval[] = [];
    for (const interval of ordered) {
      const last = intervals.at(-1);
      if (last && interval.start < last.end) last.end = Math.max(last.end, interval.end);
      else intervals.push({ ...interval });
    }
    // The context may span every relation, so cache storage must not grow with search count.
    if (cache.size >= 512) cache.delete(cache.keys().next().value!);
    cache.set(coordinate, intervals);
    return intervals;
  };
  const segmentClear = (a: Point, b: Point) => {
    if (!indexable || ![a.x, a.y, b.x, b.y].every(Number.isFinite))
      return !boxes.some((box) => crosses(a, b, box));
    const isVertical = a.x === b.x;
    if (!isVertical && a.y !== b.y) return boxes.length === 0;
    const intervals = intervalsAt(isVertical ? a.x : a.y, isVertical);
    const low = Math.min(isVertical ? a.y : a.x, isVertical ? b.y : b.x);
    const high = Math.max(isVertical ? a.y : a.x, isVertical ? b.y : b.x);
    let left = 0,
      right = intervals.length;
    while (left < right) {
      const mid = (left + right) >>> 1;
      if (intervals[mid]!.end <= low) left = mid + 1;
      else right = mid;
    }
    return left >= intervals.length || intervals[left]!.start >= high;
  };
  return {
    segmentClear,
    pointClear: (point: Point) => segmentClear(point, point),
    pathClear: (points: readonly Point[]) => {
      for (let i = 1; i < points.length; i++)
        if (!segmentClear(points[i - 1]!, points[i]!)) return false;
      return true;
    },
  };
}
