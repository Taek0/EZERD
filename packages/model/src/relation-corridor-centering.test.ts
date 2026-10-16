import { describe, expect, it } from 'vitest';
import { centerRelationRouteCorridors, type CorridorRoute } from './relation-corridor-centering.js';
import { relationGeometry } from './relation-routing.js';

const box = (id: string, x: number, y: number, width: number, height: number) => ({
  id,
  x,
  y,
  width,
  height,
});
const fixture = (first = 118, second = 134) => ({
  boxes: [
    box('left', 0, -100, 100, 600),
    box('source', 400, -50, 100, 150),
    box('target', 400, 250, 100, 150),
  ],
  routes: [
    {
      id: 'a',
      sourceId: 'source',
      targetId: 'target',
      points: [
        { x: 392, y: 0 },
        { x: first, y: 0 },
        { x: first, y: 300 },
        { x: 392, y: 300 },
      ],
    },
    {
      id: 'b',
      sourceId: 'source',
      targetId: 'target',
      points: [
        { x: 392, y: 30 },
        { x: second, y: 30 },
        { x: second, y: 330 },
        { x: 392, y: 330 },
      ],
    },
  ],
});

describe('explicit arrangement corridor centering', () => {
  it.each([false, true])(
    'centers a parallel bundle without overlapping lanes (transpose=%s)',
    (transpose) => {
      const input = fixture();
      if (transpose) {
        input.boxes = input.boxes.map((b) => ({
          ...b,
          x: b.y,
          y: b.x,
          width: b.height,
          height: b.width,
        }));
        input.routes = input.routes.map((r) => ({
          ...r,
          points: r.points.map((p) => ({ x: p.y, y: p.x })),
        }));
      }
      const original = structuredClone(input),
        result = centerRelationRouteCorridors(input.routes, input.boxes);
      const axis = transpose ? 'y' : 'x';
      expect(result.map((p) => p[1]![axis])).toEqual([242, 258]);
      expect((result[0]![1]![axis] + result[1]![1]![axis]) / 2).toBe(250);
      expect(input).toEqual(original);
      result.forEach((points, i) => {
        expect(points).toHaveLength(input.routes[i]!.points.length);
        expect(points[0]).toEqual(input.routes[i]!.points[0]);
        expect(points.at(-1)).toEqual(input.routes[i]!.points.at(-1));
      });
    },
  );

  it('uses card faces across the whole segment span when widths differ', () => {
    const input = fixture(198, 214);
    input.boxes.push(box('wider-left-card', 0, 110, 180, 80));
    const result = centerRelationRouteCorridors(input.routes, input.boxes);
    expect(result.map((p) => p[1]!.x)).toEqual([282, 298]);
  });

  it('includes a spanning obstacle outside the bundle common overlap', () => {
    const input = fixture(198, 214);
    input.routes[1]!.points[0]!.y = input.routes[1]!.points[1]!.y = 90;
    input.boxes.push(box('early-obstacle', 100, 15, 80, 25));
    const result = centerRelationRouteCorridors(input.routes, input.boxes);
    expect(result.map((p) => p[1]!.x)).toEqual([282, 298]);
  });

  it('retains the original bundle if the shared corridor cannot fit spaced lanes', () => {
    const input = fixture(118, 126);
    input.boxes = input.boxes.map((b) =>
      b.id === 'source' || b.id === 'target' ? { ...b, x: 160 } : b,
    );
    input.routes.forEach((r) => {
      r.points[0]!.x = r.points[3]!.x = 152;
    });
    expect(centerRelationRouteCorridors(input.routes, input.boxes)).toEqual(
      input.routes.map((r) => r.points),
    );
  });

  it('keeps a straight two-point route and an already centered bundle unchanged', () => {
    const input = fixture(242, 258);
    const direct: CorridorRoute = {
      id: 'direct',
      sourceId: 'source',
      targetId: 'target',
      points: [
        { x: 600, y: 0 },
        { x: 600, y: 300 },
      ],
    };
    const result = centerRelationRouteCorridors([...input.routes, direct], input.boxes);
    expect(result).toEqual([...input.routes, direct].map((r) => r.points));
    expect(result[2]).toBe(direct.points);
  });

  it('chooses the nearest center that preserves protected fractional terminal runs', () => {
    const input = fixture(350, 366);
    // This short horizontal extent constrains the centered bundle on its left side.
    input.routes.forEach((route, i) => {
      route.points[0] = { x: 300.25, y: i * 30 };
      route.points[3] = { x: 300.25, y: 300 + i * 30 };
    });
    input.boxes = [box('left', 0, -100, 100, 600), box('right', 450, -100, 100, 600)];
    const result = centerRelationRouteCorridors(input.routes, input.boxes);
    expect(result.map((p) => p[1]!.x)).toEqual([328.25, 344.25]);
    expect(result[0]![1]!.x - result[0]![0]!.x).toBe(28);
  });

  it('rejects new crossings against unchanged routes and keeps the closest valid candidate', () => {
    const input = fixture();
    const blocker: CorridorRoute = {
      id: 'other',
      sourceId: 'other-source',
      targetId: 'other-target',
      points: [
        { x: 200, y: 150 },
        { x: 300, y: 150 },
      ],
    };
    const result = centerRelationRouteCorridors([...input.routes, blocker], input.boxes);
    expect(result[0]![1]!.x).toBeLessThanOrEqual(200);
    expect(result[1]![1]!.x).toBeLessThanOrEqual(200);
    expect(result[2]).toBe(blocker.points);
  });

  it('keeps the original when every valid fallback would move farther from center', () => {
    const input = fixture(245, 261);
    const route = input.routes[0]!;
    const blocker: CorridorRoute = {
      id: 'other',
      sourceId: 'other-source',
      targetId: 'other-target',
      points: [
        { x: 245, y: 150 },
        { x: 255, y: 150 },
      ],
    };
    const result = centerRelationRouteCorridors([route, blocker], input.boxes);
    expect(result[0]).toEqual(route.points);
    expect(result[0]![1]!.x).toBe(245);
  });
  it('retains an entire uncommitted bundle when the primitive work budget is exhausted', () => {
    const input = fixture();
    const unrelated = Array.from({ length: 512 }, (_, index): CorridorRoute => ({
      id: `unrelated-${index}`,
      sourceId: 'outside-source',
      targetId: 'outside-target',
      points: Array.from({ length: 130 }, (_, step) => ({
        x: 600 + Math.floor(step / 2),
        y: index * 200 + Math.ceil(step / 2),
      })),
    }));
    const original = structuredClone(input.routes);
    const result = centerRelationRouteCorridors([...input.routes, ...unrelated], input.boxes);
    expect(result[0]).toBe(input.routes[0]!.points);
    expect(result[1]).toBe(input.routes[1]!.points);
    expect(input.routes).toEqual(original);
  });
  it('replays centered saved waypoints with fixed endpoint faces', () => {
    const input = fixture();
    const result = centerRelationRouteCorridors(input.routes, input.boxes);
    const source = input.boxes.find((b) => b.id === 'source')!,
      target = input.boxes.find((b) => b.id === 'target')!;
    result.forEach((points, i) => {
      const saved = {
        sourceAnchor: { side: 'left' as const, ratio: (points[0]!.y - source.y) / source.height },
        targetAnchor: {
          side: 'left' as const,
          ratio: (points.at(-1)!.y - target.y) / target.height,
        },
        waypoints: points.slice(1, -1),
      };
      const replay = relationGeometry(
        source,
        target,
        90,
        0,
        0,
        undefined,
        [input.boxes[0]!],
        saved,
      ).points;
      expect(replay).toEqual(points);
      expect(replay[0]).toEqual(input.routes[i]!.points[0]);
      expect(replay.at(-1)).toEqual(input.routes[i]!.points.at(-1));
    });
  });
});
