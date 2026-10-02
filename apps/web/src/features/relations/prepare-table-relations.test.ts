import { expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TableRelationsSvg } from './TableRelations.js';
import * as routing from './relation-routing.js';
import { createTestDocument } from '../../test-utils/diagram-fixture.js';
import { prepareTableRelations } from './prepare-table-relations.js';
import { relationGeometry } from './relation-routing.js';
import { prepareTableRelationsReference } from './prepare-table-relations.reference.js';
import * as cardGeometry from '../tables/table-geometry.js';
import { TABLES_VIEW_ID, ensureTableCanvasLayout, updateTable } from '@ezerd/model';

it('renders global relationships across assigned and unassigned owners and excludes unassigned endpoints from combined views', () => {
  const doc = updateTable(ensureTableCanvasLayout(createTestDocument()), 't0', { domainId: null });
  const before = structuredClone(doc);
  const global = prepareTableRelations(doc, TABLES_VIEW_ID, 'physical').filter(Boolean);
  expect(global).toHaveLength(10);
  expect(global.some((item) => item?.relation.sourceTableId === 't0')).toBe(true);
  expect(doc).toEqual(before);
  const combined = {
    ...doc,
    views: [{ id: 'combined', name: 'Combined', domainIds: ['perf'] }],
    layout: {
      ...doc.layout,
      nodes: doc.layout.nodes
        .filter((node) => node.viewId === TABLES_VIEW_ID)
        .map((node) => ({ ...node, viewId: 'combined' })),
    },
  };
  expect(prepareTableRelations(combined, 'combined', 'physical').filter(Boolean)).toHaveLength(8);
});

