import { describe, expect, it } from 'vitest';
import { databaseTypeCatalog, getDatabaseType } from './catalog.js';
import { literalDecision, inspectNativeLiteralToken } from './literals.js';
import { defaultDatabaseContext } from './profiles.js';
import { hasDatabaseCoverage, type DatabaseKind } from './definitions.js';
import { nativeDefaultCoverage, nativeFeatureCoverage } from './readiness.js';
import type { NativeColumnType, NativeLiteral } from './native-document.js';
import { nativeDDLFixture } from './ddl-fixtures.js';
import { inspectNativeDatabaseDocument, validateDatabaseDocument } from './validation.js';
import { compileNativeDatabaseDDL, exportNativeDatabaseDDL } from './ddl.js';

const literal = (
  value: string,
  literalType: Exclude<NativeLiteral['literalType'], 'boolean'> = 'typedText',
): NativeLiteral => ({ kind: 'literal', literalType, value });
const type = (
  kind: DatabaseKind,
  name: string,
  parameters: Record<string, number> = {},
): NativeColumnType =>
  ({ kind: 'builtin', database: kind, typeId: `${kind}:${name}`, parameters }) as NativeColumnType;
const decide = (
  name: string,
  value: string,
  kind: DatabaseKind = 'postgresql',
  literalType: Exclude<NativeLiteral['literalType'], 'boolean'> = 'typedText',
  parameters: Record<string, number> = {},
) =>
  literalDecision(
    defaultDatabaseContext(kind),
    type(kind, name, parameters),
    literal(value, literalType),
  );
describe('MySQL literal effective charset facts', () => {
  it.each([
    ['ascii', 'é', false],
    ['utf8mb3', '😀', false],
    ['utf8mb4', '😀', true],
    ['latin1', '€', true],
    ['latin1', '한', false],
    ['binary', 'é', false],
  ])('%s default %s respects representation and encoded length', (charset, value, allowed) => {
    const t: NativeColumnType = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: 1 },
    };
    expect(
      literalDecision(defaultDatabaseContext('mysql'), t, literal(value, 'string'), { charset })
        .allowed,
    ).toBe(allowed);
  });
  it('uses latin1 byte capacity rather than UTF8 length and refuses an unknown charset', () => {
    const t: NativeColumnType = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:tinytext',
      parameters: {},
    };
    expect(
      literalDecision(defaultDatabaseContext('mysql'), t, literal('é'.repeat(255), 'string'), {
        charset: 'latin1',
      }).allowed,
    ).toBe(true);
    expect(
      literalDecision(defaultDatabaseContext('mysql'), t, literal('é'.repeat(256), 'string'), {
        charset: 'latin1',
      }).allowed,
    ).toBe(false);
    expect(
      literalDecision(defaultDatabaseContext('mysql'), t, literal('a', 'string'), {
        charset: 'unknown',
      }).category,
    ).toBe('environment');
  });
  it('applies charset representability to ENUM and SET defaults instead of trusting list membership', () => {
    const t: NativeColumnType = {
      kind: 'valueList',
      database: 'mysql',
      typeId: 'mysql:enum',
      values: ['😀'],
    };
    expect(
      literalDecision(defaultDatabaseContext('mysql'), t, literal('😀', 'string'), {
        charset: 'utf8mb3',
      }).allowed,
    ).toBe(false);
    const set: NativeColumnType = {
      kind: 'valueList',
      database: 'mysql',
      typeId: 'mysql:set',
      values: ['a', 'é'],
    };
    expect(
      literalDecision(defaultDatabaseContext('mysql'), set, literal('a,é', 'string'), {
        charset: 'ascii',
      }).allowed,
    ).toBe(false);
  });
});

