import { describe, expect, it } from 'vitest';
import { addDomain, createEmptyDocument } from '@ezerd/model';
import { applyRouteBend, applyRoutePatch, routePatchRollback } from './TableRelations.js';

describe('relation route autosave', () => {
  it('applies only the final bend intent to the latest document on drag release', () => {
    const base = createEmptyDocument();
    base.layout.relations = [
      { relationId: 'relation', viewId: 'orders', offset: 8, bend: { x: 1, y: 2 } },
    ];
    const remote = addDomain(
      base,
      { id: 'remote', name: '원격 도메인', description: '' },
      { x: 4, y: 5 },
    );
    const latest = {
      ...remote,
      layout: {
        ...remote.layout,
        relations: [{ relationId: 'relation', viewId: 'orders', offset: 32, bend: { x: 3, y: 4 } }],
      },
    };

    const committed = applyRouteBend(latest, 'relation', 'orders', { x: 80, y: 90 });

    expect(committed.domains).toContainEqual(
      expect.objectContaining({ id: 'remote', name: '원격 도메인' }),
    );
    expect(committed.layout.relations).toEqual([
      { relationId: 'relation', viewId: 'orders', offset: 32, bend: { x: 80, y: 90 } },
    ]);
  });
});

it('preserves concurrent document and opposite endpoint changes when committing an endpoint drag', () => {
  const base = routeDocument();
  const latest = addDomain(
    base,
    { id: 'remote', name: '동시 변경', description: '' },
    { x: 4, y: 5 },
  );
  latest.layout.relations = [
    {
      relationId: 'relation',
      viewId: 'orders',
      offset: 32,
      sourceAnchor: { side: 'left', ratio: 0.2 },
      targetAnchor: { side: 'bottom', ratio: 0.7 },
      bend: { x: 80, y: 90 },
      waypoints: [{ x: 100, y: 90 }],
    },
  ];
  const committed = applyRoutePatch(latest, 'relation', 'orders', {
    sourceAnchor: { side: 'top', ratio: 0.4 },
    bend: undefined,
    waypoints: undefined,
  });
  expect(committed.domains).toEqual(latest.domains);
  expect(committed.layout.relations).toEqual([
    {
      relationId: 'relation',
      viewId: 'orders',
      offset: 32,
      sourceAnchor: { side: 'top', ratio: 0.4 },
      targetAnchor: { side: 'bottom', ratio: 0.7 },
      bend: undefined,
      waypoints: undefined,
    },
  ]);
  expect(latest.layout.relations[0]!.sourceAnchor).toEqual({ side: 'left', ratio: 0.2 });
});

