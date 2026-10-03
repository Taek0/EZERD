import { getDatabaseType, validateDatabaseTypeParameters } from './catalog.js';
import type { DatabaseContext } from './definitions.js';
import type { NativeColumnType, NativeLiteral } from './native-document.js';
import { getDatabaseProfile } from './profiles.js';

/** Engine subset only. Reference resolution, AST checks and registry readiness stay with callers. */
export interface PostgresBoundedTypedLiteralDecision {
  allowed: boolean;
  format?:
    'pg-search-single-lexeme' | 'pg-empty-multirange' | 'pg-snapshot-counters' | 'pg-empty-array';
  code?: string;
  category?: 'invalid' | 'unsupported' | 'environment';
}
const yes = (
  format: NonNullable<PostgresBoundedTypedLiteralDecision['format']>,
): PostgresBoundedTypedLiteralDecision => ({ allowed: true, format });
const no = (
  code: string,
  category: PostgresBoundedTypedLiteralDecision['category'] = 'invalid',
): PostgresBoundedTypedLiteralDecision => ({ allowed: false, code, category });
const multiranges = new Set([
  'postgresql:int4multirange',
  'postgresql:int8multirange',
  'postgresql:nummultirange',
  'postgresql:tsmultirange',
  'postgresql:tstzmultirange',
  'postgresql:datemultirange',
]);
const maxCounter = (1n << 64n) - 1n;
const maxXip = 128;

/** Canonical syntax avoids normalization/duplicate removal and keeps every comparison exact. */
function snapshot(s: string): PostgresBoundedTypedLiteralDecision {
  if (s.length > 21 * (maxXip + 2)) return no('default.pg-snapshot-subset-limit', 'unsupported');
  const parts = s.split(':');
  if (parts.length !== 3) return no('default.pg-snapshot-invalid');
  const counter = (token: string) => /^[1-9][0-9]{0,19}$/.test(token);
  if (!counter(parts[0]!) || !counter(parts[1]!)) return no('default.pg-snapshot-counter-invalid');
  const xmin = BigInt(parts[0]!),
    xmax = BigInt(parts[1]!);
  if (
    xmin > maxCounter ||
    xmax > maxCounter ||
    xmin > xmax ||
    (xmin & 0xffffffffn) === 0n ||
    (xmax & 0xffffffffn) === 0n
  )
    return no('default.pg-snapshot-counter-invalid');
  const xip = parts[2] === '' ? [] : parts[2]!.split(',');
  if (xip.length > maxXip) return no('default.pg-snapshot-subset-limit', 'unsupported');
  let previous = 0n;
  for (const token of xip) {
    if (!counter(token)) return no('default.pg-snapshot-xip-invalid');
    const xid = BigInt(token);
    if (xid < xmin || xid >= xmax || xid > maxCounter || (xid & 0xffffffffn) === 0n)
      return no('default.pg-snapshot-xip-invalid');
    if (xid <= previous) return no('default.pg-snapshot-xip-order-unsupported', 'unsupported');
    previous = xid;
  }
  return yes('pg-snapshot-counters');
}

/**
 * null means an unowned scalar, never permission to cast it. Only an explicitly identified,
 * valid PG18 type and typedText token can match. No SQL, normalization or readiness promotion.
 * Empty project ENUM arrays still require the caller's enum reference existence validation.
 */
export function inspectPostgresBoundedTypedLiteral(
  context: DatabaseContext,
  type: NativeColumnType,
  literal: NativeLiteral,
): PostgresBoundedTypedLiteralDecision | null {
  try {
    getDatabaseProfile(context);
  } catch {
    return no('database.profile-unsupported', 'unsupported');
  }
  if (context.kind !== 'postgresql' || type.kind === 'legacy' || type.database !== 'postgresql')
    return no('type.not-supported', 'unsupported');
  if (type.kind !== 'builtin' && type.kind !== 'projectEnum')
    return no('type.not-supported', 'unsupported');
  const definition = type.kind === 'builtin' ? getDatabaseType(type.typeId) : undefined;
  if (type.kind === 'builtin') {
    if (!definition || definition.databaseKind !== 'postgresql')
      return no('type.not-supported', 'unsupported');
    if (validateDatabaseTypeParameters(definition, type.parameters).length)
      return no('type.parameter-invalid');
  }
  const array = type.array;
  if (
    !array &&
    (type.kind === 'projectEnum' ||
      ![
        'postgresql:tsvector',
        'postgresql:tsquery',
        'postgresql:pg_snapshot',
        'postgresql:txid_snapshot',
        ...multiranges,
      ].includes(type.typeId))
  )
    return null;
  if (definition?.deprecated) return no('default.deprecated-type-unsupported', 'unsupported');
  if (array) {
    if (!Number.isInteger(array.dimensions) || array.dimensions < 1 || array.dimensions > 6)
      return no('type.array-dimensions-invalid');
    if (type.kind === 'projectEnum' && !type.enumId) return no('type.enum-not-found');
    if (
      definition &&
      (!definition.array || definition.sqlName.startsWith('reg') || definition.category === 'money')
    )
      return no('default.environment-value-unverified', 'environment');
  }
  if (literal.kind !== 'literal' || literal.literalType !== 'typedText')
    return no('default.type-mismatch');
  if (
    typeof literal.value !== 'string' ||
    literal.value.includes('\0') ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(literal.value)
  )
    return no('literal.string-invalid');
  const s = literal.value;
  if (array)
    return s === '{}'
      ? yes('pg-empty-array')
      : no('default.array-literal-not-supported', 'unsupported');
  if (type.kind !== 'builtin') return null;
  if (multiranges.has(type.typeId))
    return s === '{}'
      ? yes('pg-empty-multirange')
      : no('default.pg-multirange-subset-unsupported', 'unsupported');
  if (type.typeId === 'postgresql:pg_snapshot') return snapshot(s);
  return /^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(s)
    ? yes('pg-search-single-lexeme')
    : no('default.pg-search-subset-unsupported', 'unsupported');
}
