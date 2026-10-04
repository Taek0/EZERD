import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  defaultDatabaseContext,
  migrateDesignDocumentV1,
  validateDatabaseDocument,
  type DatabaseKind,
} from '@ezerd/model';
import {
  importJsonSha256,
  nativeImportLegacyProvenance,
  validateNativeImportWithProvenance,
} from '../src/shared/native-import-provenance.js';

function fixture(kind: DatabaseKind = 'postgresql') {
  const old = createEmptyDocument();
  old.tables = [
    {
      id: 't',
      domainId: null,
      scope: 'both',
      logical: { name: 'Table', definition: '' },
      physical: { name: 't', schema: 'public', comment: ' raw ' },
      customProperties: { common: {}, logical: {}, physical: {} },
    },
  ];
  old.columns = [
    {
      id: 'c',
      tableId: 't',
      scope: 'both',
      logical: { name: 'Column', definition: '', semanticType: '', required: false },
      physical: {
        name: 'c',
        type: { name: ' ENUM RAW ', enumId: 'e', length: 16, isArray: false },
        nullable: true,
        defaultExpression: " unknown(' raw ') ",
        comment: '',
      },
      customProperties: { common: {}, logical: {}, physical: {} },
    },
  ];
  old.enums = [{ id: 'e', name: 'Status', schema: 'public', values: [' a ', 'β\\token'] }];
  return migrateDesignDocumentV1(old, defaultDatabaseContext(kind)).document;
}

