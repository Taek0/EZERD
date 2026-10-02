import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../document.js';
import { defaultDatabaseContext } from './profiles.js';
import { createEmptyNativeDocument, type NativeDesignDocument } from './native-document.js';
import {
  createNativeTable,
  createNativeColumn,
  addNativeColumn,
  updateNativeColumn,
  updateNativeTable,
  createNativeForeignKeyFromPrimaryKey,
} from './editing.js';
import { inspectNativeDatabaseDocument, validateDatabaseDocument } from './validation.js';
import type { DatabaseKind } from './definitions.js';

function fixture(kind: DatabaseKind = 'postgresql'): NativeDesignDocument {
  const database = defaultDatabaseContext(kind);
  const parent = createNativeTable(database, 'parent');
  parent.physical.name = 'parent';
  parent.logical.name = '부모';
  const child = createNativeTable(database, 'child');
  child.physical.name = 'child';
  child.logical.name = '자식';
  const column = createNativeColumn(database, parent, 'parent-id');
  column.logical.name = '번호';
  column.logical.required = true;
  column.physical.name = 'id';
  column.physical.type =
    kind === 'postgresql'
      ? { kind: 'builtin', database: kind, typeId: 'postgresql:bigint', parameters: {} }
      : kind === 'mysql'
        ? {
            kind: 'builtin',
            database: kind,
            typeId: 'mysql:bigint',
            parameters: { unsigned: true },
          }
        : { kind: 'builtin', database: kind, typeId: 'sqlite:integer', parameters: {} };
  column.physical.generation =
    kind === 'postgresql'
      ? {
          kind: 'identity',
          database: kind,
          mode: 'always',
          sequence: { start: '9007199254740993' },
        }
      : { kind: 'autoIncrement', database: kind };
  return {
    ...createEmptyNativeDocument(database),
    tables: [parent, child],
    columns: [column],
    keys: [
      {
        id: 'pk',
        tableId: parent.id,
        scope: 'both',
        kind: 'primary',
        name: 'pk_parent',
        columnIds: [column.id],
      },
    ],
    layout: {
      nodes: [parent, child].map((table, i) => ({
        id: 'node-' + table.id,
        objectId: table.id,
        viewId: '__tables__',
        x: i * 400,
        y: 0,
        width: 320,
        height: 260,
      })),
      viewports: [],
    },
  };
}
const fkInput = {
  primaryTableId: 'parent',
  foreignTableId: 'child',
  primaryKeyId: 'pk',
  relationId: 'fk',
  columnIds: ['child-id'],
};

