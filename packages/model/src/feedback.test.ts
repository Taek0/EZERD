import { expect, it } from 'vitest';
import {
  addColumn,
  addDomain,
  addTable,
  addTableReference,
  autoLayoutView,
  createEmptyDocument,
  createForeignKeyFromPrimaryKey,
  diagnoseDocument,
  removeDomain,
  upsertKey,
  updateTable,
  upsertRelationLayout,
  type Column,
  type Table,
} from './index.js';
const properties = { common: {}, logical: {}, physical: {} };
const table = (id: string, domainId: string): Table => ({
  id,
  domainId,
  scope: 'both',
  logical: { name: id, definition: '' },
  physical: { name: id, schema: 'public', comment: '' },
  customProperties: properties,
});
const column = (id: string, tableId: string): Column => ({
  id,
  tableId,
  scope: 'both',
  logical: { name: 'ID', definition: '', semanticType: '', required: true },
  physical: {
    name: 'id',
    type: { name: 'bigserial', isArray: false },
    nullable: false,
    defaultExpression: 'nextval()',
    comment: '',
  },
  customProperties: properties,
});
function seed() {
  let doc = createEmptyDocument();
  for (const id of ['a', 'b'])
    doc = addDomain(doc, { id, name: id, description: '' }, { x: 0, y: 0 });
  for (const id of ['a', 'b']) doc = addTable(doc, table(`t${id}`, id), { x: 10, y: 20 });
  doc = addColumn(doc, column('pkc', 'ta'));
  doc = addColumn(doc, column('existing', 'tb'));
  return upsertKey(doc, {
    id: 'pk',
    tableId: 'ta',
    kind: 'primary',
    scope: 'both',
    name: 'pk',
    columnIds: ['pkc'],
  });
}
it('copies PK to a new FK column without defaults or name collisions and preserves SQL direction', () => {
  const doc = seed();
  const next = createForeignKeyFromPrimaryKey(doc, {
    primaryTableId: 'ta',
    foreignTableId: 'tb',
    primaryKeyId: 'pk',
    relationId: 'fk',
    columnIds: ['fkcol'],
  });
  expect(next.columns!.at(-1)!.physical).toMatchObject({
    name: 'id_2',
    type: { name: 'bigint' },
    defaultExpression: null,
  });
  expect(next.tableRelations![0]).toMatchObject({
    sourceTableId: 'tb',
    targetTableId: 'ta',
    physical: { sourceColumnIds: ['fkcol'], targetColumnIds: ['pkc'] },
  });
  expect(doc.columns).toHaveLength(2);
  expect(diagnoseDocument(next)).toEqual([]);
  expect(() =>
    createForeignKeyFromPrimaryKey(doc, {
      primaryTableId: 'ta',
      foreignTableId: 'tb',
      primaryKeyId: 'pk',
      relationId: 'fk',
      columnIds: ['pkc'],
    }),
  ).toThrow();
});
it('preserves historical combined placements and cleans deleted domain views', () => {
  const doc = addTableReference(seed(), 'tb', 'a', { x: 999, y: 999 });
  let next: typeof doc = {
    ...doc,
    views: [{ id: 'combined', name: '함께 보기', domainIds: ['a', 'b'] }],
    layout: {
      ...doc.layout,
      nodes: [
        ...doc.layout.nodes,
        ...doc.layout.nodes
          .filter((node) => node.viewId === '__tables__')
          .flatMap((node) => [{ ...node, id: node.id + ':' + 'combined', viewId: 'combined' }]),
      ],
    },
  };
  expect(next.layout.nodes.filter((n) => n.viewId === 'combined')).toHaveLength(2);
  expect(next.tables).toEqual(doc.tables);
  expect(diagnoseDocument(autoLayoutView(next, 'combined'))).toEqual([]);
  next = removeDomain(next, 'a');
  expect(next.views![0]!.domainIds).toEqual(['b']);
  expect(diagnoseDocument(next)).toEqual([]);
  next = removeDomain(next, 'b');
  expect(next.views).toEqual([]);
  expect(next.layout.nodes.some((n) => n.viewId === 'combined')).toBe(false);
});
it('stores independent route offsets by view', () => {
  let doc = createForeignKeyFromPrimaryKey(seed(), {
    primaryTableId: 'ta',
    foreignTableId: 'tb',
    primaryKeyId: 'pk',
    relationId: 'fk',
    columnIds: ['fkc'],
  });
  doc = {
    ...doc,
    views: [{ id: 'combined', name: '함께 보기', domainIds: ['a', 'b'] }],
    layout: {
      ...doc.layout,
      nodes: [
        ...doc.layout.nodes,
        ...doc.layout.nodes
          .filter((node) => node.viewId === '__tables__')
          .flatMap((node) => [{ ...node, id: node.id + ':' + 'combined', viewId: 'combined' }]),
      ],
    },
  };
  doc = upsertRelationLayout(doc, { relationId: 'fk', viewId: 'combined', offset: 60 });
  expect(doc.layout.relations).toEqual([{ relationId: 'fk', viewId: 'combined', offset: 60 }]);
});
it('copies ordered composite PK type parameters and enum identities; validates every column before mutation', () => {
  let doc = seed();
  doc = {
    ...doc,
    enums: [{ id: 'enum', schema: 'public', name: 'status', values: ['on', 'off'] }],
  };
  doc = addColumn(doc, {
    ...column('pk2', 'ta'),
    physical: {
      ...column('pk2', 'ta').physical,
      type: { name: 'status', enumId: 'enum', isArray: true, length: 12, precision: 8, scale: 2 },
    },
  });
  doc = upsertKey(doc, { ...doc.keys![0]!, columnIds: ['pk2', 'pkc'] });
  const input = {
    primaryTableId: 'ta',
    foreignTableId: 'tb',
    primaryKeyId: 'pk',
    relationId: 'fk',
    columnIds: ['c2', 'c1'],
  };
  const next = createForeignKeyFromPrimaryKey(doc, input);
  expect(next.tableRelations![0]!.physical!.targetColumnIds).toEqual(['pk2', 'pkc']);
  expect(next.columns!.find((c) => c.id === 'c2')!.physical.type).toEqual(
    doc.columns!.find((c) => c.id === 'pk2')!.physical.type,
  );
  expect(next.columns!.find((c) => c.id === 'c2')!.physical.type).not.toBe(
    doc.columns!.find((c) => c.id === 'pk2')!.physical.type,
  );
  const before = JSON.stringify(doc);
  expect(() =>
    createForeignKeyFromPrimaryKey(doc, { ...input, columnIds: ['new', 'existing'] }),
  ).toThrow();
  expect(JSON.stringify(doc)).toBe(before);
});
it('uses the established NOT NULL default and distinct FK constraint names for repeated connections', () => {
  const first = createForeignKeyFromPrimaryKey(seed(), {
    primaryTableId: 'ta',
    foreignTableId: 'tb',
    primaryKeyId: 'pk',
    relationId: 'r1',
    columnIds: ['fk1'],
  });
  const next = createForeignKeyFromPrimaryKey(first, {
    primaryTableId: 'ta',
    foreignTableId: 'tb',
    primaryKeyId: 'pk',
    relationId: 'r2',
    columnIds: ['fk2'],
  });
  expect(next.columns!.find((c) => c.id === 'fk2')!.physical.nullable).toBe(false);
  expect(new Set(next.tableRelations!.map((r) => r.physical!.name)).size).toBe(2);
});
it('stores independent draggable bends and rejects invalid coordinates', () => {
  let doc = createForeignKeyFromPrimaryKey(seed(), {
    primaryTableId: 'ta',
    foreignTableId: 'tb',
    primaryKeyId: 'pk',
    relationId: 'fk',
    columnIds: ['fc'],
  });
  doc = {
    ...doc,
    views: [{ id: 'combined', name: '도메인 뷰', domainIds: ['a', 'b'] }],
    layout: {
      ...doc.layout,
      nodes: [
        ...doc.layout.nodes,
        ...doc.layout.nodes
          .filter((node) => node.viewId === '__tables__')
          .flatMap((node) => [{ ...node, id: node.id + ':' + 'combined', viewId: 'combined' }]),
      ],
    },
  };
  const bend = { x: 125, y: -75 };
  const next = upsertRelationLayout(doc, { relationId: 'fk', viewId: 'combined', offset: 0, bend });
  bend.x = 999;
  expect(next.layout.relations![0]!.bend).toEqual({ x: 125, y: -75 });
  expect(doc.layout.relations).toBeUndefined();
  expect(() =>
    upsertRelationLayout(doc, {
      relationId: 'fk',
      viewId: 'combined',
      offset: 0,
      bend: { x: Infinity, y: 0 },
    }),
  ).toThrow();
  expect(() =>
    upsertRelationLayout(doc, {
      relationId: 'fk',
      viewId: 'combined',
      offset: 0,
      bend: { x: 0, y: 1e8 },
    }),
  ).toThrow();
});

