import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createEmptyNativeDocument,
  createNativeColumn,
  createNativeTable,
  defaultDatabaseContext,
} from '@ezerd/model';
import { WorkspaceService } from '../src/workspace/workspace.service.js';
import { NativeDDLService } from '../src/workspace/native-ddl.service.js';
import { NativeTransferService } from '../src/workspace/native-transfer.service.js';
import { nativeTransferStore } from './native-transfer-store.js';

const context = defaultDatabaseContext('generic');
function fixture() {
  const document = createEmptyNativeDocument(context);
  const table = createNativeTable(context, 'Records');
  const column = createNativeColumn(context, table, 'Identifier');
  column.physical.type = { kind: 'custom', database: 'generic', name: 'Business identifier' };
  document.tables = [table];
  document.columns = [column];
  const row = {
    id: randomUUID(),
    workspaceId: randomUUID(),
    name: 'Unspecified model',
    databaseKind: 'generic',
    databaseProfileId: 'generic-v1',
    databaseRevision: 0,
    status: 'active',
    version: 0,
    syncSequence: 0,
    document,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const access = {
    runProject: async (
      _actor: string,
      _project: string,
      _permission: string,
      run: (tx: unknown) => unknown,
    ) => run({ select: () => ({ from: () => ({ where: async () => [row] }) }) }),
  };
  return { document, row, access };
}

describe('RDBMS unspecified server boundaries', () => {
  it('creates native projects with the generic context persisted together', async () => {
    const { row } = fixture();
    let inserted: Record<string, unknown> | undefined;
    const tx = {
      insert: () => ({
        values: (value: Record<string, unknown>) => {
          if ('document' in value) inserted = value;
          return { returning: async () => [{ ...row, ...value }] };
        },
      }),
    };
    const access = {
      runWorkspace: async (
        _actor: string,
        _workspace: string,
        _permission: string,
        run: (tx: unknown) => unknown,
      ) => run(tx),
    };
    const service = new WorkspaceService({} as never, access as never);
    expect(
      await service.createProject(randomUUID(), {
        workspaceId: row.workspaceId,
        name: 'Unspecified model',
        databaseKind: 'generic',
      }),
    ).toMatchObject({ databaseKind: 'generic', databaseProfileId: 'generic-v1' });
    expect(inserted).toMatchObject({
      databaseKind: 'generic',
      databaseProfileId: 'generic-v1',
      document: { schemaVersion: 2, database: context },
    });
  });

  it('round trips custom types through native transfer without treating them as legacy SQL', async () => {
    const { row, access, document } = fixture();
    const exported = await new NativeTransferService({} as never, access as never).exportProject(
      randomUUID(),
      row.id,
    );
    expect(exported).toMatchObject({
      project: { databaseKind: 'generic', databaseProfileId: 'generic-v1' },
      sourceDocument: document,
      native: { status: 'available' },
    });
    const store = nativeTransferStore();
    await store.service.importProject(randomUUID(), {
      workspaceId: row.workspaceId,
      transfer: exported,
    });
    expect(store.stored).toHaveLength(1);
    expect(store.stored[0]).toMatchObject({
      databaseKind: 'generic',
      databaseProfileId: 'generic-v1',
      document: {
        database: context,
        columns: [{ physical: { type: document.columns![0]!.physical.type } }],
      },
    });
    expect(document.columns![0]!.physical.type.kind).toBe('custom');
  });

  it('blocks direct DDL export with an explicit diagnostic and no SQL', async () => {
    const { row, access } = fixture();
    const result = await new NativeDDLService(access as never).exportProject(randomUUID(), row.id);
    expect(result).toMatchObject({
      canExport: false,
      sql: '',
      database: { ...context, revision: 0 },
      issues: [{ code: 'ddl.database-unspecified', severity: 'error', path: '/database' }],
    });
    expect(result.issues[0]!.params.message).toContain('RDBMS 미지정');
  });

  it('adds the enum without using its uncommitted value in the profile constraint', () => {
    const migration = readFileSync(
      new URL('../drizzle/0016_generic_modeling.sql', import.meta.url),
      'utf8',
    );
    expect(migration).toContain("ADD VALUE 'generic'");
    expect(migration).toContain('"database_kind"::text = \'generic\'');
    expect(migration).not.toMatch(/"database_kind"\s*=\s*'generic'/);
    for (const profile of [
      'postgresql-18-v1',
      'mysql-8.4-innodb-v1',
      'sqlite-3.45-v1',
      'generic-v1',
    ])
      expect(migration).toContain(profile);
    expect(migration).not.toMatch(/UPDATE |DELETE |TRUNCATE |DROP TABLE/i);
  });
});
