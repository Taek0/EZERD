import { describe, expect, it } from 'vitest';
import { databaseTypeCatalog } from './catalog.js';
import { keyEligibility } from './key-policy.js';
import { defaultDatabaseContext } from './profiles.js';
import { hasDatabaseCoverage, type DatabaseKind } from './definitions.js';
import { nativeFeatureCoverage } from './readiness.js';
import type { NativeColumnType } from './native-document.js';
import { nativeDDLFixture } from './ddl-fixtures.js';
import { inspectNativeDatabaseDocument, validateDatabaseDocument } from './validation.js';
import { compileNativeDatabaseDDL } from './ddl.js';

const nativeType = (kind: DatabaseKind, name: string): NativeColumnType =>
  ({
    kind: 'builtin',
    database: kind,
    typeId: `${kind}:${name}`,
    parameters: ['varchar', 'varbinary'].includes(name) && kind === 'mysql' ? { length: 12 } : {},
  }) as NativeColumnType;
const pgDenied = [
  'json',
  'jsonpath',
  'xml',
  'point',
  'line',
  'lseg',
  'box',
  'path',
  'polygon',
  'circle',
  'pg_snapshot',
  'txid_snapshot',
];

describe('default direct PK/UNIQUE type policy', () => {
  it('selects primary versus unique readiness without changing virtual-column engine eligibility', () => {
    const context = defaultDatabaseContext('mysql'),
      type = nativeType('mysql', 'int'),
      generation = {
        kind: 'computed',
        database: 'mysql',
        storage: 'virtual',
        expression: { kind: 'literal', literalType: 'number', value: '1' },
      } as const;
    const primary = keyEligibility(context, type, { generation, kind: 'primary' }),
      unique = keyEligibility(context, type, { generation, kind: 'unique' });
    expect(primary).toMatchObject({ primaryAllowed: false, uniqueAllowed: true, usable: false });
    expect(unique.usable).toBe(
      hasDatabaseCoverage(nativeFeatureCoverage('unique')) &&
        hasDatabaseCoverage(nativeFeatureCoverage('generatedVirtual')),
    );
    expect(unique.uniqueAllowed).toBe(true);
  });
  it('leaves unsupported key conditions unusable even with verified type declarations', () => {
    const my = defaultDatabaseContext('mysql'),
      type: NativeColumnType = {
        kind: 'builtin',
        database: 'mysql',
        typeId: 'mysql:varchar',
        parameters: { length: 769 },
      };
    expect(keyEligibility(my, type, { kind: 'primary' })).toMatchObject({
      primaryAllowed: false,
      usable: false,
      code: 'key.length-exceeded',
    });
    expect(keyEligibility(my, type, { kind: 'unique', charset: 'unknown' })).toMatchObject({
      uniqueAllowed: false,
      usable: false,
      code: 'key.charset-unverified',
    });
    expect(
      keyEligibility(
        defaultDatabaseContext('postgresql'),
        nativeType('postgresql', 'txid_snapshot'),
        { kind: 'unique' },
      ).usable,
    ).toBe(false);
  });
  it('requires ENUM/array and SQLite declaration family gates rather than a fabricated builtin ID', () => {
    const pg = defaultDatabaseContext('postgresql'),
      enumeration: NativeColumnType = { kind: 'projectEnum', database: 'postgresql', enumId: 'e' };
    expect(keyEligibility(pg, enumeration, { kind: 'unique' }).usable).toBe(
      hasDatabaseCoverage(nativeFeatureCoverage('enumType')) &&
        hasDatabaseCoverage(nativeFeatureCoverage('unique')),
    );
    expect(
      keyEligibility(pg, { ...enumeration, array: { dimensions: 1 } }, { kind: 'unique' }).usable,
    ).toBe(
      hasDatabaseCoverage(nativeFeatureCoverage('enumType')) &&
        hasDatabaseCoverage(nativeFeatureCoverage('unique')) &&
        hasDatabaseCoverage(nativeFeatureCoverage('array')),
    );
    for (const t of [
      { kind: 'declared', database: 'sqlite', name: 'Custom text', numericArguments: [] },
      { kind: 'untyped', database: 'sqlite' },
    ] satisfies NativeColumnType[])
      expect(keyEligibility(defaultDatabaseContext('sqlite'), t, { kind: 'unique' })).toMatchObject(
        {
          uniqueAllowed: true,
          coverage: false,
          usable: false,
          readinessCode: 'type.declaration-not-ready',
        },
      );
  });
  it.each(databaseTypeCatalog)(
    '$id reports actual type eligibility separately from coverage',
    (d) => {
      const type: NativeColumnType = ['mysql:enum', 'mysql:set'].includes(d.id)
        ? {
            kind: 'valueList',
            database: 'mysql',
            typeId: d.id as 'mysql:enum' | 'mysql:set',
            values: ['a', 'b'],
          }
        : nativeType(d.databaseKind, d.sqlName);
      const decision = keyEligibility(defaultDatabaseContext(d.databaseKind), type);
      const allowed = !(
        (d.databaseKind === 'postgresql' && pgDenied.includes(d.sqlName)) ||
        (d.databaseKind === 'mysql' &&
          (['json', 'geometry'].includes(d.category) ||
            /^(tiny|medium|long)?(text|blob)$/.test(d.sqlName)))
      );
      const covered =
        hasDatabaseCoverage(d.coverage) &&
        hasDatabaseCoverage(nativeFeatureCoverage('primaryKey')) &&
        hasDatabaseCoverage(nativeFeatureCoverage('unique')) &&
        (type.kind !== 'valueList' ||
          hasDatabaseCoverage(
            nativeFeatureCoverage(type.typeId === 'mysql:enum' ? 'enumColumn' : 'setColumn'),
          ));
      expect(decision).toMatchObject({
        primaryAllowed: allowed,
        uniqueAllowed: allowed,
        coverage: covered,
        usable: allowed && covered,
      });
      if (!allowed) expect(decision.code).toBe('key.type-not-supported');
    },
  );
  it.each(pgDenied)(
    '%s remains a valid declaration but both direct keys and btree indexes are blocked',
    (name) => {
      const doc = nativeDDLFixture('postgresql');
      doc.columns![0]!.physical.generation = { kind: 'none' };
      doc.columns![0]!.physical.type = nativeType('postgresql', name);
      doc.tableRelations = [];
      for (const kind of ['primary', 'unique'] as const) {
        doc.keys![0]!.kind = kind;
        expect(inspectNativeDatabaseDocument(doc, doc.database).map((i) => i.code)).toContain(
          'key.type-not-supported',
        );
        expect(compileNativeDatabaseDDL(doc).sql).toBe('');
      }
      doc.keys = [];
      expect(compileNativeDatabaseDDL(doc).canExport).toBe(true);
      doc.indexes![0]!.parts = [
        { expression: { kind: 'column', columnId: doc.columns![0]!.id }, direction: 'asc' },
      ];
      expect(inspectNativeDatabaseDocument(doc, doc.database).map((i) => i.code)).toContain(
        'index.type-not-supported',
      );
    },
  );
  it('does not promote special GiST/GIN types to direct key eligibility', () => {
    expect(
      keyEligibility(defaultDatabaseContext('postgresql'), nativeType('postgresql', 'jsonb'))
        .primaryAllowed,
    ).toBe(true);
    expect(
      keyEligibility(defaultDatabaseContext('postgresql'), nativeType('postgresql', 'pg_lsn'))
        .primaryAllowed,
    ).toBe(true);
    expect(
      keyEligibility(defaultDatabaseContext('postgresql'), nativeType('postgresql', 'tsvector'))
        .primaryAllowed,
    ).toBe(true);
    expect(
      keyEligibility(defaultDatabaseContext('postgresql'), nativeType('postgresql', 'point'))
        .primaryAllowed,
    ).toBe(false);
  });
  it('checks type context, legacy, parameters and CHARSET byte limits', () => {
    const pg = defaultDatabaseContext('postgresql'),
      my = defaultDatabaseContext('mysql');
    expect(keyEligibility(pg, nativeType('mysql', 'int')).primaryAllowed).toBe(false);
    const varchar: NativeColumnType = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: 769 },
    };
    expect(keyEligibility(my, varchar).code).toBe('key.length-exceeded');
    expect(keyEligibility(my, varchar, { charset: 'latin1' }).primaryAllowed).toBe(true);
    expect(keyEligibility(my, varchar, { charset: 'unknown' }).code).toBe('key.charset-unverified');
    expect(keyEligibility(my, { ...varchar, parameters: { length: -1 } }).category).toBe('invalid');
    expect(
      keyEligibility(pg, {
        kind: 'legacy',
        source: 'document-v1',
        original: { name: 'point', isArray: false },
      }).primaryAllowed,
    ).toBe(false);
  });
  it('keeps MySQL virtual generated UNIQUE eligibility separate from PRIMARY KEY', () => {
    const decision = keyEligibility(defaultDatabaseContext('mysql'), nativeType('mysql', 'int'), {
      generation: {
        kind: 'computed',
        database: 'mysql',
        storage: 'virtual',
        expression: { kind: 'literal', literalType: 'number', value: '1' },
      },
    });
    expect(decision).toMatchObject({
      primaryAllowed: false,
      uniqueAllowed: true,
      code: 'key.generated-not-supported',
    });
  });
  it('rejects aggregate composite string bytes and keeps trusted prior error repairs possible', () => {
    const doc = nativeDDLFixture('mysql');
    doc.tableRelations = [];
    doc.indexes = [];
    doc.checks = [];
    const columns = doc.columns!.filter((c) => c.tableId === doc.tables![0]!.id);
    doc.columns = columns;
    for (const column of columns) {
      column.physical.type = {
        kind: 'builtin',
        database: 'mysql',
        typeId: 'mysql:varchar',
        parameters: { length: 500 },
      };
      column.physical.generation = { kind: 'none' };
      column.physical.defaultValue = { kind: 'none' };
    }
    doc.keys![0]!.columnIds = columns.map((c) => c.id);
    expect(inspectNativeDatabaseDocument(doc, doc.database).map((i) => i.code)).toContain(
      'key.length-exceeded',
    );
    const candidate = structuredClone(doc);
    candidate.keys![0]!.name = 'renamed';
    expect(
      validateDatabaseDocument(candidate, doc.database, { mode: 'write', previous: doc }),
    ).toEqual([]);
    candidate.columns![0]!.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: 600 },
    };
    expect(
      validateDatabaseDocument(candidate, doc.database, { mode: 'write', previous: doc }).map(
        (i) => i.code,
      ),
    ).toContain('key.length-exceeded');
  });
});
