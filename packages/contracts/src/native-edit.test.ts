import { describe, expect, it } from 'vitest';
import {
  addNativeColumn,
  createNativeColumn,
  createNativeTable,
  createEmptyNativeDocument,
  defaultDatabaseContext,
  updateNativeColumn,
  updateNativeTable,
  validateDatabaseDocument,
} from '@ezerd/model';
import { nativeColumnPatchSchema, nativeTablePatchSchema } from './native-edit.js';
import { nativeStoredDesignDocumentSchema } from './native-document.js';

describe('native edit contract boundary', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'keeps %s factory candidates in the stored structural contract',
    (kind) => {
      const database = defaultDatabaseContext(kind);
      const table = createNativeTable(database, 't');
      const document = addNativeColumn(
        { ...createEmptyNativeDocument(database), tables: [table] },
        createNativeColumn(database, table, 'c'),
      );
      const columnPatch = nativeColumnPatchSchema.parse({
        physical: {
          name: 'id',
          defaultValue: { kind: 'literal', literalType: 'number', value: '9007199254740993' },
        },
      });
      const tablePatch = nativeTablePatchSchema.parse({
        physical: { name: 'records', comment: 'saved' },
        logical: { name: '기록' },
      });
      const candidate = updateNativeTable(
        updateNativeColumn(document, 'c', columnPatch),
        't',
        tablePatch,
      );
      expect(nativeStoredDesignDocumentSchema.parse(candidate)).toEqual(candidate);
      expect(candidate.columns![0]!.physical.defaultValue).toEqual({
        kind: 'literal',
        literalType: 'number',
        value: '9007199254740993',
      });
      expect(
        validateDatabaseDocument(candidate, database, {
          mode: 'write',
          previous: createEmptyNativeDocument(database),
        }).some((issue) => issue.code === 'type.not-implemented'),
      ).toBe(true);
    },
  );
  it('rejects identity/owner/database injection and unknown nested fields without stripping them', () => {
    for (const input of [
      { id: 'new' },
      { tableId: 'other' },
      { database: { kind: 'mysql' } },
      { physical: { defaultExpression: 'raw sql' } },
      { logical: { injected: true } },
    ])
      expect(nativeColumnPatchSchema.safeParse(input).success).toBe(false);
    for (const input of [
      { id: 'new' },
      { domainId: 'other' },
      { database: { kind: 'mysql' } },
      { physical: { schema: 'old' } },
      { logical: { injected: true } },
    ])
      expect(nativeTablePatchSchema.safeParse(input).success).toBe(false);
  });
  it('bounds expressions and leaves generation/default/options independent for final DB validation', () => {
    const input = {
      physical: {
        type: {
          kind: 'builtin',
          database: 'mysql',
          typeId: 'mysql:int',
          parameters: { unsigned: true },
        },
      },
    };
    expect(nativeColumnPatchSchema.parse(input)).toEqual(input);
    const nested: Record<string, unknown> = { kind: 'column', columnId: 'c' };
    let expression: unknown = nested;
    for (let i = 0; i < 35; i++) expression = { kind: 'unary', operator: '-', operand: expression };
    expect(
      nativeColumnPatchSchema.safeParse({
        physical: {
          generation: { kind: 'computed', database: 'postgresql', storage: 'stored', expression },
        },
      }).success,
    ).toBe(false);
  });
});
