import { describe, expect, it } from 'vitest';
import type { RelationLayout } from './document-base.js';
import { relationGeometryReference as referenceGeometry } from '../../../apps/web/src/features/relations/relation-routing.reference.js';
import { createAutoObstacleQueries } from './relation-obstacle-queries.js';
import {
  createAutoRelationRoutingContext,
  createRelationRoutingContext,
  relationGeometry,
  segmentCrossesBounds,
  type Point,
  type RelationBounds,
  type RelationSearchBudget,
} from './relation-routing.js';

const a = { x: 0, y: 0, width: 100, height: 100 };
const b = { ...a, x: 600 };
const anchors = {
  sourceAnchor: { side: 'right' as const, ratio: 0.5 },
  targetAnchor: { side: 'left' as const, ratio: 0.5 },
};
const budget = (maxNodes = 12_000): RelationSearchBudget => ({
  maxNodes,
  exploredNodes: 0,
  limitReached: false,
  diagnostics: { searchCalls: 0, exploredStates: 0, localRetries: 0, deadlineReached: false },
});
const clear = (points: readonly Point[], boxes: readonly RelationBounds[]) => {
  for (let i = 1; i < points.length; i++) {
    expect(points[i - 1]!.x === points[i]!.x || points[i - 1]!.y === points[i]!.y).toBe(true);
    for (const box of boxes)
      expect(segmentCrossesBounds(points[i - 1]!, points[i]!, box)).toBe(false);
  }
};

describe('opt-in automatic routing search', () => {
  it('preserves ordinary movement geometry against the frozen pre-index router', () => {
    const obstacles = Array.from({ length: 12 }, (_, i) => ({
      x: 180 + (i % 3) * 115,
      y: -160 + Math.floor(i / 3) * 140,
      width: 70,
      height: 90,
    }));
    const options: Array<Pick<RelationLayout, 'sourceAnchor' | 'targetAnchor' | 'waypoints'>> = [
      {},
      anchors,
      {
        ...anchors,
        waypoints: [
          { x: 144, y: 50 },
          { x: 144, y: -230 },
          { x: 556, y: -230 },
          { x: 556, y: 50 },
        ],
      },
      { ...anchors, waypoints: [{ x: 50, y: 50 }] },
    ];
    for (const target of [a, b, { ...b, y: 320 }, { ...b, x: -600 }])
      for (const lane of [0, 2])
        for (const bend of [undefined, { x: 340, y: -260 }, { x: 330, y: 260 }])
          for (const saved of options) {
            const actual = relationGeometry(a, target, 90, lane, 8, bend, obstacles, saved);
            expect(actual).toEqual(
              referenceGeometry(a, target, 90, lane, 8, bend, obstacles, saved),
            );
            expect(
              relationGeometry(
                a,
                target,
                90,
                lane,
                8,
                bend,
                obstacles,
                saved,
                createRelationRoutingContext(a, target, obstacles),
              ),
            ).toEqual(actual);
          }
  });

  it('indexes exact segment and point checks including touching open boundaries', () => {
    const boxes = Array.from({ length: 20 }, (_, i) => ({
      x: (i % 5) * 20,
      y: Math.floor(i / 5) * 20,
      width: 20,
      height: 20,
    }));
    const queries = createAutoObstacleQueries(boxes, segmentCrossesBounds);
    // More distinct coordinates than the bounded cache capacity exercise eviction.
    for (let i = 0; i < 700; i++) {
      const x = i / 7 - 5,
        y = ((i * 13) % 700) / 7 - 5;
      const point = { x, y };
      const end = { x: x + 25, y };
      const verticalEnd = { x, y: y + 25 };
      expect(queries.pointClear(point)).toBe(
        !boxes.some((box) => segmentCrossesBounds(point, point, box)),
      );
      expect(queries.segmentClear(point, verticalEnd)).toBe(
        !boxes.some((box) => segmentCrossesBounds(point, verticalEnd, box)),
      );
      expect(queries.segmentClear(point, end)).toBe(
        !boxes.some((box) => segmentCrossesBounds(point, end, box)),
      );
    }
    expect(queries.pointClear({ x: 20, y: 20 })).toBe(true);
    expect(queries.segmentClear({ x: 20, y: 0 }, { x: 20, y: 80 })).toBe(true);
  });

  it('reuses all obstacles while routing different pairs and preserves saved replay', () => {
    const obstacle = { x: 250, y: -150, width: 200, height: 400 };
    const c = { ...a, x: 600, y: 600 };
    const all = [a, b, c, obstacle];
    const shared = budget();
    const context = createAutoRelationRoutingContext(all, shared);
    for (const target of [b, c]) {
      const route = relationGeometry(a, target, 90, 0, 0, undefined, [], anchors, context, {
        skipCandidates: true,
      });
      clear(route.points, all);
      expect(route.points[1]!.x).toBeGreaterThan(route.points[0]!.x);
      const replay = relationGeometry(
        a,
        target,
        90,
        0,
        0,
        undefined,
        all.filter((box) => box !== a && box !== target),
        {
          ...anchors,
          waypoints: route.points.slice(1, -1),
        },
      );
      expect(replay.points).toEqual(route.points);
    }
    expect(shared.diagnostics!.searchCalls).toBe(2);
    expect(shared.diagnostics!.exploredStates).toBe(shared.exploredNodes);
    expect(shared.exploredNodes).toBeLessThan(shared.maxNodes);
  });

  it('bounds each search without exhausting a larger shared budget', () => {
    const blocker = { x: 250, y: -150, width: 200, height: 400 };
    const shared = budget(10_000);
    shared.maxNodesPerSearch = 12;
    const context = createAutoRelationRoutingContext([a, b, blocker], shared);
    relationGeometry(a, b, 90, 0, 0, undefined, [], anchors, context, { skipCandidates: true });
    expect(shared.exploredNodes).toBeLessThanOrEqual(12);
    expect(shared.limitReached).toBe(false);
    expect(shared.diagnostics!.exploredStates).toBe(shared.exploredNodes);
  });

  it('stops before graph exploration when the shared deadline has passed', () => {
    const shared = budget();
    shared.deadline = -Infinity;
    const context = createAutoRelationRoutingContext([a, b], shared);
    relationGeometry(a, b, 90, 0, 0, undefined, [], anchors, context, { skipCandidates: true });
    expect(shared.exploredNodes).toBe(0);
    expect(shared.limitReached).toBe(true);
    expect(shared.diagnostics!.deadlineReached).toBe(true);
  });
});
