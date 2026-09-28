import { expect, it } from 'vitest';
import { relationGeometry } from './relation-routing.js';
import { relationGeometryReference } from './relation-routing.reference.js';

it('preserves automatic ties and manual-bend fallback over deterministic varied scenes', () => {
  let seed = 20260928;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let i = 0; i < 60; i++) {
    const a = {
      x: (next() % 1000) / 10 - 50,
      y: (next() % 1000) / 10 - 50,
      width: 240,
      height: 180,
    };
    const b =
      i % 10 === 0
        ? a
        : { x: 500 + (next() % 300), y: (next() % 500) - 250, width: 240, height: 180 };
    const obstacles = Array.from({ length: 8 }, () => ({
      x: (next() % 1600) - 300,
      y: (next() % 1200) - 300,
      width: 60 + (next() % 180),
      height: 60 + (next() % 180),
    }));
    const bend = i % 3 === 0 ? { x: -400, y: -400 } : undefined;
    const options =
      i % 4 === 0
        ? {
            sourceAnchor: { side: 'right' as const, ratio: 0.5 },
            targetAnchor: { side: 'left' as const, ratio: 0.5 },
          }
        : {};
    const args = [a, b, 120, i % 4, 0, bend, obstacles, options] as const;
    expect(relationGeometry(...args)).toEqual(relationGeometryReference(...args));
  }
}, 10000);
