import { expect, it } from 'vitest';
import { createPathClear } from './obstacle-queries.js';
import {
  relationGeometry,
  segmentCrossesBounds,
  type Point,
  type RelationBounds,
} from './relation-routing.js';
import { relationGeometryReference } from './relation-routing.reference.js';
import { createPerformanceFixture } from '../../shared/performance/fixture.js';
import { prepareTableRelations } from './prepare-table-relations.js';

it('preserves every route in the 300-table scale fixture', () => {
  const doc = createPerformanceFixture(300, 10);
  const prepared = prepareTableRelations(doc, 'perf', 'physical');
  expect(prepared.filter(Boolean)).toHaveLength(300);
  for (const item of prepared) {
    if (!item) throw new Error('Unexpected missing route');
    expect(item.geometry).toEqual(
      relationGeometryReference(
        item.sourceBounds,
        item.targetBounds,
        item.labelWidth,
        0,
        0,
        undefined,
        item.obstacles,
      ),
    );
  }
}, 10000);

const linear = (points: Point[], boxes: RelationBounds[]) =>
  points.every(
    (point, i) => !i || !boxes.some((box) => segmentCrossesBounds(points[i - 1]!, point, box)),
  );

it('preserves open edges, touching intervals, zero-length paths and invalid-input fallback', () => {
  const boxes = Array.from({ length: 8 }, (_, i) => ({ x: 0, y: i * 10, width: 10, height: 10 }));
  const query = createPathClear(boxes, segmentCrossesBounds);
  const cases = [
    [],
    [{ x: 5, y: 10 }],
    [
      { x: 5, y: 10 },
      { x: 5, y: 10 },
    ],
    [
      { x: 5, y: 9 },
      { x: 5, y: 9 },
    ],
    [
      { x: 0, y: 0 },
      { x: 0, y: 80 },
    ],
    [
      { x: 5, y: 0 },
      { x: 5, y: 80 },
    ],
    [
      { x: -1, y: 10 },
      { x: 11, y: 10 },
    ],
    [
      { x: 0, y: 0 },
      { x: 10, y: 80 },
    ],
    [
      { x: Infinity, y: 1 },
      { x: Infinity, y: 3 },
    ],
  ];
  for (const path of cases) expect(query(path)).toBe(linear(path, boxes));
  const invalid = [...boxes, { x: 3, y: 0, width: -2, height: 10 }];
  expect(
    createPathClear(
      invalid,
      segmentCrossesBounds,
    )([
      { x: 0, y: 5 },
      { x: 10, y: 5 },
    ]),
  ).toBe(
    linear(
      [
        { x: 0, y: 5 },
        { x: 10, y: 5 },
      ],
      invalid,
    ),
  );
});

it('matches linear queries for deterministic random segments and obstacle edges', () => {
  let seed = 20260928;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % 401) - 200;
  const boxes = Array.from({ length: 80 }, () => ({
    x: random(),
    y: random(),
    width: Math.abs(random()) % 70,
    height: Math.abs(random()) % 70,
  }));
  const before = structuredClone(boxes);
  const query = createPathClear(boxes, segmentCrossesBounds);
  for (let i = 0; i < 2000; i++) {
    const a = { x: random(), y: random() },
      b = i % 2 ? { x: a.x, y: random() } : { x: random(), y: a.y };
    expect(query([a, b])).toBe(linear([a, b], boxes));
  }
  for (const box of boxes)
    for (const y of [box.y, box.y + box.height]) {
      const path = [
        { x: -300, y },
        { x: 300, y },
      ];
      expect(query(path)).toBe(linear(path, boxes));
    }
  expect(boxes).toEqual(before);
});

it('keeps complete routing output identical for automatic, manual and overlapping scenes', () => {
  const a = { x: 0, y: 0, width: 280, height: 220 };
  for (let variant = 0; variant < 20; variant++) {
    const b =
      variant % 5 === 0
        ? a
        : { x: 650 + (variant % 3) * 80, y: (variant % 4) * 100, width: 280, height: 220 };
    const obstacles = Array.from({ length: 12 }, (_, i) => ({
      x: ((i * 191 + variant * 37) % 1400) - 200,
      y: Math.floor(i / 4) * 340 + 300,
      width: 120 + (i % 3) * 20,
      height: 90,
    }));
    for (const manual of [false, true]) {
      const options = manual
        ? {
            sourceAnchor: { side: 'right' as const, ratio: 0.3 },
            targetAnchor: { side: 'left' as const, ratio: 0.6 },
            waypoints: [
              { x: 380, y: -150 },
              { x: 550, y: -150 },
            ],
          }
        : {};
      const args = [
        a,
        b,
        140,
        variant % 3,
        variant * 3,
        variant % 4 === 1 ? { x: 400, y: -250 } : undefined,
        obstacles,
        options,
      ] as const;
      expect(relationGeometry(...args)).toEqual(relationGeometryReference(...args));
    }
  }
});
