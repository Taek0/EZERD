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
