import { expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TableRelationsSvg } from './TableRelations.js';
import * as routing from './relation-routing.js';
import { createPerformanceFixture } from '../../shared/performance/fixture.js';
import { prepareTableRelations } from './prepare-table-relations.js';
import { relationGeometry } from './relation-routing.js';

it('shares one calculation across both SVG layers without changing standalone output', () => {
  const doc = createPerformanceFixture();
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
  const doc = createPerformanceFixture();
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
  const doc = createPerformanceFixture();
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
  const doc = createPerformanceFixture();
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
