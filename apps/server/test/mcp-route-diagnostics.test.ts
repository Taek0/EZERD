import { describe, expect, it } from 'vitest';
import {
  createEmptyNativeDocument,
  createNativeColumn,
  createNativeTable,
  defaultDatabaseContext,
  nativeTableCanvasHeaderHeight,
  nativeTableCanvasMetrics,
  relationGeometry,
} from '@ezerd/model';
import { diagnoseLayout } from '../src/mcp/mcp-layout-diagnostics.js';
import {
  inspectRouteConflicts,
  reconstructDiagnosticRoutes,
  segmentCardPenetration,
  segmentIntersection,
  type DiagnosticRoute,
  type RouteConflict,
} from '../src/mcp/mcp-route-diagnostics.js';

const route = (
  id: string,
  points: DiagnosticRoute['points'],
  sourceId = `${id}:source`,
  targetId = `${id}:target`,
): DiagnosticRoute => ({ relationId: id, sourceId, targetId, points });
const inspect = (
  routes: DiagnosticRoute[],
  cards: Parameters<typeof inspectRouteConflicts>[1] = [],
) => {
  const conflicts: RouteConflict[] = [];
  const coverage = inspectRouteConflicts(routes, cards, (conflict) => {
    conflicts.push(conflict);
    return true;
  });
  return { conflicts, coverage };
};

