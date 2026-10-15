import { describe, expect, it } from 'vitest';
import {
  createEmptyNativeDocument,
  createNativeTable,
  createNativeColumn,
  defaultDatabaseContext,
  validateDatabaseDocument,
  projectDatabaseCapabilities,
} from '@ezerd/model';
import { nativeColumnTypeSchema, nativeStoredDesignDocumentSchema } from './native-document.js';
import { nativeTransferReadSchema } from './native-transfer.js';
import { projectDatabaseCapabilitiesSchema } from './database-capabilities.js';

describe('generic modeling transport', () => {
  it('round trips common/custom types in a native project file', () => {
    const database = defaultDatabaseContext('generic');
    const document = createEmptyNativeDocument(database);
    const table = createNativeTable(database, 'table');
    table.physical.name = 'records';
    const column = createNativeColumn(database, table, 'column');
    column.physical.name = 'value';
    column.physical.type = { kind: 'custom', database: 'generic', name: 'List<UserId>' };
    document.tables = [table];
    document.columns = [column];
    expect(nativeStoredDesignDocumentSchema.parse(document)).toEqual(document);
    expect(validateDatabaseDocument(document, database, { mode: 'write' })).toEqual([]);
    const transfer = {
      format: 'ezerd-project',
      formatVersion: 2,
      exportedAt: '2026-10-15T00:00:00.000Z',
      project: { name: 'Model', databaseKind: 'generic', databaseProfileId: 'generic-v1' },
      document,
    };
    expect(nativeTransferReadSchema.parse(JSON.parse(JSON.stringify(transfer)))).toEqual(transfer);
    expect(
      projectDatabaseCapabilitiesSchema.parse({
        projectId: '00000000-0000-4000-8000-000000000001',
        version: 0,
        sequence: 0,
        ...projectDatabaseCapabilities({ ...database, revision: 0 }, 2),
      }),
    ).toMatchObject({ ddlExport: false, customType: true });
  });
  it('bounds custom input and rejects foreign engine custom types', () => {
    for (const name of ['', '   ', 'x'.repeat(121), 'a\nb', 'a\0b']) {
      expect(
        nativeColumnTypeSchema.safeParse({ kind: 'custom', database: 'generic', name }).success,
      ).toBe(false);
    }
    expect(
      nativeColumnTypeSchema.parse({ kind: 'custom', database: 'generic', name: '  Money  ' }),
    ).toEqual({ kind: 'custom', database: 'generic', name: 'Money' });
    expect(
      nativeColumnTypeSchema.safeParse({ kind: 'custom', database: 'postgresql', name: 'Money' })
        .success,
    ).toBe(false);
    expect(
      nativeColumnTypeSchema.safeParse({
        kind: 'builtin',
        database: 'generic',
        typeId: 'postgresql:text',
        parameters: {},
      }).success,
    ).toBe(false);
    expect(
      nativeColumnTypeSchema.safeParse({
        kind: 'builtin',
        database: 'generic',
        typeId: 'generic:integer',
        parameters: { length: 10 },
      }).success,
    ).toBe(false);
  });
});
