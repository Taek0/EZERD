import {
  inspectNativeLiteralToken,
  keyEligibility,
  literalDecision,
  nativeBuiltinFunctionIds,
  nativeBuiltinDefaultDecision,
  nativeOnUpdateDecision,
  nativeGenerationDecision,
  type NativeColumnOptionDecision,
  type NativeColumn,
  type NativeDefaultValue,
  type NativeDesignDocument,
  type NativeGeneration,
  type NativeExpression,
  type NativeLiteral,
  type NativeTable,
} from '@ezerd/model';
import { nativeDefaultValueSchema, nativeGenerationSchema } from '@ezerd/contracts';

export interface NativeOptionDecision {
  engineAllowed: boolean;
  productUsable: boolean;
  code?: string;
  category?: 'invalid' | 'unsupported' | 'environment';
  format?: string;
}
export const nativeLiteralKinds = [
  'string',
  'number',
  'json',
  'binary',
  'boolean',
  'typedText',
] as const;
export function nativeExactBoolean(token: string): boolean {
  if (token !== 'true' && token !== 'false') throw new Error('native.boolean-token-incomplete');
  return token === 'true';
}
export function nativeBoundedInteger(token: string, min: number, max: number): number {
  if (!/^[+-]?\d+$/.test(token) || token.length > 100)
    throw new Error('native.integer-token-incomplete');
  const number = Number(token);
  if (!Number.isSafeInteger(number) || number < min || number > max)
    throw new Error('native.integer-token-out-of-range');
  return number;
}
/** Retain the exact string: parsing is validation, never normalization of a draft. */
export function nativeLiteralFromToken(
  kind: NativeLiteral['literalType'],
  token: string,
): NativeLiteral {
  const value: NativeLiteral =
    kind === 'boolean'
      ? { kind: 'literal', literalType: kind, value: nativeExactBoolean(token) }
      : { kind: 'literal', literalType: kind, value: token };
  const inspected = inspectNativeLiteralToken(value);
  // typedText is checked with its explicit destination below, never as an untyped AST literal.
  if (!inspected.allowed && inspected.code !== 'literal.target-type-required')
    throw new Error(inspected.code);
  return value;
}
export function nativeLiteralPolicy(
  document: NativeDesignDocument,
  table: NativeTable,
  column: NativeColumn,
  value: NativeDefaultValue,
  nullable = column.physical.nullable,
): NativeOptionDecision {
  const type = column.physical.type;
  const decision = literalDecision(document.database, type, value, {
    nullable,
    primary: (document.keys ?? []).some(
      (key) =>
        key.tableId === table.id &&
        key.scope !== 'logical' &&
        key.kind === 'primary' &&
        key.columnIds.includes(column.id),
    ),
    strict: table.physical.options.database === 'sqlite' && table.physical.options.strict,
    ...(type.kind === 'projectEnum'
      ? { enumValues: document.enums?.find((item) => item.id === type.enumId)?.values ?? [] }
      : {}),
  });
  return {
    engineAllowed: decision.allowed,
    productUsable: decision.allowed && decision.usable,
    ...(decision.code
      ? { code: decision.code }
      : !decision.usable
        ? { code: 'default.not-ready' }
        : {}),
    ...(decision.category && { category: decision.category }),
    ...(decision.format && { format: decision.format }),
  };
}
/** Representative hints are checked by the model; they are not defaults or general parser claims. */
function literalProbe(
  document: NativeDesignDocument,
  column: NativeColumn,
  kind: NativeLiteral['literalType'],
): string {
  const type = column.physical.type;
  if (kind === 'boolean') return 'false';
  if (kind === 'number') return '0';
  if (kind === 'binary') return '';
  if (kind === 'json') return '{}';
  if (kind === 'string') {
    if (type.kind === 'valueList') return type.values[0] ?? '';
    if (type.kind === 'projectEnum')
      return document.enums?.find((item) => item.id === type.enumId)?.values[0] ?? '';
    if (
      type.kind === 'builtin' &&
      ['postgresql:bit', 'postgresql:bit varying'].includes(type.typeId)
    )
      return '0'.repeat(
        Math.max(
          1,
          Math.min(1024, 'bitLength' in type.parameters ? (type.parameters.bitLength ?? 1) : 1),
        ),
      );
    return '';
  }
  if (type.kind !== 'builtin') return '';
  const name = type.typeId.split(':')[1]!;
  const hints: Record<string, string> = {
    uuid: '00000000-0000-4000-8000-000000000001',
    date: '2024-01-01',
    time: '00:00:00',
    timetz: '00:00:00+00:00',
    year: '2024',
    datetime: '2024-01-01 00:00:00',
    timestamp: '2024-01-01 00:00:00',
    timestamptz: '2024-01-01T00:00:00Z',
    interval: '0 days 00:00:00',
    point: '(0,0)',
    line: '{1,0,0}',
    lseg: '[(0,0),(1,1)]',
    box: '(1,1),(0,0)',
    path: '[(0,0),(1,1)]',
    polygon: '((0,0),(1,0),(0,1))',
    circle: '<(0,0),1>',
    inet: '127.0.0.1',
    cidr: '127.0.0.0/8',
    macaddr: '00:00:00:00:00:00',
    macaddr8: '00:00:00:00:00:00:00:00',
    oid: '0',
    pg_lsn: '0/0',
  };
  return name.endsWith('range') ? 'empty' : (hints[name] ?? '');
}
export function nativeDefaultChoices(
  document: NativeDesignDocument,
  table: NativeTable,
  column: NativeColumn,
) {
  const current = column.physical.defaultValue;
  const currentChoice =
    current.kind === 'literal' ? `literal:${current.literalType}` : current.kind;
  return ['none', 'null', ...nativeLiteralKinds.map((kind) => `literal:${kind}`)].map((choice) => {
    const kind = choice.slice(8) as NativeLiteral['literalType'];
    const sample = choice.startsWith('literal:') ? literalProbe(document, column, kind) : '';
    let decision: NativeOptionDecision;
    try {
      const value: NativeDefaultValue =
        choice === 'none' || choice === 'null'
          ? { kind: choice }
          : nativeLiteralFromToken(kind, sample);
      decision = nativeLiteralPolicy(document, table, column, value);
    } catch (error) {
      // A bad stored enum label must not break read-only/current-value presentation.
      decision = {
        engineAllowed: false,
        productUsable: false,
        category: 'invalid',
        code: error instanceof Error ? error.message : 'literal.string-invalid',
      };
    }
    return {
      choice,
      sample,
      ...decision,
      preserved: choice === currentChoice,
      selectable: choice === 'none' || choice === currentChoice || decision.productUsable,
    };
  });
}
export function nativeDefaultInput(
  document: NativeDesignDocument,
  table: NativeTable,
  column: NativeColumn,
  choice: string,
  token: string,
  nullable: boolean,
): { value: NativeDefaultValue; decision: NativeOptionDecision } {
  if (choice === 'none')
    return { value: { kind: 'none' }, decision: { engineAllowed: true, productUsable: false } };
  if (choice !== 'null' && !nativeLiteralKinds.some((kind) => choice === `literal:${kind}`))
    throw new Error('native.default-kind-invalid');
  const value: NativeDefaultValue =
    choice === 'null'
      ? { kind: 'null' }
      : nativeLiteralFromToken(choice.slice(8) as NativeLiteral['literalType'], token);
  const decision = nativeLiteralPolicy(document, table, column, value, nullable);
  if (!decision.engineAllowed) throw new Error(decision.code ?? 'default.literal-not-supported');
  return { value: nativeDefaultValueSchema.parse(value), decision };
}
export function nativeKeyColumnPolicies(
  document: NativeDesignDocument,
  table: NativeTable,
  kind: 'primary' | 'unique',
  preservedIds: readonly string[] = [],
) {
  return (document.columns ?? [])
    .filter(
      (column) =>
        column.tableId === table.id &&
        (preservedIds.includes(column.id) ||
          (column.scope !== 'logical' &&
            column.physical.type.kind !== 'legacy' &&
            column.physical.type.database === document.database.kind)),
    )
    .map((column) => {
      const options = column.physical.options;
      const tableOptions = table.physical.options;
      const eligibility = keyEligibility(document.database, column.physical.type, {
        generation: column.physical.generation,
        ...(options.database === 'mysql' && tableOptions.database === 'mysql'
          ? { charset: options.charset ?? tableOptions.charset ?? 'utf8mb4' }
          : {}),
      });
      const visible = table.scope !== 'logical' && column.scope !== 'logical';
      const engineAllowed =
        visible && (kind === 'primary' ? eligibility.primaryAllowed : eligibility.uniqueAllowed);
      return {
        column,
        eligibility,
        engineAllowed,
        productUsable: engineAllowed && eligibility.usable,
        code: !visible
          ? 'document.scope-mismatch'
          : !engineAllowed
            ? (eligibility.code ?? 'key.type-not-supported')
            : 'key.not-ready',
        preserved: preservedIds.includes(column.id),
      };
    });
}
export function nativeKeyInput(
  document: NativeDesignDocument,
  table: NativeTable,
  kind: 'primary' | 'unique',
  ids: string[],
) {
  if (!ids.length || ids.some((id) => !id) || new Set(ids).size !== ids.length)
    throw new Error('key.columns-invalid');
  const choices = nativeKeyColumnPolicies(document, table, kind);
  const selected = ids.map((id) => {
    const choice = choices.find((item) => item.column.id === id);
    if (!choice?.engineAllowed) throw new Error(choice?.code ?? 'key.columns-invalid');
    return choice;
  });
  if (
    document.database.kind === 'mysql' &&
    selected.reduce((sum, item) => sum + (item.eligibility.estimatedBytes ?? 0), 0) > 3072
  )
    throw new Error('key.length-exceeded');
  return selected;
}

