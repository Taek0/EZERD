import { describe, expect, it } from 'vitest';
import { databaseTypeCatalog } from './catalog.js';
import { defaultDatabaseContext } from './profiles.js';
import type { NativeColumnType, NativeLiteral } from './native-document.js';
import { inspectPostgresBoundedTypedLiteral } from './postgres-typed-literal-helper.js';

const context = defaultDatabaseContext('postgresql');
const literal = (value: string): NativeLiteral => ({
  kind: 'literal',
  literalType: 'typedText',
  value,
});
// Trusted catalog fixture IDs; never used to reinterpret product input.
const type = (name: string): NativeColumnType =>
  ({
    kind: 'builtin',
    database: 'postgresql',
    typeId: `postgresql:${name}`,
    parameters: {},
  }) as NativeColumnType;
const decide = (name: string, value: string) =>
  inspectPostgresBoundedTypedLiteral(context, type(name), literal(value));
const supportedArrays = databaseTypeCatalog.filter(
  (d) =>
    d.databaseKind === 'postgresql' &&
    !d.deprecated &&
    !d.sqlName.startsWith('reg') &&
    d.category !== 'money',
);

describe('PostgreSQL bounded type-owned literals', () => {
  it.each(['tsvector', 'tsquery'])(
    '%s accepts just one ASCII lexeme without normalization',
    (name) => {
      for (const value of ['a', 'Ezerd_42', 'A'.repeat(128)])
        expect(decide(name, value)).toEqual({ allowed: true, format: 'pg-search-single-lexeme' });
      for (const value of [
        '',
        'A'.repeat(129),
        'two tokens',
        "'quoted'",
        'a:1A',
        'a:*',
        'a&b',
        'a|b',
        '!a',
        '(a)',
        'a<->b',
        'a\\b',
        '한글',
        '1word',
        'a-b',
        'a;select',
        'a--comment',
        'a\n',
      ])
        expect(decide(name, value)).toMatchObject({ allowed: false, category: 'unsupported' });
    },
  );
  it.each([
    'int4multirange',
    'int8multirange',
    'nummultirange',
    'tsmultirange',
    'tstzmultirange',
    'datemultirange',
  ])('%s supports only canonical empty multirange', (name) => {
    expect(decide(name, '{}')).toEqual({ allowed: true, format: 'pg-empty-multirange' });
    for (const value of ['{[1,2)}', '{empty}', '{ }', ' {}', '{} ', '', '{};SELECT 1'])
      expect(decide(name, value)).toMatchObject({ allowed: false, category: 'unsupported' });
  });
  it.each([
    '1:1:',
    '10:20:10,14,15',
    '9007199254740995:9007199254740998:9007199254740995,9007199254740996',
    '18446744073709551614:18446744073709551615:18446744073709551614',
    '18446744073709551615:18446744073709551615:',
  ])('exact snapshot %s', (value) => {
    expect(decide('pg_snapshot', value)).toEqual({ allowed: true, format: 'pg-snapshot-counters' });
  });
  it.each([
    '0:1:',
    '4294967296:4294967297:',
    '9007199254740992:9007199254740995:',
    '4294967295:4294967296:',
    '4294967295:4294967297:4294967296',
    '1:0:',
    '20:10:',
    '1:18446744073709551616:',
    '18446744073709551616:18446744073709551616:',
    '01:20:',
    '-1:20:',
    '+1:20:',
    '1e2:200:',
    '1.0:2:',
    '1:2',
    '1:2::',
    '1:2:0',
    '1:2:2',
    '10:20:9',
    '10:20:21',
    '1:2:1,',
    '1:2:,1',
    '1:3:01',
    '1:3: 1',
    '1:3:-1',
    '1:3:1.0',
  ])('rejects malformed/range-invalid snapshot %s', (value) => {
    expect(decide('pg_snapshot', value)).toMatchObject({ allowed: false, category: 'invalid' });
  });
  it('compares adjacent xips beyond Number safe range without rounding', () => {
    expect(
      decide('pg_snapshot', '9007199254740995:9007199254740998:9007199254740996,9007199254740995'),
    ).toMatchObject({ allowed: false, code: 'default.pg-snapshot-xip-order-unsupported' });
    expect(decide('pg_snapshot', '10:20:10,10')).toMatchObject({
      allowed: false,
      category: 'unsupported',
    });
  });
  it('bounds xip cardinality and scanning before BigInt conversion', () => {
    const values = Array.from({ length: 128 }, (_, i) => String(i + 1));
    expect(decide('pg_snapshot', `1:200:${values.join(',')}`)?.allowed).toBe(true);
    expect(decide('pg_snapshot', `1:200:${[...values, '129'].join(',')}`)).toMatchObject({
      allowed: false,
      category: 'unsupported',
    });
    expect(decide('pg_snapshot', '1'.repeat(10000))).toMatchObject({
      allowed: false,
      category: 'unsupported',
    });
  });
  it.each(supportedArrays)(
    '$id empty array accepts no element grammar for valid declared dimensions',
    (d) => {
      for (const dimensions of [1, 6]) {
        const t = { ...type(d.sqlName), array: { dimensions } } as NativeColumnType;
        expect(inspectPostgresBoundedTypedLiteral(context, t, literal('{}'))).toEqual({
          allowed: true,
          format: 'pg-empty-array',
        });
        for (const value of ['{1}', '{NULL}', '{{}}', '[1:0]={}', '{""}', '{ }'])
          expect(inspectPostgresBoundedTypedLiteral(context, t, literal(value))).toMatchObject({
            allowed: false,
            category: 'unsupported',
          });
      }
    },
  );
  it.each([0, 7, -1, 1.5, NaN])('rejects invalid array declaration dimension %s', (dimensions) => {
    const t = { ...type('integer'), array: { dimensions } } as NativeColumnType;
    expect(inspectPostgresBoundedTypedLiteral(context, t, literal('{}'))).toMatchObject({
      allowed: false,
      code: 'type.array-dimensions-invalid',
    });
  });
  it('accepts empty project ENUM array only as engine syntax, not reference or readiness proof', () => {
    const t: NativeColumnType = {
      kind: 'projectEnum',
      database: 'postgresql',
      enumId: 'caller-resolves-this',
      array: { dimensions: 1 },
    };
    expect(inspectPostgresBoundedTypedLiteral(context, t, literal('{}'))).toEqual({
      allowed: true,
      format: 'pg-empty-array',
    });
    expect(
      inspectPostgresBoundedTypedLiteral(context, { ...t, enumId: '' }, literal('{}'))?.allowed,
    ).toBe(false);
    expect(
      inspectPostgresBoundedTypedLiteral(
        context,
        { ...t, array: undefined } as unknown as NativeColumnType,
        literal('label'),
      ),
    ).toBeNull();
  });
  it.each(['txid_snapshot', 'money', 'regclass'])(
    'does not grant deprecated/environment %s array defaults',
    (name) => {
      const t = { ...type(name), array: { dimensions: 1 } } as NativeColumnType;
      expect(inspectPostgresBoundedTypedLiteral(context, t, literal('{}'))?.allowed).toBe(false);
      if (name === 'txid_snapshot')
        expect(decide(name, '10:20:')).toMatchObject({ allowed: false, category: 'unsupported' });
    },
  );
  it('cannot trust a foreign/unregistered/parameter-invalid destination or profile', () => {
    for (const t of [
      type('madeup'),
      type('mysql:int'),
      { ...type('tsquery'), parameters: { length: 1 } },
      { kind: 'legacy', source: 'document-v1', original: 'tsquery' },
    ] as NativeColumnType[])
      expect(inspectPostgresBoundedTypedLiteral(context, t, literal('Ezerd'))?.allowed).toBe(false);
    expect(
      inspectPostgresBoundedTypedLiteral(
        defaultDatabaseContext('mysql'),
        type('tsquery'),
        literal('Ezerd'),
      )?.allowed,
    ).toBe(false);
    expect(
      inspectPostgresBoundedTypedLiteral(
        { kind: 'postgresql', profileId: 'unverified' },
        type('tsquery'),
        literal('Ezerd'),
      )?.allowed,
    ).toBe(false);
  });
  it('requires an actual typedText token and valid Unicode without a destination-free cast', () => {
    for (const value of ['string', 'number', 'json', 'binary'])
      expect(
        inspectPostgresBoundedTypedLiteral(context, type('tsquery'), {
          ...literal('Ezerd'),
          literalType: value,
        } as NativeLiteral)?.allowed,
      ).toBe(false);
    for (const value of ['a\0b', 'a\uD800', '\uDC00'])
      expect(decide('tsquery', value)).toMatchObject({
        allowed: false,
        code: 'literal.string-invalid',
      });
    expect(
      inspectPostgresBoundedTypedLiteral(context, type('tsquery'), {
        ...literal('Ezerd'),
        value: 123,
      } as unknown as NativeLiteral)?.allowed,
    ).toBe(false);
    expect(decide('integer', '123')).toBeNull();
    expect(decide('xml', '<valid/>')).toBeNull();
    expect(decide('jsonpath', '$')).toBeNull();
  });
});