describe('server-derived native import legacy cause mask', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    '%s reproduces only legacy branches and their v1 base causes without mutating input',
    (kind) => {
      const document = fixture(kind),
        context = defaultDatabaseContext(kind),
        before = structuredClone(document);
      const proof = nativeImportLegacyProvenance(document, context);
      expect(proof.problems).toEqual([]);
      expect(proof.fieldPaths.has('/columns/c/physical/type')).toBe(true);
      expect(proof.fieldPaths.has('/columns/c/physical/defaultValue')).toBe(true);
      expect(proof.mask.keys ?? []).toEqual([]);
      expect(proof.mask.tableRelations ?? []).toEqual([]);
      expect(proof.mask.indexes ?? []).toEqual([]);
      expect(proof.mask.checks ?? []).toEqual([]);
      expect(
        validateNativeImportWithProvenance(document, context, proof).filter(
          (issue) => issue.severity === 'error',
        ),
      ).toEqual([]);
      expect(document).toEqual(before);
    },
  );
  it('does not accept a known PostgreSQL native type merely relabeled as a legacy origin', () => {
    const document = fixture(),
      context = defaultDatabaseContext('postgresql');
    document.columns![0]!.physical.type = {
      kind: 'legacy',
      source: 'document-v1',
      original: { name: 'integer', isArray: false },
    };
    const proof = nativeImportLegacyProvenance(document, context);
    expect(proof.problems.some((issue) => issue.code === 'legacy.source-not-trusted')).toBe(true);
    expect(
      validateNativeImportWithProvenance(document, context, proof).some(
        (issue) => issue.code === 'legacy.source-not-trusted',
      ),
    ).toBe(true);
  });
  it('keeps native readiness failures for a typed column even when its default has a legacy tag', () => {
    const document = fixture(),
      context = defaultDatabaseContext('postgresql');
    document.columns![0]!.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:txid_snapshot',
      parameters: {},
    };
    const proof = nativeImportLegacyProvenance(document, context);
    expect(
      validateNativeImportWithProvenance(document, context, proof).some(
        (issue) => issue.code === 'type.not-implemented',
      ),
    ).toBe(true);
  });
  it('resurrects new comment and duplicate name failures even if the mask copied their v1 scalar fields', () => {
    const document = fixture(),
      context = defaultDatabaseContext('postgresql');
    document.tables![0]!.physical.comment = 'bad\0comment';
    document.columns!.push({ ...structuredClone(document.columns![0]!), id: 'other' });
    const proof = nativeImportLegacyProvenance(document, context);
    const issues = validateNativeImportWithProvenance(document, context, proof);
    expect(issues.some((issue) => issue.code === 'comment.invalid')).toBe(true);
    expect(issues.some((issue) => issue.code === 'column.duplicate-name')).toBe(true);
  });
  it('preserves fresh engine-invalid index/check/key/generation failures beside proven legacy fields', () => {
    const document = fixture(),
      context = defaultDatabaseContext('postgresql');
    document.indexes = [
      {
        id: 'i',
        tableId: 't',
        name: 'idx',
        scope: 'both',
        unique: true,
        parts: [{ expression: { kind: 'column', columnId: 'c' }, direction: 'asc' }],
        options: { database: 'postgresql', method: 'hash' },
      },
    ];
    document.checks = [
      {
        id: 'ch',
        tableId: 't',
        name: 'check',
        scope: 'both',
        expression: { kind: 'literal', literalType: 'number', value: '1' },
      },
    ];
    document.keys = [
      { id: 'k', tableId: 't', name: 'key', scope: 'both', kind: 'unique', columnIds: ['c', 'c'] },
    ];
    document.columns![0]!.physical.generation = {
      kind: 'computed',
      database: 'postgresql',
      storage: 'stored',
      expression: { kind: 'literal', literalType: 'number', value: '1' },
    };
    const proof = nativeImportLegacyProvenance(document, context),
      fresh = validateDatabaseDocument(document, context, { mode: 'write' });
    expect(proof.problems).toEqual([]);
    expect(proof.mask.indexes ?? []).toEqual([]);
    expect(proof.mask.checks ?? []).toEqual([]);
    expect(proof.mask.keys ?? []).toEqual([]);
    expect(proof.mask.columns![0]!.physical.generation).toEqual({ kind: 'none' });
    const checked = validateNativeImportWithProvenance(document, context, proof);
    const nativeFailures = fresh.filter(
      (issue) =>
        ['i', 'ch', 'k'].includes(issue.objectId ?? '') ||
        issue.code === 'generation.default-not-supported' ||
        issue.path.includes('/generation'),
    );
    expect(nativeFailures.length).toBeGreaterThan(0);
    for (const issue of nativeFailures) expect(checked).toContainEqual(issue);
    expect(checked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ objectId: 'i', code: 'index.unique-method-not-supported' }),
        expect.objectContaining({ objectId: 'k', code: 'key.columns-invalid' }),
        expect.objectContaining({ objectId: 'ch', code: 'expression.boolean-required' }),
        expect.objectContaining({ objectId: 'c', code: 'generation.default-not-supported' }),
      ]),
    );
    expect(
      checked.some((issue) => issue.code === 'legacy.source-not-trusted'),
      JSON.stringify(checked),
    ).toBe(false);
  });
  it('accepts verified native graph additions alongside exact legacy provenance without trusting them as previous', () => {
    const document = fixture(),
      context = defaultDatabaseContext('postgresql'),
      legacy = structuredClone(document.columns![0]!);
    const native = structuredClone(legacy);
    native.id = 'n';
    native.physical.name = 'n';
    native.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:integer',
      parameters: {},
    };
    native.physical.defaultValue = { kind: 'none' };
    const generated = structuredClone(native);
    generated.id = 'g';
    generated.physical.name = 'g';
    generated.physical.generation = {
      kind: 'computed',
      database: 'postgresql',
      storage: 'stored',
      expression: {
        kind: 'binary',
        operator: '+',
        left: { kind: 'column', columnId: 'n' },
        right: { kind: 'literal', literalType: 'number', value: '1' },
      },
    };
    document.columns!.push(native, generated);
    document.keys = [
      { id: 'k', tableId: 't', name: 'key', scope: 'physical', kind: 'unique', columnIds: ['n'] },
    ];
    document.indexes = [
      {
        id: 'i',
        tableId: 't',
        name: 'idx',
        scope: 'physical',
        unique: false,
        parts: [{ expression: { kind: 'column', columnId: 'n' }, direction: 'asc' }],
        options: { database: 'postgresql', method: 'btree' },
      },
    ];
    document.checks = [
      {
        id: 'ch',
        tableId: 't',
        name: 'check',
        scope: 'physical',
        expression: { kind: 'literal', literalType: 'boolean', value: true },
      },
    ];
    const before = structuredClone(document),
      proof = nativeImportLegacyProvenance(document, context);
    expect(proof.problems).toEqual([]);
    expect(proof.mask.keys ?? []).toEqual([]);
    expect(proof.mask.indexes ?? []).toEqual([]);
    expect(proof.mask.checks ?? []).toEqual([]);
    expect(proof.mask.columns!.map((column) => column.id)).toEqual(['c']);
    expect(
      validateNativeImportWithProvenance(document, context, proof).filter(
        (issue) => issue.severity === 'error',
      ),
    ).toEqual([]);
    expect(document).toEqual(before);
    expect(document.columns![0]).toEqual(legacy);
  });
  it('rejects changed legacy references and context rather than trusting old proof paths', () => {
    const document = fixture(),
      context = defaultDatabaseContext('postgresql'),
      proof = nativeImportLegacyProvenance(document, context);
    if (document.columns![0]!.physical.type.kind !== 'legacy') throw new Error('fixture');
    document.columns![0]!.physical.type.original.enumId = 'absent';
    const changed = validateNativeImportWithProvenance(document, context, proof);
    expect(changed.some((issue) => issue.code === 'document.enum-not-found')).toBe(true);
    expect(changed.some((issue) => issue.code === 'legacy.source-not-trusted')).toBe(true);
    document.database = defaultDatabaseContext('mysql');
    expect(
      validateNativeImportWithProvenance(document, context, proof).some(
        (issue) => issue.code === 'database.context-changed',
      ),
    ).toBe(true);
  });
  it('requires a real legacy namespace derivation and never masks a native table mode', () => {
    const pg = fixture(),
      pgContext = defaultDatabaseContext('postgresql');
    pg.tables![0]!.physical.namespace = {
      kind: 'legacyNamespace',
      source: 'document-v1',
      original: 'public',
    };
    expect(
      nativeImportLegacyProvenance(pg, pgContext).problems.some(
        (issue) => issue.code === 'legacy.source-not-trusted',
      ),
    ).toBe(true);
    const sqlite = fixture('sqlite'),
      context = defaultDatabaseContext('sqlite');
    sqlite.tables![0]!.physical.options = { database: 'sqlite', strict: true, withoutRowid: true };
    const checked = validateNativeImportWithProvenance(
      sqlite,
      context,
      nativeImportLegacyProvenance(sqlite, context),
    );
    expect(checked).toContainEqual(
      expect.objectContaining({
        code: 'table.primary-key-required',
        objectId: 't',
        path: '/tables/t/physical/options/withoutRowid',
      }),
    );
    expect(
      checked.some(
        (issue) =>
          issue.code === 'type.strict-not-supported' || issue.code === 'legacy.type-unresolved',
      ),
    ).toBe(true);
    const fresh = validateDatabaseDocument(sqlite, context, { mode: 'write' });
    for (const issue of fresh.filter((issue) => issue.code === 'table.primary-key-required'))
      expect(checked).toContainEqual(issue);
    // A valid WITHOUT ROWID table can retain proven legacy types outside STRICT mode.
    sqlite.tables![0]!.physical.options = { database: 'sqlite', strict: false, withoutRowid: true };
    const keyColumn = structuredClone(sqlite.columns![0]!);
    keyColumn.id = 'pk-column';
    keyColumn.physical.name = 'pk_column';
    keyColumn.physical.type = {
      kind: 'builtin',
      database: 'sqlite',
      typeId: 'sqlite:integer',
      parameters: {},
    };
    keyColumn.physical.nullable = false;
    keyColumn.physical.defaultValue = { kind: 'none' };
    sqlite.columns!.push(keyColumn);
    sqlite.keys = [
      {
        id: 'pk',
        tableId: 't',
        name: 'pk',
        scope: 'physical',
        kind: 'primary',
        columnIds: ['pk-column'],
      },
    ];
    const proof = nativeImportLegacyProvenance(sqlite, context);
    expect(proof.problems).toEqual([]);
    expect(proof.mask.tables![0]!.physical.options).toEqual({
      database: 'sqlite',
      strict: false,
      withoutRowid: false,
    });
    expect(proof.mask.keys ?? []).toEqual([]);
    expect(
      validateNativeImportWithProvenance(sqlite, context, proof).filter(
        (issue) => issue.severity === 'error',
      ),
    ).toEqual([]);
  });
  it.each(['column-options', 'table-options', 'generation'] as const)(
    'does not suppress legacy byte uncertainty after new native %s',
    (change) => {
      const document = fixture('mysql'),
        context = defaultDatabaseContext('mysql');
      if (change === 'column-options')
        document.columns![0]!.physical.options = { database: 'mysql', charset: 'ascii' };
      if (change === 'table-options')
        document.tables![0]!.physical.options = {
          database: 'mysql',
          engine: 'InnoDB',
          charset: 'ascii',
        };
      if (change === 'generation')
        document.columns![0]!.physical.generation = { kind: 'autoIncrement', database: 'mysql' };
      const checked = validateNativeImportWithProvenance(
        document,
        context,
        nativeImportLegacyProvenance(document, context),
      );
      expect(checked.some((issue) => issue.code === 'mysql.column-byte-budget-unverified')).toBe(
        true,
      );
    },
  );
  it('keeps whole-table column budget failures even when every individual legacy byte cause is proven', () => {
    const document = fixture('mysql'),
      context = defaultDatabaseContext('mysql'),
      column = document.columns![0]!;
    document.columns = Array.from({ length: 1018 }, (_, i) => ({
      ...structuredClone(column),
      id: `c${i}`,
      physical: { ...structuredClone(column.physical), name: `c${i}` },
    }));
    const checked = validateNativeImportWithProvenance(
      document,
      context,
      nativeImportLegacyProvenance(document, context),
    );
    expect(checked.some((issue) => issue.code === 'mysql.column-count-exceeded')).toBe(true);
    expect(checked.some((issue) => issue.code === 'mysql.column-byte-budget-unverified')).toBe(
      false,
    );
  });
  it('hashes validated source trees independently of JSONB property order while retaining every token', () => {
    expect(importJsonSha256({ b: ' raw ', a: [1, 2] })).toBe(
      importJsonSha256({ a: [1, 2], b: ' raw ' }),
    );
    expect(importJsonSha256({ value: ' raw ' })).not.toBe(importJsonSha256({ value: 'raw' }));
  });
});
