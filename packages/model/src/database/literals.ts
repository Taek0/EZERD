import { getDatabaseType, validateDatabaseTypeParameters } from './catalog.js';
import type { DatabaseContext } from './definitions.js';
import type { NativeColumnType, NativeDefaultValue, NativeLiteral } from './native-document.js';
import { getDatabaseProfile } from './profiles.js';

export interface NativeLiteralDecision {
  allowed: boolean;
  usable: false;
  coverage: false;
  code?: string;
  category?: 'invalid' | 'unsupported' | 'environment';
  /** Explicit supported input subset; never a claim of a complete engine parser. */
  format?: string;
}
export interface NativeLiteralFacts {
  nullable?: boolean;
  primary?: boolean;
  strict?: boolean;
  enumValues?: readonly string[];
}
const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const integer = /^[+-]?\d+$/;
const ok = (format: string): NativeLiteralDecision => ({
  allowed: true,
  usable: false,
  coverage: false,
  format,
});
const no = (
  code: string,
  category: NativeLiteralDecision['category'] = 'invalid',
): NativeLiteralDecision => ({ allowed: false, usable: false, coverage: false, code, category });
const bytes = (s: string) =>
  [...s].reduce(
    (n, c) =>
      n +
      (c.codePointAt(0)! <= 127
        ? 1
        : c.codePointAt(0)! <= 2047
          ? 2
          : c.codePointAt(0)! <= 65535
            ? 3
            : 4),
    0,
  );
const boundedInteger = (s: string, low: bigint, high: bigint) =>
  integer.test(s) &&
  s.replace(/^[+-]?0*/, '').length <= high.toString().length &&
  BigInt(s) >= low &&
  BigInt(s) <= high;

/** Literal token checks for AST nodes without trusting a destination cast. */
export function inspectNativeLiteralToken(literal: NativeLiteral): NativeLiteralDecision {
  if (literal.literalType === 'boolean')
    return typeof literal.value === 'boolean' ? ok('boolean') : no('literal.boolean-invalid');
  if (typeof literal.value !== 'string') return no('literal.string-invalid');
  const s = literal.value;
  if (
    s.includes('\0') ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s)
  )
    return no('literal.string-invalid');
  if (literal.literalType === 'number' && !numeric.test(s)) return no('literal.number-invalid');
  if (literal.literalType === 'binary' && !/^(?:[a-f\d]{2})*$/i.test(s))
    return no('literal.binary-invalid');
  if (literal.literalType === 'json') {
    try {
      JSON.parse(s);
    } catch {
      return no('literal.json-invalid');
    }
  }
  if (literal.literalType === 'typedText') return no('literal.target-type-required', 'unsupported');
  return ok(literal.literalType);
}

