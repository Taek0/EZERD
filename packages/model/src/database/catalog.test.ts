import { describe, expect, it } from 'vitest';
import {
  databaseTypeCatalog,
  getDatabaseType,
  listDatabaseTypes,
  resolveDatabaseType,
  sqliteTypeAffinity,
  validateDatabaseTypeParameters,
} from './catalog.js';
import { defaultDatabaseContext, getDatabaseProfile } from './profiles.js';
import { databaseImplementationPaths, hasDatabaseCoverage } from './definitions.js';
import { checkDatabaseFeature } from './features.js';

const pg = defaultDatabaseContext('postgresql');
const mysql = defaultDatabaseContext('mysql');
const sqlite = defaultDatabaseContext('sqlite');

describe('native database catalog boundaries', () => {
  it('separates identical type spellings and DB-specific aliases', () => {
    expect(resolveDatabaseType(pg, ' INT ')?.definition.id).toBe('postgresql:integer');
    expect(resolveDatabaseType(mysql, 'INTEGER')?.definition.id).toBe('mysql:int');
    expect(resolveDatabaseType(sqlite, 'INTEGER')?.definition.id).toBe('sqlite:integer');
    expect(resolveDatabaseType(pg, 'bool')?.definition.id).toBe('postgresql:boolean');
    expect(resolveDatabaseType(mysql, 'BOOL')).toMatchObject({
      definition: { id: 'mysql:tinyint' },
      declarationAlias: 'boolean',
    });
    expect(resolveDatabaseType(sqlite, 'bool')).toBeUndefined();
    expect(resolveDatabaseType(mysql, 'jsonb')).toBeUndefined();
    expect(resolveDatabaseType(sqlite, 'uuid')).toBeUndefined();
  });
  it('rejects unsupported or mismatched profiles instead of guessing', () => {
    expect(() => getDatabaseProfile({ ...mysql, profileId: pg.profileId })).toThrow(
      'database.profile-unsupported',
    );
    expect(() => listDatabaseTypes(pg, { strict: true })).toThrow('table.mode-not-supported');
    expect(() =>
      getDatabaseProfile({ ...pg, profileId: 'postgresql-17' as typeof pg.profileId }),
    ).toThrow();
  });
  it('records all advanced native type families without advertising them as implemented', () => {
    for (const id of [
      'postgresql:jsonpath',
      'postgresql:xml',
      'postgresql:inet',
      'postgresql:int4range',
      'postgresql:datemultirange',
      'postgresql:regclass',
      'postgresql:pg_snapshot',
      'mysql:mediumint',
      'mysql:longblob',
      'mysql:set',
      'mysql:geometrycollection',
      'sqlite:any',
    ] as const) {
      expect(getDatabaseType(id)?.coverage.availability).toBe('specified');
    }
    expect(new Set(databaseTypeCatalog.map((type) => type.id)).size).toBe(
      databaseTypeCatalog.length,
    );
    expect(listDatabaseTypes(mysql)).toEqual([]);
    expect(listDatabaseTypes(pg)).toEqual([]);
    expect(listDatabaseTypes(sqlite)).toEqual([]);
  });
  it('preserves serial semantics and does not allow SQL snippets through aliases', () => {
    expect(resolveDatabaseType(pg, 'serial8')).toMatchObject({
      definition: { id: 'postgresql:bigint' },
      impliedGeneration: 'serial',
    });
    expect(resolveDatabaseType(mysql, 'serial')).toMatchObject({
      definition: { id: 'mysql:bigint' },
      parameters: { unsigned: true },
      impliedGeneration: 'autoIncrement',
      impliedColumnOptions: { nullable: false, unique: true },
    });
    expect(resolveDatabaseType(mysql, 'serial', { unsigned: false })).toBeUndefined();
    expect(resolveDatabaseType(pg, 'integer; DROP TABLE users')).toBeUndefined();
    expect(resolveDatabaseType(pg, 'varchar(20)')).toBeUndefined();
  });
  it('normalizes floating precision aliases without leaking precision into the base type', () => {
    expect(resolveDatabaseType(pg, 'float', { precision: 24 })).toMatchObject({
      definition: { id: 'postgresql:real' },
      parameters: {},
    });
    expect(resolveDatabaseType(mysql, 'float', { precision: 53 })).toMatchObject({
      definition: { id: 'mysql:double' },
      parameters: {},
    });
    expect(resolveDatabaseType(pg, 'float', { precision: 54 })).toBeUndefined();
    expect(resolveDatabaseType(mysql, 'real')?.definition.id).toBe('mysql:double');
  });
  it('requires completed evidence in every path before a feature can be activated', () => {
    const evidence = Object.fromEntries(
      databaseImplementationPaths.map((path) => [path, [`fixture:${path}`]]),
    );
    expect(hasDatabaseCoverage({ availability: 'verified', evidence })).toBe(true);
    expect(hasDatabaseCoverage({ availability: 'implemented', evidence })).toBe(false);
    expect(
      hasDatabaseCoverage({ availability: 'verified', evidence: { ...evidence, integration: [] } }),
    ).toBe(false);
    expect(
      hasDatabaseCoverage({ availability: 'verified', evidence: { ...evidence, server: [' '] } }),
    ).toBe(false);
  });
});