it('calculates each participating card boundary once per preparation, including obstacles', () => {
  const doc = createTestDocument();
  const spy = vi.spyOn(cardGeometry, 'tableCardSize');
  try {
    const result = prepareTableRelations(doc, 'perf', 'physical');
    expect(result.filter(Boolean)).toHaveLength(10);
    expect(spy).toHaveBeenCalledTimes(10);
    spy.mockClear();
    expect(
      prepareTableRelations(doc, 'perf', 'physical', ['node-t0', 'node-t1']).filter(Boolean),
    ).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockClear();
    prepareTableRelations({ ...doc, tableRelations: [] }, 'perf', 'physical');
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

it('matches the previous algorithm for edited, self, parallel, draft and multi-view relations', () => {
  for (let variant = 0; variant < 6; variant++) {
    const doc = createTestDocument();
    doc.layout.nodes = doc.layout.nodes.map((node, index) => ({
      ...node,
      x: node.x + ((index * 17 + variant * 43) % 160),
      width: node.width + variant * 11,
    }));
    doc.columns![0]!.physical.name = '복합_식별자_' + '가'.repeat(variant * 5);
    const first = doc.tableRelations![0]!;
    doc.tableRelations!.push(
      { ...first, id: 'self', targetTableId: 't0' },
      { ...first, id: 'parallel' },
      {
        ...first,
        id: 'reverse',
        sourceTableId: first.targetTableId,
        targetTableId: first.sourceTableId,
      },
      { ...first, id: 'draft', sourceTableId: 'missing' },
      { ...first, id: 'logical', scope: 'both', physical: null },
    );
    doc.layout.relations = [
      {
        relationId: 'r0',
        viewId: 'perf',
        offset: variant * 7,
        sourceAnchor: { side: 'right', ratio: 0.25 },
        targetAnchor: { side: 'left', ratio: 0.75 },
        waypoints: [{ x: 570, y: 220 + variant * 10 }],
      },
    ];
    doc.views = [{ id: 'combined', name: 'test', domainIds: ['perf'] }];
    doc.layout.nodes.push(
      ...doc.layout.nodes
        .filter((n) => n.viewId === 'perf')
        .map((n) => ({ ...n, id: 'combined-' + n.id, viewId: 'combined' })),
    );
    if (variant % 2) doc.tableRelations!.reverse();
    const before = structuredClone(doc);
    for (const view of ['perf', 'combined', 'missing']) {
      for (const scope of ['physical', 'both', 'logical'] as const) {
        for (const visible of [undefined, ['node-t0', 'node-t1', 'node-t2']]) {
          expect(prepareTableRelations(doc, view, scope, visible)).toEqual(
            prepareTableRelationsReference(doc, view, scope, visible),
          );
        }
      }
    }
    expect(doc).toEqual(before);
  }
});

it('retains first-match semantics even for duplicate IDs in unvalidated input', () => {
  const doc = createTestDocument();
  doc.tables!.push({
    ...doc.tables![0]!,
    physical: { ...doc.tables![0]!.physical, name: 'ignored' },
  });
  doc.columns!.push({
    ...doc.columns![0]!,
    physical: { ...doc.columns![0]!.physical, name: 'ignored' },
  });
  doc.layout.nodes.push({ ...doc.layout.nodes[0]!, x: 555 });
  doc.tableRelations!.push({ ...doc.tableRelations![0]! });
  doc.layout.relations = [
    { relationId: 'r0', viewId: 'perf', offset: 12 },
    { relationId: 'r0', viewId: 'perf', offset: 99 },
  ];
  expect(prepareTableRelations(doc, 'perf', 'physical')).toEqual(
    prepareTableRelationsReference(doc, 'perf', 'physical'),
  );
});

it('shares one calculation across both SVG layers without changing standalone output', () => {
  const doc = createTestDocument();
  const spy = vi.spyOn(routing, 'relationGeometry');
  try {
    const sharedRelations = prepareTableRelations(doc, 'perf', 'physical');
    const props = {
      document: doc,
      viewId: 'perf',
      viewMode: 'physical' as const,
      onSelect: () => {},
    };
    const render = (extra: object) =>
      renderToStaticMarkup(
        createElement('svg', null, createElement(TableRelationsSvg, { ...props, ...extra })),
      );
    const body = render({ sharedRelations, hideControls: true });
    const overlay = render({ sharedRelations, controlsOnly: true });
    expect(spy).toHaveBeenCalledTimes(10);
    expect(render({ hideControls: true })).toBe(body);
    expect(render({ controlsOnly: true })).toBe(overlay);
    expect(spy).toHaveBeenCalledTimes(30);
  } finally {
    spy.mockRestore();
  }
});

it('keeps view, scope, endpoint and combined-view visibility semantics', () => {
  const doc = createTestDocument();
  expect(prepareTableRelations(doc, 'perf', 'physical').filter(Boolean)).toHaveLength(10);
  expect(prepareTableRelations(doc, 'missing', 'physical').filter(Boolean)).toHaveLength(0);
  expect(prepareTableRelations(doc, 'perf', 'logical').filter(Boolean)).toHaveLength(0);
  expect(
    prepareTableRelations(doc, 'perf', 'physical', ['node-t0', 'node-t1']).filter(Boolean),
  ).toHaveLength(1);
  const other = structuredClone(doc);
  other.views = [{ id: 'combined', name: 'combined', domainIds: ['other-domain'] }];
  other.layout.nodes = other.layout.nodes.map((n) => ({ ...n, viewId: 'combined' }));
  expect(prepareTableRelations(other, 'combined', 'physical').filter(Boolean)).toHaveLength(0);
});

it('preserves manual route options and does not mutate the document', () => {
  const doc = createTestDocument();
  doc.layout.relations = [
    {
      relationId: 'r0',
      viewId: 'perf',
      offset: 17,
      sourceAnchor: { side: 'right', ratio: 0.3 },
      targetAnchor: { side: 'left', ratio: 0.7 },
      waypoints: [
        { x: 560, y: 100 },
        { x: 600, y: 200 },
      ],
    },
  ];
  const before = structuredClone(doc);
  const route = prepareTableRelations(doc, 'perf', 'physical')[0]!;
  expect(route.geometry).toEqual(
    relationGeometry(
      route.sourceBounds,
      route.targetBounds,
      route.labelWidth,
      0,
      17,
      undefined,
      route.obstacles,
      doc.layout.relations[0],
    ),
  );
  expect(route.route).toBe(doc.layout.relations[0]);
  expect(doc).toEqual(before);
});

it('updates card bounds and unrelated obstacles when the document changes', () => {
  const doc = createTestDocument();
  const original = prepareTableRelations(doc, 'perf', 'physical')[0]!;
  expect(original.obstacles.some((n) => n.objectId === 't2')).toBe(true);
  const next = structuredClone(doc);
  next.tables![0]!.physical.name = 'a'.repeat(100);
  next.layout.nodes.find((n) => n.objectId === 't2')!.x += 123;
  const changed = prepareTableRelations(next, 'perf', 'physical')[0]!;
  expect(changed.sourceBounds.width).toBeGreaterThan(original.sourceBounds.width);
  expect(changed.obstacles.find((n) => n.objectId === 't2')!.x).toBe(
    original.obstacles.find((n) => n.objectId === 't2')!.x + 123,
  );
  const filtered = prepareTableRelations(next, 'perf', 'physical', ['node-t0', 'node-t1'])[0]!;
  expect(filtered.obstacles).toEqual([]);
});

it('filters global relations by both endpoints while using only shared routes and canonical table coordinates', () => {
  const doc = createTestDocument();
  const globalView = '__tables__';
  const originals = doc.layout.nodes.filter((n) => n.viewId === 'perf');
  doc.layout.nodes.push(
    ...originals.map((n) => ({
      ...n,
      id: 'global-' + n.id,
      viewId: globalView,
      x: n.x + 500,
      y: n.y + 800,
    })),
  );
  doc.views = [{ id: 'personal', name: 'Personal', domainIds: ['perf'] }];
  doc.layout.relations = [
    { relationId: 'r0', viewId: 'personal', offset: 999, waypoints: [{ x: 9000, y: 9000 }] },
    { relationId: 'r0', viewId: globalView, offset: 21 },
  ];
  const before = structuredClone(doc);
  const filtered = prepareTableRelations(doc, globalView, 'physical', [
    'global-node-t0',
    'global-node-t1',
  ]).filter((r) => r !== null);
  expect(filtered).toHaveLength(1);
  expect(filtered[0]!.route).toEqual({ relationId: 'r0', viewId: globalView, offset: 21 });
  expect(filtered[0]!.sourceBounds.x).toBe(originals.find((n) => n.objectId === 't0')!.x + 500);
  expect(filtered[0]!.obstacles).toEqual([]);
  expect(
    prepareTableRelations(doc, globalView, 'physical', ['global-node-t0']).filter(Boolean),
  ).toHaveLength(0);
  expect(doc).toEqual(before);
});