it('keeps a dragged segment route scoped to its view', () => {
  const base = routeDocument();
  base.layout.relations = [{ relationId: 'relation', viewId: 'other', offset: 15 }];
  const committed = applyRoutePatch(base, 'relation', 'orders', {
    sourceAnchor: { side: 'right', ratio: 0.5 },
    targetAnchor: { side: 'left', ratio: 0.5 },
    waypoints: [
      { x: 100, y: 50 },
      { x: 100, y: 150 },
    ],
    bend: undefined,
  });
  expect(committed.layout.relations).toHaveLength(2);
  expect(committed.layout.relations![0]).toEqual(base.layout.relations[0]);
  expect(committed.layout.relations![1]).toMatchObject({
    viewId: 'orders',
    offset: 0,
    waypoints: [
      { x: 100, y: 50 },
      { x: 100, y: 150 },
    ],
  });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { addTable, upsertTableRelation } from '@ezerd/model';
import { TableRelationsSvg } from './TableRelations.js';

function renderControls(
  options: { readOnly?: boolean; layoutReadOnly?: boolean; hideControls?: boolean } = {},
) {
  let document = addDomain(
    createEmptyDocument(),
    { id: 'd', name: '도메인', description: '' },
    { x: 0, y: 0 },
  );
  document = addTable(
    document,
    {
      id: 't',
      domainId: 'd',
      scope: 'both',
      logical: { name: '테이블', definition: '' },
      physical: { name: 'table', schema: 'public', comment: '' },
      customProperties: { common: {}, logical: {}, physical: {} },
    },
    { x: 0, y: 0 },
  );
  document = upsertTableRelation(document, {
    id: 'r',
    sourceTableId: 't',
    targetTableId: 't',
    scope: 'both',
    logical: { name: '관계', cardinality: 'one-to-many', required: false },
    physical: null,
  });
  return renderToStaticMarkup(
    createElement(TableRelationsSvg, {
      document,
      viewId: 'd',
      viewMode: 'both',
      onSelect: () => {},
      onChange: () => {},
      controlsOnly: true,
      selectedId: 'r',
      ...options,
    }),
  );
}

it('makes line segments and both anchors keyboard accessible without a separate adjustment button', () => {
  const markup = renderControls();
  expect(markup).toContain('table-route-segment');
  expect(markup).toContain('관계 FK 연결 위치 조절');
  expect(markup).toContain('관계 PK 연결 위치 조절');
  expect(markup).toContain('table-route-endpoint selected');
  expect(markup).toContain('tabindex="0"');
  expect(markup).not.toContain('table-route-adjust');
  expect(markup).not.toContain('table-relation-stroke');
});

it.each([{ readOnly: true }, { layoutReadOnly: true }, { hideControls: true }])(
  'suppresses direct manipulation controls under %j',
  (options) => {
    const markup = renderControls(options);
    expect(markup).not.toContain('table-route-segment');
    expect(markup).not.toContain('table-route-endpoint');
  },
);

function routeDocument() {
  let document = addDomain(
    createEmptyDocument(),
    { id: 'orders', name: '주문', description: '' },
    { x: 0, y: 0 },
  );
  document = addTable(
    document,
    {
      id: 't',
      domainId: 'orders',
      scope: 'both',
      logical: { name: '테이블', definition: '' },
      physical: { name: 'table', schema: 'public', comment: '' },
      customProperties: { common: {}, logical: {}, physical: {} },
    },
    { x: 0, y: 0 },
  );
  return upsertTableRelation(document, {
    id: 'relation',
    sourceTableId: 't',
    targetTableId: 't',
    scope: 'both',
    logical: { name: '관계', cardinality: 'one-to-many', required: false },
    physical: null,
  });
}
it('does not restore a relation deleted remotely during a drag', () => {
  const latest = createEmptyDocument();
  expect(
    applyRoutePatch(latest, 'deleted', 'orders', { sourceAnchor: { side: 'left', ratio: 0.5 } }),
  ).toBe(latest);
});

it('cancels only the dragged endpoint fields while retaining a concurrent opposite anchor edit', () => {
  const latest = routeDocument();
  latest.layout.relations = [
    {
      relationId: 'relation',
      viewId: 'orders',
      offset: 32,
      sourceAnchor: { side: 'top', ratio: 0.4 },
      targetAnchor: { side: 'bottom', ratio: 0.9 },
    },
  ];
  const rollback = routePatchRollback(
    {
      sourceAnchor: { side: 'left', ratio: 0.2 },
      targetAnchor: { side: 'right', ratio: 0.5 },
      bend: { x: 80, y: 90 },
      waypoints: undefined,
    },
    { sourceAnchor: { side: 'top', ratio: 0.4 }, bend: undefined, waypoints: undefined },
  );
  const cancelled = applyRoutePatch(latest, 'relation', 'orders', rollback);
  expect(cancelled.layout.relations![0]).toEqual({
    relationId: 'relation',
    viewId: 'orders',
    offset: 32,
    sourceAnchor: { side: 'left', ratio: 0.2 },
    targetAnchor: { side: 'bottom', ratio: 0.9 },
    bend: { x: 80, y: 90 },
    waypoints: undefined,
  });
  expect(Object.hasOwn(rollback, 'targetAnchor')).toBe(false);
});
