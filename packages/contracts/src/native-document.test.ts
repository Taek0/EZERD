import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  createEmptyNativeDocument,
  defaultDatabaseContext,
  migrateDesignDocumentV1,
  type Column,
  type NativeExpression,
} from '@ezerd/model';
import {
  databaseContextSchema,
  designDocumentReadSchema,
  nativeColumnTypeSchema,
  nativeStoredColumnTypeSchema,
  nativeDefaultValueSchema,
  nativeStoredDefaultValueSchema,
  nativeExpressionSchema,
  nativeStoredDesignDocumentSchema,
  nativeProjectTransferSchema,
  projectTransferReadSchema,
} from './native-document.js';

const pg = defaultDatabaseContext('postgresql');
const mysql = defaultDatabaseContext('mysql');
const sqlite = defaultDatabaseContext('sqlite');
const builtin = (database: 'postgresql' | 'mysql' | 'sqlite', typeId: string, parameters = {}) => ({
  kind: 'builtin',
  database,
  typeId,
  parameters,
});
const literal = (literalType: string, value: unknown) => ({ kind: 'literal', literalType, value });

describe('native type and expression wire contracts', () => {
  it('validates profile identity and native DB IDs', () => {
    expect(databaseContextSchema.safeParse(pg).success).toBe(true);
    expect(
      databaseContextSchema.safeParse({ kind: 'mysql', profileId: pg.profileId }).success,
    ).toBe(false);
    expect(nativeColumnTypeSchema.safeParse(builtin('mysql', 'postgresql:integer')).success).toBe(
      false,
    );
    expect(
      nativeColumnTypeSchema.safeParse(builtin('postgresql', 'postgresql:unknown')).success,
    ).toBe(false);
    expect(
      nativeColumnTypeSchema.safeParse(
        builtin('postgresql', 'postgresql:numeric', { precision: 2, scale: 4 }),
      ).success,
    ).toBe(true);
    expect(
      nativeColumnTypeSchema.safeParse(
        builtin('mysql', 'mysql:decimal', { precision: 2, scale: 4 }),
      ).success,
    ).toBe(false);
  });
  it('rejects unrelated options, aliases and generated SQL fragments', () => {
    expect(nativeColumnTypeSchema.safeParse(builtin('mysql', 'mysql:varchar')).success).toBe(false);
    expect(
      nativeColumnTypeSchema.safeParse(builtin('mysql', 'mysql:varchar', { length: 255 })).success,
    ).toBe(true);
    expect(
      nativeColumnTypeSchema.safeParse({
        ...builtin('mysql', 'mysql:int'),
        array: { dimensions: 1 },
      }).success,
    ).toBe(false);
    expect(
      nativeColumnTypeSchema.safeParse(
        builtin('postgresql', 'postgresql:integer', { unsigned: true }),
      ).success,
    ).toBe(false);
    expect(
      nativeColumnTypeSchema.safeParse(builtin('mysql', 'mysql:int', { unknown: 1 })).success,
    ).toBe(false);
    expect(
      nativeColumnTypeSchema.safeParse({
        ...builtin('mysql', 'mysql:int'),
        declarationAlias: 'boolean',
      }).success,
    ).toBe(false);
    expect(
      nativeColumnTypeSchema.safeParse({
        kind: 'declared',
        database: 'sqlite',
        name: 'TEXT; DROP TABLE t',
        numericArguments: [],
      }).success,
    ).toBe(false);
  });
  it('preserves MySQL value lists and applies SET-specific constraints', () => {
    const enumType = {
      kind: 'valueList',
      database: 'mysql',
      typeId: 'mysql:enum',
      values: ['a', 'b'],
    };
    expect(nativeColumnTypeSchema.parse(enumType)).toEqual(enumType);
    expect(nativeColumnTypeSchema.safeParse({ ...enumType, values: ['a', 'a'] }).success).toBe(
      false,
    );
    expect(
      nativeColumnTypeSchema.safeParse({ ...enumType, typeId: 'mysql:set', values: ['a,b'] })
        .success,
    ).toBe(false);
    expect(
      nativeColumnTypeSchema.safeParse({
        ...enumType,
        typeId: 'mysql:set',
        values: Array.from({ length: 65 }, (_, i) => `${i}`),
      }).success,
    ).toBe(false);
  });
  it('only accepts legacy forms in read/candidate schemas and retains original spellings', () => {
    const type = {
      kind: 'legacy',
      source: 'document-v1',
      original: { name: ' INT8 ', isArray: false },
    };
    expect(nativeStoredColumnTypeSchema.parse(type)).toEqual(type);
    expect(nativeColumnTypeSchema.safeParse(type).success).toBe(false);
    const raw = { kind: 'legacyExpression', source: 'document-v1', original: 'unregistered()' };
    expect(nativeStoredDefaultValueSchema.parse(raw)).toEqual(raw);
    expect(nativeDefaultValueSchema.safeParse(raw).success).toBe(false);
  });
  it('preserves exact numbers and validates structured literal forms', () => {
    const big = literal('number', '18446744073709551615');
    expect(nativeDefaultValueSchema.parse(big)).toEqual(big);
    expect(nativeDefaultValueSchema.safeParse(literal('number', '1); DROP TABLE t')).success).toBe(
      false,
    );
    expect(nativeDefaultValueSchema.safeParse(literal('boolean', 'false')).success).toBe(false);
    expect(nativeDefaultValueSchema.safeParse(literal('json', '{bad}')).success).toBe(false);
    expect(nativeDefaultValueSchema.safeParse(literal('binary', 'abc')).success).toBe(false);
    expect(nativeDefaultValueSchema.parse(literal('binary', 'aB00'))).toEqual(
      literal('binary', 'aB00'),
    );
  });
  it('rejects raw expressions, unknown functions and excessive recursion before recursive parsing', () => {
    expect(nativeExpressionSchema.safeParse('now(); DROP TABLE t').success).toBe(false);
    expect(
      nativeExpressionSchema.safeParse({
        kind: 'call',
        functionId: 'postgresql:untrusted',
        args: [],
      }).success,
    ).toBe(false);
    let deep: NativeExpression = { kind: 'null' };
    for (let i = 0; i < 1500; i++) deep = { kind: 'unary', operator: 'NOT', operand: deep };
    const parsed = nativeExpressionSchema.safeParse(deep);
    expect(parsed.success).toBe(false);
    expect(!parsed.success && parsed.error.issues[0]?.message).toBe('expression.complexity-limit');
    const cycle: Record<string, unknown> = { kind: 'unary', operator: 'NOT' };
    cycle.operand = cycle;
    expect(nativeExpressionSchema.safeParse(cycle).success).toBe(false);
  });
});

