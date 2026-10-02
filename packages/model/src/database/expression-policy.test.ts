import { describe, expect, it } from 'vitest';
import { createNativeColumn, createNativeTable } from './editing.js';
import { defaultDatabaseContext } from './profiles.js';
import { nativeExpressionDecision } from './expression-policy.js';
import type { NativeExpression } from './native-document.js';
const literal = (value: string): NativeExpression => ({
  kind: 'literal',
  literalType: 'number',
  value,
});
const column: NativeExpression = { kind: 'column', columnId: 'number' };
function fixture(kind: 'postgresql' | 'mysql' | 'sqlite') {
  const context = defaultDatabaseContext(kind),
    table = createNativeTable(context, 't'),
    numeric = createNativeColumn(context, table, 'number'),
    text = createNativeColumn(context, table, 'text');
  numeric.physical.type =
    kind === 'postgresql'
      ? { kind: 'builtin', database: kind, typeId: 'postgresql:integer', parameters: {} }
      : kind === 'mysql'
        ? { kind: 'builtin', database: kind, typeId: 'mysql:int', parameters: {} }
        : { kind: 'builtin', database: kind, typeId: 'sqlite:integer', parameters: {} };
  const columns = [numeric, text];
  return {
    context,
    columns,
    decision: (
      expression: NativeExpression,
      purpose: 'default' | 'computed' | 'check' | 'predicate' | 'index' = 'check',
    ) => nativeExpressionDecision(context, expression, { columns, tableId: 't', purpose }),
  };
}
describe.each(['postgresql', 'mysql', 'sqlite'] as const)(
  '%s structured expression semantics',
  (kind) => {
    it('accepts numeric comparisons but rejects a scalar CHECK/predicate or string arithmetic', () => {
      const { decision } = fixture(kind);
      expect(
        decision({ kind: 'binary', operator: '>', left: column, right: literal('0') }).allowed,
      ).toBe(true);
      expect(decision(column).code).toBe('expression.boolean-required');
      expect(decision(literal('1'), 'predicate').allowed).toBe(false);
      expect(
        decision(
          {
            kind: 'binary',
            operator: '+',
            left: { kind: 'column', columnId: 'text' },
            right: literal('1'),
          },
          'computed',
        ).code,
      ).toBe('expression.numeric-required');
    });
    it('checks function argument types and volatile expressions', () => {
      const { decision } = fixture(kind);
      expect(
        decision({ kind: 'call', functionId: `${kind}:lower`, args: [column] }, 'computed').code,
      ).toBe('expression.string-required');
      expect(
        decision(
          {
            kind: 'call',
            functionId: `${kind}:length`,
            args: [{ kind: 'column', columnId: 'text' }],
          },
          'index',
        ).result?.family,
      ).toBe('number');
      expect(
        decision({ kind: 'call', functionId: `${kind}:current_timestamp`, args: [] }, 'index').code,
      ).toBe('expression.non-deterministic');
      expect(
        decision({ kind: 'call', functionId: `${kind}:coalesce`, args: [column] }, 'computed').code,
      ).toBe('expression.function-arguments-invalid');
    });
    it('binds physical column ownership and prohibits default column references', () => {
      const { columns, decision } = fixture(kind);
      expect(decision(column, 'default').code).toBe('default.column-reference-not-supported');
      columns[0]!.scope = 'logical';
      expect(decision(column, 'computed').code).toBe('expression.column-not-found');
      columns[0]!.scope = 'both';
      columns[0]!.tableId = 'other';
      expect(decision(column, 'computed').code).toBe('expression.column-not-found');
    });
    it('keeps binary literal validation and coalesce nullability/type compatibility', () => {
      const { decision } = fixture(kind);
      expect(
        decision({ kind: 'literal', literalType: 'binary', value: 'xyz' }, 'computed').allowed,
      ).toBe(false);
      expect(
        decision(
          {
            kind: 'call',
            functionId: `${kind}:coalesce`,
            args: [column, { kind: 'literal', literalType: 'string', value: 'fallback' }],
          },
          'computed',
        ).code,
      ).toBe('expression.function-type-mismatch');
      expect(
        decision(
          { kind: 'call', functionId: `${kind}:coalesce`, args: [{ kind: 'null' }, literal('0')] },
          'computed',
        ).result?.nullable,
      ).toBe(false);
    });
    it('checks IN comparison operands and typedText authority', () => {
      const { decision } = fixture(kind);
      expect(
        decision({
          kind: 'in',
          operand: column,
          values: [literal('1'), literal('2')],
          negate: false,
        }).allowed,
      ).toBe(true);
      expect(
        decision({
          kind: 'in',
          operand: column,
          values: [{ kind: 'literal', literalType: 'string', value: 'a' }],
          negate: false,
        }).allowed,
      ).toBe(false);
      expect(
        decision({ kind: 'literal', literalType: 'typedText', value: '2024-01-01' }, 'computed')
          .code,
      ).toBe('literal.target-type-required');
    });
  },
);
describe('expression result assignment and numeric promotion', () => {
  it('does not bypass a NOT NULL default through the expression NULL branch', () => {
    const { context, columns } = fixture('postgresql');
    expect(
      nativeExpressionDecision(
        context,
        { kind: 'null' },
        {
          columns,
          tableId: 't',
          purpose: 'default',
          targetType: columns[0]!.physical.type,
          nullable: false,
        },
      ).code,
    ).toBe('default.null-not-supported');
  });
  it('rejects an explicit constant zero divisor before SQL generation', () => {
    const { decision } = fixture('postgresql');
    expect(
      decision(
        { kind: 'binary', operator: '/', left: literal('1'), right: literal('0') },
        'default',
      ).code,
    ).toBe('expression.division-by-zero');
  });
  it('rejects generated/default result mismatch and retains SQLite general affinity/STRICT ANY', () => {
    const pg = fixture('postgresql'),
      sqlite = fixture('sqlite');
    expect(
      nativeExpressionDecision(pg.context, literal('1'), {
        columns: pg.columns,
        tableId: 't',
        purpose: 'computed',
        targetType: pg.columns[1]!.physical.type,
      }).code,
    ).toBe('expression.target-type-mismatch');
    expect(
      nativeExpressionDecision(sqlite.context, literal('1'), {
        columns: sqlite.columns,
        tableId: 't',
        purpose: 'computed',
        targetType: sqlite.columns[1]!.physical.type,
      }).allowed,
    ).toBe(true);
    expect(
      nativeExpressionDecision(sqlite.context, literal('1'), {
        columns: sqlite.columns,
        tableId: 't',
        purpose: 'computed',
        strict: true,
        targetType: { kind: 'builtin', database: 'sqlite', typeId: 'sqlite:any', parameters: {} },
      }).allowed,
    ).toBe(true);
  });
  it('rejects PostgreSQL float modulo even when a coalesce starts with an integer', () => {
    const { context, columns } = fixture('postgresql');
    columns[1]!.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:double precision',
      parameters: {},
    };
    const coalesce: NativeExpression = {
      kind: 'call',
      functionId: 'postgresql:coalesce',
      args: [column, { kind: 'column', columnId: 'text' }],
    };
    expect(
      nativeExpressionDecision(
        context,
        { kind: 'binary', operator: '%', left: coalesce, right: literal('2') },
        { columns, tableId: 't', purpose: 'computed' },
      ).allowed,
    ).toBe(false);
  });
  it('supports IS NULL on non-comparable physical types without allowing their equality', () => {
    const { columns, decision } = fixture('postgresql');
    columns[0]!.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:xml',
      parameters: {},
    };
    expect(decision({ kind: 'isNull', operand: column, negate: false }).allowed).toBe(true);
    expect(decision({ kind: 'binary', operator: '=', left: column, right: column }).allowed).toBe(
      false,
    );
  });
});
