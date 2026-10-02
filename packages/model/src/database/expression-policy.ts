import type { DatabaseContext } from './definitions.js';
import { getDatabaseType, sqliteTypeAffinity } from './catalog.js';
import { getDatabaseProfile } from './profiles.js';
import { inspectNativeLiteralToken } from './literals.js';
import type { NativeColumn, NativeColumnType, NativeExpression } from './native-document.js';

export type NativeExpressionFamily =
  | 'null'
  | 'boolean'
  | 'number'
  | 'string'
  | 'binary'
  | 'json'
  | 'uuid'
  | 'date'
  | 'time'
  | 'timestamp'
  | 'enum'
  | 'unsupported';
export interface NativeExpressionType {
  family: NativeExpressionFamily;
  numeric?: 'integer' | 'decimal' | 'floating';
  enumId?: string;
  nullable: boolean;
}
export interface NativeExpressionDecision {
  allowed: boolean;
  usable: false;
  result?: NativeExpressionType;
  code?: string;
}
export interface NativeExpressionPolicyFacts {
  columns: readonly NativeColumn[];
  tableId: string;
  purpose: 'default' | 'computed' | 'check' | 'index' | 'predicate';
  targetType?: NativeColumnType;
  strict?: boolean;
  nullable?: boolean;
  primary?: boolean;
}
function family(type: NativeColumnType): NativeExpressionType {
  const result = (
    value: NativeExpressionFamily,
    extra: Partial<NativeExpressionType> = {},
  ): NativeExpressionType => ({ family: value, nullable: false, ...extra });
  if (type.kind === 'legacy' || (type.database === 'postgresql' && 'array' in type && type.array))
    return result('unsupported');
  if (type.kind === 'projectEnum') return result('enum', { enumId: type.enumId });
  if (type.kind === 'valueList') return result('string');
  if (type.kind === 'untyped') return result('unsupported');
  if (type.kind === 'declared') {
    const affinity = sqliteTypeAffinity(type.name);
    return affinity === 'text'
      ? result('string')
      : affinity === 'blob'
        ? result('binary')
        : result('number', { numeric: affinity === 'real' ? 'floating' : 'decimal' });
  }
  const definition = getDatabaseType(type.typeId);
  if (!definition) return result('unsupported');
  if (type.database === 'sqlite') {
    if (type.typeId === 'sqlite:any') return result('unsupported');
    const affinity = definition.sqliteAffinity;
    return affinity === 'text'
      ? result('string')
      : affinity === 'blob'
        ? result('binary')
        : result('number', {
            numeric:
              affinity === 'integer' ? 'integer' : affinity === 'real' ? 'floating' : 'decimal',
          });
  }
  const category = definition.category,
    name = definition.sqlName.toLowerCase();
  if (category === 'integer' || category === 'decimal' || category === 'floating')
    return type.database === 'mysql' && type.declarationAlias === 'boolean'
      ? result('boolean')
      : result('number', {
          numeric:
            category === 'integer' ? 'integer' : category === 'decimal' ? 'decimal' : 'floating',
        });
  if (category === 'boolean') return result('boolean');
  if (category === 'string' || category === 'binary' || category === 'json' || category === 'uuid')
    return result(category);
  if (category === 'temporal')
    return result(
      name === 'date'
        ? 'date'
        : ['time', 'timetz'].includes(name)
          ? 'time'
          : name === 'year'
            ? 'number'
            : 'timestamp',
    );
  return result('unsupported');
}
const same = (a: NativeExpressionType, b: NativeExpressionType) =>
  a.family === b.family && (a.family !== 'enum' || a.enumId === b.enumId);
