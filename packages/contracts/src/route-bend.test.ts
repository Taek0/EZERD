import { expect, it } from 'vitest';
import { relationLayoutSchema } from './workspace.js';
it('round trips old offsets and optional free-route bend coordinates', () => {
  const old = { relationId: 'r', viewId: 'd', offset: 32 };
  expect(relationLayoutSchema.parse(old)).toEqual(old);
  const next = { ...old, bend: { x: -550.5, y: 360 } };
  expect(relationLayoutSchema.parse(next)).toEqual(next);
  expect(relationLayoutSchema.safeParse({ ...old, bend: { x: Infinity, y: 0 } }).success).toBe(
    false,
  );
  expect(relationLayoutSchema.safeParse({ ...old, bend: { x: 0, y: 1e8 } }).success).toBe(false);
});

it('round trips endpoint anchors and interior segment waypoints', () => {
  const route = {
    relationId: 'r',
    viewId: 'd',
    offset: 0,
    sourceAnchor: { side: 'right', ratio: 0.25 },
    targetAnchor: { side: 'top', ratio: 0.75 },
    waypoints: [
      { x: 540, y: 120 },
      { x: 800, y: 120 },
      { x: 800, y: -40 },
    ],
  };
  expect(relationLayoutSchema.parse(route)).toEqual(route);
  expect(
    relationLayoutSchema.safeParse({ ...route, sourceAnchor: { side: 'center', ratio: 0.5 } })
      .success,
  ).toBe(false);
  expect(
    relationLayoutSchema.safeParse({ ...route, targetAnchor: { side: 'left', ratio: 1.1 } })
      .success,
  ).toBe(false);
  expect(
    relationLayoutSchema.safeParse({ ...route, waypoints: [{ x: Infinity, y: 0 }] }).success,
  ).toBe(false);
  expect(
    relationLayoutSchema.safeParse({
      ...route,
      waypoints: Array.from({ length: 129 }, () => ({ x: 0, y: 0 })),
    }).success,
  ).toBe(false);
});