/** DB semantics only. Structure/reference validation and product readiness stay separate. */
export function literalDecision(
  context: DatabaseContext,
  type: NativeColumnType,
  value: NativeDefaultValue,
  facts: NativeLiteralFacts = {},
): NativeLiteralDecision {
  try {
    getDatabaseProfile(context);
  } catch {
    return no('database.profile-unsupported', 'unsupported');
  }
  if (type.kind === 'legacy') return no('legacy.type-unresolved', 'unsupported');
  if (type.database !== context.kind) return no('type.not-supported', 'unsupported');
  const definition =
    (type.kind === 'builtin' || type.kind === 'valueList') && getDatabaseType(type.typeId);
  if (
    (type.kind === 'builtin' || type.kind === 'valueList') &&
    (!definition || definition.databaseKind !== context.kind)
  )
    return no('type.not-supported', 'unsupported');
  if (
    type.kind === 'builtin' &&
    definition &&
    validateDatabaseTypeParameters(definition, type.parameters).length
  )
    return no('type.parameter-invalid');
  if (type.kind === 'builtin' && definition && definition.category === 'value-list')
    return no('type.value-list-required', 'unsupported');
  if (value.kind === 'none') return ok('none');
  if (value.kind === 'null')
    return facts.nullable === false || facts.primary
      ? no('default.null-not-supported')
      : ok('null');
  if (value.kind === 'legacyExpression') return no('legacy.default-unresolved', 'unsupported');
  if ('array' in type && type.array)
    return no('default.array-literal-not-supported', 'unsupported');
  if (value.kind === 'expression')
    return no('default.expression-validation-required', 'unsupported');
  const token = inspectNativeLiteralToken(value);
  if (!token.allowed && token.code !== 'literal.target-type-required') return token;
  const mismatch = () => no('default.type-mismatch');
  if (type.kind === 'projectEnum')
    return value.literalType === 'string' && facts.enumValues?.includes(value.value)
      ? ok('enum-label')
      : no('default.enum-value-invalid');
  if (type.kind === 'valueList') {
    if (value.literalType !== 'string') return mismatch();
    if (type.typeId === 'mysql:enum')
      return type.values.includes(value.value)
        ? ok('enum-label')
        : no('default.enum-value-invalid');
    const values = value.value === '' ? [] : value.value.split(',');
    return new Set(values).size === values.length && values.every((v) => type.values.includes(v))
      ? ok('set-labels')
      : no('default.set-value-invalid');
  }
  if (context.kind === 'sqlite') {
    if (value.literalType === 'typedText')
      return no('default.literal-not-supported', 'unsupported');
    if (facts.strict && type.kind === 'builtin') {
      const name = definition && definition.sqlName;
      if (name === 'blob' && value.literalType !== 'binary') return mismatch();
      if (
        ['integer', 'int'].includes(name || '') &&
        !(
          value.literalType === 'boolean' ||
          (value.literalType === 'number' &&
            boundedInteger(value.value, -(1n << 63n), (1n << 63n) - 1n))
        )
      )
        return mismatch();
      if (
        name === 'real' &&
        !(
          value.literalType === 'boolean' ||
          (value.literalType === 'number' && Number.isFinite(Number(value.value)))
        )
      )
        return mismatch();
      if (name === 'text' && value.literalType === 'binary') return mismatch();
    }
    if (value.literalType === 'number' && !Number.isFinite(Number(value.value)))
      return no('default.number-out-of-range');
    return ok('sqlite-storage-literal');
  }
  if (type.kind !== 'builtin' || !definition)
    return no('default.literal-not-supported', 'unsupported');
  const name = definition.sqlName,
    category = definition.category;
  const s = typeof value.value === 'string' ? value.value : '';
  const p = type.parameters;
  if (
    ['xml', 'search', 'multirange'].includes(category) ||
    name === 'jsonpath' ||
    ['pg_snapshot', 'txid_snapshot'].includes(name) ||
    (context.kind === 'mysql' && category === 'geometry')
  )
    return no('default.literal-not-supported', 'unsupported');
  if (name.startsWith('reg') || category === 'money')
    return no('default.environment-value-unverified', 'environment');
  if (category === 'integer') {
    if (
      type.database === 'mysql' &&
      type.declarationAlias === 'boolean' &&
      value.literalType === 'boolean'
    )
      return ok('boolean-alias');
    if (value.literalType !== 'number' || !integer.test(s)) return mismatch();
    const width = (
      { smallint: 16, integer: 32, int: 32, bigint: 64, tinyint: 8, mediumint: 24 } as Record<
        string,
        number
      >
    )[name]!;
    const unsigned = 'unsigned' in p && !!p.unsigned;
    return boundedInteger(
      s,
      unsigned ? 0n : -(1n << BigInt(width - 1)),
      (1n << BigInt(unsigned ? width : width - 1)) - 1n,
    )
      ? ok('integer-token')
      : no('default.number-out-of-range');
  }
  if (category === 'decimal' || category === 'floating') {
    if (value.literalType !== 'number') return mismatch();
    if (category === 'floating') {
      const n = Number(s),
        narrow = ['real', 'float'].includes(name);
      return Number.isFinite(n) &&
        (!narrow || Number.isFinite(Math.fround(n))) &&
        (n !== 0 || !/[1-9]/.test(s.split(/[eE]/)[0]!)) &&
        (!narrow || n === 0 || Math.fround(n) !== 0)
        ? ok('finite-float-token')
        : no('default.number-out-of-range');
    }
    const precision =
      ('precision' in p ? p.precision : undefined) ?? (context.kind === 'mysql' ? 10 : undefined);
    const scale = ('scale' in p ? p.scale : undefined) ?? 0;
    return decimalFits(s, precision, scale)
      ? ok('decimal-token-rounded-by-engine')
      : no('default.number-out-of-range');
  }
  if (category === 'boolean') return value.literalType === 'boolean' ? ok('boolean') : mismatch();
  if (category === 'string') {
    if (value.literalType !== 'string') return mismatch();
    const limit = ('length' in p ? p.length : undefined) ?? (name === 'char' ? 1 : undefined);
    if (limit !== undefined && [...s].length > limit) return no('default.length-exceeded');
    const byteLimit = (
      { tinytext: 255, text: 65535, mediumtext: 16777215, longtext: 4294967295 } as Record<
        string,
        number
      >
    )[name];
    return context.kind === 'mysql' && byteLimit !== undefined && bytes(s) > byteLimit
      ? no('default.length-exceeded')
      : ok('string');
  }
  if (category === 'binary') {
    if (value.literalType !== 'binary') return mismatch();
    const limit =
      ('length' in p ? p.length : undefined) ??
      (name === 'binary'
        ? 1
        : (
            { tinyblob: 255, blob: 65535, mediumblob: 16777215, longblob: 4294967295 } as Record<
              string,
              number
            >
          )[name]);
    return limit !== undefined && s.length / 2 > limit
      ? no('default.length-exceeded')
      : ok('hex-bytes');
  }
  if (category === 'json' && name !== 'jsonpath') {
    if (value.literalType !== 'json') return mismatch();
    // Read numeric JSON tokens outside quoted strings, without trusting JSON.parse's
    // rounded JS numbers (notably exponent underflow to zero).
    if (name !== 'json' || context.kind === 'mysql') {
      const tokens = s.matchAll(/"(?:\\[\s\S]|[^"\\])*"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g);
      for (const token of tokens) {
        const number = token[1];
        if (!number) continue;
        if (
          context.kind === 'postgresql'
            ? !decimalFits(number, undefined, 0)
            : !Number.isFinite(Number(number)) ||
              (Number(number) === 0 && /[1-9]/.test(number.split(/[eE]/)[0]!))
        )
          return no('literal.json-invalid');
      }
    }
    // jsonb and MySQL JSON decode Unicode escapes; PostgreSQL json preserves the token.
    if (name !== 'json' || context.kind === 'mysql') {
      const pending: unknown[] = [JSON.parse(s)];
      while (pending.length) {
        const item = pending.pop();
        if (
          typeof item === 'string' &&
          !inspectNativeLiteralToken({ kind: 'literal', literalType: 'string', value: item })
            .allowed
        )
          return no('literal.json-invalid');
        if (typeof item === 'number' && !Number.isFinite(item)) return no('literal.json-invalid');
        if (item && typeof item === 'object') {
          pending.push(...Object.values(item));
          if (!Array.isArray(item)) pending.push(...Object.keys(item));
        }
      }
    }
    return ok('json');
  }
  if (category === 'bit') {
    if (context.kind === 'mysql') {
      if (value.literalType !== 'number' || !integer.test(s)) return mismatch();
      const width = 'bitLength' in p ? (p.bitLength ?? 1) : 1;
      return boundedInteger(s, 0n, (1n << BigInt(width)) - 1n)
        ? ok('unsigned-bit-number')
        : no('default.number-out-of-range');
    }
    if (value.literalType !== 'typedText') return mismatch();
    if (!/^[01]*$/.test(s)) return no('default.literal-format-invalid');
    const width = 'bitLength' in p ? p.bitLength : undefined;
    return (name === 'bit' ? s.length === (width ?? 1) : width === undefined || s.length <= width)
      ? ok('bit-digits')
      : no('default.length-exceeded');
  }
  if (value.literalType !== 'typedText') return mismatch();
  if (category === 'uuid')
    return /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(s)
      ? ok('canonical-uuid')
      : no('default.literal-format-invalid');
  if (category === 'temporal')
    return temporalDecision(
      context,
      name,
      s,
      'precision' in p ? (p.precision ?? (context.kind === 'mysql' ? 0 : 6)) : 0,
    );
  if (category === 'interval') {
    // Exact day/time subset. YEAR/MONTH and arbitrary engine grammar are not claimed.
    if ('fields' in p && p.fields && p.fields !== 'DAY TO SECOND')
      return no('default.literal-not-supported', 'unsupported');
    const m = /^([+-]?\d+) days? (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/.exec(s);
    if (
      !m ||
      !boundedInteger(m[1]!, -2147483648n, 2147483647n) ||
      +m[2]! > 23 ||
      +m[3]! > 59 ||
      +m[4]! > 59
    )
      return no('default.literal-format-invalid');
    return (m[5]?.length ?? 0) <= ('precision' in p ? (p.precision ?? 6) : 6)
      ? ok('day-time-interval')
      : no('default.precision-exceeded');
  }
  if (category === 'network')
    return networkValid(name, s) ? ok('canonical-network') : no('default.literal-format-invalid');
  if (category === 'geometry' && context.kind === 'postgresql')
    return geometryValid(name, s) ? ok('finite-pg-geometry') : no('default.literal-format-invalid');
  if (category === 'range') return rangeDecision(name, s);
  if (category === 'object-reference') {
    if (name !== 'oid') return no('default.environment-value-unverified', 'environment');
    return boundedInteger(s, 0n, 4294967295n)
      ? ok('unsigned-oid')
      : no('default.number-out-of-range');
  }
  if (name === 'pg_lsn')
    return /^[a-f\d]{1,8}\/[a-f\d]{1,8}$/i.test(s)
      ? ok('lsn-hex')
      : no('default.literal-format-invalid');
  return no('default.literal-not-supported', 'unsupported');
}

