import { describe, expect, it } from 'vitest';
import { databaseTypeCatalog } from './catalog.js';
import { defaultDatabaseContext } from './profiles.js';
import { nativePostgresIndexMethodDecision } from './index-policy.js';
import type { NativeColumnType } from './native-document.js';
const context = defaultDatabaseContext('postgresql');
const type = (name: string): NativeColumnType =>
  ({
    kind: 'builtin',
    database: 'postgresql',
    typeId: `postgresql:${name}`,
    parameters: {},
  }) as NativeColumnType;
describe('PostgreSQL default index method type policy', () => {
  it.each([
    ['integer', 'gin', false],
    ['integer', 'brin', true],
    ['json', 'btree', false],
    ['jsonb', 'gin', true],
    ['boolean', 'brin', false],
    ['point', 'gist', true],
    ['point', 'btree', false],
    ['inet', 'gist', false],
    ['inet', 'spgist', true],
    ['money', 'hash', false],
    ['text', 'spgist', true],
    ['char', 'spgist', false],
    ['int4range', 'spgist', true],
    ['int4multirange', 'spgist', false],
    ['tsquery', 'gist', true],
    ['tsquery', 'gin', false],
  ] as const)('checks %s/%s default operator classes', (name, method, allowed) => {
    expect(nativePostgresIndexMethodDecision(context, method, type(name))).toMatchObject({
      allowed,
      usable: false,
    });
  });
  it('requires element operator support for arrays and handles enum scalar separately', () => {
    expect(
      nativePostgresIndexMethodDecision(context, 'gin', {
        ...type('integer'),
        array: { dimensions: 1 },
      } as NativeColumnType).allowed,
    ).toBe(true);
    expect(
      nativePostgresIndexMethodDecision(context, 'gin', {
        ...type('xml'),
        array: { dimensions: 1 },
      } as NativeColumnType).allowed,
    ).toBe(false);
    const enumeration: NativeColumnType = {
      kind: 'projectEnum',
      database: 'postgresql',
      enumId: 'enum',
    };
    expect(nativePostgresIndexMethodDecision(context, 'hash', enumeration).allowed).toBe(true);
    expect(nativePostgresIndexMethodDecision(context, 'brin', enumeration).allowed).toBe(false);
  });
  it('checks expression results without inventing JSON opclasses', () => {
    expect(
      nativePostgresIndexMethodDecision(context, 'gin', undefined, {
        family: 'json',
        jsonKind: 'json',
        nullable: true,
      }).allowed,
    ).toBe(false);
    expect(
      nativePostgresIndexMethodDecision(context, 'gin', undefined, {
        family: 'json',
        jsonKind: 'jsonb',
        nullable: true,
      }).allowed,
    ).toBe(true);
    expect(
      nativePostgresIndexMethodDecision(context, 'brin', undefined, {
        family: 'boolean',
        nullable: false,
      }).allowed,
    ).toBe(false);
  });
  it('never exposes a scalar method for an unknown type or another database', () => {
    expect(
      nativePostgresIndexMethodDecision(defaultDatabaseContext('sqlite'), 'btree', type('integer'))
        .allowed,
    ).toBe(false);
    expect(nativePostgresIndexMethodDecision(context, 'btree', type('unknown')).allowed).toBe(
      false,
    );
    for (const definition of databaseTypeCatalog.filter(
      (value) => value.databaseKind === 'postgresql',
    ))
      expect(
        nativePostgresIndexMethodDecision(context, 'btree', type(definition.sqlName)).usable,
      ).toBe(false);
  });
});
