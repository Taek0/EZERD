import { describe, expect, it } from 'vitest';
import { defaultDatabaseContext } from './profiles.js';
import {
  createEmptyNativeDocument,
  type NativeColumn,
  type NativeColumnType,
  type NativeDesignDocument,
  type NativeTable,
} from './native-document.js';
import {
  inspectNativeDatabaseDocument,
  inspectNativeLegacyChanges,
  validateDatabaseDocument,
} from './validation.js';
import type { DatabaseKind } from './definitions.js';

const metadata = { common: {}, logical: {}, physical: {} };
const pg = defaultDatabaseContext('postgresql');
function table(kind: DatabaseKind, id = 't'): NativeTable {
  return {
    id,
    domainId: null,
    scope: 'physical',
    logical: { name: '', definition: '' },
    customProperties: metadata,
    physical: {
      name: id,
      comment: '',
      namespace:
        kind === 'postgresql'
          ? { kind: 'postgresSchema', name: 'public' }
          : kind === 'mysql'
            ? { kind: 'mysqlCurrentDatabase' }
            : { kind: 'sqliteMain' },
      options:
        kind === 'postgresql'
          ? { database: 'postgresql' }
          : kind === 'mysql'
            ? { database: 'mysql', engine: 'InnoDB' }
            : { database: 'sqlite', strict: false, withoutRowid: false },
    },
  };
}
function column(kind: DatabaseKind, id = 'c', tableId = 't'): NativeColumn {
  const type: NativeColumnType =
    kind === 'postgresql'
      ? { kind: 'builtin', database: kind, typeId: 'postgresql:integer', parameters: {} }
      : kind === 'mysql'
        ? { kind: 'builtin', database: kind, typeId: 'mysql:int', parameters: {} }
        : { kind: 'builtin', database: kind, typeId: 'sqlite:integer', parameters: {} };
  return {
    id,
    tableId,
    scope: 'physical',
    logical: { name: '', definition: '', semanticType: '', required: false },
    customProperties: metadata,
    physical: {
      name: id,
      type,
      nullable: false,
      comment: '',
      generation: { kind: 'none' },
      defaultValue: { kind: 'none' },
      options: { database: kind },
    },
  };
}
function fixture(kind: DatabaseKind = 'postgresql'): NativeDesignDocument {
  return {
    ...createEmptyNativeDocument(defaultDatabaseContext(kind)),
    tables: [table(kind)],
    columns: [column(kind)],
    keys: [
      { id: 'pk', tableId: 't', name: '', scope: 'physical', kind: 'primary', columnIds: ['c'] },
    ],
  };
}
const codes = (doc: NativeDesignDocument) =>
  inspectNativeDatabaseDocument(doc, doc.database)
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.code);
function withRelation(kind: DatabaseKind): NativeDesignDocument {
  const doc = fixture(kind);
  doc.tables!.push(table(kind, 'parent'));
  doc.columns!.push(column(kind, 'parent-id', 'parent'));
  doc.keys!.push({
    id: 'parent-pk',
    tableId: 'parent',
    scope: 'physical',
    kind: 'primary',
    name: '',
    columnIds: ['parent-id'],
  });
  doc.tableRelations = [
    {
      id: 'fk',
      sourceTableId: 't',
      targetTableId: 'parent',
      scope: 'physical',
      logical: { name: '', cardinality: 'one-to-many', required: false },
      physical: {
        name: '',
        sourceColumnIds: ['c'],
        targetColumnIds: ['parent-id'],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
    },
  ];
  return doc;
}

describe('native DB policy is separate from draft and activation rules', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'validates a native %s design without cross-DB inference',
    (kind) => {
      expect(codes(fixture(kind))).toEqual([]);
      const doc = withRelation(kind);
      expect(codes(doc)).toEqual([]);
      expect(
        validateDatabaseDocument(doc, doc.database, { mode: 'export' }).some(
          (issue) =>
            issue.code === 'feature.not-implemented' && issue.params.feature === 'foreignKey',
        ),
      ).toBe(true);
    },
  );
  it('never treats stale project context as a repairable old error', () => {
    const doc = fixture('mysql');
    expect(validateDatabaseDocument(doc, pg, { mode: 'write', previous: doc })).toMatchObject([
      { code: 'database.context-changed' },
    ]);
    expect(
      inspectNativeDatabaseDocument(doc, { ...doc.database, profileId: pg.profileId }),
    ).toMatchObject([{ code: 'database.profile-unsupported' }]);
  });
  it('keeps incomplete designs distinct from invalid native options', () => {
    const doc = fixture();
    doc.tables![0]!.physical.name = '';
    doc.columns = [];
    doc.keys = [];
    expect(
      inspectNativeDatabaseDocument(doc, pg).every((issue) => issue.category === 'incomplete'),
    ).toBe(true);
    expect(
      validateDatabaseDocument(doc, pg, { mode: 'write' }).every(
        (issue) => issue.category !== 'incomplete',
      ),
    ).toBe(true);
    const before = fixture('sqlite');
    before.columns![0]!.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:integer',
      parameters: {},
      array: { dimensions: 1 },
    };
    expect(codes(before)).toContain('type.not-supported');
  });
  it('respects SQLite STRICT, exact INTEGER automatic generation and WITHOUT ROWID', () => {
    const doc = fixture('sqlite');
    doc.tables![0]!.physical.options = { database: 'sqlite', strict: true, withoutRowid: false };
    doc.columns![0]!.physical.type = {
      kind: 'builtin',
      database: 'sqlite',
      typeId: 'sqlite:varchar',
      parameters: {},
    };
    expect(codes(doc)).toContain('type.strict-not-supported');
    doc.columns![0]!.physical.type = {
      kind: 'builtin',
      database: 'sqlite',
      typeId: 'sqlite:int',
      parameters: {},
    };
    doc.columns![0]!.physical.generation = { kind: 'autoIncrement', database: 'sqlite' };
    expect(codes(doc)).toContain('generation.key-required');
    doc.columns![0]!.physical.type = {
      kind: 'builtin',
      database: 'sqlite',
      typeId: 'sqlite:integer',
      parameters: {},
    };
    expect(codes(doc)).toEqual([]);
    doc.tables![0]!.physical.options = { database: 'sqlite', strict: true, withoutRowid: true };
    expect(codes(doc)).toContain('generation.key-required');
  });
  it('checks actual owner, columns, namespace and identifier limits', () => {
    const doc = fixture();
    doc.columns![0]!.tableId = 'missing';
    expect(codes(doc)).toContain('column.table-not-found');
    doc.columns![0]!.tableId = 't';
    doc.columns![0]!.physical.name = '한'.repeat(22);
    expect(codes(doc)).toContain('identifier.invalid');
    doc.tables![0]!.physical.namespace = { kind: 'sqliteMain' };
    expect(codes(doc)).toContain('namespace.not-supported');
    doc.columns![0]!.scope = 'both';
    expect(codes(doc)).toContain('column.scope-mismatch');
  });
});