describe('versioned document and transfer reads', () => {
  const metadata = { common: {}, logical: {}, physical: {} };
  const column: Column = {
    id: 'c',
    tableId: 't',
    scope: 'physical',
    logical: { name: '', definition: '', semanticType: '', required: false },
    physical: {
      name: 'id',
      type: { name: 'INT8', isArray: false },
      nullable: false,
      comment: '',
      defaultExpression: '9223372036854775807',
    },
    customProperties: metadata,
  };
  const v1 = {
    ...createEmptyDocument(),
    tables: [
      {
        id: 't',
        domainId: null,
        scope: 'physical' as const,
        logical: { name: '', definition: '' },
        physical: { name: 't', schema: '', comment: '' },
        customProperties: metadata,
      },
    ],
    columns: [column],
  };
  it('reads v1 without renaming its original types, and reads v2 without downgrading', () => {
    const read = designDocumentReadSchema.parse(v1);
    expect(read.columns?.[0]?.physical.type).toEqual(column.physical.type);
    const v2 = migrateDesignDocumentV1(v1, pg).document;
    expect(designDocumentReadSchema.parse(v2)).toEqual(v2);
    expect(designDocumentReadSchema.safeParse({ ...v2, schemaVersion: 3 }).success).toBe(false);
  });
  it('keeps migrated non-PG legacy fields open for repair', () => {
    const { document } = migrateDesignDocumentV1(v1, mysql);
    expect(nativeStoredDesignDocumentSchema.parse(document)).toEqual(document);
  });
  it('validates global IDs including new checks and indexes', () => {
    const document = createEmptyNativeDocument(sqlite);
    document.checks = [
      { id: 'duplicate', tableId: 't', name: '', scope: 'physical', expression: { kind: 'null' } },
    ];
    document.indexes = [
      {
        id: 'duplicate',
        tableId: 't',
        name: '',
        scope: 'physical',
        unique: false,
        parts: [{ expression: { kind: 'column', columnId: 'c' }, direction: 'asc' }],
        options: { database: 'sqlite' },
      },
    ];
    const parsed = nativeStoredDesignDocumentSchema.safeParse(document);
    expect(parsed.success).toBe(false);
    expect(
      !parsed.success &&
        parsed.error.issues.some((issue) => issue.message === 'document.duplicate-identities'),
    ).toBe(true);
    document.indexes = [];
    document.checks![0]!.id = '__tables__';
    expect(nativeStoredDesignDocumentSchema.safeParse(document).success).toBe(false);
  });
  it('rejects oversized native documents and duplicate placements', () => {
    const document = createEmptyNativeDocument(pg);
    document.notes = Array.from({ length: 80 }, (_, i) => ({
      id: `note:${i}`,
      viewId: '__tables__',
      text: '한'.repeat(10000),
      color: '#ffffff',
    }));
    expect(nativeStoredDesignDocumentSchema.safeParse(document).success).toBe(false);
    document.notes = [];
    const placement = {
      id: 'n',
      objectId: 't',
      viewId: '__tables__',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    };
    document.layout.nodes = [placement, { ...placement, id: 'other' }];
    expect(nativeStoredDesignDocumentSchema.safeParse(document).success).toBe(false);
  });
  it('accepts both transfer versions and enforces metadata/document agreement', () => {
    const v2 = migrateDesignDocumentV1(v1, pg).document;
    const file = {
      format: 'ezerd-project',
      formatVersion: 2,
      exportedAt: '2026-10-01T00:00:00.000Z',
      project: { name: 'test', databaseKind: pg.kind, databaseProfileId: pg.profileId },
      document: v2,
    };
    expect(nativeProjectTransferSchema.parse(file)).toEqual(file);
    expect(
      nativeProjectTransferSchema.safeParse({
        ...file,
        project: { ...file.project, databaseKind: 'sqlite' },
      }).success,
    ).toBe(false);
    expect(
      projectTransferReadSchema.parse({
        ...file,
        formatVersion: 1,
        project: { name: 'old' },
        document: v1,
      }).document,
    ).toEqual(v1);
    expect(projectTransferReadSchema.safeParse({ ...file, formatVersion: 3 }).success).toBe(false);
  });
});
