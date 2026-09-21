import { expect, it } from 'vitest';
import {
  relationGeometry,
  relationAnchorAtPoint,
  moveRelationSegment,
  segmentCrossesBounds,
  type Point,
} from './relation-routing.js';
const a = { x: 0, y: 0, width: 480, height: 280 },
  b = { x: 900, y: 500, width: 480, height: 280 };
function orthogonal(points: Point[]) {
  for (let i = 1; i < points.length; i++)
    expect(points[i]!.x === points[i - 1]!.x || points[i]!.y === points[i - 1]!.y).toBe(true);
}
it('snaps endpoints to the nearest card edge and clamps ratios', () => {
  expect(relationAnchorAtPoint(a, { x: 500, y: 70 })).toEqual({ side: 'right', ratio: 0.25 });
  expect(relationAnchorAtPoint(a, { x: 120, y: -30 })).toEqual({ side: 'top', ratio: 0.25 });
  const corner = relationAnchorAtPoint(a, { x: -100, y: -500 });
  expect(corner.ratio).toBeGreaterThanOrEqual(0);
  expect(corner.ratio).toBeLessThanOrEqual(1);
});
it('routes around the cards while honoring dragged endpoint sides', () => {
  const route = relationGeometry(a, b, 140, 0, 0, undefined, [], {
    sourceAnchor: { side: 'bottom', ratio: 0.25 },
    targetAnchor: { side: 'top', ratio: 0.75 },
  });
  expect(route.points[0]).toEqual({ x: 120, y: 288 });
  expect(route.points.at(-1)).toEqual({ x: 1260, y: 492 });
  orthogonal(route.points);
  for (let i = 1; i < route.points.length; i++)
    for (const box of [a, b])
      expect(segmentCrossesBounds(route.points[i - 1]!, route.points[i]!, box)).toBe(false);
});
it('moves an interior segment without moving endpoints or changing the corner count', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 200, y: 100 },
  ];
  const moved = moveRelationSegment(points, 1, 40);
  expect(moved).toEqual([
    { x: 0, y: 0 },
    { x: 140, y: 0 },
    { x: 140, y: 100 },
    { x: 200, y: 100 },
  ]);
  expect(points[1]).toEqual({ x: 100, y: 0 });
  orthogonal(moved);
});
it('adds orthogonal connectors when moving a straight whole relation', () => {
  const points = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
    ],
    moved = moveRelationSegment(points, 0, 60);
  expect(moved[0]).toEqual(points[0]);
  expect(moved.at(-1)).toEqual(points.at(-1));
  expect(moved.some((p) => p.y === 60)).toBe(true);
  orthogonal(moved);
});
it('persists a moved route exactly through its waypoints and keeps arrows attached', () => {
  const original = relationGeometry(a, b, 140, 0);
  const index = Math.max(0, Math.floor((original.points.length - 2) / 2));
  const moved = moveRelationSegment(original.points, index, 35, [a, b]);
  const route = relationGeometry(a, b, 140, 0, 0, undefined, [], {
    sourceAnchor: relationAnchorAtPoint(a, moved[0]!),
    targetAnchor: relationAnchorAtPoint(b, moved.at(-1)!),
    waypoints: moved.slice(1, -1),
  });
  expect(route.points).toEqual(moved);
});
it('does not drag a segment through another table', () => {
  const points = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 400, y: 200 },
    ],
    obstacle = { x: 240, y: 40, width: 100, height: 120 };
  const moved = moveRelationSegment(points, 1, 100, [obstacle]);
  orthogonal(moved);
  for (let i = 1; i < moved.length; i++)
    expect(segmentCrossesBounds(moved[i - 1]!, moved[i]!, obstacle)).toBe(false);
});