describe('native editor drafts', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'creates %s profile defaults without activating unverified capabilities',
    (kind) => {
      const database = defaultDatabaseContext(kind);
      const table = createNativeTable(database, 't', null, 'logical');
      const column = createNativeColumn(database, table, 'c');
      expect(column.scope).toBe('logical');
      expect(column.physical.type).toEqual(
        kind === 'mysql'
          ? {
              kind: 'builtin',
              database: kind,
              typeId: 'mysql:varchar',
              parameters: { length: 255 },
            }
          : { kind: 'builtin', database: kind, typeId: `${kind}:text`, parameters: {} },
      );
      expect(column.physical.generation).toEqual({ kind: 'none' });
      const document = {
        ...createEmptyNativeDocument(database),
        tables: [{ ...table, scope: 'physical' as const }],
      };
      const candidate = addNativeColumn(document, { ...column, scope: 'physical' });
      expect(
        validateDatabaseDocument(candidate, database, { mode: 'write', previous: document }).map(
          (issue) => issue.code,
        ),
      ).toContain('type.not-implemented');
      column.customProperties.common.changed = 'source';
      expect(candidate.columns![0]!.customProperties.common).toEqual({});
    },
  );
  it('retains exact defaults/generation/options and immutable identity during partial patches', () => {
    const document = fixture();
    document.columns![0]!.physical.defaultValue = {
      kind: 'literal',
      literalType: 'number',
      value: '9007199254740993',
    };
    const before = structuredClone(document);
    const patch = { physical: { comment: 'reviewed' }, logical: { definition: 'definition' } };
    const candidate = updateNativeColumn(document, 'parent-id', patch);
    expect(candidate.columns![0]!.physical).toEqual({
      ...before.columns![0]!.physical,
      comment: 'reviewed',
    });
    expect(candidate.columns![0]!.logical.required).toBe(true);
    expect(candidate.columns![0]!.id).toBe('parent-id');
    expect(candidate.columns![0]!.tableId).toBe('parent');
    patch.physical.comment = 'mutated later';
    expect(candidate.columns![0]!.physical.comment).toBe('reviewed');
    const changed = updateNativeColumn(document, 'parent-id', {
      physical: {
        type: {
          kind: 'builtin',
          database: 'postgresql',
          typeId: 'postgresql:text',
          parameters: {},
        },
      },
    });
    expect(changed.columns![0]!.physical.generation).toEqual(
      before.columns![0]!.physical.generation,
    );
    expect(changed.columns![0]!.physical.defaultValue).toEqual(
      before.columns![0]!.physical.defaultValue,
    );
    expect(document).toEqual(before);
  });
  it('preserves legacy raw data during description edits, rejects raw replacement/new copies, and allows repair', () => {
    const document = fixture();
    document.columns![0]!.scope = 'logical';
    document.columns![0]!.physical.type = {
      kind: 'legacy',
      source: 'document-v1',
      original: { name: 'CUSTOM', isArray: true },
    };
    document.columns![0]!.physical.defaultValue = {
      kind: 'legacyExpression',
      source: 'document-v1',
      original: ' RAW(42) ',
    };
    const edited = updateNativeColumn(document, 'parent-id', { physical: { comment: 'safe' } });
    expect(edited.columns![0]!.physical.type).toEqual(document.columns![0]!.physical.type);
    expect(edited.columns![0]!.physical.defaultValue).toEqual(
      document.columns![0]!.physical.defaultValue,
    );
    expect(() =>
      updateNativeColumn(document, 'parent-id', {
        physical: {
          defaultValue: { kind: 'legacyExpression', source: 'document-v1', original: 'RAW(42)' },
        },
      }),
    ).toThrow('legacy.source-not-trusted');
    expect(() => addNativeColumn(document, { ...document.columns![0]!, id: 'new' })).toThrow(
      'legacy.source-not-trusted',
    );
    expect(
      updateNativeColumn(document, 'parent-id', {
        physical: {
          type: {
            kind: 'builtin',
            database: 'postgresql',
            typeId: 'postgresql:integer',
            parameters: {},
          },
          defaultValue: { kind: 'none' },
        },
      }).columns![0]!.physical.type.kind,
    ).toBe('builtin');
  });
  it('updates table properties without moving domain/layout or reinterpreting legacy namespace', () => {
    const document = fixture('mysql');
    document.tables![0]!.physical.namespace = {
      kind: 'legacyNamespace',
      source: 'document-v1',
      original: 'OldSchema',
    };
    document.tables![0]!.color = '#123456';
    const before = structuredClone(document);
    const candidate = updateNativeTable(document, 'parent', {
      physical: { comment: 'reviewed' },
      color: undefined,
      canvasDisplay: { showComment: true },
    });
    expect(candidate.tables![0]!.physical.namespace).toEqual(before.tables![0]!.physical.namespace);
    expect(candidate.tables![0]).not.toHaveProperty('color');
    expect(candidate.layout).toEqual(before.layout);
    expect(() =>
      updateNativeTable(document, 'parent', {
        physical: {
          namespace: { kind: 'legacyNamespace', source: 'document-v1', original: 'NewSchema' },
        },
      }),
    ).toThrow('legacy.source-not-trusted');
    expect(document).toEqual(before);
  });
  it('rejects reserved/global IDs, missing owners, incompatible scope/context and v1 documents', () => {
    const document = fixture();
    expect(() => createNativeTable(document.database, '__tables__')).toThrow(
      'document.invalid-identity',
    );
    expect(() => addNativeColumn(document, { ...document.columns![0]!, id: 'pk' })).toThrow(
      'document.duplicate-identities',
    );
    expect(() =>
      addNativeColumn(document, { ...document.columns![0]!, id: 'new', tableId: 'missing' }),
    ).toThrow('document.owner-table-not-found');
    expect(() =>
      createNativeColumn(defaultDatabaseContext('sqlite'), document.tables![0]!, 'new'),
    ).toThrow('database.context-changed');
    expect(() =>
      updateNativeColumn(document, 'parent-id', { physical: { options: { database: 'sqlite' } } }),
    ).toThrow('database.context-changed');
    expect(() =>
      updateNativeTable(document, 'parent', {
        physical: { options: { database: 'sqlite', strict: false, withoutRowid: false } },
      }),
    ).toThrow('database.context-changed');
    document.tables![0]!.scope = 'physical';
    expect(() => updateNativeColumn(document, 'parent-id', { scope: 'both' })).toThrow(
      'document.scope-mismatch',
    );
    expect(() =>
      updateNativeColumn(createEmptyDocument() as unknown as NativeDesignDocument, 'c', {}),
    ).toThrow('document.version-not-supported');
  });
});