describe('native MCP route geometry diagnostics', () => {
  it('finds straight crossings and provides both segment coordinates and IDs', () => {
    const result = inspect([
      route('horizontal', [
        { x: 0, y: 10 },
        { x: 100, y: 10 },
      ]),
      route('vertical', [
        { x: 50, y: 0 },
        { x: 50, y: 100 },
      ]),
    ]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        code: 'relation-crossing',
        relationId: 'horizontal',
        otherRelationId: 'vertical',
        segmentIndex: 0,
        otherSegmentIndex: 0,
        x: 50,
        y: 10,
        intersectionKind: 'crossing',
        segment: { start: { x: 0, y: 10 }, end: { x: 100, y: 10 } },
      }),
    ]);
    expect(result.coverage.complete).toBe(true);
  });

  it('checks every dogleg/waypoint segment and detects collinear overlaps', () => {
    const result = inspect([
      route('dogleg', [
        { x: 0, y: 0 },
        { x: 0, y: 50 },
        { x: 100, y: 50 },
        { x: 100, y: 100 },
      ]),
      route('waypoints', [
        { x: 20, y: 50 },
        { x: 70, y: 50 },
        { x: 70, y: 80 },
        { x: 120, y: 80 },
      ]),
    ]);
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({
        code: 'relation-segment-overlap',
        relationId: 'dogleg',
        segmentIndex: 1,
        otherSegmentIndex: 0,
        intersectionKind: 'overlap',
        y: 50,
      }),
    );
    expect(
      result.conflicts.find((item) => item.code === 'relation-segment-overlap')?.x,
    ).toBeCloseTo(45);
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({
        code: 'relation-crossing',
        segmentIndex: 2,
        otherSegmentIndex: 2,
        x: 100,
        y: 80,
      }),
    );
  });

  it('ignores designated shared endpoint contacts but preserves incidental touches and overlap', () => {
    const first = route(
      'a',
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      'shared',
    );
    const second = route(
      'b',
      [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ],
      'shared',
    );
    expect(inspect([first, second]).conflicts).toEqual([]);
    second.sourceId = 'different-card';
    expect(inspect([first, second]).conflicts[0]?.intersectionKind).toBe('touch');
    second.sourceId = 'shared';
    second.points = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ];
    expect(inspect([first, second]).conflicts[0]?.code).toBe('relation-segment-overlap');
  });

  it('reports endpoint-card traversal as well as non-endpoint-card penetration', () => {
    const card = { objectId: 'source', x: 0, y: 0, width: 100, height: 100 };
    const traversal = route(
      'bad',
      [
        { x: -10, y: 50 },
        { x: 110, y: 50 },
      ],
      'source',
    );
    expect(inspect([traversal], [card]).conflicts).toContainEqual(
      expect.objectContaining({
        code: 'relation-card-penetration',
        otherObjectId: 'source',
        x: 50,
        y: 50,
      }),
    );
    traversal.sourceId = 'elsewhere';
    expect(inspect([traversal], [card]).conflicts).toHaveLength(1);
    traversal.points = [
      { x: 100, y: 50 },
      { x: 200, y: 50 },
    ];
    expect(inspect([traversal], [card]).conflicts).toEqual([]);
  });

  it('treats card boundaries and corners as clear while clipping diagonal penetration exactly', () => {
    const card = { x: 0, y: 0, width: 100, height: 100 };
    expect(segmentCardPenetration({ x: -10, y: 0 }, { x: 110, y: 0 }, card)).toBeUndefined();
    expect(segmentCardPenetration({ x: -10, y: -10 }, { x: 0, y: 0 }, card)).toBeUndefined();
    expect(segmentCardPenetration({ x: -10, y: -10 }, { x: 110, y: 110 }, card)).toEqual({
      x: 50,
      y: 50,
    });
    expect(segmentCardPenetration({ x: 50, y: 50 }, { x: 50, y: 50 }, card)).toBeUndefined();
    expect(
      segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })?.kind,
    ).toBe('crossing');
  });

  it('stops when the output limit or comparison budget is exhausted', () => {
    const routes = [
      route('a', [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
      route('b', [
        { x: 50, y: -50 },
        { x: 50, y: 50 },
      ]),
    ];
    expect(inspectRouteConflicts(routes, [], () => false).complete).toBe(false);
    expect(inspectRouteConflicts(routes, [], () => true, 0)).toEqual({
      complete: false,
      comparisons: 1,
    });
  });

  it('reconstructs automatic and explicit routes with the shared native router', () => {
    const document = createEmptyNativeDocument(defaultDatabaseContext('postgresql'));
    document.tables = ['a', 'b'].map((id) => createNativeTable(document.database, id));
    document.tableRelations = [
      {
        id: 'r',
        sourceTableId: 'a',
        targetTableId: 'b',
        scope: 'logical',
        logical: { name: 'route', cardinality: 'one-to-many', required: false },
        physical: null,
      },
    ];
    const cards = [
      { objectId: 'a', x: 0, y: 0, width: 280, height: 220 },
      { objectId: 'b', x: 700, y: 0, width: 280, height: 220 },
    ];
    const automatic = reconstructDiagnosticRoutes(document, cards, '__tables__', 'logical');
    expect(automatic.routes[0]?.points).toEqual(
      relationGeometry(cards[0]!, cards[1]!, 90, 0).points,
    );
    document.layout.relations = [
      {
        relationId: 'r',
        viewId: '__tables__',
        offset: 0,
        sourceAnchor: { side: 'right', ratio: 0.5 },
        targetAnchor: { side: 'left', ratio: 0.5 },
        waypoints: [
          { x: 400, y: 110 },
          { x: 500, y: 110 },
        ],
      },
    ];
    const manual = reconstructDiagnosticRoutes(document, cards, '__tables__', 'logical');
    expect(manual.routes[0]?.points).toEqual([
      { x: 288, y: 110 },
      { x: 400, y: 110 },
      { x: 500, y: 110 },
      { x: 692, y: 110 },
    ]);
    expect(manual.skipped).toBe(0);
  });

  it('explicitly reports unverified auto paths when scene limits or missing endpoints prevent reconstruction', () => {
    const document = createEmptyNativeDocument(defaultDatabaseContext('postgresql'));
    document.tableRelations = [
      {
        id: 'r',
        sourceTableId: 'missing-a',
        targetTableId: 'missing-b',
        scope: 'logical',
        logical: { name: '', cardinality: 'one-to-many', required: false },
        physical: null,
      },
    ];
    document.layout.nodes = [
      { id: 'note', objectId: 'note', viewId: '__tables__', x: 0, y: 0, width: 160, height: 110 },
    ];
    const result = diagnoseLayout(document, '__tables__', 10, 'logical');
    expect(result.diagnostics).toEqual([]);
    expect(result.coverage).toMatchObject({
      complete: false,
      checkedRoutes: 0,
      skippedRoutes: 1,
      modes: ['logical'],
    });
    const cards = Array.from({ length: 201 }, (_, index) => ({
      objectId: `card-${index}`,
      x: index * 500,
      y: 0,
      width: 280,
      height: 220,
    }));
    document.tableRelations[0]!.sourceTableId = 'card-0';
    document.tableRelations[0]!.targetTableId = 'card-1';
    expect(reconstructDiagnosticRoutes(document, cards, '__tables__', 'logical')).toEqual({
      routes: [],
      skipped: 1,
    });
  });

  it('uses physical column-row anchors and declares complete coverage only for the requested mode', () => {
    const document = createEmptyNativeDocument(defaultDatabaseContext('postgresql'));
    const source = createNativeTable(document.database, 'a');
    const target = createNativeTable(document.database, 'b');
    const sourceColumn = createNativeColumn(document.database, source, 'a-column');
    const targetColumn = createNativeColumn(document.database, target, 'b-column');
    document.tables = [source, target];
    document.columns = [sourceColumn, targetColumn];
    document.tableRelations = [
      {
        id: 'r',
        sourceTableId: source.id,
        targetTableId: target.id,
        scope: 'physical',
        logical: { name: '', cardinality: 'one-to-many', required: false },
        physical: {
          name: '',
          sourceColumnIds: [sourceColumn.id],
          targetColumnIds: [targetColumn.id],
          onDelete: 'NO ACTION',
          onUpdate: 'NO ACTION',
        },
      },
    ];
    document.layout.nodes = [source, target].map((table, index) => ({
      id: `node-${table.id}`,
      objectId: table.id,
      viewId: '__tables__',
      x: index * 700,
      y: 0,
      width: 560,
      height: 500,
    }));
    const reconstructed = reconstructDiagnosticRoutes(
      document,
      document.layout.nodes,
      '__tables__',
      'physical',
    );
    const row = nativeTableCanvasMetrics(document, source, 'physical').rows[0]!;
    expect(reconstructed.routes[0]?.points[0]).toEqual({
      x: 568,
      y: nativeTableCanvasHeaderHeight + row.height / 2,
    });
    const result = diagnoseLayout(document, '__tables__', 10, 'physical');
    expect(result.coverage).toMatchObject({
      checkedRoutes: 1,
      skippedRoutes: 0,
      complete: true,
      modes: ['physical'],
    });
    expect(diagnoseLayout(document, '__tables__', 10).coverage.complete).toBe(false);
    expect(diagnoseLayout(document, '__tables__', 10, 'logical').coverage.checkedRoutes).toBe(0);
  });
});
