import { describe, expect, it } from 'vitest';
import { arrangeRelationRoutes, type RelationAutoArrangeInput } from './relation-auto-arrange.js';
import {
  createRelationRoutingContext,
  relationGeometry,
  segmentCrossesBounds,
} from './relation-routing.js';

const box = (id: string, x: number, y: number, width = 260, height = 180) => ({
  id,
  x,
  y,
  width,
  height,
});

describe('relation auto arrangement', () => {
  it('places FK and PK ports in stable, evenly spaced order', () => {
    const input: RelationAutoArrangeInput = {
      tables: [box('fk', 0, 0), box('pk', 0, -500)],
      relations: Array.from({ length: 5 }, (_, i) => ({
        id: `r${i}`,
        sourceTableId: 'fk',
        targetTableId: 'pk',
      })),
    };
    const result = arrangeRelationRoutes(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const anchors = result.routes.map((route) => route.sourceAnchor);
    expect(anchors.every((anchor) => anchor.side === 'top')).toBe(true);
    const gaps = anchors.slice(1).map((anchor, i) => anchor.ratio - anchors[i]!.ratio);
    expect(gaps.every((gap) => Math.abs(gap - gaps[0]!) < 1e-9)).toBe(true);
    expect(result.routes.map((route) => route.relationId)).toEqual(
      input.relations.map((r) => r.id),
    );
  });

  it.each([
    [box('fk', 0, 0, 260, 180), box('pk', 600, 40, 260, 260)],
    [box('fk', 0.127, 21.728, 260.543, 180.234), box('pk', 600.123, 40.238, 260.458, 260.613)],
    [box('fk', 0.127, 21.728, 260.543, 180.234), box('pk', 40.238, 600.123, 320.458, 180.613)],
    [box('fk', 0, 0, 260, 180), box('pk', 40, 600, 320, 180)],
  ])('aligns ports across an obstacle-free overlapping extent', (source, target) => {
    const result = arrangeRelationRoutes({
      tables: [source, target],
      relations: [{ id: 'r', sourceTableId: 'fk', targetTableId: 'pk' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const saved = result.routes[0]!;
    expect(saved.waypoints).toEqual([]);
    const points = relationGeometry(source, target, 90, 0, 0, undefined, [], saved).points;
    expect(points).toHaveLength(2);
    expect(points[0]!.x === points[1]!.x || points[0]!.y === points[1]!.y).toBe(true);
    expect(segmentCrossesBounds(points[0]!, points[1]!, source)).toBe(false);
    expect(segmentCrossesBounds(points[0]!, points[1]!, target)).toBe(false);
  });

  it('uses the lower face for a card above-right of the destination, while keeping adjacent row and column links straight', () => {
    const tables = [
      box('p', 2750, 3605, 500, 280),
      box('run', 3450, 3605, 540, 260),
      box('tbl', 4160, 3605, 640, 300),
      box('tc', 2750, 4085, 560, 280),
    ];
    const relations = [
      { id: 'p-run', sourceTableId: 'p', targetTableId: 'run' },
      { id: 'run-tbl', sourceTableId: 'run', targetTableId: 'tbl' },
      { id: 'tbl-tc', sourceTableId: 'tbl', targetTableId: 'tc' },
      { id: 'tc-p', sourceTableId: 'tc', targetTableId: 'p' },
    ];
    const result = arrangeRelationRoutes({ tables, relations });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.routes.find((r) => r.relationId === 'tbl-tc')!.sourceAnchor.side).toBe('bottom');
    for (const saved of result.routes) {
      const relation = relations.find((r) => r.id === saved.relationId)!,
        source = tables.find((t) => t.id === relation.sourceTableId)!,
        target = tables.find((t) => t.id === relation.targetTableId)!;
      const points = relationGeometry(
        source,
        target,
        90,
        0,
        0,
        undefined,
        tables.filter((t) => t !== source && t !== target),
        saved,
      ).points;
      expect(points.slice(1, -1)).toEqual(saved.waypoints);
      expect(saved.waypoints.length).toBe(saved.relationId === 'tbl-tc' ? 1 : 0);
    }
  });

  it('keeps short launch and landing runs clear of a blocking note without tiny doglegs', () => {
    const source = box('fk', 0, 0),
      target = box('pk', 900, 100),
      note = box('note', 420, -60, 160, 400);
    const result = arrangeRelationRoutes({
      tables: [source, target],
      notes: [note],
      relations: [{ id: 'r', sourceTableId: 'fk', targetTableId: 'pk' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const saved = result.routes[0]!,
      points = relationGeometry(source, target, 90, 0, 0, undefined, [note], saved).points;
    expect(points.slice(1, -1)).toEqual(saved.waypoints);
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    expect(distance(points[0]!, points[1]!)).toBeGreaterThanOrEqual(24);
    expect(distance(points.at(-1)!, points.at(-2)!)).toBeGreaterThanOrEqual(24);
    for (let i = 1; i < points.length; i++)
      for (const obstacle of [source, target, note])
        expect(segmentCrossesBounds(points[i - 1]!, points[i]!, obstacle)).toBe(false);
  });

  it('replays a valid direct route across a gap shorter than automatic stubs', () => {
    const source = box('fk', 0, 0),
      target = box('pk', 290, 0);
    const result = arrangeRelationRoutes({
      tables: [source, target],
      relations: [{ id: 'r', sourceTableId: 'fk', targetTableId: 'pk' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const saved = result.routes[0]!;
    expect(saved.waypoints).toEqual([]);
    expect(relationGeometry(source, target, 90, 0, 0, undefined, [], saved).points).toEqual([
      { x: 268, y: 90 },
      { x: 282, y: 90 },
    ]);
    // An invalid saved route must not add blocked stub pairs to automatic fallback.
    const invalid = { ...saved, waypoints: [{ x: 100, y: 90 }] };
    expect(relationGeometry(source, target, 90, 0, 0, undefined, [], invalid)).toEqual(
      relationGeometry(source, target, 90, 0, 0, undefined, [], {
        sourceAnchor: saved.sourceAnchor,
        targetAnchor: saved.targetAnchor,
      }),
    );
  });

  it('spills crowded ports across available sides', () => {
    const input: RelationAutoArrangeInput = {
      tables: [box('hub', 0, 0, 120, 90), box('other', 0, -450, 300, 120)],
      relations: Array.from({ length: 30 }, (_, i) => ({
        id: `r${String(i).padStart(2, '0')}`,
        sourceTableId: 'hub',
        targetTableId: 'other',
      })),
      options: { maxImprovementPasses: 0 },
    };
    const result = arrangeRelationRoutes(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Set(result.routes.map((route) => route.sourceAnchor.side)).size).toBeGreaterThan(1);
    expect(result.metrics.crowdedTableIds).toContain('hub');
  });

  it('routes a self reference through distinct sides without entering its table', () => {
    const table = box('self', 100, 100);
    const result = arrangeRelationRoutes({
      tables: [table],
      relations: [{ id: 'self-fk', sourceTableId: 'self', targetTableId: 'self' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const saved = result.routes[0]!;
    expect(saved.sourceAnchor.side).not.toBe(saved.targetAnchor.side);
    const points = relationGeometry(table, table, 90, 0, 0, undefined, [], saved).points;
    for (let i = 1; i < points.length; i++)
      expect(segmentCrossesBounds(points[i - 1]!, points[i]!, table)).toBe(false);
  });

  it('keeps every segment clear of tables and notes, including saved waypoints', () => {
    const tables = [box('fk', 0, 0), box('pk', 900, 0)];
    const note = box('note', 410, -50, 180, 280);
    const result = arrangeRelationRoutes({
      tables,
      notes: [note],
      relations: [{ id: 'r', sourceTableId: 'fk', targetTableId: 'pk' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const saved = result.routes[0]!;
    const points = relationGeometry(tables[0]!, tables[1]!, 90, 0, 0, undefined, [note], {
      sourceAnchor: saved.sourceAnchor,
      targetAnchor: saved.targetAnchor,
      waypoints: saved.waypoints,
    }).points;
    const prepared = createRelationRoutingContext(tables[0]!, tables[1]!, [note]);
    expect(
      relationGeometry(tables[0]!, tables[1]!, 90, 0, 0, undefined, [note], {}, prepared),
    ).toEqual(relationGeometry(tables[0]!, tables[1]!, 90, 0, 0, undefined, [note]));
    for (let i = 1; i < points.length; i++)
      for (const obstacle of [...tables, note])
        expect(segmentCrossesBounds(points[i - 1]!, points[i]!, obstacle)).toBe(false);
    expect(points).toEqual([
      relationGeometry(tables[0]!, tables[1]!, 90, 0, 0, undefined, [note], {
        sourceAnchor: saved.sourceAnchor,
        targetAnchor: saved.targetAnchor,
        waypoints: saved.waypoints,
      }).points[0],
      ...saved.waypoints,
      points.at(-1),
    ]);
  });

  it('keeps bounded improvement at or below the initial weighted conflict score', () => {
    const input: RelationAutoArrangeInput = {
      tables: [box('a', 0, 0), box('b', 700, 0), box('c', 0, 400), box('d', 700, 400)],
      notes: [box('note', 330, 150, 100, 220)],
      relations: Array.from({ length: 12 }, (_, i) => ({
        id: `r${String(i).padStart(2, '0')}`,
        sourceTableId: i % 2 ? 'a' : 'c',
        targetTableId: i % 3 ? 'd' : 'b',
      })),
    };
    const base = arrangeRelationRoutes({ ...input, options: { maxImprovementPasses: 0 } });
    const improved = arrangeRelationRoutes(input);
    expect(base.ok && improved.ok).toBe(true);
    if (!base.ok || !improved.ok) return;
    const score = (metrics: typeof base.metrics) =>
      metrics.crossings * 2500 +
      metrics.overlapLength * 80 +
      metrics.spacingViolations * 800 +
      metrics.totalBends * 48 +
      metrics.totalLength;
    expect(score(improved.metrics)).toBeLessThanOrEqual(score(base.metrics));
  });

  it('is independent of input order and rejects an impossible layout atomically', () => {
    const input: RelationAutoArrangeInput = {
      tables: [box('a', 0, 0), box('b', 550, 0), box('c', 1100, 0)],
      relations: [
        { id: 'ab', sourceTableId: 'a', targetTableId: 'b' },
        { id: 'ac', sourceTableId: 'a', targetTableId: 'c' },
        { id: 'bc', sourceTableId: 'b', targetTableId: 'c' },
      ],
    };
    const first = arrangeRelationRoutes(input);
    expect(first).toEqual(
      arrangeRelationRoutes({
        ...input,
        tables: [...input.tables].reverse(),
        relations: [...input.relations].reverse(),
      }),
    );
    const impossible = arrangeRelationRoutes({
      tables: [box('a', 0, 0), box('b', 0, 0)],
      relations: [{ id: 'r', sourceTableId: 'a', targetTableId: 'b' }],
    });
    expect(impossible).toMatchObject({ ok: false, error: { code: 'no-valid-route' } });
  });

  it('handles 121 dense edges including a self loop within a bounded search count', () => {
    const tables = Array.from({ length: 24 }, (_, i) =>
      box(`t${String(i).padStart(2, '0')}`, (i % 6) * 420, Math.floor(i / 6) * 360),
    );
    const relations = [
      ...Array.from({ length: 120 }, (_, i) => ({
        id: `r${String(i).padStart(3, '0')}`,
        sourceTableId: tables[i % 24]!.id,
        targetTableId: tables[(i * 7 + 5) % 24]!.id,
      })),
      { id: 'self', sourceTableId: tables[0]!.id, targetTableId: tables[0]!.id },
    ];
    const start = performance.now();
    const result = arrangeRelationRoutes({
      tables,
      relations,
      options: { maxImprovementPasses: 0, maxSearches: relations.length },
    });
    const duration = performance.now() - start;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.routes).toHaveLength(121);
    expect(Number.isFinite(result.metrics.totalLength)).toBe(true);
    // Keep the measurement visible in Vitest's normal output for performance review.
    console.info(`relation-auto-arrange 121 edges: ${duration.toFixed(1)} ms`);
  });
});
