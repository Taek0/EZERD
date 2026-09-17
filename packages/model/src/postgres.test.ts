import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type Column, type Table, type TableRelation } from './document.js';
import { exportPostgres } from './postgres.js';
const props = () => ({ common: {}, logical: {}, physical: {} });
it('exports only the allowed current-time default on scalar time columns', () => {
  for (const name of ['time', 'timetz']) {
    const doc = fixture();
    doc.columns[0]!.physical.type.name = name;
    doc.columns[1]!.physical.type.name = name;
    doc.columns[0]!.physical.defaultExpression = 'CURRENT_TIME';
    expect(exportPostgres(doc).sql).toContain('DEFAULT CURRENT_TIME');
    doc.columns[0]!.physical.defaultExpression = 'CURRENT_TIME; SELECT 1';
    expect(exportPostgres(doc).canExport).toBe(false);
    doc.columns[0]!.physical.defaultExpression = 'CURRENT_TIME';
    doc.columns[0]!.physical.type.isArray = true;
    expect(exportPostgres(doc).canExport).toBe(false);
  }
});
const table = (id: string): Table => ({
  id,
  domainId: 'd',
  scope: 'both',
  logical: { name: '논리' + id, definition: '' },
  physical: { name: id, schema: 'erd_test', comment: '' },
  customProperties: props(),
});
const column = (id: string, tableId: string, name = 'id', type = 'integer'): Column => ({
  id,
  tableId,
  scope: 'both',
  logical: { name: '식별자', definition: '업무', semanticType: '식별자', required: true },
  physical: {
    name,
    type: { name: type, isArray: false },
    nullable: false,
    defaultExpression: null,
    comment: '',
  },
  customProperties: props(),
});
const relation = (
  id: string,
  source: string,
  target: string,
  sc: string[],
  tc: string[],
): TableRelation => ({
  id,
  sourceTableId: source,
  targetTableId: target,
  scope: 'both',
  logical: { name: '참조', cardinality: 'one-to-many', required: true },
  physical: {
    name: id,
    sourceColumnIds: sc,
    targetColumnIds: tc,
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  },
});
function fixture() {
  return {
    ...createEmptyDocument(),
    domains: [{ id: 'd', name: '업무', description: '' }],
    tables: [table('orders'), table('payments')],
    columns: [column('a', 'orders'), column('b', 'payments')],
    keys: [
      {
        id: 'ka',
        tableId: 'orders',
        scope: 'both' as const,
        kind: 'primary' as const,
        name: 'orders_pk',
        columnIds: ['a'],
      },
      {
        id: 'kb',
        tableId: 'payments',
        scope: 'both' as const,
        kind: 'primary' as const,
        name: 'payments_pk',
        columnIds: ['b'],
      },
    ],
    tableRelations: [relation('fk_payments', 'payments', 'orders', ['b'], ['a'])],
  };
}
describe('PostgreSQL creation DDL', () => {
  it('quotes names, exports explicit keys/FK after tables and excludes logical objects/business links', () => {
    const doc = fixture();
    doc.tables.push({ ...table('hidden'), scope: 'logical' });
    doc.domainRelations.push({
      id: 'business',
      sourceDomainId: 'd',
      targetDomainId: 'gone',
      name: 'not FK',
      direction: 'forward',
      description: '',
    });
    const result = exportPostgres(doc);
    expect(result.diagnostics).toEqual([]);
    expect(result.canExport).toBe(true);
    expect(result.sql).toContain('CREATE TABLE "erd_test"."orders"');
    expect(result.sql).toContain('CONSTRAINT "orders_pk" PRIMARY KEY ("id")');
    expect(result.sql.indexOf('ALTER TABLE')).toBeGreaterThan(
      result.sql.lastIndexOf('CREATE TABLE'),
    );
    expect(result.sql).not.toContain('hidden');
    expect(result.sql).not.toContain('business');
  });
  it('supports ordered composite keys and circular FK', () => {
    const doc = fixture();
    doc.columns.push(column('a2', 'orders', 'tenant'), column('b2', 'payments', 'tenant'));
    doc.keys[0]!.columnIds.push('a2');
    doc.keys[1]!.columnIds.push('b2');
    doc.tableRelations = [
      relation('to_orders', 'payments', 'orders', ['b', 'b2'], ['a', 'a2']),
      relation('to_payments', 'orders', 'payments', ['a', 'a2'], ['b', 'b2']),
    ];
    const result = exportPostgres(doc);
    expect(result.canExport).toBe(true);
    expect(result.sql).toContain('FOREIGN KEY ("id", "tenant")');
    expect(result.sql.match(/ALTER TABLE/g)).toHaveLength(2);
  });
  it('blocks invalid FK mappings and logical-only referenced columns instead of incomplete SQL', () => {
    const doc = fixture();
    doc.columns[0]!.scope = 'logical';
    const result = exportPostgres(doc);
    expect(result.canExport).toBe(false);
    expect(result.sql).toBe('');
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
  it('never inserts unsupported type/default expressions into SQL', () => {
    for (const update of [
      { type: { name: 'text); DROP TABLE users;--', isArray: false } },
      { defaultExpression: 'now(); DROP TABLE users;--' },
    ]) {
      const doc = fixture();
      doc.columns[0]!.physical = { ...doc.columns[0]!.physical, ...update };
      expect(exportPostgres(doc).canExport).toBe(false);
      expect(exportPostgres(doc).sql).toBe('');
    }
  });
  it('escapes quoted identifiers/comments and permits safe literals and parameters', () => {
    const doc = fixture();
    doc.tables[0]!.physical.name = 'an"order';
    doc.tables[0]!.physical.comment = "owner's table\\note";
    doc.columns[0]!.physical.type = { name: 'numeric', precision: 12, scale: 2, isArray: false };
    doc.columns[0]!.physical.defaultExpression = '0';
    doc.tableRelations = [];
    const result = exportPostgres(doc);
    expect(result.canExport).toBe(true);
    expect(result.sql).toContain('"an""order"');
    expect(result.sql).toContain('numeric(12, 2)');
    expect(result.sql).toContain("owner''s table\\\\note");
  });
  it('diagnoses duplicate schema names, duplicate PK and names exceeding PostgreSQL UTF8 limits', () => {
    const doc = fixture();
    doc.tables[1]!.physical.name = 'orders';
    doc.tables[0]!.physical.name = '한'.repeat(22);
    doc.keys.push({ ...doc.keys[0]!, id: 'second', name: 'another_pk' });
    expect(exportPostgres(doc).canExport).toBe(false);
  });
  it('rejects serial arrays, missing uniqueness, foreign type mismatch and impossible SET NULL', () => {
    const doc = fixture();
    doc.columns[0]!.physical.type = { name: 'serial', isArray: true };
    expect(exportPostgres(doc).canExport).toBe(false);
    const noKey = fixture();
    noKey.keys = [];
    expect(exportPostgres(noKey).canExport).toBe(false);
    const mismatch = fixture();
    mismatch.columns[0]!.physical.type.name = 'uuid';
    expect(exportPostgres(mismatch).canExport).toBe(false);
    const invalidAction = fixture();
    invalidAction.tableRelations[0]!.physical!.onDelete = 'SET NULL';
    expect(exportPostgres(invalidAction).canExport).toBe(false);
  });
  it('supports supported array columns but diagnoses unknown type drafts and empty designs', () => {
    const doc = fixture();
    doc.columns.push({
      ...column('tags', 'orders', 'tags', 'text'),
      physical: {
        ...column('z', 'orders').physical,
        name: 'tags',
        type: { name: 'text', isArray: true },
        nullable: true,
      },
    });
    expect(exportPostgres(doc).sql).toContain('"tags" text[]');
    expect(exportPostgres(createEmptyDocument()).canExport).toBe(false);
  });
});

it('blocks numeric defaults that overflow after PostgreSQL scale rounding', () => {
  for (const [precision, scale, value] of [
    [2, 0, '999'],
    [3, 2, '9.995'],
    [2, -3, '99500'],
  ] as const) {
    const doc = fixture();
    doc.tableRelations = [];
    doc.columns[0]!.physical.type = { name: 'numeric', precision, scale, isArray: false };
    doc.columns[0]!.physical.defaultExpression = value;
    expect(exportPostgres(doc).canExport).toBe(false);
  }
  const doc = fixture();
  doc.tableRelations = [];
  doc.columns[0]!.physical.type = { name: 'numeric', precision: 3, scale: 2, isArray: false };
  doc.columns[0]!.physical.defaultExpression = '9.994';
  expect(exportPostgres(doc).canExport).toBe(true);
});

it('rejects SET DEFAULT on effectively non-null primary keys without a default', () => {
  const doc = fixture();
  doc.columns[1]!.physical.nullable = true;
  doc.tableRelations[0]!.physical!.onDelete = 'SET DEFAULT';
  expect(exportPostgres(doc).canExport).toBe(false);
});

it('diagnoses float defaults that underflow at INSERT and orphan physical objects', () => {
  for (const type of ['real', 'double precision']) {
    const doc = fixture();
    doc.tableRelations = [];
    doc.columns[0]!.physical.type = { name: type, isArray: false };
    doc.columns[0]!.physical.defaultExpression = '1e-400';
    expect(exportPostgres(doc).canExport).toBe(false);
  }
  const orphan = fixture();
  orphan.columns.push(column('orphan', 'missing'));
  expect(exportPostgres(orphan).canExport).toBe(false);
});