function decimalFits(s: string, precision: number | undefined, scale: number): boolean {
  const [mantissa = '', exponent = '0'] = s.replace(/^[+-]/, '').toLowerCase().split('e');
  const [whole = '', fraction = ''] = mantissa.split('.');
  const digits = (whole + fraction).replace(/^0+/, '') || '0';
  const e = Number(exponent);
  if (!Number.isSafeInteger(e) || Math.abs(e) > 200000) return false;
  if (precision === undefined)
    return (
      digits === '0' ||
      (digits.length + e - fraction.length <= 131072 && Math.max(0, fraction.length - e) <= 16383)
    );
  if (digits === '0') return true;
  const shift = e - fraction.length + scale;
  if (shift >= 0) return digits.length + shift <= precision;
  const kept = digits.length + shift;
  if (kept < 0) return true;
  if (kept > precision) return false;
  if (kept < precision) return true;
  // Carry from rounding can overflow a full-width coefficient, including negative scales.
  return !(
    digits
      .slice(0, kept)
      .split('')
      .every((c) => c === '9') && digits[kept]! >= '5'
  );
}
function dateValid(s: string, mysql: boolean): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = +m[1]!,
    month = +m[2]!,
    day = +m[3]!;
  if (y < (mysql ? 1000 : 1) || month < 1 || month > 12) return false;
  const days = [
    31,
    y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day >= 1 && day <= days[month - 1]!;
}
function temporalDecision(
  context: DatabaseContext,
  name: string,
  s: string,
  precision: number,
): NativeLiteralDecision {
  const mysql = context.kind === 'mysql';
  if (name === 'date')
    return dateValid(s, mysql) ? ok('iso-date') : no('default.literal-format-invalid');
  if (name === 'year')
    return /^\d{4}$/.test(s) && (+s === 0 || (+s >= 1901 && +s <= 2155))
      ? ok('mysql-year')
      : no('default.number-out-of-range');
  const zoned = ['timetz', 'timestamptz'].includes(name);
  const stamp = ['timestamp', 'timestamptz', 'datetime'].includes(name);
  const m =
    /^(?:(\d{4}-\d{2}-\d{2})[ T])?(-?\d{2,3}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})?$/.exec(
      s,
    );
  if (!m || stamp !== !!m[1] || zoned !== !!m[6] || (m[1] && !dateValid(m[1], mysql)))
    return no('default.literal-format-invalid');
  const h = +m[2]!,
    min = +m[3]!,
    sec = +m[4]!;
  if (
    min > 59 ||
    sec > 59 ||
    (mysql && name === 'time' ? Math.abs(h) > 838 : h < 0 || h > 23 || m[2]!.length !== 2)
  )
    return no('default.literal-format-invalid');
  if (m[6] && m[6] !== 'Z' && (+m[6].slice(1, 3) > 15 || +m[6].slice(4) > 59))
    return no('default.literal-format-invalid');
  if ((m[5]?.length ?? 0) > precision) return no('default.precision-exceeded');
  if (mysql && name === 'timestamp')
    return no('default.environment-value-unverified', 'environment'); // session time_zone and engine epoch bounds
  return ok(zoned ? 'iso-time-with-offset' : 'iso-date-time');
}
function networkValid(name: string, s: string): boolean {
  if (name === 'macaddr' || name === 'macaddr8')
    return new RegExp(`^(?:[a-f\\d]{2}:){${name === 'macaddr' ? 5 : 7}}[a-f\\d]{2}$`, 'i').test(s);
  const [address = '', mask] = s.split('/');
  if (s.split('/').length > 2) return false;
  let bits: bigint, width: number;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)) {
    const parts = address.split('.');
    if (parts.some((p) => +p > 255 || p !== String(+p))) return false;
    width = 32;
    bits = parts.reduce((b, p) => (b << 8n) + BigInt(p), 0n);
  } else {
    if (!/^[a-f\d:]+$/i.test(address) || address.split('::').length > 2) return false;
    const halves = address.split('::'),
      left = halves[0] ? halves[0].split(':') : [],
      right = halves[1] ? halves[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if (halves.length === 1 ? left.length !== 8 : missing < 1) return false;
    const groups =
      halves.length === 1 ? left : [...left, ...Array<string>(missing).fill('0'), ...right];
    if (groups.some((g) => !/^[a-f\d]{1,4}$/i.test(g))) return false;
    width = 128;
    bits = groups.reduce((b, g) => (b << 16n) + BigInt('0x' + g), 0n);
  }
  if (mask !== undefined && (!/^\d{1,3}$/.test(mask) || +mask > width)) return false;
  if (name === 'cidr') {
    const host = width - (mask === undefined ? width : +mask);
    return (bits & ((1n << BigInt(host)) - 1n)) === 0n;
  }
  return true;
}
function geometryValid(name: string, s: string): boolean {
  const n = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
  const point = `\\(${n},${n}\\)`;
  const pair = `${point},${point}`;
  const patterns: Record<string, string> = {
    point,
    line: `\\{${n},${n},${n}\\}`,
    lseg: `\\[${pair}\\]`,
    box: pair,
    path: `(?:\\[${point}(?:,${point})*\\]|\\(${point}(?:,${point})*\\))`,
    polygon: `\\(${point}(?:,${point})*\\)`,
    circle: `<${point},${n}>`,
  };
  if (!patterns[name] || !new RegExp('^' + patterns[name] + '$').test(s)) return false;
  const tokens = s.match(new RegExp(n, 'g'))!;
  const numbers = tokens.map(Number);
  if (
    numbers.some(
      (value, i) =>
        !Number.isFinite(value) || (value === 0 && /[1-9]/.test(tokens[i]!.split(/[eE]/)[0]!)),
    )
  )
    return false;
  if (name === 'line' && numbers[0] === 0 && numbers[1] === 0) return false;
  return name !== 'circle' || numbers[2]! >= 0;
}
function rangeDecision(name: string, s: string): NativeLiteralDecision {
  if (s === 'empty') return ok('empty-range');
  if (['tsrange', 'tstzrange'].includes(name))
    return no('default.literal-not-supported', 'unsupported');
  const m = /^([\[(])([^,]*),([^,]*)([\])])$/.exec(s);
  if (!m) return no('default.literal-format-invalid');
  const lower = m[2]!,
    upper = m[3]!;
  const bound = (b: string) =>
    !b ||
    (name === 'int4range'
      ? boundedInteger(b, -2147483648n, 2147483647n)
      : name === 'int8range'
        ? boundedInteger(b, -(1n << 63n), (1n << 63n) - 1n)
        : name === 'numrange'
          ? numeric.test(b) && decimalFits(b, undefined, 0)
          : name === 'daterange'
            ? dateValid(b, false)
            : false);
  if (!bound(lower) || !bound(upper)) return no('default.literal-format-invalid');
  if (lower && upper) {
    if (name === 'numrange') return no('default.literal-not-supported', 'unsupported'); // exact arbitrary decimal bound ordering is not yet implemented
    const reversed = name === 'daterange' ? lower > upper : BigInt(lower) > BigInt(upper);
    if (reversed) return no('default.range-bounds-invalid');
    const max =
      name === 'int4range' ? 2147483647n : name === 'int8range' ? 9223372036854775807n : undefined;
    if (
      max !== undefined &&
      ((upper && BigInt(upper) === max && m[4] === ']') ||
        (lower && BigInt(lower) === max && m[1] === '('))
    )
      return no('default.number-out-of-range');
  }
  return ok('restricted-range');
}