const noArgumentFunctions = new Set([
  'current_timestamp',
  'current_date',
  'current_time',
  'gen_random_uuid',
  'uuid',
]);
export function nativeBuiltinFunctionChoices(document: NativeDesignDocument) {
  return nativeBuiltinFunctionIds
    .filter((id) => id.startsWith(`${document.database.kind}:`))
    .map((id) => ({
      id,
      requiresArguments: !noArgumentFunctions.has(id.split(':')[1]!),
    }));
}
export function nativeBuiltinDefaultInput(
  document: NativeDesignDocument,
  functionId: string,
): NativeDefaultValue {
  const choice = nativeBuiltinFunctionChoices(document).find((item) => item.id === functionId);
  if (!choice) throw new Error('expression.function-not-supported');
  if (choice.requiresArguments) throw new Error('expression.function-arguments-required');
  return nativeDefaultValueSchema.parse({
    kind: 'expression',
    expression: { kind: 'call', functionId: choice.id, args: [] },
  });
}
export function nativeOnUpdateInput(
  document: NativeDesignDocument,
  functionId: string,
): NativeExpression {
  if (document.database.kind !== 'mysql') throw new Error('column.on-update-not-supported');
  const candidate = nativeBuiltinDefaultInput(document, functionId);
  if (candidate.kind !== 'expression') throw new Error('column.on-update-not-supported');
  return candidate.expression;
}
export const nativeIdentityFields = ['start', 'increment', 'min', 'max', 'cache', 'cycle'] as const;
export function nativeIdentityInitial(generation: NativeGeneration): Record<string, string> {
  return Object.fromEntries(
    nativeIdentityFields.map((field) => [
      `identity:${field}`,
      generation.kind === 'identity' && generation.sequence?.[field] !== undefined
        ? String(generation.sequence[field])
        : '',
    ]),
  );
}
export function nativeIdentityInput(
  values: Record<string, string>,
  before: Record<string, string>,
  original: NativeGeneration,
): NativeGeneration {
  const sequence = original.kind === 'identity' ? { ...original.sequence } : {};
  for (const field of nativeIdentityFields) {
    const token = values[`identity:${field}`] ?? '';
    if (token === (before[`identity:${field}`] ?? '')) continue;
    if (!token) {
      delete sequence[field];
      continue;
    }
    if (field === 'cache') sequence.cache = nativeBoundedInteger(token, 1, 2147483647);
    else if (field === 'cycle') sequence.cycle = nativeExactBoolean(token);
    else {
      if (!/^[+-]?\d+$/.test(token) || token.length > 100)
        throw new Error('native.integer-token-incomplete');
      sequence[field] = token;
    }
  }
  if (values.identityMode !== 'always' && values.identityMode !== 'byDefault')
    throw new Error('generation.identity-mode-invalid');
  const candidate: NativeGeneration = {
    kind: 'identity',
    database: 'postgresql',
    mode: values.identityMode,
    ...(Object.keys(sequence).length || (original.kind === 'identity' && original.sequence)
      ? { sequence }
      : {}),
  };
  nativeGenerationSchema.parse(candidate);
  return candidate;
}
function columnOptionPolicy(
  decision: NativeColumnOptionDecision,
  area: string,
): NativeOptionDecision {
  return {
    engineAllowed: decision.allowed,
    productUsable: decision.allowed && decision.usable,
    ...(decision.code
      ? { code: decision.code }
      : !decision.usable
        ? { code: `${area}.not-ready` }
        : {}),
    ...(decision.category && { category: decision.category }),
  };
}
export function nativeBuiltinDefaultPolicy(
  document: NativeDesignDocument,
  table: NativeTable,
  column: NativeColumn,
  expression: NativeExpression,
  facts: { nullable?: boolean; generation?: NativeGeneration } = {},
): NativeOptionDecision {
  return columnOptionPolicy(
    nativeBuiltinDefaultDecision(document.database, column.physical.type, expression, {
      strict: table.physical.options.database === 'sqlite' && table.physical.options.strict,
      generation: facts.generation ?? column.physical.generation,
      nullable: facts.nullable ?? column.physical.nullable,
    }),
    'default',
  );
}
export function nativeOnUpdatePolicy(
  document: NativeDesignDocument,
  column: NativeColumn,
  expression: NativeExpression,
  generation = column.physical.generation,
): NativeOptionDecision {
  return columnOptionPolicy(
    nativeOnUpdateDecision(document.database, column.physical.type, expression, generation),
    'column.on-update',
  );
}
export function nativeGenerationPolicy(
  document: NativeDesignDocument,
  table: NativeTable,
  column: NativeColumn,
  generation: NativeGeneration,
  facts: { nullable?: boolean; hasDefault?: boolean } = {},
): NativeOptionDecision {
  const keys = (document.keys ?? []).filter(
    (item) => item.tableId === table.id && item.scope !== 'logical',
  );
  const primary = keys.find(
    (item) => item.kind === 'primary' && item.columnIds.includes(column.id),
  );
  const indexes = (document.indexes ?? []).filter(
    (item) => item.tableId === table.id && item.scope !== 'logical',
  );
  return columnOptionPolicy(
    nativeGenerationDecision(document.database, column.physical.type, generation, {
      columns: document.columns ?? [],
      tableId: table.id,
      strict: table.physical.options.database === 'sqlite' && table.physical.options.strict,
      nullable: facts.nullable ?? column.physical.nullable,
      hasDefault: facts.hasDefault ?? column.physical.defaultValue.kind !== 'none',
      isPrimaryKeyColumn: !!primary,
      primaryKeyColumns: primary?.columnIds.length ?? 0,
      withoutRowid:
        table.physical.options.database === 'sqlite' && table.physical.options.withoutRowid,
      indexed:
        keys.some((key) => key.columnIds.includes(column.id)) ||
        indexes.some((index) =>
          index.parts.some(
            (part) => part.expression.kind === 'column' && part.expression.columnId === column.id,
          ),
        ),
      firstIndexColumn:
        keys.some((key) => key.columnIds[0] === column.id) ||
        indexes.some(
          (index) =>
            index.parts[0]?.expression.kind === 'column' &&
            index.parts[0].expression.columnId === column.id,
        ),
      otherAutoIncrementColumns: (document.columns ?? []).filter(
        (item) =>
          item.tableId === table.id &&
          item.scope !== 'logical' &&
          item.id !== column.id &&
          item.physical.generation.kind === 'autoIncrement',
      ).length,
    }),
    'generation',
  );
}
export function nativeFunctionOptionPolicies(
  document: NativeDesignDocument,
  table: NativeTable,
  column: NativeColumn,
  purpose: 'default' | 'onUpdate',
) {
  return nativeBuiltinFunctionChoices(document).map((item) => ({
    ...item,
    ...(purpose === 'default'
      ? nativeBuiltinDefaultPolicy(document, table, column, {
          kind: 'call',
          functionId: item.id,
          args: [],
        })
      : nativeOnUpdatePolicy(document, column, { kind: 'call', functionId: item.id, args: [] })),
  }));
}
