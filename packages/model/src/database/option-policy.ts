import type { DatabaseContext } from './definitions.js';
import { checkDatabaseFeature, type DatabaseFeatureFacts } from './features.js';
import { getDatabaseProfile } from './profiles.js';
import {
  nativeExpressionColumnIds,
  type NativeColumn,
  type NativeColumnType,
  type NativeExpression,
  type NativeGeneration,
} from './native-document.js';
import { nativeExpressionDecision } from './expression-policy.js';

export interface NativeColumnOptionDecision {
  allowed: boolean;
  usable: false;
  code?: string;
  category?: 'invalid' | 'unsupported' | 'environment';
}
const allow = (): NativeColumnOptionDecision => ({ allowed: true, usable: false });
const reject = (
  code: string,
  category: NativeColumnOptionDecision['category'] = 'invalid',
): NativeColumnOptionDecision => ({
  allowed: false,
  usable: false,
  code,
  ...(category && { category }),
});
export interface NativeBuiltinDefaultFacts {
  strict?: boolean;
  generation?: NativeGeneration;
  nullable?: boolean;
}
/** A constrained zero-argument default policy; complex result typing is separate. */
export function nativeBuiltinDefaultDecision(
  context: DatabaseContext,
  type: NativeColumnType,
  expression: NativeExpression,
  facts: NativeBuiltinDefaultFacts = {},
): NativeColumnOptionDecision {
  getDatabaseProfile(context);
  if (type.kind === 'legacy' || type.database !== context.kind)
    return reject('type.not-supported', 'unsupported');
  if (facts.generation && facts.generation.kind !== 'none')
    return reject('generation.default-not-supported');
  if (
    expression.kind !== 'call' ||
    !['current_timestamp', 'current_date', 'current_time', 'gen_random_uuid', 'uuid'].includes(
      expression.functionId.split(':')[1]!,
    )
  ) {
    const decision = nativeExpressionDecision(context, expression, {
      columns: [],
      tableId: '',
      purpose: 'default',
      targetType: type,
      ...(facts.strict !== undefined && { strict: facts.strict }),
      ...(facts.nullable !== undefined && { nullable: facts.nullable }),
    });
    return decision.allowed
      ? allow()
      : reject(decision.code ?? 'default.expression-validation-required', 'unsupported');
  }
  if (!expression.functionId.startsWith(context.kind + ':'))
    return reject('expression.function-not-supported', 'unsupported');
  if (expression.args.length) return reject('expression.function-arguments-invalid');
  const functionName = expression.functionId.split(':')[1]!;
  if (context.kind === 'sqlite') {
    if (!['current_timestamp', 'current_date', 'current_time'].includes(functionName))
      return reject('default.expression-validation-required', 'unsupported');
    if (
      facts.strict &&
      (type.kind !== 'builtin' || !['sqlite:text', 'sqlite:any'].includes(type.typeId))
    )
      return reject('default.type-mismatch');
    return allow();
  }
  if (type.kind !== 'builtin' || (type.database === 'postgresql' && type.array !== undefined))
    return reject('default.type-mismatch');
  const name = type.typeId.split(':')[1]!;
  const valid =
    context.kind === 'postgresql'
      ? functionName === 'gen_random_uuid'
        ? name === 'uuid'
        : functionName === 'current_timestamp'
          ? ['timestamp', 'timestamptz'].includes(name)
          : functionName === 'current_date'
            ? name === 'date'
            : functionName === 'current_time'
              ? ['time', 'timetz'].includes(name)
              : false
      : functionName === 'current_timestamp'
        ? ['timestamp', 'datetime'].includes(name)
        : functionName === 'current_date'
          ? name === 'date'
          : functionName === 'current_time'
            ? name === 'time'
            : functionName === 'uuid'
              ? /^(char|varchar|(tiny|medium|long)?text)$/.test(name) &&
                (!('length' in type.parameters) ||
                  type.parameters.length === undefined ||
                  type.parameters.length >= 36)
              : false;
  return valid
    ? allow()
    : reject(
        ['lower', 'upper', 'length', 'abs', 'coalesce'].includes(functionName)
          ? 'default.expression-validation-required'
          : 'default.type-mismatch',
      );
}
export function nativeOnUpdateDecision(
  context: DatabaseContext,
  type: NativeColumnType,
  expression: NativeExpression,
  generation: NativeGeneration = { kind: 'none' },
): NativeColumnOptionDecision {
  getDatabaseProfile(context);
  if (
    context.kind !== 'mysql' ||
    type.kind !== 'builtin' ||
    type.database !== 'mysql' ||
    !['mysql:datetime', 'mysql:timestamp'].includes(type.typeId)
  )
    return reject('column.on-update-not-supported', 'unsupported');
  if (generation.kind !== 'none') return reject('generation.on-update-not-supported');
  if (expression.kind !== 'call' || expression.functionId !== 'mysql:current_timestamp')
    return reject('column.on-update-not-supported', 'unsupported');
  if (expression.args.length) return reject('expression.function-arguments-invalid');
  return allow();
}
/** Exact sequence boundaries, preserving the supplied tokens rather than normalizing them. */
export interface NativeGenerationFacts extends DatabaseFeatureFacts {
  nullable?: boolean;
  columns?: readonly NativeColumn[];
  tableId?: string;
}
export function nativeGenerationDecision(
  context: DatabaseContext,
  type: NativeColumnType,
  generation: NativeGeneration,
  facts: NativeGenerationFacts = {},
): NativeColumnOptionDecision {
  getDatabaseProfile(context);
  if (generation.kind === 'none') return allow();
  if (
    generation.database !== context.kind ||
    type.kind === 'legacy' ||
    type.database !== context.kind
  )
    return reject('generation.context-mismatch', 'unsupported');
  if (facts.nullable && generation.kind !== 'computed')
    return reject('generation.nullability-mismatch');
  if (facts.hasDefault) return reject('generation.default-not-supported');
  if (generation.kind === 'computed') {
    const support = checkDatabaseFeature(
      context,
      generation.storage === 'stored' ? 'generatedStored' : 'generatedVirtual',
      facts,
    );
    if (!support.supported)
      return reject(support.code ?? 'generation.storage-not-supported', 'unsupported');
    if (
      context.kind === 'postgresql' &&
      generation.storage === 'virtual' &&
      (type.kind === 'projectEnum' ||
        nativeExpressionColumnIds(generation.expression).some(
          (id) =>
            facts.columns?.find((column) => column.id === id)?.physical.type.kind === 'projectEnum',
        ))
    )
      return reject('generation.virtual-type-not-supported', 'unsupported');
    const decision = nativeExpressionDecision(context, generation.expression, {
      columns: facts.columns ?? [],
      tableId: facts.tableId ?? '',
      purpose: 'computed',
      targetType: type,
      ...(facts.strict !== undefined && { strict: facts.strict }),
    });
    return decision.allowed
      ? allow()
      : reject(decision.code ?? 'generation.expression-validation-required', 'unsupported');
  }
  const support = checkDatabaseFeature(context, generation.kind, {
    ...facts,
    ...(type.kind === 'builtin' && { typeId: type.typeId }),
    array: type.kind === 'builtin' && type.database === 'postgresql' && type.array !== undefined,
  });
  if (!support.supported)
    return reject(support.code ?? 'generation.type-not-supported', 'unsupported');
  if (generation.kind !== 'identity' || !generation.sequence) return allow();
  if (type.kind !== 'builtin' || type.database !== 'postgresql')
    return reject('generation.type-not-supported');
  const widths: Record<string, number> = {
    'postgresql:smallint': 16,
    'postgresql:integer': 32,
    'postgresql:bigint': 64,
  };
  const width = widths[type.typeId];
  if (!width) return reject('generation.type-not-supported');
  const floor = -(1n << BigInt(width - 1)),
    ceiling = (1n << BigInt(width - 1)) - 1n;
  const parse = (value: string): bigint => {
    if (!/^[+-]?\d+$/.test(value) || value.length > 100) throw Error('invalid');
    return BigInt(value);
  };
  try {
    const sequence = generation.sequence,
      increment = sequence.increment === undefined ? 1n : parse(sequence.increment);
    if (increment === 0n || increment < -(1n << 63n) || increment > (1n << 63n) - 1n)
      return reject('generation.sequence-increment-invalid');
    const min = sequence.min === undefined ? (increment > 0n ? 1n : floor) : parse(sequence.min);
    const max = sequence.max === undefined ? (increment > 0n ? ceiling : -1n) : parse(sequence.max);
    const start =
      sequence.start === undefined ? (increment > 0n ? min : max) : parse(sequence.start);
    if (min < floor || max > ceiling || min >= max || start < min || start > max)
      return reject('generation.sequence-range-invalid');
    if (
      sequence.cache !== undefined &&
      (!Number.isInteger(sequence.cache) || sequence.cache < 1 || sequence.cache > 2147483647)
    )
      return reject('generation.sequence-cache-invalid');
    return allow();
  } catch {
    return reject('generation.sequence-invalid');
  }
}
