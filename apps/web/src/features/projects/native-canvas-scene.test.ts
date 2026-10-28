import { expect, it } from 'vitest';

import {
  TABLES_VIEW_ID,
  createEmptyDocument,
  tableCardSize,
  defaultDatabaseContext,
  migrateDesignDocumentV1,
  type DesignDocument,
} from '@ezerd/model';
import {
  completeNativeCanvasScene,
  prepareNativeCanvasScene,
  prepareNativeCanvasPlacementScene,
  nativeCanvasScene,
  nativeCanvasSceneMetrics,
  nativeCanvasPlacementDraftScene,
  nativeCanvasDraftScene,
  createNativeSceneRoutingCache,
} from './native-canvas-scene.js';
import { routeNativeScene } from './native-ghost-routing.js';
it.each(['physical', 'logical'] as const)(
  'prepared cloneable routing matches ordinary %s scene',
  (mode) => {
    const { document } = createNativePerformanceFixture(10, 5),
      before = structuredClone(document);
    const prepared = prepareNativeCanvasScene(document, TABLES_VIEW_ID, mode),
      geometries = routeNativeScene(structuredClone(prepared.routing));
    expect(completeNativeCanvasScene(prepared, geometries)).toEqual(
      nativeCanvasScene(document, TABLES_VIEW_ID, mode),
    );
    expect(prepared.routing.bounds).toHaveLength(prepared.nodes.length);
    expect(prepared.routing.relations.every((r) => !('obstacles' in r) && !('relation' in r))).toBe(
      true,
    );
    expect(document).toEqual(before);
  },
);
it('retains current relation references/metrics and reuses across new document/layout IDs', () => {
  const { document } = createNativePerformanceFixture(10, 5),
    cache = createNativeSceneRoutingCache();
  const prepared = prepareNativeCanvasScene(document, TABLES_VIEW_ID, 'physical'),
    geometries = routeNativeScene(prepared.routing);
  const scene = completeNativeCanvasScene(prepared, geometries, cache);
  expect(nativeCanvasSceneMetrics(scene)).toBe(prepared.metricsFor);
  const next = structuredClone(document);
  next.layout.nodes = next.layout.nodes.map((n) => ({ ...n, id: `saved-${n.id}` }));
  const nextScene = nativeCanvasScene(next, TABLES_VIEW_ID, 'physical', null, undefined, cache);
  expect(nextScene.relations[0]!.geometry).toBe(geometries[0]);
  expect(nextScene.relations[0]!.relation).toBe(next.tableRelations![0]);
  expect(nextScene.relations[0]!.relation).not.toBe(scene.relations[0]!.relation);
});
it('invalidates exact positions, dimensions, labels, content, routes, lane and obstacle order', () => {
  const { document } = createNativePerformanceFixture(10, 5),
    cache = createNativeSceneRoutingCache();
  const p = prepareNativeCanvasScene(document, TABLES_VIEW_ID, 'physical');
  cache.set(p.routing, routeNativeScene(p.routing));
  const mutations: Array<(d: typeof document) => void> = [
    (d) => {
      d.layout.nodes[0]!.x += 0.001;
    },
    (d) => {
      d.layout.nodes[0]!.width = 1800;
    },
    (d) => {
      d.tableRelations![0]!.physical!.name += ' much longer relation name';
    },
    (d) => {
      d.columns![0]!.physical.comment = 'long content '.repeat(80);
    },
    (d) => {
      d.layout.relations = [
        {
          viewId: TABLES_VIEW_ID,
          relationId: d.tableRelations![0]!.id,
          offset: 12,
          bend: { x: 400, y: 600 },
        },
      ];
    },
    (d) => {
      d.tableRelations!.reverse();
    },
    (d) => {
      d.layout.nodes.reverse();
    },
  ];
  for (const mutate of mutations) {
    const next = structuredClone(document);
    mutate(next);
    expect(
      cache.get(prepareNativeCanvasScene(next, TABLES_VIEW_ID, 'physical').routing),
    ).toBeUndefined();
  }
});
it('retains only one latest result and rejects malformed cache entries', () => {
  const { document } = createNativePerformanceFixture(10, 5),
    cache = createNativeSceneRoutingCache();
  const a = prepareNativeCanvasScene(document, TABLES_VIEW_ID, 'physical');
  cache.set(a.routing, routeNativeScene(a.routing));
  document.layout.nodes[0]!.x += 100;
  const b = prepareNativeCanvasScene(document, TABLES_VIEW_ID, 'physical');
  cache.set(b.routing, routeNativeScene(b.routing));
  expect(cache.get(a.routing)).toBeUndefined();
  expect(cache.get(b.routing)).toBeDefined();
  expect(() => cache.set(b.routing, [])).toThrow();
});
it('draft helpers inherit the routing cache and placement preparation routes only once', () => {
  const { document } = createNativePerformanceFixture(10, 5),
    cache = createNativeSceneRoutingCache();
  const scene = nativeCanvasScene(document, TABLES_VIEW_ID, 'physical', null, undefined, cache);
  const placements = scene.nodes.map((n) => ({ ...n, x: n.x + 50, y: n.y + 60 }));
  const p = prepareNativeCanvasPlacementScene(
      document,
      scene,
      TABLES_VIEW_ID,
      'physical',
      placements,
    ),
    gs = routeNativeScene(p.routing);
  completeNativeCanvasScene(p, gs, cache);
  const drawn = nativeCanvasPlacementDraftScene(document, scene, TABLES_VIEW_ID, 'physical', {
    nodesJSON: JSON.stringify(placements),
  });
  expect(drawn.relations[0]!.geometry).toBe(gs[0]);
  expect(nativeCanvasSceneMetrics(drawn)).toBe(nativeCanvasSceneMetrics(scene));
  const first = scene.nodes[0]!;
  const single = nativeCanvasDraftScene(
    document,
    scene,
    TABLES_VIEW_ID,
    'physical',
    first.objectId,
    String(first.x + 20),
    String(first.y + 30),
  );
  const again = nativeCanvasDraftScene(
    document,
    scene,
    TABLES_VIEW_ID,
    'physical',
    first.objectId,
    String(first.x + 20),
    String(first.y + 30),
  );
  expect(again.relations[0]!.geometry).toBe(single.relations[0]!.geometry);
});

