import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, addTable, addColumn, defaultDatabaseContext } from '@ezerd/model';
import { NativeTransferController } from '../src/workspace/native-transfer.controller.js';
import { nativeTransferStore } from './native-transfer-store.js';

const actor = { id: randomUUID(), username: 'owner', color: '#4169e1' };
const workspaceId = randomUUID();
function file(kind: 'postgresql' | 'mysql' | 'sqlite' = 'postgresql') {
  const props = { common: {}, logical: {}, physical: {} };
  const document = addColumn(
    addTable(
      createEmptyDocument(),
      {
        id: 'table',
        domainId: null,
        scope: 'both',
        logical: { name: 'Table', definition: '' },
        physical: { name: 'records', schema: ' public ', comment: '' },
        customProperties: props,
      },
      { x: 10, y: 20 },
    ),
    {
      id: 'column',
      tableId: 'table',
      scope: 'both',
      logical: { name: 'Column', definition: '', semanticType: '', required: false },
      physical: {
        name: 'raw',
        type: { name: ' unknown_raw_type ', isArray: false },
        nullable: true,
        defaultExpression: " custom_fn(' raw ') ",
        comment: '',
      },
      customProperties: props,
    },
  );
  return {
    format: 'ezerd-project',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    project: { name: ' Imported ', databaseKind: kind },
    document,
  };
}

describe('all import entry points create Native projects', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'derives %s v2 from raw v1 and preserves migration evidence',
    async (kind) => {
      const input = file(kind),
        before = structuredClone(input),
        store = nativeTransferStore();
      const result = await store.service.importProject(actor.id, { workspaceId, transfer: input });
      expect(store.stored[0].document).toMatchObject({
        schemaVersion: 2,
        database: defaultDatabaseContext(kind),
      });
      expect(store.stored[0].document.columns[0].physical.type).toMatchObject({
        kind: 'legacy',
        original: input.document.columns![0]!.physical.type,
      });
      expect(store.stored[0].document.columns[0].physical.defaultValue).toMatchObject({
        kind: 'legacyExpression',
        original: " custom_fn(' raw ') ",
      });
      expect(store.audits[0].details.importProvenance.sourceDocument).toEqual(input.document);
      expect(result.project).toMatchObject({
        workspaceId,
        name: 'Imported',
        databaseKind: kind,
        databaseRevision: 0,
      });
      expect(result.migrationIssues.length).toBeGreaterThan(0);
      expect(input).toEqual(before);
    },
  );
  it('preserves the old REST response shape but creates independent Native documents on both routes', async () => {
    const store = nativeTransferStore();
    const controller = new NativeTransferController(store.service, {
      authenticateHeader: vi.fn(async () => actor),
    } as never);
    const input = { workspaceId, transfer: file() };
    const project = await controller.importCompatibleProject(input, 'Bearer test');
    const native = await controller.importProject(input, 'Bearer test');
    expect(project.id).not.toBe(native.project.id);
    expect(store.stored.map((row) => row.document.schemaVersion)).toEqual([2, 2]);
    expect(store.stored[0].document.tables[0].id).not.toBe(store.stored[1].document.tables[0].id);
    expect(store.access.runWorkspace).toHaveBeenCalledWith(
      actor.id,
      workspaceId,
      'createProject',
      expect.any(Function),
    );
  });
  it('rejects unauthenticated and unauthorized imports before writing', async () => {
    const store = nativeTransferStore();
    const controller = new NativeTransferController(store.service, {
      authenticateHeader: vi.fn(async () => {
        throw new UnauthorizedException();
      }),
    } as never);
    await expect(
      controller.importCompatibleProject({ workspaceId, transfer: file() }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    store.access.runWorkspace.mockRejectedValueOnce(new ForbiddenException());
    await expect(
      store.service.importProject(actor.id, { workspaceId, transfer: file() }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(store.db.insert).not.toHaveBeenCalled();
  });
  it('validates the file and graph before insertion and reports storage failures', async () => {
    const store = nativeTransferStore();
    expect(() =>
      store.service.importProject(actor.id, { workspaceId, transfer: { ...file(), secret: true } }),
    ).toThrow(BadRequestException);
    const invalid = file();
    invalid.document.columns![0]!.tableId = 'missing';
    await expect(
      store.service.importProject(actor.id, { workspaceId, transfer: invalid }),
    ).rejects.toBeDefined();
    expect(store.db.insert).not.toHaveBeenCalled();
    await expect(
      nativeTransferStore(true).service.importProject(actor.id, { workspaceId, transfer: file() }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
