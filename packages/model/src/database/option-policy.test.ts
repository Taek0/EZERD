import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { defaultDatabaseContext } from './profiles.js';
import { hasDatabaseCoverage } from './definitions.js';
import { nativeDefaultCoverage, nativeFeatureCoverage } from './readiness.js';
import { getDatabaseType } from './catalog.js';
import {
  nativeBuiltinDefaultDecision,
  nativeGenerationDecision,
  nativeOnUpdateDecision,
} from './option-policy.js';
import type { NativeColumnType, NativeGeneration, NativeExpression } from './native-document.js';
const pg = defaultDatabaseContext('postgresql'),
  mysql = defaultDatabaseContext('mysql'),
  sqlite = defaultDatabaseContext('sqlite');
const integer: NativeColumnType = {
  kind: 'builtin',
  database: 'postgresql',
  typeId: 'postgresql:integer',
  parameters: {},
};
const call = (
  functionId: Extract<NativeExpression, { kind: 'call' }>['functionId'],
): NativeExpression => ({ kind: 'call', functionId, args: [] });
describe('native column option decisions', () => {
  it('consumes actual default coverage and refuses to promote clear recovery or caller evidence', () => {
    const uuid: NativeColumnType = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:uuid',
      parameters: {},
    };
    expect(nativeBuiltinDefaultDecision(pg, uuid, call('postgresql:gen_random_uuid')).usable).toBe(
      hasDatabaseCoverage(nativeDefaultCoverage),
    );
    expect(
      nativeBuiltinDefaultDecision(pg, integer, call('postgresql:gen_random_uuid')),
    ).toMatchObject({ allowed: false, usable: false });
    expect(nativeGenerationDecision(pg, integer, { kind: 'none' })).toEqual({
      allowed: true,
      usable: false,
    });
    const legacy: NativeColumnType = {
      kind: 'legacy',
      source: 'document-v1',
      original: { name: 'custom', isArray: false },
    };
    expect(nativeGenerationDecision(pg, legacy, { kind: 'none' })).toEqual({
      allowed: true,
      usable: false,
    });
    const injected = {
      nullable: false,
      usable: true,
      coverage: true,
      evidence: { editor: ['caller'] },
    };
    expect(
      nativeGenerationDecision(
        pg,
        legacy,
        { kind: 'identity', database: 'postgresql', mode: 'always' },
        injected,
      ),
    ).toMatchObject({ allowed: false, usable: false });
    const enumeration: NativeColumnType = {
      kind: 'projectEnum',
      database: 'postgresql',
      enumId: 'e',
    };
    // Legacy engine facts are preserved, but a caller typeId cannot supply product type coverage.
    expect(
      nativeGenerationDecision(
        pg,
        enumeration,
        { kind: 'identity', database: 'postgresql', mode: 'always' },
        { typeId: 'postgresql:integer' },
      ),
    ).toMatchObject({ allowed: true, usable: false });
  });
  it('requires actual storage/type/expression readiness for computed generation and supports proper autoIncrement facts', () => {
    const expression: NativeExpression = { kind: 'literal', literalType: 'number', value: '1' };
    for (const storage of ['stored', 'virtual'] as const)
      expect(
        nativeGenerationDecision(pg, integer, {
          kind: 'computed',
          database: 'postgresql',
          storage,
          expression,
        }).usable,
      ).toBe(
        hasDatabaseCoverage(
          nativeFeatureCoverage(storage === 'stored' ? 'generatedStored' : 'generatedVirtual'),
        ),
      );
    const type: NativeColumnType = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:int',
      parameters: {},
    };
    expect(
      nativeGenerationDecision(
        mysql,
        type,
        { kind: 'autoIncrement', database: 'mysql' },
        { indexed: true, firstIndexColumn: true },
      ).usable,
    ).toBe(hasDatabaseCoverage(nativeFeatureCoverage('autoIncrement')));
    expect(
      nativeGenerationDecision(mysql, type, { kind: 'autoIncrement', database: 'mysql' }),
    ).toMatchObject({ allowed: false, usable: false, code: 'generation.key-required' });
    const timestamp: NativeColumnType = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:timestamp',
      parameters: {},
    };
    expect(nativeOnUpdateDecision(mysql, timestamp, call('mysql:current_timestamp')).usable).toBe(
      hasDatabaseCoverage(nativeDefaultCoverage),
    );
    expect(nativeOnUpdateDecision(mysql, timestamp, call('mysql:current_date'))).toMatchObject({
      allowed: false,
      usable: false,
    });
  });
  it('uses structured expression results for generated/default candidates and PG virtual type rules', () => {
    const expression: NativeExpression = {
      kind: 'binary',
      operator: '+',
      left: { kind: 'literal', literalType: 'number', value: '1' },
      right: { kind: 'literal', literalType: 'number', value: '2' },
    };
    expect(nativeBuiltinDefaultDecision(pg, integer, expression).allowed).toBe(true);
    expect(
      nativeGenerationDecision(pg, integer, {
        kind: 'computed',
        database: 'postgresql',
        storage: 'stored',
        expression,
      }).allowed,
    ).toBe(true);
    expect(
      nativeGenerationDecision(
        pg,
        { kind: 'projectEnum', database: 'postgresql', enumId: 'enum' },
        { kind: 'computed', database: 'postgresql', storage: 'virtual', expression },
      ).code,
    ).toBe('generation.virtual-type-not-supported');
  });
  it.each(['smallint', 'integer', 'bigint'] as const)(
    'preserves %s exact sequence bounds including descending defaults',
    (name) => {
      const type: NativeColumnType = { ...integer, typeId: `postgresql:${name}` };
      const generation: NativeGeneration = {
        kind: 'identity',
        database: 'postgresql',
        mode: 'always',
        sequence: { increment: '-1' },
      };
      expect(nativeGenerationDecision(pg, type, generation, { nullable: false })).toEqual({
        allowed: true,
        usable:
          hasDatabaseCoverage(nativeFeatureCoverage('identity')) &&
          hasDatabaseCoverage(getDatabaseType(type.typeId)!.coverage),
      });
      const copy = JSON.stringify(generation);
      nativeGenerationDecision(pg, type, generation);
      expect(JSON.stringify(generation)).toBe(copy);
    },
  );
  it.each([
    { increment: '0' },
    { start: '2147483648' },
    { min: '5', max: '5' },
    { min: '10', start: '9' },
    { increment: '-1', start: '0' },
    { increment: '9223372036854775808' },
    { cache: 0 },
    { start: '1;DROP' },
  ])('rejects invalid identity option %j', (sequence) => {
    expect(
      nativeGenerationDecision(pg, integer, {
        kind: 'identity',
        database: 'postgresql',
        mode: 'byDefault',
        sequence,
      }).allowed,
    ).toBe(false);
  });
  it('uses bigint tokens beyond JS safe integers', () => {
    const type: NativeColumnType = { ...integer, typeId: 'postgresql:bigint' };
    expect(
      nativeGenerationDecision(pg, type, {
        kind: 'identity',
        database: 'postgresql',
        mode: 'always',
        sequence: {
          min: '9007199254740992',
          max: '9223372036854775807',
          start: '9007199254740993',
        },
      }).allowed,
    ).toBe(true);
  });
  it('rejects generation defaults, nullability, DB mismatch and arrays', () => {
    const generation: NativeGeneration = {
      kind: 'identity',
      database: 'postgresql',
      mode: 'always',
    };
    expect(nativeGenerationDecision(pg, integer, generation, { hasDefault: true }).code).toBe(
      'generation.default-not-supported',
    );
    expect(nativeGenerationDecision(pg, integer, generation, { nullable: true }).allowed).toBe(
      false,
    );
    expect(nativeGenerationDecision(mysql, integer, generation).allowed).toBe(false);
    expect(
      nativeGenerationDecision(pg, { ...integer, array: { dimensions: 1 } }, generation).allowed,
    ).toBe(false);
  });
  it('checks engine AUTO_INCREMENT key prerequisites', () => {
    const type: NativeColumnType = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:int',
      parameters: {},
    };
    expect(
      nativeGenerationDecision(mysql, type, { kind: 'autoIncrement', database: 'mysql' }).allowed,
    ).toBe(false);
    expect(
      nativeGenerationDecision(
        mysql,
        type,
        { kind: 'autoIncrement', database: 'mysql' },
        { indexed: true, firstIndexColumn: true },
      ).allowed,
    ).toBe(true);
  });
  it('requires INTEGER single PK rowid for SQLite AUTOINCREMENT', () => {
    const type: NativeColumnType = {
        kind: 'builtin',
        database: 'sqlite',
        typeId: 'sqlite:integer',
        parameters: {},
      },
      generation: NativeGeneration = { kind: 'autoIncrement', database: 'sqlite' };
    expect(
      nativeGenerationDecision(sqlite, type, generation, {
        isPrimaryKeyColumn: true,
        primaryKeyColumns: 1,
      }).allowed,
    ).toBe(true);
    expect(
      nativeGenerationDecision(sqlite, type, generation, {
        isPrimaryKeyColumn: true,
        primaryKeyColumns: 1,
        withoutRowid: true,
      }).allowed,
    ).toBe(false);
  });
  it('allows only constrained current-time and UUID defaults matching target types', () => {
    const uuid: NativeColumnType = { ...integer, typeId: 'postgresql:uuid' };
    expect(nativeBuiltinDefaultDecision(pg, uuid, call('postgresql:gen_random_uuid')).allowed).toBe(
      true,
    );
    expect(
      nativeBuiltinDefaultDecision(pg, integer, call('postgresql:gen_random_uuid')).allowed,
    ).toBe(false);
    expect(nativeBuiltinDefaultDecision(pg, integer, call('mysql:current_timestamp')).allowed).toBe(
      false,
    );
    expect(
      nativeBuiltinDefaultDecision(pg, uuid, {
        kind: 'call',
        functionId: 'postgresql:gen_random_uuid',
        args: [{ kind: 'null' }],
      }).allowed,
    ).toBe(false);
    const varchar: NativeColumnType = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: 35 },
    };
    expect(nativeBuiltinDefaultDecision(mysql, varchar, call('mysql:uuid')).allowed).toBe(false);
    expect(
      nativeBuiltinDefaultDecision(
        mysql,
        { ...varchar, parameters: { length: 36 } },
        call('mysql:uuid'),
      ).allowed,
    ).toBe(true);
  });
  it('treats SQLite clocks as text in STRICT tables', () => {
    const type: NativeColumnType = {
      kind: 'builtin',
      database: 'sqlite',
      typeId: 'sqlite:integer',
      parameters: {},
    };
    expect(
      nativeBuiltinDefaultDecision(sqlite, type, call('sqlite:current_timestamp')).allowed,
    ).toBe(true);
    expect(
      nativeBuiltinDefaultDecision(sqlite, type, call('sqlite:current_timestamp'), { strict: true })
        .allowed,
    ).toBe(false);
    expect(
      nativeBuiltinDefaultDecision(
        sqlite,
        { ...type, typeId: 'sqlite:text' },
        call('sqlite:current_timestamp'),
        { strict: true },
      ).allowed,
    ).toBe(true);
  });
  it('executes SQLite UTC clocks in general and STRICT text/ANY declarations', () => {
    const db = new DatabaseSync(':memory:');
    try {
      for (const [i, definition] of ['v INTEGER', 'v TEXT', 'v ANY', 'v "Custom Type"'].entries()) {
        db.exec(
          `CREATE TABLE t${i} (${definition} DEFAULT CURRENT_TIMESTAMP)${i === 1 || i === 2 ? ' STRICT' : ''}`,
        );
        db.exec(`INSERT INTO t${i} DEFAULT VALUES`);
        expect(db.prepare(`SELECT typeof(v) AS storage,v FROM t${i}`).get()).toMatchObject({
          storage: 'text',
          v: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
        });
      }
      expect(
        nativeBuiltinDefaultDecision(
          sqlite,
          { kind: 'declared', database: 'sqlite', name: 'Custom Type', numericArguments: [] },
          call('sqlite:current_timestamp'),
        ).allowed,
      ).toBe(true);
      expect(
        nativeBuiltinDefaultDecision(
          sqlite,
          { kind: 'untyped', database: 'sqlite' },
          call('sqlite:current_timestamp'),
          { strict: true },
        ).allowed,
      ).toBe(false);
    } finally {
      db.close();
    }
  });
  it('requires plain MySQL timestamp/datetime for ON UPDATE', () => {
    const type: NativeColumnType = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:timestamp',
      parameters: { precision: 6 },
    };
    expect(nativeOnUpdateDecision(mysql, type, call('mysql:current_timestamp')).allowed).toBe(true);
    expect(nativeOnUpdateDecision(mysql, type, call('mysql:current_date')).allowed).toBe(false);
    expect(
      nativeOnUpdateDecision(mysql, type, call('mysql:current_timestamp'), {
        kind: 'computed',
        database: 'mysql',
        storage: 'stored',
        expression: { kind: 'null' },
      }).allowed,
    ).toBe(false);
  });
});