describe('legacy repair cannot introduce or disguise bad state', () => {
  function legacy(): NativeDesignDocument {
    const doc = fixture();
    doc.columns![0]!.physical.type = {
      kind: 'legacy',
      source: 'document-v1',
      original: { name: 'unknown', isArray: false },
    };
    doc.columns![0]!.physical.defaultValue = {
      kind: 'legacyExpression',
      source: 'document-v1',
      original: 'old()',
    };
    return doc;
  }
  it('allows description/layout repairs without exposing private cause fingerprints', () => {
    const before = legacy();
    const after = structuredClone(before);
    after.columns![0]!.physical.comment = 'changed';
    after.tables![0]!.physical.name = 'renamed';
    expect(validateDatabaseDocument(after, pg, { mode: 'write', previous: before })).toEqual([]);
    expect(inspectNativeDatabaseDocument(before, pg).every((issue) => !('cause' in issue))).toBe(
      true,
    );
  });
  it('rejects copies and edits of unresolved source data even with the same error count', () => {
    const before = legacy();
    const after = structuredClone(before);
    after.columns!.push({
      ...structuredClone(before.columns![0]!),
      id: 'copy',
      physical: { ...structuredClone(before.columns![0]!.physical), name: 'copy' },
    });
    expect(
      validateDatabaseDocument(after, pg, { mode: 'write', previous: before }).some(
        (issue) => issue.code === 'legacy.type-unresolved' && issue.objectId === 'copy',
      ),
    ).toBe(true);
    const changed = structuredClone(before);
    changed.columns![0]!.physical.type = {
      kind: 'legacy',
      source: 'document-v1',
      original: { name: 'another-unknown', isArray: false },
    };
    expect(
      validateDatabaseDocument(changed, pg, { mode: 'write', previous: before }).some(
        (issue) => issue.code === 'legacy.type-unresolved',
      ),
    ).toBe(true);
  });
  it('does not use the error count to waive new invalid ENUM values', () => {
    const before = fixture();
    before.enums = [{ id: 'e', schema: 'public', name: 'state', values: ['a', 'a'] }];
    const after = structuredClone(before);
    after.enums![0]!.values = ['b', 'b'];
    expect(
      validateDatabaseDocument(after, pg, { mode: 'write', previous: before }).some(
        (issue) => issue.code === 'enum.values-invalid',
      ),
    ).toBe(true);
  });
  it.each(['type', 'defaultValue', 'namespace'] as const)(
    'protects logical-only legacy %s values even when engine diagnostics skip them',
    (field) => {
      const before = legacy();
      before.tables![0]!.scope = 'logical';
      before.columns![0]!.scope = 'logical';
      before.keys = [];
      before.tables![0]!.physical.namespace = {
        kind: 'legacyNamespace',
        source: 'document-v1',
        original: 'old-schema',
      };
      const retained = structuredClone(before);
      retained.tables![0]!.logical.definition = 'changed';
      retained.columns![0]!.logical.definition = 'changed';
      expect(validateDatabaseDocument(retained, pg, { mode: 'write', previous: before })).toEqual(
        [],
      );
      const changed = structuredClone(retained);
      if (field === 'namespace')
        changed.tables![0]!.physical.namespace = {
          kind: 'legacyNamespace',
          source: 'document-v1',
          original: 'forged-schema',
        };
      else if (field === 'type')
        changed.columns![0]!.physical.type = {
          kind: 'legacy',
          source: 'document-v1',
          original: { name: 'forged-type', isArray: false },
        };
      else
        changed.columns![0]!.physical.defaultValue = {
          kind: 'legacyExpression',
          source: 'document-v1',
          original: 'forged()',
        };
      expect(
        validateDatabaseDocument(changed, pg, { mode: 'write', previous: before }),
      ).toMatchObject([
        { code: 'legacy.source-not-trusted', path: expect.stringContaining(field) },
      ]);
      expect(inspectNativeLegacyChanges(retained)).toHaveLength(3);
      const copied = structuredClone(retained);
      copied.tables!.push({ ...structuredClone(retained.tables![0]!), id: 'copy-table' });
      copied.columns!.push({
        ...structuredClone(retained.columns![0]!),
        id: 'copy-column',
        tableId: 'copy-table',
      });
      expect(
        validateDatabaseDocument(copied, pg, { mode: 'write', previous: before }).filter(
          (issue) => issue.code === 'legacy.source-not-trusted',
        ),
      ).toHaveLength(3);
    },
  );
  it('requires the same column owner and DB context rather than only a matching ID and raw value', () => {
    const before = legacy();
    before.tables!.push(table('postgresql', 'other-table'));
    const moved = structuredClone(before);
    moved.columns![0]!.tableId = 'other-table';
    expect(inspectNativeLegacyChanges(moved, before)).toHaveLength(2);
    const otherContext = structuredClone(before);
    otherContext.database = defaultDatabaseContext('mysql');
    expect(inspectNativeLegacyChanges(before, otherContext)).toHaveLength(2);
    // Deleting or correcting a legacy branch requires no retained source permission.
    const corrected = structuredClone(before);
    corrected.columns![0]!.physical.type = column('postgresql').physical.type;
    corrected.columns![0]!.physical.defaultValue = { kind: 'none' };
    expect(inspectNativeLegacyChanges(corrected, before)).toEqual([]);
    corrected.columns = [];
    expect(inspectNativeLegacyChanges(corrected, before)).toEqual([]);
  });
});

