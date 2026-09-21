import { describe, it, expect } from 'vitest';
import { relationGeometry, segmentCrossesBounds } from './relation-routing.js';
const a = { x: 0, y: 0, width: 280, height: 220 };
describe('orthogonal obstacle-aware relation routing', () => {
  for (const [name, b] of Object.entries({
    right: { ...a, x: 650 },
    left: { ...a, x: -650 },
    below: { ...a, y: 550 },
    above: { ...a, y: -550 },
    tight: { ...a, x: 300, y: 15 },
  }))
    it(name + ' keeps every segment and endpoint outside table interiors', () => {
      const route = relationGeometry(a, b, 160, 0);
      expect(route.points.length).toBeGreaterThan(1);
      for (let i = 1; i < route.points.length; i++) {
        const p = route.points[i - 1]!,
          q = route.points[i]!;
        expect(p.x === q.x || p.y === q.y).toBe(true);
        expect(segmentCrossesBounds(p, q, a)).toBe(false);
        expect(segmentCrossesBounds(p, q, b)).toBe(false);
      }
    });
  it('detours around a third table and has no zero-length or redundant bends', () => {
    const b = { ...a, x: 1000 },
      obstacle = { x: 460, y: -80, width: 280, height: 440 };
    const route = relationGeometry(a, b, 160, 0, 0, undefined, [obstacle]);
    for (let i = 1; i < route.points.length; i++)
      expect(segmentCrossesBounds(route.points[i - 1]!, route.points[i]!, obstacle)).toBe(false);
    for (let i = 1; i < route.points.length - 1; i++) {
      const p = route.points[i - 1]!,
        q = route.points[i]!,
        r = route.points[i + 1]!;
      expect((p.x === q.x && q.x === r.x) || (p.y === q.y && q.y === r.y)).toBe(false);
    }
  });
  it('keeps manual routing outside both endpoint tables even when the handle is dragged inside one', () => {
    const b = { ...a, x: 650 };
    const route = relationGeometry(a, b, 160, 0, 0, { x: 140, y: 110 });
    for (let i = 1; i < route.points.length; i++)
      for (const box of [a, b])
        expect(segmentCrossesBounds(route.points[i - 1]!, route.points[i]!, box)).toBe(false);
  });
  it('draws self references through distinct exterior attachment points', () => {
    const route = relationGeometry(a, a, 140, 0);
    expect(route.points[0]).not.toEqual(route.points.at(-1));
    for (let i = 1; i < route.points.length; i++)
      expect(segmentCrossesBounds(route.points[i - 1]!, route.points[i]!, a)).toBe(false);
  });
});

it('does not retrace the path when a manual bend is close to an attachment stub', () => {
  const route = relationGeometry(a, { ...a, x: 650 }, 160, 0, 0, { x: 300, y: 150 });
  const keys = route.points.map((p) => p.x + ',' + p.y);
  expect(new Set(keys).size).toBe(keys.length);
  expect(
    route.points.some((p, i) => {
      const q = route.points[i + 1];
      return (
        q && p.x === 300 && q.x === 300 && Math.min(p.y, q.y) <= 150 && Math.max(p.y, q.y) >= 150
      );
    }),
  ).toBe(true);
});