it('does not generate personal-view placements when tables are added or change domains', () => {
  const source = seed();
  const legacy = {
    ...source,
    views: [{ id: 'combined', name: 'Historical', domainIds: ['a'] }],
    layout: {
      ...source.layout,
      nodes: [
        ...source.layout.nodes,
        {
          ...source.layout.nodes.find((node) => node.objectId === 'ta' && node.viewId === 'a')!,
          id: 'historical-ta',
          viewId: 'combined',
        },
      ],
    },
  };
  const added = addTable(legacy, table('new', 'a'), { x: 400, y: 200 });
  expect(added.views).toEqual(legacy.views);
  expect(added.layout.nodes.filter((node) => node.viewId === 'combined')).toEqual(
    legacy.layout.nodes.filter((node) => node.viewId === 'combined'),
  );
  const movedIn = updateTable(added, 'tb', { domainId: 'a' });
  expect(movedIn.layout.nodes.filter((node) => node.viewId === 'combined')).toEqual(
    legacy.layout.nodes.filter((node) => node.viewId === 'combined'),
  );
  const movedOut = updateTable(movedIn, 'ta', { domainId: 'b' });
  expect(movedOut.views).toEqual(legacy.views);
  expect(movedOut.layout.nodes.filter((node) => node.viewId === 'combined')).toEqual([]);
  expect(diagnoseDocument(movedOut)).toEqual([]);
  expect(source.views).toBeUndefined();
});