describe('type parameters follow the project DB', () => {
  it('allows PG negative and excess scale while rejecting the same MySQL declaration', () => {
    expect(
      validateDatabaseTypeParameters(getDatabaseType('postgresql:numeric')!, {
        precision: 20,
        scale: -2,
      }),
    ).toEqual([]);
    expect(
      validateDatabaseTypeParameters(getDatabaseType('postgresql:numeric')!, {
        precision: 2,
        scale: 5,
      }),
    ).toEqual([]);
    expect(
      validateDatabaseTypeParameters(getDatabaseType('mysql:decimal')!, {
        precision: 20,
        scale: -2,
      }),
    ).toMatchObject([{ parameter: 'scale', code: 'type.parameter-out-of-range' }]);
    expect(
      validateDatabaseTypeParameters(getDatabaseType('mysql:decimal')!, { precision: 2, scale: 5 }),
    ).toMatchObject([{ parameter: 'scale', code: 'type.parameter-out-of-range' }]);
  });
  it('checks dependent parameters, required lengths and DB defaults', () => {
    expect(
      validateDatabaseTypeParameters(getDatabaseType('postgresql:numeric')!, { scale: 2 }),
    ).toMatchObject([{ parameter: 'precision', code: 'type.parameter-required' }]);
    expect(
      validateDatabaseTypeParameters(getDatabaseType('mysql:decimal')!, { scale: 10 }),
    ).toEqual([]);
    expect(
      validateDatabaseTypeParameters(getDatabaseType('mysql:decimal')!, { scale: 11 }),
    ).toMatchObject([{ parameter: 'scale', code: 'type.parameter-out-of-range' }]);
    expect(validateDatabaseTypeParameters(getDatabaseType('mysql:varchar')!, {})).toMatchObject([
      { parameter: 'length', code: 'type.parameter-required' },
    ]);
    expect(validateDatabaseTypeParameters(getDatabaseType('postgresql:varchar')!, {})).toEqual([]);
  });
  it('rejects irrelevant, deprecated and malformed parameters instead of ignoring them', () => {
    expect(
      validateDatabaseTypeParameters(getDatabaseType('mysql:int')!, { unsigned: true }),
    ).toEqual([]);
    expect(
      validateDatabaseTypeParameters(getDatabaseType('postgresql:integer')!, { unsigned: true }),
    ).toMatchObject([{ code: 'type.option-not-supported' }]);
    expect(
      validateDatabaseTypeParameters(getDatabaseType('mysql:decimal')!, { unsigned: true }),
    ).toMatchObject([{ code: 'type.option-not-supported' }]);
    for (const length of [NaN, Infinity, -1, 256, 1.2, '3'])
      expect(
        validateDatabaseTypeParameters(getDatabaseType('mysql:char')!, { length }),
      ).not.toEqual([]);
    expect(validateDatabaseTypeParameters(getDatabaseType('mysql:char')!, { length: 0 })).toEqual(
      [],
    );
    expect(
      validateDatabaseTypeParameters(getDatabaseType('postgresql:char')!, { length: 0 }),
    ).not.toEqual([]);
    expect(
      validateDatabaseTypeParameters(getDatabaseType('mysql:bit')!, { bitLength: 65 }),
    ).not.toEqual([]);
    expect(
      validateDatabaseTypeParameters(getDatabaseType('mysql:date')!, { precision: 1 }),
    ).not.toEqual([]);
  });
  it('rejects prototype-named options and interval precision without seconds', () => {
    expect(
      validateDatabaseTypeParameters(
        getDatabaseType('postgresql:integer')!,
        JSON.parse('{"__proto__":true,"constructor":1,"toString":2}'),
      ),
    ).toHaveLength(3);
    const interval = getDatabaseType('postgresql:interval')!;
    expect(
      validateDatabaseTypeParameters(interval, { fields: 'YEAR TO MONTH', precision: 3 }),
    ).toMatchObject([{ code: 'type.option-not-supported', parameter: 'precision' }]);
    expect(
      validateDatabaseTypeParameters(interval, { fields: 'DAY TO SECOND', precision: 3 }),
    ).toEqual([]);
  });
});

