import { describe, expect, it } from 'vitest';
import { databaseTypeCatalog } from './catalog.js';
import { hasDatabaseCoverage, type DatabaseKind } from './definitions.js';
import { createNativeColumn, createNativeTable } from './editing.js';
import { createEmptyNativeDocument, type NativeColumnType } from './native-document.js';
import { defaultDatabaseContext } from './profiles.js';
import { validateDatabaseDocument } from './validation.js';
import { planNativeDatabaseConversion } from './conversion.js';

const pg = defaultDatabaseContext('postgresql');
const mysql = defaultDatabaseContext('mysql');
function physical(kind: DatabaseKind = 'postgresql') {
  const context = defaultDatabaseContext(kind);
  const table = createNativeTable(context, 't');
  table.physical.name = 'records';
  if (kind === 'mysql') table.physical.options = { database: 'mysql', engine: 'InnoDB' };
  const column = createNativeColumn(context, table, 'c');
  column.physical.name = 'value';
  return { ...createEmptyNativeDocument(context), tables: [table], columns: [column] };
}
describe('native DB conversion without loss or readiness overrides', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'changes an empty %s physical design losslessly for every target',
    (kind) => {
      const source = defaultDatabaseContext(kind);
      const document = createEmptyNativeDocument(source);
      document.domains = [{ id: 'd', name: '  Raw domain  ', description: 'Untouched' }];
      document.notes = [{ id: 'n', viewId: 'overview', text: 'integer UUID lower(value)' }];
      document.layout.nodes = [
        { id: 'node', objectId: 'd', viewId: 'overview', x: 23, y: 45, width: 200, height: 150 },
      ];
      const before = structuredClone(document);
      for (const targetKind of ['postgresql', 'mysql', 'sqlite'] as const) {
        const target = defaultDatabaseContext(targetKind);
        const plan = planNativeDatabaseConversion(document, source, target);
        expect(plan.canApply).toBe(true);
        expect(plan.issues).toEqual([]);
        expect(plan.document).toEqual({ ...before, database: target });
        expect(plan.changedPaths).toEqual(kind === targetKind ? [] : ['/database']);
        expect(document).toEqual(before);
        expect(plan.document).not.toBe(document);
        expect(validateDatabaseDocument(plan.document!, target, { mode: 'write' })).toEqual([]);
      }
    },
  );
  it('blocks unsupported dormant mandatory physical fields without erasing them', () => {
    const document = physical();
    document.tables[0]!.scope = 'logical';
    document.columns[0]!.scope = 'logical';
    const plan = planNativeDatabaseConversion(document, pg, mysql);
    expect(plan.canApply).toBe(false);
    expect(plan.hasPhysicalDesign).toBe(false);
    expect(plan.document).toBeUndefined();
    expect(plan.issues).toContainEqual(
      expect.objectContaining({ objectId: 'c', code: 'database.conversion-mapping-unverified' }),
    );
  });
  it('rejects a source document in another project context and mismatched target profiles', () => {
    const document = createEmptyNativeDocument(pg);
    expect(planNativeDatabaseConversion(document, mysql, pg).issues).toContainEqual(
      expect.objectContaining({ code: 'database.context-changed', path: '/database' }),
    );
    expect(
      planNativeDatabaseConversion(document, pg, { kind: 'mysql', profileId: pg.profileId }).issues,
    ).toContainEqual(expect.objectContaining({ code: 'database.profile-unsupported' }));
  });
  it('checks the complete logical graph even when there is no physical design', () => {
    const document = createEmptyNativeDocument(pg);
    document.notes = [{ id: 'n', viewId: 'missing', text: 'invalid graph' }];
    const plan = planNativeDatabaseConversion(document, pg, mysql);
    expect(plan.canApply).toBe(false);
    expect(plan.document).toBeUndefined();
    expect(plan.issues).toContainEqual(
      expect.objectContaining({ objectId: 'n', category: 'invalid' }),
    );
  });
  it('does not promote any current catalog entry to verified', () => {
    expect(databaseTypeCatalog.length).toBeGreaterThan(0);
    expect(databaseTypeCatalog.every((type) => !hasDatabaseCoverage(type.coverage))).toBe(true);
    const document = physical();
    const issues = validateDatabaseDocument(document, pg, { mode: 'write' });
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'type.not-implemented', objectId: 'c' }),
    );
    const plan = planNativeDatabaseConversion(document, pg, mysql);
    expect(plan.canApply).toBe(false);
    expect(plan.document).toBeUndefined();
    expect(plan.issues).toContainEqual(
      expect.objectContaining({ code: 'database.conversion-target-not-ready', path: '/target' }),
    );
  });
  it.each([
    { kind: 'builtin', database: 'postgresql', typeId: 'postgresql:integer', parameters: {} },
    { kind: 'builtin', database: 'postgresql', typeId: 'postgresql:bigint', parameters: {} },
    {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:varchar',
      parameters: { length: 8 },
    },
    { kind: 'builtin', database: 'postgresql', typeId: 'postgresql:varchar', parameters: {} },
    { kind: 'builtin', database: 'postgresql', typeId: 'postgresql:uuid', parameters: {} },
    { kind: 'builtin', database: 'postgresql', typeId: 'postgresql:boolean', parameters: {} },
  ] satisfies NativeColumnType[])(
    'keeps $typeId blocked by actual readiness or unsupported mapping',
    (type) => {
      const document = physical();
      document.columns[0]!.physical.type = type;
      const before = structuredClone(document);
      const plan = planNativeDatabaseConversion(document, pg, mysql);
      expect(plan.canApply).toBe(false);
      expect(plan.document).toBeUndefined();
      expect(plan.issues).toContainEqual(
        expect.objectContaining({
          code:
            type.kind === 'builtin' &&
            ['postgresql:integer', 'postgresql:bigint'].includes(type.typeId)
              ? 'database.conversion-target-not-ready'
              : 'database.conversion-mapping-unverified',
          objectId: 'c',
          path: '/columns/c/physical/type',
        }),
      );
      expect(document).toEqual(before);
    },
  );
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'blocks SQLite dynamic semantics and orphan physical objects for %s',
    (kind) => {
      const document = physical(kind);
      document.tables = [];
      const target = defaultDatabaseContext(kind === 'sqlite' ? 'mysql' : 'sqlite');
      const plan = planNativeDatabaseConversion(document, document.database, target);
      expect(plan.canApply).toBe(false);
      expect(plan.hasPhysicalDesign).toBe(true);
      expect(plan.issues).toContainEqual(
        expect.objectContaining({
          code: 'database.conversion-dynamic-semantics-unverified',
          objectId: 'c',
        }),
      );
    },
  );
  it.each([
    { kind: 'builtin', database: 'mysql', typeId: 'mysql:int', parameters: {} },
    { kind: 'builtin', database: 'mysql', typeId: 'mysql:bigint', parameters: { unsigned: false } },
    { kind: 'builtin', database: 'mysql', typeId: 'mysql:int', parameters: { unsigned: true } },
    { kind: 'builtin', database: 'mysql', typeId: 'mysql:varchar', parameters: { length: 255 } },
  ] satisfies NativeColumnType[])(
    'keeps MySQL $typeId blocked by actual readiness or unsupported mapping',
    (type) => {
      const document = physical('mysql');
      document.columns[0]!.physical.type = type;
      const plan = planNativeDatabaseConversion(document, mysql, pg);
      expect(plan.canApply).toBe(false);
      expect(plan.document).toBeUndefined();
      expect(plan.issues).toContainEqual(
        expect.objectContaining({
          code:
            type.kind === 'builtin' &&
            ['mysql:int', 'mysql:bigint'].includes(type.typeId) &&
            (!('unsigned' in type.parameters) || type.parameters.unsigned === false)
              ? 'database.conversion-target-not-ready'
              : 'database.conversion-mapping-unverified',
          objectId: 'c',
        }),
      );
    },
  );
  it('checks source parameter rules before considering a conversion', () => {
    const document = physical();
    document.columns[0]!.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:varchar',
      parameters: { length: 10485761 },
    };
    expect(planNativeDatabaseConversion(document, pg, mysql).issues).toContainEqual(
      expect.objectContaining({ code: 'type.parameter-out-of-range', objectId: 'c' }),
    );
  });
  it('blocks dormant legacy definitions without treating them as trusted previous', () => {
    const document = physical();
    document.tables[0]!.scope = 'logical';
    document.columns[0]!.scope = 'logical';
    document.columns[0]!.physical.type = {
      kind: 'legacy',
      source: 'document-v1',
      original: { name: ' UUID ', isArray: false },
    };
    document.columns[0]!.physical.defaultValue = {
      kind: 'legacyExpression',
      source: 'document-v1',
      original: 'lower(unknown())',
    };
    const plan = planNativeDatabaseConversion(document, pg, mysql);
    expect(plan.canApply).toBe(false);
    expect(
      plan.issues.filter((issue) => issue.code === 'database.conversion-legacy-unresolved'),
    ).toHaveLength(2);
  });
  it('identifies installed collation, generation, array, enum, index and check objects', () => {
    const document = physical();
    const column = document.columns[0]!;
    column.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:integer',
      parameters: {},
      array: { dimensions: 1 },
    };
    column.physical.options = { database: 'postgresql', collation: 'site_installed' };
    column.physical.generation = { kind: 'identity', database: 'postgresql', mode: 'always' };
    document.enums = [{ id: 'e', schema: 'public', name: 'state', values: ['x', 'y'] }];
    const expression = { kind: 'column', columnId: 'c' } as const;
    const plan = planNativeDatabaseConversion(
      {
        ...document,
        indexes: [
          {
            id: 'i',
            tableId: 't',
            scope: 'physical',
            name: 'idx',
            unique: false,
            parts: [{ direction: 'asc', expression }],
            options: { database: 'postgresql', method: 'btree' },
          },
        ],
        checks: [{ id: 'q', tableId: 't', scope: 'physical', name: 'ck', expression }],
      },
      pg,
      mysql,
    );
    expect(plan.canApply).toBe(false);
    for (const [code, objectId] of [
      ['database.conversion-environment-unverified', 'c'],
      ['database.conversion-generation-unverified', 'c'],
      ['database.conversion-array-unverified', 'c'],
      ['database.conversion-enum-unverified', 'e'],
      ['database.conversion-expression-unverified', 'i'],
      ['database.conversion-expression-unverified', 'q'],
    ])
      expect(plan.issues).toContainEqual(expect.objectContaining({ code, objectId }));
  });
});
