import { describe, expect, it } from 'vitest';
import {
  moveRelationSegment,
  relationAnchorAtPoint,
  relationGeometry,
  segmentCrossesBounds,
  type Point,
  type RelationBounds,
} from './relation-routing.js';

function expectOrthogonalAndClear(points: Point[], boxes: RelationBounds[]) {
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1]!;
    const end = points[index]!;
    expect(start.x === end.x || start.y === end.y).toBe(true);
    for (const box of boxes) expect(segmentCrossesBounds(start, end, box)).toBe(false);
  }
}

describe('adversarial persisted relation manipulation', () => {
  it('roundtrips lane-shifted anchors despite floating-point ratio error', () => {
    const source = { x: 0, y: 2 / 37, width: 300, height: 3002 / 29 };
    const target = { x: 800, y: 2 / 37, width: 300, height: 3002 / 29 };
    const endpointY = source.y + source.height / 2 - 22;
    const moved = [
      { x: source.x + source.width + 8, y: endpointY },
      { x: 350, y: endpointY },
      { x: 350, y: 180 },
      { x: 750, y: 180 },
      { x: 750, y: endpointY },
      { x: target.x - 8, y: endpointY },
    ];

    const persisted = JSON.parse(
      JSON.stringify({
        sourceAnchor: relationAnchorAtPoint(source, moved[0]!),
        targetAnchor: relationAnchorAtPoint(target, moved.at(-1)!),
        waypoints: moved.slice(1, -1),
      }),
    );
    const restored = relationGeometry(source, target, 100, 2, 0, undefined, [], persisted);

    expect(restored.points).toEqual(moved);
  });

  it('roundtrips a moved end segment with fractional bounds', () => {
    const source = { x: 10.1, y: 20.2, width: 313.7, height: 241.3 };
    const target = { x: 801.4, y: 463.6, width: 287.9, height: 219.7 };
    const original = relationGeometry(source, target, 140, 0);
    const moved = moveRelationSegment(original.points, 0, 37.25, [source, target]);
    expect(moved).not.toEqual(original.points);

    const persisted = JSON.parse(
      JSON.stringify({
        sourceAnchor: relationAnchorAtPoint(source, moved[0]!),
        targetAnchor: relationAnchorAtPoint(target, moved.at(-1)!),
        waypoints: moved.slice(1, -1),
      }),
    );
    const restored = relationGeometry(source, target, 140, 0, 0, undefined, [], persisted);

    expect(restored.points).toEqual(moved);
    expect(restored.points[0]).toEqual(moved[0]);
    expect(restored.points.at(-1)).toEqual(moved.at(-1));
    expectOrthogonalAndClear(restored.points, [source, target]);
  });

  it('keeps a serialized manual route outside a third-card obstacle', () => {
    const source = { x: 0.25, y: 0.5, width: 280.5, height: 220.25 };
    const target = { x: 760.75, y: 360.125, width: 300.25, height: 240.5 };
    const obstacle = { x: 390.5, y: 120.75, width: 180.25, height: 260.5 };
    const original = relationGeometry(source, target, 120, 0, 0, undefined, [obstacle]);
    const segmentIndex = Math.max(0, Math.floor((original.points.length - 2) / 2));
    const moved = moveRelationSegment(original.points, segmentIndex, -19.75, [
      source,
      target,
      obstacle,
    ]);
    expect(moved).not.toEqual(original.points);

    const persisted = JSON.parse(
      JSON.stringify({
        sourceAnchor: relationAnchorAtPoint(source, moved[0]!),
        targetAnchor: relationAnchorAtPoint(target, moved.at(-1)!),
        waypoints: moved.slice(1, -1),
      }),
    );
    const restored = relationGeometry(source, target, 120, 0, 0, undefined, [obstacle], persisted);

    expect(restored.points).toEqual(moved);
    expectOrthogonalAndClear(restored.points, [source, target, obstacle]);
  });
});