describe('native FK from ordered PK', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'copies %s base type but strips generation/default without changing source',
    (kind) => {
      const document = fixture(kind),
        before = structuredClone(document);
      const candidate = createNativeForeignKeyFromPrimaryKey(document, fkInput);
      const child = candidate.columns![1]!;
      expect(child.physical.type).toEqual(before.columns![0]!.physical.type);
      expect(child.physical.generation).toEqual({ kind: 'none' });
      expect(child.physical.defaultValue).toEqual({ kind: 'none' });
      expect(child.logical.required).toBe(false);
      expect(child.physical.nullable).toBe(false);
      expect(candidate.tableRelations![0]!.physical).toMatchObject({
        sourceColumnIds: ['child-id'],
        targetColumnIds: ['parent-id'],
      });
      expect(candidate.tableRelations![0]).toMatchObject({
        sourceTableId: 'child',
        targetTableId: 'parent',
      });
      expect(
        inspectNativeDatabaseDocument(candidate, candidate.database).filter(
          (issue) => issue.severity === 'error',
        ),
      ).toEqual([]);
      expect(document).toEqual(before);
    },
  );
  it('preserves composite order, PG enum/array and exact literals while stripping serial/computed/default', () => {
    const document = fixture();
    const parent = document.tables![0]!;
    document.enums = [{ id: 'enum', name: 'status', schema: 'public', values: ['a', 'b'] }];
    const first = document.columns![0]!;
    first.physical.generation = { kind: 'serial', database: 'postgresql' };
    const second = createNativeColumn(document.database, parent, 'status');
    second.logical.name = '상태';
    second.physical.name = 'status';
    second.physical.type = {
      kind: 'projectEnum',
      database: 'postgresql',
      enumId: 'enum',
      array: { dimensions: 2 },
    };
    second.physical.defaultValue = { kind: 'literal', literalType: 'typedText', value: '{a,b}' };
    second.physical.generation = {
      kind: 'computed',
      database: 'postgresql',
      storage: 'stored',
      expression: { kind: 'literal', literalType: 'typedText', value: '{a,b}' },
    };
    document.columns!.push(second);
    document.keys![0]!.columnIds = ['status', 'parent-id'];
    const candidate = createNativeForeignKeyFromPrimaryKey(document, {
      ...fkInput,
      columnIds: ['new-status', 'new-id'],
    });
    expect(candidate.tableRelations![0]!.physical!.targetColumnIds).toEqual([
      'status',
      'parent-id',
    ]);
    expect(candidate.columns!.slice(2).map((item) => item.physical.type)).toEqual([
      second.physical.type,
      first.physical.type,
    ]);
    expect(
      candidate
        .columns!.slice(2)
        .every(
          (item) =>
            item.physical.defaultValue.kind === 'none' && item.physical.generation.kind === 'none',
        ),
    ).toBe(true);
    expect(document.columns![1]!.physical.defaultValue).toEqual({
      kind: 'literal',
      literalType: 'typedText',
      value: '{a,b}',
    });
  });
  it('materializes inherited MySQL charset/collation and removes ON UPDATE', () => {
    const document = fixture('mysql');
    document.tables![0]!.physical.options = {
      database: 'mysql',
      engine: 'InnoDB',
      charset: 'utf8mb4',
      collation: 'utf8mb4_0900_ai_ci',
    };
    document.tables![1]!.physical.options = {
      database: 'mysql',
      engine: 'InnoDB',
      charset: 'latin1',
      collation: 'latin1_swedish_ci',
    };
    const source = document.columns![0]!;
    source.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: 64 },
    };
    source.physical.generation = { kind: 'none' };
    const candidate = createNativeForeignKeyFromPrimaryKey(document, fkInput);
    expect(candidate.columns![1]!.physical.options).toEqual({
      database: 'mysql',
      charset: 'utf8mb4',
      collation: 'utf8mb4_0900_ai_ci',
    });
    expect(
      inspectNativeDatabaseDocument(candidate, candidate.database).filter(
        (issue) => issue.code === 'foreign-key.type-mismatch',
      ),
    ).toEqual([]);
    source.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:timestamp',
      parameters: {},
    };
    source.physical.options = {
      database: 'mysql',
      onUpdate: { kind: 'call', functionId: 'mysql:current_timestamp', args: [] },
    };
    expect(
      createNativeForeignKeyFromPrimaryKey(document, fkInput).columns![1]!.physical.options,
    ).toEqual({ database: 'mysql' });
    expect(source.physical.options).toHaveProperty('onUpdate');
  });
  it('uses collision-free bounded Unicode identifiers', () => {
    const document = fixture();
    document.columns![0]!.physical.name = '한'.repeat(21);
    const existing = createNativeColumn(document.database, document.tables![1]!, 'existing');
    existing.physical.name = '한'.repeat(21);
    document.columns!.push(existing);
    document.tables![0]!.physical.name = '부'.repeat(21);
    document.tables![1]!.physical.name = '자'.repeat(21);
    const candidate = createNativeForeignKeyFromPrimaryKey(document, fkInput);
    const name = candidate.columns![2]!.physical.name;
    expect(name).toMatch(/_2$/);
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(63);
    expect(
      new TextEncoder().encode(candidate.tableRelations![0]!.physical!.name).length,
    ).toBeLessThanOrEqual(63);
    expect(name).not.toContain('\uFFFD');
  });
  it('rejects unresolved legacy/enum, deferrable PK, wrong IDs and MySQL virtual generated parents atomically', () => {
    const document = fixture(),
      before = structuredClone(document);
    expect(() =>
      createNativeForeignKeyFromPrimaryKey(document, { ...fkInput, columnIds: ['pk'] }),
    ).toThrow('document.duplicate-identities');
    expect(() =>
      createNativeForeignKeyFromPrimaryKey(document, { ...fkInput, relationId: 'child-id' }),
    ).toThrow('document.duplicate-identities');
    expect(document).toEqual(before);
    document.keys![0]!.deferrable = { initially: 'immediate' };
    expect(() => createNativeForeignKeyFromPrimaryKey(document, fkInput)).toThrow(
      'foreign-key.referenced-key-required',
    );
    delete document.keys![0]!.deferrable;
    document.columns![0]!.physical.type = {
      kind: 'legacy',
      source: 'document-v1',
      original: { name: 'unknown', isArray: false },
    };
    expect(() => createNativeForeignKeyFromPrimaryKey(document, fkInput)).toThrow(
      'legacy.source-not-trusted',
    );
    document.columns![0]!.physical.type = {
      kind: 'projectEnum',
      database: 'postgresql',
      enumId: 'missing',
    };
    expect(() => createNativeForeignKeyFromPrimaryKey(document, fkInput)).toThrow(
      'column.enum-not-found',
    );
    const mysql = fixture('mysql');
    mysql.columns![0]!.physical.generation = {
      kind: 'computed',
      database: 'mysql',
      storage: 'virtual',
      expression: { kind: 'literal', literalType: 'number', value: '1' },
    };
    expect(() => createNativeForeignKeyFromPrimaryKey(mysql, fkInput)).toThrow();
  });
  it('blocks an unknown inherited collation rather than using the child table collation', () => {
    const document = fixture('mysql');
    document.tables![1]!.physical.options = {
      database: 'mysql',
      engine: 'InnoDB',
      collation: 'utf8mb4_bin',
    };
    document.columns![0]!.physical.generation = { kind: 'none' };
    document.columns![0]!.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: 10 },
    };
    expect(() => createNativeForeignKeyFromPrimaryKey(document, fkInput)).toThrow(
      'foreign-key.collation-unresolved',
    );
  });
});
