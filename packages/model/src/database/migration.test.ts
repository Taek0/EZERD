import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type Column, type DesignDocument } from '../document.js';
import { defaultDatabaseContext } from './profiles.js';
import { migrateDesignDocumentV1, nativeDocumentMatchesContext } from './migration.js';
import {
  createEmptyNativeDocument,
  mapNativeExpressionColumns,
  nativeExpressionColumnIds,
  type NativeExpression,
} from './native-document.js';

const pg = defaultDatabaseContext('postgresql');
const metadata = { common: {}, logical: {}, physical: {} };
function column(
  id: string,
  type: Column['physical']['type'],
  defaultExpression: string | null = null,
): Column {
  return {
    id,
    tableId: 't',
    scope: 'physical',
    logical: { name: id, definition: '', semanticType: '', required: false },
    physical: { name: id, type, nullable: false, comment: '', defaultExpression },
    customProperties: metadata,
  };
}
function fixture(columns: Column[]): DesignDocument {
  return {
    ...createEmptyDocument(),
    tables: [
      {
        id: 't',
        domainId: null,
        scope: 'physical',
        logical: { name: 'logical', definition: '' },
        physical: { name: 'actual', schema: 'sales', comment: 'keep' },
        customProperties: metadata,
      },
    ],
    columns,
    keys: [
      {
        id: 'k',
        tableId: 't',
        scope: 'physical',
        kind: 'primary',
        name: 'pk',
        columnIds: [columns[0]!.id],
      },
    ],
    layout: {
      nodes: [
        { id: 'n', objectId: 't', viewId: '__tables__', x: 10, y: 20, width: 300, height: 200 },
      ],
      viewports: [],
    },
  };
}