describe('native literal decisions with explicit target IDs', () => {
  it('uses registry default readiness for checked values but never grants new permission from none or a lexical token', () => {
    const context = defaultDatabaseContext('postgresql'),
      t = type('postgresql', 'integer'),
      ready = hasDatabaseCoverage(nativeDefaultCoverage);
    expect(literalDecision(context, t, literal('1', 'number'))).toMatchObject({
      allowed: true,
      coverage: ready,
      usable: ready,
    });
    expect(literalDecision(context, t, literal('2147483648', 'number'))).toMatchObject({
      allowed: false,
      usable: false,
    });
    expect(literalDecision(context, t, { kind: 'none' })).toMatchObject({
      allowed: true,
      coverage: false,
      usable: false,
    });
    expect(inspectNativeLiteralToken(literal('1', 'number'))).toMatchObject({
      allowed: true,
      coverage: false,
      usable: false,
    });
    expect(inspectNativeLiteralToken(literal('1', 'typedText'))).toMatchObject({
      allowed: false,
      coverage: false,
      usable: false,
    });
  });
  it('requires the project ENUM feature or the matching MySQL value-list family as well as default coverage', () => {
    const pg = defaultDatabaseContext('postgresql'),
      my = defaultDatabaseContext('mysql'),
      label = literal('a', 'string');
    const enumeration: NativeColumnType = {
      kind: 'projectEnum',
      database: 'postgresql',
      enumId: 'e',
    };
    expect(literalDecision(pg, enumeration, label, { enumValues: ['a'] })).toMatchObject({
      allowed: true,
      usable:
        hasDatabaseCoverage(nativeDefaultCoverage) &&
        hasDatabaseCoverage(nativeFeatureCoverage('enumType')),
    });
    for (const id of ['mysql:enum', 'mysql:set'] as const) {
      const list: NativeColumnType = {
        kind: 'valueList',
        database: 'mysql',
        typeId: id,
        values: ['a'],
      };
      const ready =
        hasDatabaseCoverage(nativeDefaultCoverage) &&
        hasDatabaseCoverage(
          nativeFeatureCoverage(id === 'mysql:enum' ? 'enumColumn' : 'setColumn'),
        ) &&
        hasDatabaseCoverage(getDatabaseType(id)!.coverage);
      expect(literalDecision(my, list, label)).toMatchObject({
        allowed: true,
        coverage: ready,
        usable: ready,
      });
      expect(literalDecision(my, list, literal('bad', 'string')).usable).toBe(false);
    }
  });
  it('does not borrow builtin coverage for SQLite custom declarations or untyped columns', () => {
    const context = defaultDatabaseContext('sqlite');
    for (const t of [
      { kind: 'declared', database: 'sqlite', name: 'Application number', numericArguments: [] },
      { kind: 'untyped', database: 'sqlite' },
    ] satisfies NativeColumnType[]) {
      expect(literalDecision(context, t, literal('1', 'number'))).toMatchObject({
        allowed: true,
        coverage: false,
        usable: false,
        readinessCode: 'type.declaration-not-ready',
      });
    }
  });
  it('ignores caller readiness/evidence fields and preserves unsupported-profile diagnostics', () => {
    const context = defaultDatabaseContext('postgresql');
    const injected = {
      nullable: true,
      usable: true,
      coverage: true,
      evidence: { editor: ['caller'] },
    };
    expect(
      literalDecision(context, type('postgresql', 'unknown'), literal('1', 'number'), injected),
    ).toMatchObject({ allowed: false, coverage: false, usable: false });
    expect(
      literalDecision(
        { ...context, profileId: 'invalid' as typeof context.profileId },
        type('postgresql', 'integer'),
        literal('1', 'number'),
      ),
    ).toMatchObject({
      allowed: false,
      code: 'database.profile-unsupported',
      coverage: false,
      usable: false,
    });
    expect(decide('xml', '<!DOCTYPE root><root/>')).toMatchObject({
      allowed: false,
      usable: false,
      category: 'unsupported',
    });
    expect(decide('regclass', 'records')).toMatchObject({
      allowed: false,
      usable: false,
      category: 'environment',
    });
  });
  it.each(databaseTypeCatalog)(
    '$id supports none/null separately from specialized literal support',
    (d) => {
      const t: NativeColumnType = ['mysql:enum', 'mysql:set'].includes(d.id)
        ? {
            kind: 'valueList',
            database: 'mysql',
            typeId: d.id as 'mysql:enum' | 'mysql:set',
            values: ['a'],
          }
        : type(
            d.databaseKind,
            d.sqlName,
            ['mysql:varchar', 'mysql:varbinary'].includes(d.id) ? { length: 12 } : {},
          );
      const context = defaultDatabaseContext(d.databaseKind);
      for (const value of [{ kind: 'none' }, { kind: 'null' }] as const) {
        expect(literalDecision(context, t, value)).toMatchObject({
          allowed: true,
          coverage:
            value.kind === 'null' &&
            hasDatabaseCoverage(nativeDefaultCoverage) &&
            hasDatabaseCoverage(d.coverage) &&
            (t.kind !== 'valueList' ||
              hasDatabaseCoverage(
                nativeFeatureCoverage(t.typeId === 'mysql:enum' ? 'enumColumn' : 'setColumn'),
              )),
          usable:
            value.kind === 'null' &&
            hasDatabaseCoverage(nativeDefaultCoverage) &&
            hasDatabaseCoverage(d.coverage) &&
            (t.kind !== 'valueList' ||
              hasDatabaseCoverage(
                nativeFeatureCoverage(t.typeId === 'mysql:enum' ? 'enumColumn' : 'setColumn'),
              )),
        });
      }
      expect(literalDecision(context, t, { kind: 'null' }, { nullable: false }).allowed).toBe(
        false,
      );
      expect(literalDecision(context, t, { kind: 'null' }, { primary: true }).allowed).toBe(false);
    },
  );
  it.each([
    ['uuid', '12345678-1234-5678-90ab-123456789abc', 'bad'],
    ['date', '2024-02-29', '2023-02-29'],
    ['timestamp', '2024-01-02 03:04:05', '2024-02-30 03:04:05'],
    ['timestamptz', '2024-01-02T03:04:05Z', '2024-01-02T03:04:05'],
    ['time', '03:04:05', '25:04:05'],
    ['timetz', '03:04:05+09:00', '03:04:05+16:00'],
    ['interval', '-2 days 03:04:05.123456', '2 days 25:00:00'],
    ['point', '(1.5,-2)', '(Infinity,2)'],
    ['line', '{1,2,3}', '{0,0,1}'],
    ['lseg', '[(1,2),(3,4)]', '[(1,2)]'],
    ['box', '(3,4),(1,2)', 'bad'],
    ['path', '[(1,2),(3,4)]', 'bad'],
    ['polygon', '((1,2),(3,4),(5,6))', 'bad'],
    ['circle', '<(1,2),3>', '<(1,2),-3>'],
    ['inet', '2001:db8::1/64', '2001:::1'],
    ['cidr', '192.168.0.0/24', '192.168.0.1/24'],
    ['macaddr', '08:00:2b:01:02:03', '08:wrong'],
    ['macaddr8', '08:00:2b:01:02:03:04:05', '08:00:2b:01:02:03'],
    ['int4range', '[1,4)', '[4,1)'],
    ['int8range', '[9007199254740993,9007199254740995)', '[9223372036854775808,)'],
    ['daterange', '[2024-01-01,2024-02-01)', '[2024-02-30,2024-03-01)'],
    ['oid', '4294967295', '4294967296'],
    ['pg_lsn', 'FFFFFFFF/FFFFFFFF', 'FFFFFFFFF/0'],
    ['bit', '1', '2'],
  ])('%s accepts a checked subset and rejects malformed values', (name, good, bad) => {
    const ready =
      hasDatabaseCoverage(nativeDefaultCoverage) &&
      hasDatabaseCoverage(getDatabaseType(`postgresql:${name}`)!.coverage);
    expect(decide(name, good)).toMatchObject({ allowed: true, usable: ready, coverage: ready });
    expect(decide(name, bad).allowed).toBe(false);
    expect(decide(name, good, 'postgresql', 'string').allowed).toBe(false);
  });
  it.each(['tsvector', 'tsquery'])(
    '%s permits its checked single-lexeme subset, not a query grammar',
    (name) => {
      expect(decide(name, 'alpha')).toMatchObject({ allowed: true, usable: true });
      expect(decide(name, 'alpha & beta')).toMatchObject({
        allowed: false,
        category: 'unsupported',
      });
      expect(decide(name, 'alpha', 'postgresql', 'string').allowed).toBe(false);
    },
  );
  it('checks snapshot syntax rather than trusting a type declaration', () => {
    expect(decide('pg_snapshot', '1:2:')).toMatchObject({ allowed: true, usable: true });
    expect(decide('pg_snapshot', 'anything')).toMatchObject({
      allowed: false,
      category: 'invalid',
    });
    expect(decide('pg_snapshot', '2:1:')).toMatchObject({ allowed: false, category: 'invalid' });
  });
  it.each(['txid_snapshot', 'int4multirange', 'tsrange', 'tstzrange'])(
    '%s does not silently trust unimplemented grammar',
    (name) => {
      expect(decide(name, 'anything')).toMatchObject({ allowed: false, category: 'unsupported' });
    },
  );
  it.each(
    databaseTypeCatalog.filter(
      (d) => d.id.startsWith('postgresql:reg') || d.id === 'postgresql:money',
    ),
  )('$id requires engine environment evidence', (d) => {
    expect(decide(d.sqlName, 'pg_catalog.pg_class')).toMatchObject({
      allowed: false,
      category: 'environment',
    });
    expect(decide(d.sqlName, '123')).toMatchObject({ allowed: false, category: 'environment' });
  });
  it('rejects invalid type parameters, foreign IDs, untyped AST casts and arrays', () => {
    expect(decide('varchar', 'a', 'postgresql', 'string', { length: 0 }).allowed).toBe(false);
    expect(
      literalDecision(defaultDatabaseContext('mysql'), type('postgresql', 'uuid'), literal('bad'))
        .allowed,
    ).toBe(false);
    expect(inspectNativeLiteralToken(literal('123'))).toMatchObject({
      allowed: false,
      code: 'literal.target-type-required',
    });
    const array: NativeColumnType = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:integer',
      parameters: {},
      array: { dimensions: 1 },
    };
    expect(
      literalDecision(defaultDatabaseContext('postgresql'), array, literal('{1}')),
    ).toMatchObject({ allowed: false, category: 'unsupported' });
  });
  it.each([
    ['smallint', '32767', '32768', {}],
    ['bigint', '9223372036854775807', '9223372036854775808', {}],
    ['numeric', '9.994', '9.995', { precision: 3, scale: 2 }],
    ['numeric', '99499', '99500', { precision: 2, scale: -3 }],
    ['numeric', '0.00994', '0.00995', { precision: 2, scale: 4 }],
    ['numeric', '1e100', '1e200000', {}],
    ['real', '1e20', '1e40', {}],
    ['real', '1e-20', '1e-50', {}],
    ['double precision', '1e300', '1e400', {}],
  ])(
    '%s respects integer width, decimal rounding, floating overflow and underflow',
    (name, good, bad, p) => {
      expect(decide(name, good, 'postgresql', 'number', p).allowed).toBe(true);
      expect(decide(name, bad, 'postgresql', 'number', p).allowed).toBe(false);
    },
  );
  it('checks kinds, binary bytes, string characters, bit widths and fractional precision', () => {
    expect(decide('varchar', '한글', 'postgresql', 'string', { length: 2 }).allowed).toBe(true);
    expect(decide('varchar', '한글x', 'postgresql', 'string', { length: 2 }).code).toBe(
      'default.length-exceeded',
    );
    expect(decide('bytea', '00ff', 'postgresql', 'binary').allowed).toBe(true);
    expect(decide('bytea', '0ff', 'postgresql', 'binary').code).toBe('literal.binary-invalid');
    expect(decide('varbinary', '00ff', 'mysql', 'binary', { length: 1 }).allowed).toBe(false);
    expect(decide('bit', '101', 'postgresql', 'typedText', { bitLength: 2 }).allowed).toBe(false);
    expect(decide('bit', '3', 'mysql', 'number', { bitLength: 2 }).allowed).toBe(true);
    expect(decide('bit', '4', 'mysql', 'number', { bitLength: 2 }).allowed).toBe(false);
    expect(decide('time', '12:34:56.123', 'postgresql', 'typedText', { precision: 2 }).code).toBe(
      'default.precision-exceeded',
    );
    expect(decide('tinytext', '한'.repeat(86), 'mysql', 'string').code).toBe(
      'default.length-exceeded',
    );
  });
  it('checks JSON decoded values and rejects malformed tokens without executing input', () => {
    expect(decide('jsonb', '{"x":"\\u0000"}', 'postgresql', 'json').allowed).toBe(false);
    expect(decide('json', '{"x":"\\u0000"}', 'postgresql', 'json').allowed).toBe(true);
    expect(decide('json', '{"x":1}', 'mysql', 'json').allowed).toBe(true);
    expect(decide('jsonb', '{"x":1e-20000}', 'postgresql', 'json').allowed).toBe(false);
    expect(decide('json', '{"x":1e-400}', 'mysql', 'json').allowed).toBe(false);
    expect(decide('jsonb', '{"x":"1e-20000"}', 'postgresql', 'json').allowed).toBe(true);
    expect(decide('json', 'bad', 'mysql', 'json').allowed).toBe(false);
    expect(decide('integer', '1; DROP TABLE x', 'postgresql', 'number').code).toBe(
      'literal.number-invalid',
    );
    expect(decide('text', "quote' and slash\\ 한글", 'postgresql', 'string').allowed).toBe(true);
    expect(decide('text', '\uD800', 'postgresql', 'string').allowed).toBe(false);
  });
  it('handles MySQL dates, TIME bounds, year, unsigned and environment timestamps', () => {
    expect(decide('date', '0999-12-31', 'mysql').allowed).toBe(false);
    expect(decide('time', '838:59:59', 'mysql').allowed).toBe(true);
    expect(decide('time', '839:00:00', 'mysql').allowed).toBe(false);
    expect(decide('year', '2155', 'mysql').allowed).toBe(true);
    expect(decide('year', '2156', 'mysql').allowed).toBe(false);
    expect(decide('timestamp', '2024-01-01 00:00:00', 'mysql').category).toBe('environment');
    const unsigned: NativeColumnType = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:bigint',
      parameters: { unsigned: true },
    };
    expect(
      literalDecision(
        defaultDatabaseContext('mysql'),
        unsigned,
        literal('18446744073709551615', 'number'),
      ).allowed,
    ).toBe(true);
    expect(
      literalDecision(defaultDatabaseContext('mysql'), unsigned, literal('-1', 'number')).allowed,
    ).toBe(false);
  });
  it('validates ENUM/SET against their actual value lists', () => {
    const set: NativeColumnType = {
      kind: 'valueList',
      database: 'mysql',
      typeId: 'mysql:set',
      values: ['a', 'b'],
    };
    for (const value of ['', 'a', 'a,b'])
      expect(
        literalDecision(defaultDatabaseContext('mysql'), set, literal(value, 'string')).allowed,
      ).toBe(true);
    for (const value of ['a,a', 'c'])
      expect(
        literalDecision(defaultDatabaseContext('mysql'), set, literal(value, 'string')).code,
      ).toBe('default.set-value-invalid');
    const en: NativeColumnType = { kind: 'projectEnum', database: 'postgresql', enumId: 'e' };
    expect(
      literalDecision(defaultDatabaseContext('postgresql'), en, literal('a', 'string'), {
        enumValues: ['a'],
      }).allowed,
    ).toBe(true);
    expect(
      literalDecision(defaultDatabaseContext('postgresql'), en, literal('b', 'string'), {
        enumValues: ['a'],
      }).allowed,
    ).toBe(false);
  });
  it('preserves SQLite ordinary affinity and rejects incompatible STRICT defaults', () => {
    const context = defaultDatabaseContext('sqlite');
    expect(
      literalDecision(context, type('sqlite', 'integer'), literal('text', 'string')).allowed,
    ).toBe(true);
    expect(
      literalDecision(context, type('sqlite', 'integer'), literal('text', 'string'), {
        strict: true,
      }).allowed,
    ).toBe(false);
    expect(
      literalDecision(context, type('sqlite', 'blob'), literal('00ff', 'binary'), { strict: true })
        .allowed,
    ).toBe(true);
    expect(
      literalDecision(context, type('sqlite', 'blob'), literal('00ff', 'string'), { strict: true })
        .allowed,
    ).toBe(false);
    expect(literalDecision(context, type('sqlite', 'text'), literal('2024-01-01')).category).toBe(
      'unsupported',
    );
  });
});

