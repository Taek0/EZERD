import { describe, it, expect } from 'vitest';
import {
  nativeColumnTypeDisplay,
  nativeDefaultDisplay,
  nativeExpressionDisplay,
  nativeGenerationDisplay,
} from './display.js';
import type { NativeExpression } from './native-document.js';
describe('native display preserves declarations instead of converting dialects', () => {
  it('shows parameters/arrays/ENUM/unsigned/SRID and SQLite declarations without a PG type approximation', () => {
    expect(
      nativeColumnTypeDisplay({
        kind: 'builtin',
        database: 'postgresql',
        typeId: 'postgresql:numeric',
        parameters: { precision: 18, scale: 2 },
        array: { dimensions: 2 },
      }),
    ).toBe('NUMERIC(18,2)[][]');
    expect(
      nativeColumnTypeDisplay(
        { kind: 'projectEnum', database: 'postgresql', enumId: 'e', array: { dimensions: 1 } },
        [{ id: 'e', name: 'OrderStatus', schema: 'public', values: ['a'] }],
      ),
    ).toBe('OrderStatus[]');
    expect(
      nativeColumnTypeDisplay({
        kind: 'builtin',
        database: 'mysql',
        typeId: 'mysql:bigint',
        parameters: { unsigned: true },
      }),
    ).toBe('BIGINT UNSIGNED');
    expect(
      nativeColumnTypeDisplay({
        kind: 'builtin',
        database: 'mysql',
        typeId: 'mysql:tinyint',
        parameters: {},
        declarationAlias: 'boolean',
      }),
    ).toBe('BOOLEAN');
    expect(
      nativeColumnTypeDisplay({
        kind: 'builtin',
        database: 'mysql',
        typeId: 'mysql:point',
        parameters: { srid: 4326 },
      }),
    ).toBe('POINT SRID 4326');
    expect(
      nativeColumnTypeDisplay({
        kind: 'declared',
        database: 'sqlite',
        name: 'Decimal Text',
        numericArguments: ['9007199254740993', '-2'],
      }),
    ).toBe('Decimal Text(9007199254740993,-2)');
    expect(nativeColumnTypeDisplay({ kind: 'untyped', database: 'sqlite' })).toBe('');
    expect(
      nativeColumnTypeDisplay({
        kind: 'valueList',
        database: 'mysql',
        typeId: 'mysql:enum',
        values: ['a"', '나'],
      }),
    ).toBe('ENUM("a\\\"", "나")');
  });
  it('keeps exact legacy spelling/default expressions and does not round long numeric/default/sequence values', () => {
    expect(
      nativeColumnTypeDisplay({
        kind: 'legacy',
        source: 'document-v1',
        original: { name: ' FLOAT4 ', isArray: true, length: 7 },
      }),
    ).toBe(' FLOAT4 (7)[]');
    expect(
      nativeDefaultDisplay(
        { kind: 'legacyExpression', source: 'document-v1', original: ' old() ' },
        {},
      ),
    ).toBe(' old() ');
    expect(
      nativeDefaultDisplay(
        { kind: 'literal', literalType: 'number', value: '9007199254740993.000' },
        {},
      ),
    ).toBe('9007199254740993.000');
    expect(
      nativeGenerationDisplay(
        {
          kind: 'identity',
          database: 'postgresql',
          mode: 'byDefault',
          sequence: { start: '9007199254740993', increment: '-2', cache: 10, cycle: false },
        },
        {},
      ),
    ).toBe('IDENTITY BY DEFAULT (start=9007199254740993, increment=-2, cache=10, cycle=false)');
  });
  it('formats AST references/calls/operators/literals without evaluating code or interpreting text as an expression', () => {
    const value: NativeExpression = {
      kind: 'binary',
      operator: '+',
      left: { kind: 'column', columnId: 'c' },
      right: { kind: 'literal', literalType: 'number', value: '9007199254740993' },
    };
    expect(
      nativeExpressionDisplay(value, {
        columns: [{ id: 'c', physical: { name: 'amount' }, logical: { name: '' } }] as never,
      }),
    ).toBe('(amount + 9007199254740993)');
    expect(
      nativeExpressionDisplay(
        {
          kind: 'call',
          functionId: 'mysql:coalesce',
          args: [{ kind: 'null' }, { kind: 'literal', literalType: 'string', value: 'raw()' }],
        },
        {},
      ),
    ).toBe('COALESCE(NULL, "raw()")');
    expect(
      nativeGenerationDisplay(
        {
          kind: 'computed',
          database: 'sqlite',
          storage: 'virtual',
          expression: {
            kind: 'isNull',
            operand: { kind: 'column', columnId: 'missing' },
            negate: true,
          },
        },
        {},
      ),
    ).toBe('VIRTUAL AS ([missing] IS NOT NULL)');
  });
  it('shares expression depth protection with contracts and sync', () => {
    let expression: NativeExpression = { kind: 'null' };
    for (let i = 0; i < 40; i++)
      expression = { kind: 'unary', operator: 'NOT', operand: expression };
    expect(() => nativeExpressionDisplay(expression, {})).toThrow('expression.complexity-limit');
  });
});
