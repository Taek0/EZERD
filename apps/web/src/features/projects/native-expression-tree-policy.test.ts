import { describe, expect, it } from 'vitest';
import type { NativeExpression } from '@ezerd/model';
import {
  nativeAstDraft,
  nativeAstExpression,
  nativeAstDecision,
  nativeAstFunctionChoices,
  nativeAstSeed,
  readNativeAstDraft,
  updateNativeAstDraft,
  wrapNativeAstDraft,
  assertNativeAstDraft,
  type NativeAstDraft,
} from './native-expression-tree-policy.js';
import { advancedFixture } from './native-advanced-test-fixtures.js';
import { nativeAdvancedExpressionFacts } from './native-advanced-policy.js';

const complex: NativeExpression = {
  kind: 'binary',
  operator: 'AND',
  left: {
    kind: 'binary',
    operator: '>',
    left: {
      kind: 'call',
      functionId: 'postgresql:abs',
      args: [
        {
          kind: 'binary',
          operator: '-',
          left: { kind: 'column', columnId: 'a' },
          right: { kind: 'column', columnId: 'b' },
        },
      ],
    },
    right: { kind: 'literal', literalType: 'number', value: '9007199254740993' },
  },
  right: {
    kind: 'in',
    negate: true,
    operand: { kind: 'column', columnId: 's' },
    values: [
      { kind: 'literal', literalType: 'string', value: '  原文  ' },
      { kind: 'literal', literalType: 'string', value: 'closed' },
    ],
  },
};
describe('bounded exact native AST drafts', () => {
  it('roundtrips a compound typed AST, nested calls, IN values and bigint text without flattening', () => {
    const draft = nativeAstDraft(complex),
      before = structuredClone(draft);
    expect(nativeAstExpression(readNativeAstDraft(JSON.stringify(draft)))).toEqual(complex);
    const f = advancedFixture();
    expect(
      nativeAstDecision(
        f.document.database,
        draft,
        nativeAdvancedExpressionFacts(f.document, f.table, 'check'),
      ),
    ).toMatchObject({ allowed: true, usable: false });
    expect(draft).toEqual(before);
  });
  it('edits only an addressed subtree and rejects unsafe/missing paths', () => {
    const draft = nativeAstDraft(complex),
      before = structuredClone(draft);
    const edited = updateNativeAstDraft(draft, ['left', 'left', 'args', 0, 'right'], {
      kind: 'literal',
      literalType: 'number',
      value: '20',
    });
    expect(nativeAstExpression(edited)).toMatchObject({
      left: { left: { args: [{ right: { value: '20' } }] } },
      right: complex.kind === 'binary' ? complex.right : undefined,
    });
    expect(draft).toEqual(before);
    expect(() =>
      updateNativeAstDraft(
        draft,
        ['__proto__', 'polluted'],
        nativeAstSeed('null', advancedFixture().document.database),
      ),
    ).toThrow('path-invalid');
    expect(() =>
      updateNativeAstDraft(draft, ['left', 'left', 'args', 10], { kind: 'null' }),
    ).toThrow('path-invalid');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
  it('wraps the full current subtree rather than resetting complex expressions', () => {
    const draft = nativeAstDraft(complex);
    const wrapped = wrapNativeAstDraft(draft, 'NOT');
    expect(wrapped).toMatchObject({ operand: draft });
    expect(nativeAstExpression(wrapped)).toMatchObject({
      kind: 'unary',
      operator: 'NOT',
      operand: complex,
    });
  });
  it.each([
    ['number', '20e'],
    ['number', '-'],
    ['number', ''],
    ['boolean', 'tru'],
    ['boolean', ''],
    ['binary', '0G'],
    ['json', '{"unfinished":'],
  ] as const)(
    'preserves incomplete %s token %j and never saves zero/NaN/false',
    (literalType, value) => {
      const draft: NativeAstDraft = { kind: 'literal', literalType, value };
      const text = JSON.stringify(draft),
        f = advancedFixture();
      expect(readNativeAstDraft(text)).toEqual(draft);
      const policy = nativeAstDecision(
        f.document.database,
        draft,
        nativeAdvancedExpressionFacts(f.document, f.table, 'default', f.columns[0]),
      );
      expect(policy.allowed).toBe(false);
      expect(() => nativeAstExpression(draft)).toThrow();
      expect(JSON.stringify(draft)).toBe(text);
    },
  );
  it('keeps exact numeric strings and strict completed booleans', () => {
    expect(
      nativeAstExpression({ kind: 'literal', literalType: 'number', value: '9007199254740993' }),
    ).toEqual({ kind: 'literal', literalType: 'number', value: '9007199254740993' });
    expect(
      nativeAstExpression({ kind: 'literal', literalType: 'boolean', value: 'false' }),
    ).toEqual({ kind: 'literal', literalType: 'boolean', value: false });
  });
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'offers only %s functions with actual purpose/arity semantics',
    (kind) => {
      const f = advancedFixture(kind),
        facts = nativeAdvancedExpressionFacts(f.document, f.table, 'index');
      const call: Extract<NativeAstDraft, { kind: 'call' }> = {
        kind: 'call',
        functionId: `${kind}:abs`,
        args: [{ kind: 'column', columnId: 'a' }],
      };
      const choices = nativeAstFunctionChoices(f.document.database, call, facts);
      expect(choices.every((c) => c.id.startsWith(kind + ':'))).toBe(true);
      expect(choices.find((c) => c.id === `${kind}:abs`)?.allowed).toBe(true);
      expect(choices.find((c) => c.id === `${kind}:lower`)?.allowed).toBe(false);
      expect(
        nativeAstDecision(f.document.database, { ...call, functionId: `${kind}:coalesce` }, facts)
          .allowed,
      ).toBe(false);
      const clock: NativeAstDraft = {
        kind: 'call',
        functionId: `${kind}:current_timestamp`,
        args: [],
      };
      expect(nativeAstDecision(f.document.database, clock, facts)).toMatchObject({
        allowed: false,
        code: 'expression.non-deterministic',
      });
    },
  );
  it('rejects default column references, foreign-table/logical references, typedText and mixed result families', () => {
    const f = advancedFixture();
    f.columns[1]!.scope = 'logical';
    const column: NativeAstDraft = { kind: 'column', columnId: 'a' };
    expect(
      nativeAstDecision(
        f.document.database,
        column,
        nativeAdvancedExpressionFacts(f.document, f.table, 'default', f.columns[0]),
      ).code,
    ).toBe('default.column-reference-not-supported');
    expect(
      nativeAstDecision(
        f.document.database,
        { kind: 'column', columnId: 'b' },
        nativeAdvancedExpressionFacts(f.document, f.table, 'index'),
      ).allowed,
    ).toBe(false);
    expect(
      nativeAstDecision(
        f.document.database,
        { kind: 'literal', literalType: 'typedText', value: '2026-' },
        nativeAdvancedExpressionFacts(f.document, f.table, 'computed', f.columns[0]),
      ).allowed,
    ).toBe(false);
    expect(
      nativeAstDecision(
        f.document.database,
        {
          kind: 'binary',
          operator: '+',
          left: column,
          right: { kind: 'literal', literalType: 'string', value: '20' },
        },
        nativeAdvancedExpressionFacts(f.document, f.table, 'index'),
      ).code,
    ).toBe('expression.numeric-required');
  });
  it('enforces depth/node/list budgets and rejects corrupt or cyclic drafts before rendering', () => {
    const context = advancedFixture().document.database;
    let deep: NativeAstDraft = { kind: 'null' };
    for (let i = 0; i < 34; i++) deep = { kind: 'unary', operator: 'NOT', operand: deep };
    expect(() => readNativeAstDraft(JSON.stringify(deep))).toThrow('complexity');
    const many: NativeAstDraft = {
      kind: 'call',
      functionId: 'postgresql:coalesce',
      args: Array.from({ length: 33 }, () => ({ kind: 'null' })),
    };
    expect(() => assertNativeAstDraft(many)).toThrow();
    let large: NativeAstDraft = { kind: 'literal', literalType: 'number', value: '0' };
    for (let i = 0; i < 10; i++)
      large = {
        kind: 'binary',
        operator: '+',
        left: structuredClone(large),
        right: structuredClone(large),
      };
    expect(() => readNativeAstDraft(JSON.stringify(large))).toThrow('complexity');
    const cycle = { kind: 'unary', operator: 'NOT' } as unknown as Extract<
      NativeAstDraft,
      { kind: 'unary' }
    >;
    cycle.operand = cycle;
    expect(() => assertNativeAstDraft(cycle)).toThrow('draft-invalid');
    expect(() => readNativeAstDraft('{bad')).toThrow();
    for (const kind of [
      'literal',
      'null',
      'column',
      'call',
      'unary',
      'binary',
      'isNull',
      'in',
    ] as const)
      expect(() => assertNativeAstDraft(nativeAstSeed(kind, context))).not.toThrow();
  });
});