describe('literal policy at validator/compiler boundaries', () => {
  it('retains existing invalid value only when the trusted cause is unchanged', () => {
    const doc = nativeDDLFixture('postgresql');
    doc.keys = [];
    doc.tableRelations = [];
    doc.columns![0]!.physical.generation = { kind: 'none' };
    doc.columns![0]!.physical.type = type('postgresql', 'uuid');
    doc.columns![0]!.physical.defaultValue = literal('bad');
    expect(inspectNativeDatabaseDocument(doc, doc.database).map((i) => i.code)).toContain(
      'default.literal-format-invalid',
    );
    const candidate = structuredClone(doc);
    candidate.columns![0]!.physical.comment = 'safe metadata edit';
    expect(
      validateDatabaseDocument(candidate, doc.database, { mode: 'write', previous: doc }),
    ).toEqual([]);
    candidate.columns![0]!.physical.defaultValue = literal('different-bad');
    expect(
      validateDatabaseDocument(candidate, doc.database, { mode: 'write', previous: doc }).map(
        (i) => i.code,
      ),
    ).toContain('default.literal-format-invalid');
    expect(compileNativeDatabaseDDL(candidate).sql).toBe('');
    expect(exportNativeDatabaseDDL(candidate).sql).toBe('');
  });
  it('blocks typedText nested in arbitrary AST even if the surrounding column has a type', () => {
    const doc = nativeDDLFixture('postgresql');
    doc.checks![0]!.expression = {
      kind: 'call',
      functionId: 'postgresql:coalesce',
      args: [literal('anything'), { kind: 'null' }],
    };
    expect(inspectNativeDatabaseDocument(doc, doc.database).map((i) => i.code)).toContain(
      'literal.target-type-required',
    );
    expect(compileNativeDatabaseDDL(doc).sql).toBe('');
  });
});