describe('v1 to native v2 migration preserves meaning', () => {
  it('separates serial generation and retains exact large numeric defaults and shared placements', () => {
    const source = fixture([
      column('id', { name: 'bigserial', isArray: false }),
      column('large', { name: 'bigint', isArray: false }, '9223372036854775807'),
      column(
        'decimal',
        { name: 'numeric', precision: 20, scale: -2, isArray: false },
        '12345678901234567890',
      ),
    ]);
    const before = JSON.stringify(source);
    const { document, issues } = migrateDesignDocumentV1(source, pg);
    expect(issues).toEqual([]);
    expect(document.schemaVersion).toBe(2);
    expect(document.columns?.[0]?.physical).toMatchObject({
      type: {
        kind: 'builtin',
        database: 'postgresql',
        typeId: 'postgresql:bigint',
        parameters: {},
      },
      generation: { kind: 'serial', database: 'postgresql' },
      defaultValue: { kind: 'none' },
    });
    expect(document.columns?.[1]?.physical.defaultValue).toEqual({
      kind: 'literal',
      literalType: 'number',
      value: '9223372036854775807',
    });
    expect(document.tables?.[0]?.physical.namespace).toEqual({
      kind: 'postgresSchema',
      name: 'sales',
    });
    expect(document.layout).toEqual(source.layout);
    expect(document.keys).toEqual(source.keys);
    document.layout.nodes[0]!.x = 99;
    expect(JSON.stringify(source)).toBe(before);
  });
  it('resolves stable ENUM IDs and preserves arrays and escaped ENUM labels', () => {
    const source = fixture([
      column('enum', { name: 'obsolete-name', enumId: 'e', isArray: false }, "'a''b\\c'"),
      column('array', { name: 'INT8', isArray: true }),
    ]);
    source.enums = [{ id: 'e', name: 'state', schema: 'types', values: ["a'b\\c"] }];
    const { document, issues } = migrateDesignDocumentV1(source, pg);
    expect(issues).toEqual([]);
    expect(document.columns?.[0]?.physical.type).toEqual({
      kind: 'projectEnum',
      database: 'postgresql',
      enumId: 'e',
    });
    expect(document.columns?.[0]?.physical.defaultValue).toEqual({
      kind: 'literal',
      literalType: 'string',
      value: "a'b\\c",
    });
    expect(document.columns?.[1]?.physical.type).toMatchObject({
      typeId: 'postgresql:bigint',
      array: { dimensions: 1 },
    });
    expect(document.enums).toEqual(source.enums);
  });
  it.each(['mysql', 'sqlite'] as const)(
    'keeps historical PG types unresolved under %s metadata',
    (kind) => {
      const source = fixture([
        column('id', { name: 'integer', isArray: false }),
        column('time', { name: 'timestamptz', isArray: false }, 'now()'),
      ]);
      const { document, issues } = migrateDesignDocumentV1(source, defaultDatabaseContext(kind));
      expect(document.database.kind).toBe(kind);
      expect(document.columns?.[0]?.physical.type).toEqual({
        kind: 'legacy',
        source: 'document-v1',
        original: source.columns![0]!.physical.type,
      });
      expect(document.columns?.[1]?.physical.defaultValue).toEqual({
        kind: 'legacyExpression',
        source: 'document-v1',
        original: 'now()',
      });
      expect(document.tables?.[0]?.physical.namespace).toEqual({
        kind: 'legacyNamespace',
        source: 'document-v1',
        original: 'sales',
      });
      expect(issues.map((issue) => issue.code)).toEqual([
        'legacy.namespace-unresolved',
        'legacy.type-unresolved',
        'legacy.type-unresolved',
        'legacy.default-unresolved',
      ]);
    },
  );
  it('preserves unknown names, invalid parameters and serial arrays instead of silently repairing them', () => {
    const source = fixture([
      column('custom', { name: 'UnregisteredType', isArray: false }, 'evil()'),
      column('bad', { name: 'integer', length: 9, isArray: false }),
      column('array', { name: 'serial', isArray: true }),
    ]);
    const { document, issues } = migrateDesignDocumentV1(source, pg);
    for (let i = 0; i < source.columns!.length; i++)
      expect(document.columns?.[i]?.physical.type).toEqual({
        kind: 'legacy',
        source: 'document-v1',
        original: source.columns![i]!.physical.type,
      });
    expect(issues.filter((issue) => issue.code === 'legacy.type-unresolved')).toHaveLength(3);
    expect(document.columns?.[0]?.physical.defaultValue).toEqual({
      kind: 'legacyExpression',
      source: 'document-v1',
      original: 'evil()',
    });
  });
  it('parses only known default forms, never executing or rewriting arbitrary SQL', () => {
    const source = fixture([
      column('text', { name: 'text', isArray: false }, "'O''Brien'"),
      column('bool', { name: 'boolean', isArray: false }, 'TRUE'),
      column('json', { name: 'jsonb', isArray: false }, '\'{"n":12345678901234567890}\''),
      column('call', { name: 'timestamptz', isArray: false }, 'NOW()'),
      column('raw', { name: 'text', isArray: false }, "'x'; DROP TABLE t;--"),
      column('escape', { name: 'text', isArray: false }, "'a\\b'"),
    ]);
    const { document } = migrateDesignDocumentV1(source, pg);
    expect(document.columns?.[0]?.physical.defaultValue).toEqual({
      kind: 'literal',
      literalType: 'string',
      value: "O'Brien",
    });
    expect(document.columns?.[1]?.physical.defaultValue).toEqual({
      kind: 'literal',
      literalType: 'boolean',
      value: true,
    });
    expect(document.columns?.[2]?.physical.defaultValue).toEqual({
      kind: 'literal',
      literalType: 'json',
      value: '{"n":12345678901234567890}',
    });
    expect(document.columns?.[3]?.physical.defaultValue).toMatchObject({
      kind: 'expression',
      expression: { kind: 'call', functionId: 'postgresql:current_timestamp' },
    });
    expect(document.columns?.[4]?.physical.defaultValue).toMatchObject({
      kind: 'legacyExpression',
    });
    expect(document.columns?.[5]?.physical.defaultValue).toMatchObject({
      kind: 'legacyExpression',
    });
  });
  it('does not add absent collections or alter the original database context', () => {
    const context = defaultDatabaseContext('sqlite');
    const { document } = migrateDesignDocumentV1(createEmptyDocument(), context);
    expect(document).not.toHaveProperty('tables');
    expect(document).not.toHaveProperty('columns');
    context.kind = 'mysql';
    expect(document.database.kind).toBe('sqlite');
    expect(nativeDocumentMatchesContext(createEmptyNativeDocument(pg), pg)).toBe(true);
    expect(nativeDocumentMatchesContext(document, defaultDatabaseContext('mysql'))).toBe(false);
  });
  it('rejects non-v1 input and escapes diagnostic ID segments', () => {
    expect(() =>
      migrateDesignDocumentV1(createEmptyNativeDocument(pg) as unknown as DesignDocument, pg),
    ).toThrow('document.version-not-supported');
    const source = fixture([column('bad~/id', { name: 'unknown', isArray: false })]);
    const { issues } = migrateDesignDocumentV1(source, pg);
    expect(issues[0]).toMatchObject({
      objectId: 'bad~/id',
      path: '/columns/bad~0~1id/physical/type',
    });
  });
});

describe('structured expressions use stable column IDs', () => {
  const expression: NativeExpression = {
    kind: 'in',
    negate: false,
    operand: {
      kind: 'call',
      functionId: 'postgresql:lower',
      args: [{ kind: 'column', columnId: 'source' }],
    },
    values: [
      { kind: 'literal', literalType: 'string', value: "'source'" },
      { kind: 'column', columnId: 'other' },
    ],
  };
  it('remaps references without touching literals and de-duplicates collected IDs', () => {
    const result = mapNativeExpressionColumns(expression, (id) => `copy:${id}`);
    expect(nativeExpressionColumnIds(result)).toEqual(['copy:source', 'copy:other']);
    expect(result).toMatchObject({ values: [{ value: "'source'" }, { columnId: 'copy:other' }] });
    expect(nativeExpressionColumnIds(expression)).toEqual(['source', 'other']);
  });
  it('bounds recursion and total expression nodes', () => {
    let deep: NativeExpression = { kind: 'null' };
    for (let i = 0; i < 34; i++) deep = { kind: 'unary', operator: 'NOT', operand: deep };
    expect(() => nativeExpressionColumnIds(deep)).toThrow('expression.complexity-limit');
    const wide: NativeExpression = {
      kind: 'call',
      functionId: 'postgresql:coalesce',
      args: Array.from({ length: 2048 }, (): NativeExpression => ({ kind: 'null' })),
    };
    expect(() => mapNativeExpressionColumns(wide, (id) => id)).toThrow(
      'expression.complexity-limit',
    );
  });
});