describe('SQLite modes and conditional native features', () => {
  it('follows SQLite affinity priority rather than inferring types from familiar names', () => {
    expect(sqliteTypeAffinity('FLOATING POINT')).toBe('integer');
    expect(sqliteTypeAffinity('STRING')).toBe('numeric');
    expect(sqliteTypeAffinity('VARCHAR(20)')).toBe('text');
    expect(sqliteTypeAffinity('')).toBe('blob');
    expect(sqliteTypeAffinity('DOUBLE PRECISION')).toBe('real');
    expect(sqliteTypeAffinity('BLOBINT')).toBe('integer');
  });
  it('defines the exact STRICT type set and keeps normal declarations available only in the catalog', () => {
    expect(
      listDatabaseTypes(sqlite, { strict: true, includeSpecified: true })
        .map((type) => type.sqlName)
        .sort(),
    ).toEqual(['any', 'blob', 'int', 'integer', 'real', 'text']);
    expect(
      checkDatabaseFeature(sqlite, 'column', { strict: true, typeId: 'sqlite:varchar' }),
    ).toMatchObject({ supported: false });
    expect(
      checkDatabaseFeature(sqlite, 'column', { strict: true, typeId: 'sqlite:text' }),
    ).toMatchObject({ supported: true, usable: false });
  });
  it('distinguishes engines that have native arrays, ENUM objects and SET', () => {
    expect(checkDatabaseFeature(mysql, 'array', { typeId: 'mysql:int' }).supported).toBe(false);
    expect(
      checkDatabaseFeature(pg, 'array', { typeId: 'postgresql:integer', generation: 'serial' })
        .supported,
    ).toBe(false);
    expect(checkDatabaseFeature(pg, 'array', { typeId: 'postgresql:integer' })).toMatchObject({
      supported: true,
      usable: false,
    });
    expect(checkDatabaseFeature(sqlite, 'enumType').supported).toBe(false);
    expect(checkDatabaseFeature(mysql, 'enumColumn').supported).toBe(true);
    expect(checkDatabaseFeature(pg, 'setColumn').supported).toBe(false);
    expect(checkDatabaseFeature(mysql, 'setColumn').supported).toBe(true);
  });
  it('checks AUTO_INCREMENT index position/count and SQLite exact INTEGER PK requirements', () => {
    const facts = { typeId: 'mysql:int' as const, indexed: true, firstIndexColumn: true };
    expect(checkDatabaseFeature(mysql, 'autoIncrement', facts).supported).toBe(true);
    expect(
      checkDatabaseFeature(mysql, 'autoIncrement', { ...facts, firstIndexColumn: false }).code,
    ).toBe('generation.key-required');
    expect(
      checkDatabaseFeature(mysql, 'autoIncrement', { ...facts, otherAutoIncrementColumns: 1 }).code,
    ).toBe('generation.multiple-columns');
    const pk = {
      typeId: 'sqlite:integer' as const,
      isPrimaryKeyColumn: true,
      primaryKeyColumns: 1,
    };
    expect(checkDatabaseFeature(sqlite, 'autoIncrement', pk).supported).toBe(true);
    expect(
      checkDatabaseFeature(sqlite, 'autoIncrement', { ...pk, typeId: 'sqlite:int' }).supported,
    ).toBe(false);
    expect(
      checkDatabaseFeature(sqlite, 'autoIncrement', { ...pk, primaryKeyColumns: 2 }).supported,
    ).toBe(false);
    expect(
      checkDatabaseFeature(sqlite, 'autoIncrement', { ...pk, withoutRowid: true }).supported,
    ).toBe(false);
  });
  it('rejects unsupported FK actions and impossible SET NULL across DBs', () => {
    expect(
      checkDatabaseFeature(mysql, 'foreignKey', { foreignKeyAction: 'SET DEFAULT' }).code,
    ).toBe('foreign-key.action-not-supported');
    expect(
      checkDatabaseFeature(pg, 'foreignKey', { foreignKeyAction: 'SET DEFAULT' }).supported,
    ).toBe(true);
    expect(
      checkDatabaseFeature(sqlite, 'foreignKey', { foreignKeyAction: 'SET NULL', nullable: false })
        .supported,
    ).toBe(false);
    expect(checkDatabaseFeature(pg, 'column', { typeId: 'mysql:int' }).code).toBe(
      'type.not-supported',
    );
  });
});