it('keys every effective anchor/waypoint and numeric routing input exactly', () => {
  const { document } = createNativePerformanceFixture(10, 5),
    cache = createNativeSceneRoutingCache();
  const p = prepareNativeCanvasScene(document, TABLES_VIEW_ID, 'physical');
  cache.set(p.routing, routeNativeScene(p.routing));
  const changes: Array<(r: typeof p.routing) => void> = [
    (r) => {
      r.relations[0]!.lane += 1;
    },
    (r) => {
      r.relations[0]!.offset += 0.000001;
    },
    (r) => {
      r.relations[0]!.labelWidth += 1;
    },
    (r) => {
      r.relations[0]!.bend = { x: 200, y: 300 };
    },
    (r) => {
      r.relations[0]!.options = { sourceAnchor: { side: 'top', ratio: 0.2 } };
    },
    (r) => {
      r.relations[0]!.options = { targetAnchor: { side: 'bottom', ratio: 0.8 } };
    },
    (r) => {
      r.relations[0]!.options = {
        waypoints: [
          { x: 200, y: 300 },
          { x: 500, y: 300 },
        ],
      };
    },
  ];
  for (const change of changes) {
    const next = structuredClone(p.routing);
    change(next);
    expect(cache.get(next)).toBeUndefined();
  }
});

// Keep the scene regression data self-contained; no performance harness dependency.
/** Deterministic valid physical schema; no clock, network, storage or random IDs. */
function createHistoricalPerformanceFixture(count = 10, columns = 5): DesignDocument {
  if (![10, 50, 100, 300].includes(count) || ![5, 10, 30].includes(columns))
    throw new Error('Unsupported fixture size');
  const doc = createEmptyDocument();
  doc.domains = [{ id: 'perf', name: 'Performance fixture', description: '', color: '#4169e1' }];
  const meta = () => ({ common: {}, logical: {}, physical: {} });
  doc.tables = Array.from({ length: count }, (_, i) => ({
    id: `t${i}`,
    domainId: 'perf',
    scope: 'physical',
    logical: { name: `table_${i}`, definition: '' },
    physical: { name: `table_${i}`, schema: 'public', comment: '' },
    customProperties: meta(),
  }));
  doc.columns = doc.tables.flatMap((t) =>
    Array.from({ length: columns }, (_, i) => ({
      id: `${t.id}-c${i}`,
      tableId: t.id,
      scope: 'physical' as const,
      logical: { name: `col_${i}`, definition: '', semanticType: '', required: true },
      physical: {
        name: i === 0 ? 'id' : `col_${i}`,
        type: { name: 'integer', isArray: false },
        nullable: false,
        defaultExpression: null,
        comment: '',
      },
      customProperties: meta(),
    })),
  );
  doc.keys = doc.tables.map((t) => ({
    id: `${t.id}-pk`,
    tableId: t.id,
    scope: 'physical',
    kind: 'primary',
    name: `${t.id}_pk`,
    columnIds: [`${t.id}-c0`],
  }));
  doc.tableRelations = doc.tables.map((t, i) => {
    const target = `t${(i + 1) % count}`;
    return {
      id: `r${i}`,
      sourceTableId: t.id,
      targetTableId: target,
      scope: 'physical',
      logical: { name: `relation_${i}`, cardinality: 'one-to-many', required: true },
      physical: {
        name: `${t.id}_fk`,
        sourceColumnIds: [`${t.id}-c1`],
        targetColumnIds: [`${target}-c0`],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
    };
  });
  const size = tableCardSize(doc, 't0');
  doc.layout.nodes = doc.tables.map((t, i) => ({
    id: `node-${t.id}`,
    objectId: t.id,
    viewId: 'perf',
    x: (i % 5) * (size.width + 180),
    y: Math.floor(i / 5) * (size.height + 180),
    ...size,
  }));
  doc.layout.viewports = [{ viewId: 'perf', x: 20, y: 20, zoom: 1 }];
  doc.layout.nodes.push({
    id: 'domain-perf',
    objectId: 'perf',
    viewId: 'overview',
    x: 0,
    y: 0,
    width: 240,
    height: 210,
  });
  return doc;
}

/** Current shared canvas fixture. Historical source data remains available for old records. */
function createPerformanceFixture(count = 10, columns = 5): DesignDocument {
  const doc = createHistoricalPerformanceFixture(count, columns);
  return {
    ...doc,
    layout: {
      ...doc.layout,
      nodes: [
        ...doc.layout.nodes.map((n) =>
          n.viewId === 'perf' ? { ...n, viewId: TABLES_VIEW_ID } : n,
        ),
        ...doc.layout.nodes
          .filter((n) => n.viewId === 'perf')
          .map((n) => ({ ...n, id: 'owned-' + n.id })),
      ],
      viewports: [{ viewId: TABLES_VIEW_ID, x: 20, y: 20, zoom: 1 }],
    },
  };
}

function createNativePerformanceFixture(count: number, columns: number) {
  return migrateDesignDocumentV1(
    createPerformanceFixture(count, columns),
    defaultDatabaseContext('postgresql'),
  );
}
