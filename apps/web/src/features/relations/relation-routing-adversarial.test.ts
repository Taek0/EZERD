import { describe, expect, it } from 'vitest';
import { relationGeometry, type Point } from './relation-routing.js';

const source = { x: 0, y: 0, width: 280, height: 220 };
const target = { x: 650, y: 0, width: 280, height: 220 };

function pointIsOnPolyline(point: Point, points: Point[]) {
  return points.slice(1).some((end, index) => {
    const start = points[index]!;
    if (start.x === end.x && point.x === start.x) {
      return point.y >= Math.min(start.y, end.y) && point.y <= Math.max(start.y, end.y);
    }
    if (start.y === end.y && point.y === start.y) {
      return point.x >= Math.min(start.x, end.x) && point.x <= Math.max(start.x, end.x);
    }
    return false;
  });
}

describe('adversarial manual relation routing', () => {
  it('keeps an exterior manual bend on the routed polyline', () => {
    const bend = { x: -300, y: -300 };
    const route = relationGeometry(source, target, 140, 0, 0, bend);

    expect(route.handle).toEqual(bend);
    expect(pointIsOnPolyline(route.handle, route.points)).toBe(true);
  });

  it('changes the polyline when an exterior bend moves farther along the same axis', () => {
    const first = relationGeometry(source, target, 140, 0, 0, { x: -300, y: -300 });
    const moved = relationGeometry(source, target, 140, 0, 0, { x: -360, y: -300 });

    expect(moved.path).not.toBe(first.path);
    expect(pointIsOnPolyline(moved.handle, moved.points)).toBe(true);
  });
});
