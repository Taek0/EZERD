import { describe, expect, it } from 'vitest';
import { nativeEditorCommandSchema } from '@ezerd/contracts';
import type { NativeIndex, NativeExpression } from '@ezerd/model';
import { advancedFixture } from './native-advanced-test-fixtures.js';
import {
  nativeAstDraft,
  nativeAstExpression,
  type NativeAstDraft,
} from './native-expression-tree-policy.js';
import {
  nativeIndexDraft,
  nativeIndexCandidate,
  nativeIndexMethodChoices,
  readNativeIndexDraft,
  nativeExpressionInitial,
  nativeExpressionCandidate,
  nativeAdvancedCommands,
  nativeAdvancedSelectionValid,
  type NativeExpressionTarget,
} from './native-advanced-policy.js';

const math: NativeExpression = {
  kind: 'binary',
  operator: '+',
  left: { kind: 'call', functionId: 'postgresql:abs', args: [{ kind: 'column', columnId: 'a' }] },
  right: {
    kind: 'binary',
    operator: '*',
    left: { kind: 'column', columnId: 'b' },
    right: { kind: 'literal', literalType: 'number', value: '2' },
  },
};
describe('advanced index and expression command consumers', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'diagnoses missing physical %s index keys before schema parsing without changing the draft',
    (kind) => {
      const f = advancedFixture(kind);
      f.document.columns = [];
      const draft = nativeIndexDraft(f.document, f.table),
        original = structuredClone(f.document),
        originalDraft = structuredClone(draft),
        choices = nativeIndexMethodChoices(f.document, f.table, draft);
      expect(nativeIndexCandidate(f.document, f.table, 'idx', draft)).toMatchObject({
        allowed: false,
        usable: false,
        code: 'index.key-columns-required',
      });
      expect(choices.every((c) => !c.allowed && c.code === 'index.key-columns-required')).toBe(
        true,
      );
      expect(f.document).toEqual(original);
      expect(draft).toEqual(originalDraft);
      f.columns[0]!.scope = 'logical';
      f.document.columns = [f.columns[0]!];
      expect(nativeIndexCandidate(f.document, f.table, 'idx', draft).code).toBe(
        'index.key-columns-required',
      );
      f.columns[0]!.scope = 'physical';
      expect(nativeIndexCandidate(f.document, f.table, 'idx', draft).code).toBe(
        'index.key-parts-required',
      );
    },
  );
  it('returns a stable shape diagnostic for a malformed index command identity', () => {
    const f = advancedFixture(),
      draft = nativeIndexDraft(f.document, f.table);
    draft.name = 'idx';
    const status = nativeIndexCandidate(f.document, f.table, '', draft);
    expect(status).toMatchObject({
      allowed: false,
      usable: false,
      code: 'native.input-shape-invalid',
    });
    expect(status.code).not.toContain('origin');
  });
  it('maps recovery hints only to the selected table and rejects damaged/missing targets', () => {
    const f = advancedFixture();
    expect(
      nativeAdvancedSelectionValid(f.document, f.table, JSON.stringify(['default', 'a'])),
    ).toBe(true);
    expect(nativeAdvancedSelectionValid(f.document, f.table, 'index:new')).toBe(true);
    expect(nativeAdvancedSelectionValid(f.document, f.table, '{broken')).toBe(false);
    expect(
      nativeAdvancedSelectionValid(f.document, f.table, JSON.stringify(['check', 'missing'])),
    ).toBe(false);
    f.columns[0]!.tableId = 'another';
    expect(
      nativeAdvancedSelectionValid(f.document, f.table, JSON.stringify(['default', 'a'])),
    ).toBe(false);
  });
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'builds the full activated %s index union and emits the exact prepared command',
    (kind) => {
      const f = advancedFixture(kind),
        draft = nativeIndexDraft(f.document, f.table);
      draft.name = 'idx_a';
      if (draft.options.database === 'postgresql') draft.options.includeColumnIds = ['s'];
      if (draft.options.database === 'mysql') draft.options.invisible = 'true';
      if (draft.options.database !== 'mysql')
        draft.options.predicate = {
          kind: 'binary',
          operator: '>',
          left: { kind: 'column', columnId: 'a' },
          right: { kind: 'literal', literalType: 'number', value: '0' },
        };
      const before = structuredClone(f.document),
        status = nativeIndexCandidate(f.document, f.table, 'idx', draft);
      expect(status.allowed).toBe(true);
      expect(status.usable).toBe(true);
      expect(status.command).toMatchObject({
        type: 'add_index',
        value: {
          options: { database: kind },
          parts: [{ expression: { kind: 'column', columnId: 'a' } }],
        },
      });
      expect(nativeEditorCommandSchema.safeParse(status.command).success).toBe(true);
      expect(nativeAdvancedCommands(status)).toEqual([status.command]);
      expect(f.document).toEqual(before);
    },
  );
  it('preserves existing option presence and complex ASTs in a minimal rename patch', () => {
    const f = advancedFixture();
    const index: NativeIndex = {
      id: 'i',
      tableId: 't',
      scope: 'physical',
      name: 'old',
      unique: false,
      parts: [{ expression: math, direction: 'asc' }],
      options: {
        database: 'postgresql',
        method: 'btree',
        includeColumnIds: [],
        nullsNotDistinct: false,
      },
    };
    f.document.indexes = [index];
    const draft = nativeIndexDraft(f.document, f.table, index);
    expect(nativeIndexCandidate(f.document, f.table, 'i', draft, true).preserved).toBe(true);
    draft.name = 'new';
    const status = nativeIndexCandidate(f.document, f.table, 'i', draft, true);
    expect(status.allowed).toBe(true);
    expect(status.command).toEqual({ type: 'patch_index', id: 'i', patch: { name: 'new' } });
    expect(status.candidate?.indexes?.[0]?.options).toEqual(index.options);
    expect(status.candidate?.indexes?.[0]?.parts).toEqual(index.parts);
    expect(index.name).toBe('old');
  });
  it('uses PG method/result policy and full method options instead of enabling every opclass', () => {
    const f = advancedFixture(),
      draft = nativeIndexDraft(f.document, f.table);
    draft.name = 'index';
    const choices = nativeIndexMethodChoices(f.document, f.table, draft);
    expect(choices.find((p) => p.method === 'btree')?.allowed).toBe(true);
    expect(choices.find((p) => p.method === 'gin')?.allowed).toBe(false);
    f.columns[0]!.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:jsonb',
      parameters: {},
    };
    expect(
      nativeIndexMethodChoices(f.document, f.table, draft).find((p) => p.method === 'gin')?.allowed,
    ).toBe(true);
    if (draft.options.database !== 'postgresql') throw Error();
    draft.options.method = 'gin';
    draft.unique = 'true';
    expect(nativeIndexCandidate(f.document, f.table, 'i', draft).allowed).toBe(false);
    draft.unique = 'false';
    draft.parts[0]!.direction = 'desc';
    expect(nativeIndexCandidate(f.document, f.table, 'i', draft).allowed).toBe(false);
  });
  it('allows repairing the currently unsupported PG method through a patch probe', () => {
    const f = advancedFixture(),
      index: NativeIndex = {
        id: 'i',
        tableId: 't',
        scope: 'physical',
        name: 'existing',
        unique: false,
        parts: [{ expression: { kind: 'column', columnId: 'a' }, direction: 'asc' }],
        options: { database: 'postgresql', method: 'gin' },
      };
    f.document.indexes = [index];
    const choices = nativeIndexMethodChoices(
      f.document,
      f.table,
      nativeIndexDraft(f.document, f.table, index),
      'i',
    );
    expect(choices.find((p) => p.method === 'btree')?.allowed).toBe(true);
  });
  it('uses the real PG array method policy instead of pretending its inferred scalar family is indexable', () => {
    const f = advancedFixture(),
      draft = nativeIndexDraft(f.document, f.table);
    draft.name = 'array_index';
    f.columns[0]!.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:integer',
      parameters: {},
      array: { dimensions: 1 },
    };
    if (draft.options.database !== 'postgresql') throw Error();
    draft.options.method = 'gin';
    const status = nativeIndexCandidate(f.document, f.table, 'i', draft);
    expect(status.allowed).toBe(true);
    expect(status.usable).toBe(true);
    expect(status.command).toMatchObject({ value: { options: { method: 'gin' } } });
    expect(nativeAdvancedCommands(status)).toEqual([status.command]);
  });
  it('consumes the shared MySQL FULLTEXT charset/collation mismatch rule', () => {
    const f = advancedFixture('mysql'),
      draft = nativeIndexDraft(f.document, f.table);
    draft.name = 'fulltext_index';
    const other = structuredClone(f.columns[2]!);
    other.id = 'other_text';
    other.physical.name = 'other_text';
    other.physical.options = { database: 'mysql', charset: 'ascii', collation: 'ascii_bin' };
    f.document.columns!.push(other);
    draft.parts = [
      { expression: { kind: 'column', columnId: 's' }, direction: 'asc', prefix: '' },
      { expression: { kind: 'column', columnId: other.id }, direction: 'asc', prefix: '' },
    ];
    if (draft.options.database !== 'mysql') throw Error();
    draft.options.kind = 'fulltext';
    const status = nativeIndexCandidate(f.document, f.table, 'i', draft);
    expect(status.allowed).toBe(false);
    expect(status.issues.some((i) => i.code === 'index.fulltext-character-context-mismatch')).toBe(
      true,
    );
  });
  it('checks MySQL functional/FULLTEXT/SPATIAL/prefix conditions and preserves incomplete prefix drafts', () => {
    const f = advancedFixture('mysql'),
      draft = nativeIndexDraft(f.document, f.table);
    draft.name = 'mysql_index';
    if (draft.options.database !== 'mysql') throw Error();
    draft.options.kind = 'fulltext';
    expect(nativeIndexCandidate(f.document, f.table, 'i', draft).allowed).toBe(false);
    draft.parts[0]!.expression = { kind: 'column', columnId: 's' };
    expect(nativeIndexCandidate(f.document, f.table, 'i', draft).allowed).toBe(true);
    draft.options.kind = 'spatial';
    expect(nativeIndexCandidate(f.document, f.table, 'i', draft).allowed).toBe(false);
    draft.options.kind = 'btree';
    draft.parts[0]!.prefix = '20e';
    expect(readNativeIndexDraft(JSON.stringify(draft)).parts[0]?.prefix).toBe('20e');
    expect(nativeIndexCandidate(f.document, f.table, 'i', draft).code).toBe(
      'index.prefix-input-incomplete',
    );
    draft.parts[0]!.prefix = '21';
    expect(nativeIndexCandidate(f.document, f.table, 'i', draft).allowed).toBe(false);
    draft.parts[0]!.prefix = '10';
    expect(nativeIndexCandidate(f.document, f.table, 'i', draft).allowed).toBe(true);
    draft.parts[0]!.expression = {
      kind: 'call',
      functionId: 'mysql:lower',
      args: [{ kind: 'column', columnId: 's' }],
    };
    const original = structuredClone(f.document);
    const unsupported = nativeIndexCandidate(f.document, f.table, 'i', draft);
    expect(unsupported.allowed).toBe(false);
    expect(unsupported.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'index.expression-prefix-policy-required',
          objectId: 'i',
          path: '/indexes/i/parts/0/prefixLength',
          severity: 'error',
          category: 'unsupported',
        }),
      ]),
    );
    expect(f.document).toEqual(original);
    draft.parts[0]!.prefix = '';
    expect(nativeIndexCandidate(f.document, f.table, 'i', draft).allowed).toBe(true);
  });
  it('rejects wrong DB options, nonboolean predicates, foreign/logical refs and duplicate includes', () => {
    const f = advancedFixture(),
      draft = nativeIndexDraft(f.document, f.table);
    draft.name = 'index';
    draft.options = { database: 'mysql', kind: 'btree', invisible: 'false' };
    expect(nativeIndexCandidate(f.document, f.table, 'i', draft).code).toBe(
      'index.context-mismatch',
    );
    draft.options = {
      database: 'postgresql',
      method: 'btree',
      includeColumnIds: ['s', 's'],
      nullsNotDistinct: 'false',
      predicate: null,
    };
    expect(nativeIndexCandidate(f.document, f.table, 'i', draft).code).toBe(
      'index.include-columns-duplicate',
    );
    draft.options.includeColumnIds = [];
    draft.options.predicate = { kind: 'literal', literalType: 'number', value: '20' };
    expect(nativeIndexCandidate(f.document, f.table, 'i', draft).code).toBe(
      'expression.boolean-required',
    );
    draft.options.predicate = null;
    draft.parts[0]!.expression = { kind: 'column', columnId: 'missing' };
    expect(nativeIndexCandidate(f.document, f.table, 'i', draft).allowed).toBe(false);
  });
  it.each(['default', 'computed', 'check'] as const)(
    'prepares complex %s patches with exact source/type metadata and real policy',
    (kind) => {
      const f = advancedFixture();
      const target: NativeExpressionTarget =
        kind === 'check'
          ? { kind, id: 'check', create: true }
          : { kind, columnId: kind === 'computed' ? 'b' : 'a' };
      const initial = nativeExpressionInitial(f.document, f.table, target),
        before = structuredClone(f.document);
      const expr: NativeAstDraft =
        kind === 'check'
          ? {
              kind: 'binary',
              operator: 'AND',
              left: {
                kind: 'binary',
                operator: '>',
                left: { kind: 'column', columnId: 'a' },
                right: { kind: 'literal', literalType: 'number', value: '0' },
              },
              right: {
                kind: 'in',
                negate: false,
                operand: { kind: 'column', columnId: 's' },
                values: [
                  { kind: 'literal', literalType: 'string', value: 'open' },
                  { kind: 'literal', literalType: 'string', value: 'closed' },
                ],
              },
            }
          : kind === 'computed'
            ? {
                kind: 'call',
                functionId: 'postgresql:abs',
                args: [
                  {
                    kind: 'binary',
                    operator: '+',
                    left: { kind: 'column', columnId: 'a' },
                    right: { kind: 'literal', literalType: 'number', value: '2' },
                  },
                ],
              }
            : {
                kind: 'binary',
                operator: '+',
                left: {
                  kind: 'call',
                  functionId: 'postgresql:abs',
                  args: [{ kind: 'literal', literalType: 'number', value: '-2' }],
                },
                right: { kind: 'literal', literalType: 'number', value: '3' },
              };
      const values = {
        ...initial,
        mode: 'replace',
        name: 'complex_check',
        expressionDraftJSON: JSON.stringify(expr),
      };
      const status = nativeExpressionCandidate(f.document, f.table, target, values, initial);
      expect(status.allowed).toBe(true);
      expect(status.usable).toBe(kind !== 'computed');
      expect(status.command).toBeDefined();
      expect(nativeEditorCommandSchema.safeParse(status.command).success).toBe(true);
      if (kind === 'computed')
        expect(() => nativeAdvancedCommands(status)).toThrow('feature.not-implemented');
      else expect(nativeAdvancedCommands(status)).toEqual([status.command]);
      expect(f.document).toEqual(before);
      if (kind !== 'check') {
        expect(status.command).toMatchObject({
          type: 'patch_column',
          patch: {
            physical:
              kind === 'default'
                ? { defaultValue: { kind: 'expression', expression: nativeAstExpression(expr) } }
                : { generation: { kind: 'computed', expression: nativeAstExpression(expr) } },
          },
        });
        expect(
          status.command && 'patch' in status.command && status.command.patch,
        ).not.toHaveProperty('physical.type');
      }
    },
  );
  it('retains legacy defaults and the full identity sequence until explicit replacement', () => {
    const f = advancedFixture(),
      column = f.columns[0]!;
    column.physical.defaultValue = {
      kind: 'legacyExpression',
      source: 'document-v1',
      original: '  private_function(20)  ',
    };
    const target: NativeExpressionTarget = { kind: 'default', columnId: 'a' },
      initial = nativeExpressionInitial(f.document, f.table, target);
    expect(JSON.parse(initial.originalJSON)).toEqual(column.physical.defaultValue);
    const preserved = nativeExpressionCandidate(f.document, f.table, target, initial, initial);
    expect(preserved.preserved).toBe(true);
    expect(nativeAdvancedCommands(preserved)).toEqual([]);
    column.physical.defaultValue = { kind: 'none' };
    column.physical.generation = {
      kind: 'identity',
      database: 'postgresql',
      mode: 'always',
      sequence: {
        start: '9007199254740993',
        increment: '2',
        min: '1',
        max: '9223372036854775807',
        cache: 20,
      },
    };
    const computed: NativeExpressionTarget = { kind: 'computed', columnId: 'a' },
      other = nativeExpressionInitial(f.document, f.table, computed);
    expect(JSON.parse(other.originalJSON)).toEqual(column.physical.generation);
    expect(nativeExpressionCandidate(f.document, f.table, computed, other, other).preserved).toBe(
      true,
    );
  });
  it('rejects stale type/source metadata, generated self-reference and forced readonly command sending', () => {
    const f = advancedFixture(),
      target: NativeExpressionTarget = { kind: 'computed', columnId: 'b' },
      initial = nativeExpressionInitial(f.document, f.table, target);
    const values = {
      ...initial,
      mode: 'replace',
      expressionDraftJSON: JSON.stringify({
        kind: 'binary',
        operator: '+',
        left: { kind: 'column', columnId: 'b' },
        right: { kind: 'literal', literalType: 'number', value: '1' },
      }),
    };
    const status = nativeExpressionCandidate(f.document, f.table, target, values, initial);
    expect(status.allowed).toBe(false);
    expect(
      status.issues.some(
        (i) => i.code === 'generation.cycle' || i.code === 'generation.self-reference',
      ),
    ).toBe(true);
    expect(() => nativeAdvancedCommands(status, true)).toThrow('read-only');
    f.columns[1]!.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:bigint',
      parameters: {},
    };
    expect(nativeExpressionCandidate(f.document, f.table, target, values, initial).code).toBe(
      'native.advanced-source-changed',
    );
  });
  it('retains the durable new CHECK identity even when a form recreates its runtime seed ID', () => {
    const f = advancedFixture(),
      target: NativeExpressionTarget = { kind: 'check', id: 'persisted-check', create: true },
      initial = nativeExpressionInitial(f.document, f.table, target);
    const status = nativeExpressionCandidate(
      f.document,
      f.table,
      { ...target, id: 'new-runtime-check' },
      { ...initial, name: 'check' },
      initial,
    );
    expect(status.command).toMatchObject({ type: 'add_check', value: { id: 'persisted-check' } });
  });
  it('checks complete document budget and corrupt drafts without mutating source', () => {
    const f = advancedFixture(),
      draft = nativeIndexDraft(f.document, f.table);
    draft.name = 'index';
    f.document.notes = Array.from({ length: 200 }, (_, i) => ({
      id: `n${i}`,
      viewId: 'overview',
      text: 'x'.repeat(10_000),
    }));
    const before = structuredClone(f.document);
    expect(nativeIndexCandidate(f.document, f.table, 'i', draft).code).toBe('document.size-limit');
    expect(f.document).toEqual(before);
    expect(() => readNativeIndexDraft('{')).toThrow();
    expect(() =>
      readNativeIndexDraft(
        JSON.stringify({ ...draft, options: { ...draft.options, pin: 'secret' } }),
      ),
    ).toThrow('draft-invalid');
    expect(() =>
      readNativeIndexDraft(
        JSON.stringify({ ...draft, parts: Array.from({ length: 33 }, () => draft.parts[0]) }),
      ),
    ).toThrow('draft-invalid');
  });
});
