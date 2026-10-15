import { describe, expect, it } from 'vitest';
import { defaultDatabaseContext } from './profiles.js';
import { createEmptyNativeDocument } from './native-document.js';
import {
  createNativeTable,
  createNativeColumn,
  createNativeForeignKeyFromPrimaryKey,
} from './editing.js';
import { planNativeDatabaseConversion } from './conversion.js';
import { validateDatabaseDocument } from './validation.js';
import { exportNativeDatabaseDDL, compileNativeDatabaseDDL } from './ddl.js';
import { nativeColumnTypeDisplay } from './display.js';
import { projectDatabaseCapabilities } from './capabilities.js';
import { keyEligibility } from './key-policy.js';

function fixture() {
  const database = defaultDatabaseContext('generic');
  const document = createEmptyNativeDocument(database);
  const table = createNativeTable(database, 't');
  table.physical.name = 'items';
  const column = createNativeColumn(database, table, 'c');
  column.physical.name = 'id';
  document.tables = [table];
  document.columns = [column];
  return { database, document, column };
}
describe('database-independent structural modeling', () => {
  it('creates and validates common types without claiming DDL support', () => {
    const { database, document, column } = fixture();
    expect(validateDatabaseDocument(document, database, { mode: 'write' })).toEqual([]);
    const capabilities = projectDatabaseCapabilities({ ...database, revision: 0 }, 2);
    expect(capabilities.types.some((type) => type.id === 'generic:varchar' && type.usable)).toBe(
      true,
    );
    column.physical.type = {
      kind: 'builtin',
      database: 'generic',
      typeId: 'generic:varchar',
      parameters: { length: 32 },
    };
    expect(nativeColumnTypeDisplay(column.physical.type)).toBe('VARCHAR(32)');
    expect(validateDatabaseDocument(document, database, { mode: 'write' })).toEqual([]);
    for (const exportDDL of [exportNativeDatabaseDDL, compileNativeDatabaseDDL]) {
      expect(exportDDL(document)).toMatchObject({
        canExport: false,
        sql: '',
        issues: [expect.objectContaining({ code: 'ddl.database-unspecified' })],
      });
    }
  });
  it('preserves custom labels and supports their structural keys', () => {
    const { database, document, column } = fixture();
    column.physical.type = { kind: 'custom', database: 'generic', name: 'UserId<string>' };
    expect(nativeColumnTypeDisplay(column.physical.type)).toBe('UserId<string>');
    expect(keyEligibility(database, column.physical.type).usable).toBe(true);
    expect(validateDatabaseDocument(document, database, { mode: 'write' })).toEqual([]);
  });
  it('copies custom PK types into FK columns and rejects mismatched references', () => {
    const { database, document, column } = fixture();
    column.physical.type = { kind: 'custom', database: 'generic', name: 'RecordId' };
    const child = createNativeTable(database, 'child');
    child.physical.name = 'children';
    document.tables!.push(child);
    document.keys = [
      {
        id: 'pk',
        tableId: 't',
        kind: 'primary',
        name: 'items_pk',
        columnIds: ['c'],
        scope: 'both',
      },
    ];
    const connected = createNativeForeignKeyFromPrimaryKey(document, {
      primaryTableId: 't',
      foreignTableId: 'child',
      primaryKeyId: 'pk',
      relationId: 'fk',
      columnIds: ['ref'],
    });
    expect(connected.columns![1]!.physical.type).toEqual(column.physical.type);
    expect(validateDatabaseDocument(connected, database, { mode: 'write' })).toEqual([]);
    connected.columns![1]!.physical.type = { kind: 'custom', database: 'generic', name: 'OtherId' };
    expect(
      validateDatabaseDocument(connected, database, { mode: 'write' }).some(
        (issue) => issue.code === 'foreign-key.type-mismatch',
      ),
    ).toBe(true);
  });
  it('allows empty context changes but never guesses conversions for an existing model', () => {
    const { database, document } = fixture();
    const pg = defaultDatabaseContext('postgresql');
    expect(
      planNativeDatabaseConversion(createEmptyNativeDocument(database), database, pg).canApply,
    ).toBe(true);
    expect(planNativeDatabaseConversion(document, database, pg).canApply).toBe(false);
    expect(planNativeDatabaseConversion(createEmptyNativeDocument(pg), pg, database).canApply).toBe(
      true,
    );
  });
  it('rejects an engine type in a generic project and invalid generic parameters', () => {
    const { database, document, column } = fixture();
    column.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:text',
      parameters: {},
    };
    expect(
      validateDatabaseDocument(document, database, { mode: 'write' }).some(
        (issue) => issue.code === 'type.not-supported',
      ),
    ).toBe(true);
    column.physical.type = {
      kind: 'builtin',
      database: 'generic',
      typeId: 'generic:numeric',
      parameters: { precision: 2, scale: 3 },
    };
    expect(validateDatabaseDocument(document, database, { mode: 'write' }).length).toBeGreaterThan(
      0,
    );
  });
});
