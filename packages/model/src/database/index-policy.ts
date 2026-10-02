import type { DatabaseContext } from './definitions.js';
import { getDatabaseProfile } from './profiles.js';
import { keyEligibility } from './key-policy.js';
import type { NativeColumnType } from './native-document.js';
import type { NativeExpressionType } from './expression-policy.js';
export type NativePostgresIndexMethod = 'btree' | 'hash' | 'gist' | 'spgist' | 'gin' | 'brin';
export interface NativeIndexMethodDecision {
  allowed: boolean;
  usable: false;
  code?: string;
}
const methods = new Set<NativePostgresIndexMethod>([
  'btree',
  'hash',
  'gist',
  'spgist',
  'gin',
  'brin',
]);
const ranges = ['int4range', 'int8range', 'numrange', 'tsrange', 'tstzrange', 'daterange'];
const multiranges = ranges.map((name) => name.replace('range', 'multirange'));
const defaults: Readonly<Record<string, readonly NativePostgresIndexMethod[]>> = {
  jsonb: ['btree', 'hash', 'gin'],
  boolean: ['btree', 'hash'],
  money: ['btree'],
  bit: ['btree', 'brin'],
  'bit varying': ['btree', 'brin'],
  point: ['gist', 'spgist'],
  box: ['gist', 'spgist', 'brin'],
  polygon: ['gist', 'spgist'],
  circle: ['gist'],
  tsvector: ['btree', 'gist', 'gin'],
  tsquery: ['btree', 'gist'],
  ...Object.fromEntries(
    ['varchar', 'text', 'inet', 'cidr'].map((name) => [
      name,
      ['btree', 'hash', 'spgist', 'brin'] as const,
    ]),
  ),
  ...Object.fromEntries(
    ranges.map((name) => [name, ['btree', 'hash', 'gist', 'spgist', 'brin'] as const]),
  ),
  ...Object.fromEntries(multiranges.map((name) => [name, ['btree', 'hash', 'gist'] as const])),
};
/** The PG18 built-in default opclasses, verified by actual declarations/index creation. */
export function nativePostgresIndexMethodDecision(
  context: DatabaseContext,
  method: NativePostgresIndexMethod,
  type?: NativeColumnType,
  result?: NativeExpressionType,
): NativeIndexMethodDecision {
  getDatabaseProfile(context);
  const reject = (code = 'index.type-not-supported'): NativeIndexMethodDecision => ({
    allowed: false,
    usable: false,
    code,
  });
  const allow = (): NativeIndexMethodDecision => ({ allowed: true, usable: false });
  if (context.kind !== 'postgresql' || !methods.has(method))
    return reject('index.method-not-supported');
  let accepted: readonly NativePostgresIndexMethod[];
  if (type) {
    if (type.kind === 'legacy' || type.database !== 'postgresql') return reject();
    if ('array' in type && type.array) {
      const scalar = { ...type };
      delete scalar.array;
      const btree = nativePostgresIndexMethodDecision(context, 'btree', scalar).allowed;
      if (!btree) return reject();
      accepted = [
        'btree',
        'gin',
        ...(nativePostgresIndexMethodDecision(context, 'hash', scalar).allowed
          ? ['hash' as const]
          : []),
      ];
    } else if (type.kind === 'projectEnum') accepted = ['btree', 'hash'];
    else if (type.kind === 'builtin') {
      const name = type.typeId.split(':')[1]!;
      accepted =
        defaults[name] ??
        (keyEligibility(context, type).uniqueAllowed ? ['btree', 'hash', 'brin'] : []);
    } else return reject();
  } else if (result) {
    accepted =
      result.family === 'boolean'
        ? ['btree', 'hash']
        : result.family === 'string'
          ? ['btree', 'hash', 'spgist', 'brin']
          : result.family === 'number' ||
              ['uuid', 'binary', 'date', 'time', 'timestamp'].includes(result.family)
            ? ['btree', 'hash', 'brin']
            : result.family === 'json' && result.jsonKind === 'jsonb'
              ? ['btree', 'hash', 'gin']
              : result.family === 'enum'
                ? ['btree', 'hash']
                : [];
  } else return reject('index.expression-result-required');
  return accepted.includes(method) ? allow() : reject();
}