describe('generation, defaults and FK conditions use the full candidate', () => {
  it('rejects decimal overflow after rounding and a UUID default on an integer', () => {
    const doc = fixture();
    doc.columns![0]!.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:numeric',
      parameters: { precision: 3, scale: 2 },
    };
    doc.columns![0]!.physical.defaultValue = {
      kind: 'literal',
      literalType: 'number',
      value: '9.995',
    };
    expect(codes(doc)).toContain('default.number-out-of-range');
    doc.columns![0]!.physical.defaultValue = {
      kind: 'literal',
      literalType: 'number',
      value: '9.994',
    };
    expect(codes(doc)).toEqual([]);
    doc.columns![0]!.physical.defaultValue = {
      kind: 'expression',
      expression: { kind: 'call', functionId: 'postgresql:gen_random_uuid', args: [] },
    };
    expect(codes(doc)).toContain('default.type-mismatch');
  });
  it('validates ON UPDATE context and empty FK drafts without waiving dangling references', () => {
    const doc = withRelation('mysql');
    doc.tableRelations![0]!.physical!.sourceColumnIds = [];
    expect(codes(doc)).toEqual(['ddl.incomplete-foreign-key']);
    doc.tableRelations![0]!.physical!.targetColumnIds = ['unknown'];
    expect(codes(doc)).toContain('foreign-key.columns-invalid');
    doc.columns![0]!.physical.options = {
      database: 'mysql',
      onUpdate: { kind: 'call', functionId: 'postgresql:current_timestamp', args: [] },
    };
    expect(codes(doc)).toContain('column.on-update-not-supported');
    expect(codes(doc)).toContain('expression.function-not-supported');
  });
  it('checks integer overflow and NULL default against effective PK constraints', () => {
    const doc = fixture();
    doc.columns![0]!.physical.defaultValue = {
      kind: 'literal',
      literalType: 'number',
      value: '2147483648',
    };
    expect(codes(doc)).toContain('default.number-out-of-range');
    doc.columns![0]!.physical.defaultValue = { kind: 'null' };
    doc.columns![0]!.physical.nullable = true;
    expect(codes(doc)).toContain('default.null-not-supported');
  });
  it('preserves native MySQL BOOLEAN alias defaults and PG ENUM array capability', () => {
    const doc = fixture('mysql');
    doc.columns![0]!.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:tinyint',
      parameters: {},
      declarationAlias: 'boolean',
    };
    doc.columns![0]!.physical.defaultValue = {
      kind: 'literal',
      literalType: 'boolean',
      value: true,
    };
    expect(codes(doc)).toEqual([]);
    const enumDoc = fixture();
    enumDoc.enums = [{ id: 'e', name: 'state', schema: 'public', values: ['ok'] }];
    enumDoc.columns![0]!.physical.type = {
      kind: 'projectEnum',
      database: 'postgresql',
      enumId: 'e',
      array: { dimensions: 1 },
    };
    expect(codes(enumDoc)).toEqual([]);
    expect(
      validateDatabaseDocument(enumDoc, pg, { mode: 'export' }).some(
        (issue) => issue.params.feature === 'array',
      ),
    ).toBe(true);
  });
  it('checks MySQL generation index/count/default and integer signedness', () => {
    const doc = fixture('mysql');
    doc.columns![0]!.physical.generation = { kind: 'autoIncrement', database: 'mysql' };
    expect(codes(doc)).toEqual([]);
    doc.keys = [];
    expect(codes(doc)).toContain('generation.key-required');
    doc.columns![0]!.physical.defaultValue = { kind: 'literal', literalType: 'number', value: '1' };
    expect(codes(doc)).toContain('generation.default-not-supported');
    const relation = withRelation('mysql');
    relation.columns![0]!.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:int',
      parameters: { unsigned: false },
    };
    expect(codes(relation)).toEqual([]);
    relation.columns![1]!.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:int',
      parameters: { unsigned: true },
    };
    expect(codes(relation)).toContain('foreign-key.type-mismatch');
  });
  it('rejects SET DEFAULT in MySQL and SET NULL on non-null source columns', () => {
    const doc = withRelation('mysql');
    doc.tableRelations![0]!.physical!.onDelete = 'SET DEFAULT';
    expect(codes(doc)).toContain('foreign-key.action-not-supported');
    doc.tableRelations![0]!.physical!.onDelete = 'SET NULL';
    expect(codes(doc)).toContain('foreign-key.nullability-mismatch');
  });
  it('validates inherited MySQL table collation in FK compatibility', () => {
    const doc = withRelation('mysql');
    for (const col of doc.columns!)
      col.physical.type = {
        kind: 'builtin',
        database: 'mysql',
        typeId: 'mysql:varchar',
        parameters: { length: 20 },
      };
    doc.tables![0]!.physical.options = {
      database: 'mysql',
      engine: 'InnoDB',
      collation: 'utf8mb4_bin',
    };
    expect(codes(doc)).toContain('foreign-key.type-mismatch');
    doc.tables![1]!.physical.options = {
      database: 'mysql',
      engine: 'InnoDB',
      collation: 'utf8mb4_bin',
    };
    expect(codes(doc)).toEqual([]);
  });
  it('uses effective MySQL charset for defaults and checks composite index bytes', () => {
    const doc = fixture('mysql');
    doc.keys = [];
    const value = doc.columns![0]!;
    value.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: 1 },
    };
    value.physical.options = { database: 'mysql', collation: 'ascii_bin' };
    value.physical.defaultValue = { kind: 'literal', literalType: 'string', value: 'é' };
    expect(codes(doc)).toContain('default.charset-value-invalid');
    value.physical.defaultValue = { kind: 'none' };
    value.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: 500 },
    };
    value.physical.options = { database: 'mysql' };
    const second = structuredClone(value);
    second.id = 'second';
    second.physical.name = 'second';
    doc.columns!.push(second);
    doc.indexes = [
      {
        id: 'index',
        tableId: value.tableId,
        scope: 'physical',
        name: 'composite',
        unique: false,
        options: { database: 'mysql', kind: 'btree' },
        parts: [value, second].map((column) => ({
          expression: { kind: 'column', columnId: column.id },
          direction: 'asc',
        })),
      },
    ];
    expect(codes(doc)).toContain('index.length-exceeded');
    doc.indexes[0]!.parts.forEach((part) => {
      part.prefixLength = 100;
    });
    expect(codes(doc)).not.toContain('index.length-exceeded');
    doc.indexes[0]!.options = { database: 'mysql', kind: 'fulltext' };
    doc.indexes[0]!.parts.forEach((part) => {
      delete part.prefixLength;
    });
    second.physical.options = { database: 'mysql', charset: 'latin1' };
    expect(codes(doc)).toContain('index.fulltext-character-context-mismatch');
  });
  it('validates structured functions, owner references and generated cycles', () => {
    const doc = fixture('sqlite');
    doc.columns!.push(column('sqlite', 'other'));
    for (const [i, other] of [1, 0].entries())
      doc.columns![i]!.physical.generation = {
        kind: 'computed',
        database: 'sqlite',
        storage: 'virtual',
        expression: { kind: 'column', columnId: doc.columns![other]!.id },
      };
    expect(codes(doc)).toContain('generation.cycle');
    doc.columns![0]!.physical.defaultValue = {
      kind: 'expression',
      expression: { kind: 'column', columnId: 'other' },
    };
    expect(codes(doc)).toContain('default.column-reference-not-supported');
    doc.checks = [
      {
        id: 'check',
        tableId: 't',
        scope: 'physical',
        name: '',
        expression: { kind: 'call', functionId: 'postgresql:current_timestamp', args: [] },
      },
    ];
    expect(codes(doc)).toContain('expression.function-not-supported');
    expect(codes(doc)).toContain('expression.non-deterministic');
  });
});