/** Finite, structured SQL expression semantics. No implicit string/numeric coercion or SQL parsing. */
export function nativeExpressionDecision(
  context: DatabaseContext,
  expression: NativeExpression,
  facts: NativeExpressionPolicyFacts,
): NativeExpressionDecision {
  getDatabaseProfile(context);
  const fail = (code: string): never => {
    throw new Error(code);
  };
  let budget = 1024;
  const infer = (node: NativeExpression, depth = 0): NativeExpressionType => {
    if (--budget < 0 || depth > 64) return fail('expression.too-complex');
    const descend = (child: NativeExpression) => infer(child, depth + 1);
    if (node.kind === 'null') return { family: 'null', nullable: true };
    if (node.kind === 'literal') {
      const decision = inspectNativeLiteralToken(node);
      if (!decision.allowed) return fail(decision.code!);
      return {
        family: (
          {
            number: 'number',
            string: 'string',
            boolean: 'boolean',
            binary: 'binary',
            json: 'json',
            typedText: 'unsupported',
          } as const
        )[node.literalType],
        ...(node.literalType === 'number' && {
          numeric: /^[+-]?\d+$/.test(String(node.value))
            ? ('integer' as const)
            : ('decimal' as const),
        }),
        nullable: false,
      };
    }
    if (node.kind === 'column') {
      if (facts.purpose === 'default') return fail('default.column-reference-not-supported');
      const column = facts.columns.find(
        (value) =>
          value.id === node.columnId &&
          value.tableId === facts.tableId &&
          value.scope !== 'logical',
      );
      if (!column) return fail('expression.column-not-found');
      const type = column.physical.type;
      if (type.kind === 'legacy' || type.database !== context.kind)
        return fail('expression.column-type-not-supported');
      const inferred = family(type);
      return { ...inferred, nullable: column.physical.nullable };
    }
    if (node.kind === 'isNull') {
      descend(node.operand);
      return { family: 'boolean', nullable: false };
    }
    if (node.kind === 'unary') {
      const operand = descend(node.operand);
      if (node.operator === 'NOT') {
        if (!['boolean', 'null'].includes(operand.family))
          return fail('expression.boolean-required');
        return { family: 'boolean', nullable: operand.nullable };
      }
      if (!['number', 'null'].includes(operand.family)) return fail('expression.numeric-required');
      return { ...operand, family: 'number' };
    }
    if (node.kind === 'in') {
      const operand = descend(node.operand),
        values = node.values.map(descend);
      if (
        !values.length ||
        values.some(
          (value) => value.family !== 'null' && operand.family !== 'null' && !same(operand, value),
        )
      )
        return fail('expression.comparison-type-mismatch');
      if (
        ![
          'null',
          'number',
          'string',
          'boolean',
          'uuid',
          'date',
          'time',
          'timestamp',
          'enum',
        ].includes(operand.family)
      )
        return fail('expression.comparison-not-supported');
      return {
        family: 'boolean',
        nullable: operand.nullable || values.some((value) => value.nullable),
      };
    }
    if (node.kind === 'binary') {
      const left = descend(node.left),
        right = descend(node.right),
        nullable = left.nullable || right.nullable;
      if (['AND', 'OR'].includes(node.operator)) {
        if (![left, right].every((value) => ['boolean', 'null'].includes(value.family)))
          return fail('expression.boolean-required');
        return { family: 'boolean', nullable };
      }
      if (['+', '-', '*', '/', '%'].includes(node.operator)) {
        if (![left, right].every((value) => ['number', 'null'].includes(value.family)))
          return fail('expression.numeric-required');
        if (
          ['/', '%'].includes(node.operator) &&
          node.right.kind === 'literal' &&
          node.right.literalType === 'number' &&
          Number(node.right.value) === 0
        )
          return fail('expression.division-by-zero');
        if (
          context.kind === 'postgresql' &&
          node.operator === '%' &&
          [left, right].some((value) => value.numeric === 'floating')
        )
          return fail('expression.operator-type-not-supported');
        const numeric = [left, right].some((value) => value.numeric === 'floating')
          ? 'floating'
          : [left, right].every((value) => value.numeric === 'integer') &&
              !(context.kind === 'mysql' && node.operator === '/')
            ? 'integer'
            : 'decimal';
        return { family: 'number', numeric, nullable };
      }
      if (left.family !== 'null' && right.family !== 'null' && !same(left, right))
        return fail('expression.comparison-type-mismatch');
      if (
        ![left, right].every((value) =>
          [
            'null',
            'number',
            'string',
            'boolean',
            'uuid',
            'date',
            'time',
            'timestamp',
            'enum',
          ].includes(value.family),
        )
      )
        return fail('expression.comparison-not-supported');
      return { family: 'boolean', nullable };
    }
    if (node.kind === 'call') {
      if (!node.functionId.startsWith(context.kind + ':'))
        return fail('expression.function-not-supported');
      const name = node.functionId.split(':')[1]!,
        args = node.args.map(descend);
      if (
        ['current_timestamp', 'current_date', 'current_time', 'gen_random_uuid', 'uuid'].includes(
          name,
        )
      ) {
        if (args.length) return fail('expression.function-arguments-invalid');
        if (facts.purpose !== 'default') return fail('expression.non-deterministic');
        return {
          family:
            context.kind === 'sqlite'
              ? 'string'
              : name === 'uuid'
                ? 'string'
                : name === 'gen_random_uuid'
                  ? 'uuid'
                  : name === 'current_date'
                    ? 'date'
                    : name === 'current_time'
                      ? 'time'
                      : 'timestamp',
          nullable: false,
        };
      }
      if (name === 'coalesce') {
        if (args.length < 2) return fail('expression.function-arguments-invalid');
        const present = args.filter((value) => value.family !== 'null'),
          result = present[0] ?? { family: 'null' as const, nullable: true };
        if (present.some((value) => !same(result, value)))
          return fail('expression.function-type-mismatch');
        const numeric = present.some((value) => value.numeric === 'floating')
          ? 'floating'
          : present.some((value) => value.numeric === 'decimal')
            ? 'decimal'
            : 'integer';
        return {
          ...result,
          ...(result.family === 'number' && { numeric }),
          nullable: args.every((value) => value.nullable),
        };
      }
      if (args.length !== 1) return fail('expression.function-arguments-invalid');
      const arg = args[0]!;
      if (name === 'abs') {
        if (!['number', 'null'].includes(arg.family)) return fail('expression.numeric-required');
        return { ...arg, family: 'number' };
      }
      if (name === 'lower' || name === 'upper') {
        if (!['string', 'null'].includes(arg.family)) return fail('expression.string-required');
        return { family: 'string', nullable: arg.nullable };
      }
      if (name === 'length') {
        if (!['string', 'binary', 'null'].includes(arg.family))
          return fail('expression.string-required');
        return { family: 'number', numeric: 'integer', nullable: arg.nullable };
      }
      return fail('expression.function-not-supported');
    }
    return fail('expression.not-supported');
  };
  try {
    const result = infer(expression);
    if (
      facts.purpose === 'default' &&
      result.family === 'null' &&
      (facts.nullable === false || facts.primary)
    )
      return { allowed: false, usable: false, code: 'default.null-not-supported' };
    if (
      (facts.purpose === 'check' || facts.purpose === 'predicate') &&
      !['boolean', 'null'].includes(result.family)
    )
      return { allowed: false, usable: false, code: 'expression.boolean-required' };
    if (facts.targetType) {
      const target = family(facts.targetType);
      const dynamicTarget =
        context.kind === 'sqlite' &&
        (!facts.strict ||
          (facts.targetType.kind === 'builtin' && facts.targetType.typeId === 'sqlite:any'));
      if (facts.targetType.kind === 'legacy' || facts.targetType.database !== context.kind)
        return { allowed: false, usable: false, code: 'expression.target-type-not-supported' };
      if (!dynamicTarget && (result.family === 'unsupported' || target.family === 'unsupported'))
        return { allowed: false, usable: false, code: 'expression.target-type-not-supported' };
      // General SQLite tables retain affinity without enforcing a storage class.
      if (
        !dynamicTarget &&
        result.family !== 'null' &&
        !same(target, result) &&
        !(
          target.family === 'number' &&
          result.family === 'boolean' &&
          context.kind !== 'postgresql'
        ) &&
        !(facts.targetType.kind === 'builtin' && facts.targetType.typeId === 'sqlite:any')
      )
        return { allowed: false, usable: false, code: 'expression.target-type-mismatch' };
    }
    return { allowed: true, usable: false, result };
  } catch (cause) {
    return {
      allowed: false,
      usable: false,
      code: cause instanceof Error ? cause.message : 'expression.not-supported',
    };
  }
}
