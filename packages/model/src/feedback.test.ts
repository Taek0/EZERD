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
  upsertCombinedView,
  upsertKey,
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
it('persists combined placements from owners only and cleans deleted domain views', () => {
  const doc = addTableReference(seed(), 'tb', 'a', { x: 999, y: 999 });
  let next = upsertCombinedView(doc, { id: 'combined', name: '함께 보기', domainIds: ['a', 'b'] });
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
  doc = upsertCombinedView(doc, { id: 'combined', name: '함께 보기', domainIds: ['a', 'b'] });
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
it('keeps combined views synchronized when an owned table is added', () => {
  let doc = upsertCombinedView(seed(), { id: 'combined', name: '함께 보기', domainIds: ['a'] });
  doc = addTable(doc, table('new', 'a'), { x: 400, y: 200 });
  expect(doc.layout.nodes.some((n) => n.objectId === 'new' && n.viewId === 'combined')).toBe(true);
  expect(diagnoseDocument(doc)).toEqual([]);
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
  doc = upsertCombinedView(doc, { id: 'combined', name: '도메인 뷰', domainIds: ['a', 'b'] });
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
