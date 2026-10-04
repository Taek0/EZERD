import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  createEmptyNativeDocument,
  createNativeColumn,
  createNativeTable,
  defaultDatabaseContext,
  planNativeDatabaseConversion,
  type NativeDesignDocument,
} from '@ezerd/model';
import {
  databaseIssueSchema,
  projectDatabasePreviewSchema,
  previewProjectDatabaseSchema,
  changeProjectDatabaseSchema,
} from '@ezerd/contracts';
import { projects, projectDatabaseOperations } from '../src/db/schema.js';
import { ProjectDatabaseService } from '../src/workspace/project-database.service.js';
import type { WorkspaceAccessService } from '../src/workspace/workspace-access.service.js';
import type { DatabaseService } from '../src/db/database.service.js';
import type { SyncGateway } from '../src/sync/sync.gateway.js';

const projectId = randomUUID();
const actorId = randomUUID();
const pg = defaultDatabaseContext('postgresql');
const request = () => ({
  operationId: randomUUID(),
  expectedVersion: 7,
  expectedSequence: 11,
  expectedDatabaseRevision: 3,
  targetKind: 'mysql' as const,
});
function fixture(
  document:
    NativeDesignDocument | ReturnType<typeof createEmptyDocument> = createEmptyNativeDocument(pg),
) {
  const row = {
    id: projectId,
    workspaceId: randomUUID(),
    databaseKind: pg.kind,
    databaseProfileId: pg.profileId,
    databaseRevision: 3,
    status: 'active',
    version: 7,
    syncSequence: 11,
    document,
  };
  let replay: unknown;
  const log: string[] = [];
  const updates: Record<string, unknown>[] = [];
  const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === projectDatabaseOperations) log.push('replay');
          const value =
            table === projects
              ? [row]
              : table === projectDatabaseOperations && replay
                ? [replay]
                : [];
          return {
            then: (resolve: (result: unknown[]) => unknown) => resolve(value),
            for: async (lock: string) => {
              log.push(`lock:${lock}`);
              return value;
            },
          };
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
          log.push('write');
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        log.push('baseline-reset');
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        log.push('insert');
        return {
          then: (resolve: () => unknown) => resolve(),
          onConflictDoUpdate: async () => undefined,
        };
      },
    }),
  };
  const access = {
    requireProject: vi.fn(async (_actor: string, _project: string, permission: string) => {
      log.push(permission);
    }),
    runProject: vi.fn(async (_actor, _project, permission, callback) => {
      log.push(permission);
      const result = await callback(tx);
      log.push('commit');
      return result;
    }),
  };
  const transaction = vi.fn(async (callback: (executor: typeof tx) => Promise<unknown>) => {
    log.push('transaction');
    const result = await callback(tx);
    log.push('commit');
    return result;
  });
  const publishDatabaseContext = vi.fn(() => {
    log.push('notify');
  });
  const service = new ProjectDatabaseService(
    { db: { transaction } } as unknown as DatabaseService,
    access as unknown as WorkspaceAccessService,
    { publishDatabaseContext } as unknown as SyncGateway,
  );
  return {
    row,
    access,
    transaction,
    service,
    updates,
    inserts,
    log,
    publishDatabaseContext,
    setReplay: (value: unknown) => {
      replay = value;
    },
  };
}
describe('ProjectDatabaseService native conversion policy and transaction ordering', () => {
  it('keeps old preview/metadatа inputs and optional diagnostics consistent with the canonical issue contract', () => {
    const input = { expectedVersion: 7, targetKind: 'mysql' };
    expect(previewProjectDatabaseSchema.parse(input)).toEqual(input);
    expect(
      changeProjectDatabaseSchema.safeParse({ ...input, operationId: randomUUID() }).success,
    ).toBe(false);
    const output = {
      projectId,
      version: 7,
      sequence: 11,
      current: { ...pg, revision: 3 },
      target: defaultDatabaseContext('mysql'),
      canChange: true,
    };
    expect(projectDatabasePreviewSchema.parse(output)).toEqual(output);
    const issue = {
      code: 'database.conversion-mapping-unverified',
      category: 'unsupported',
      severity: 'error',
      objectId: 'c',
      path: '/columns/c/physical/type',
      params: { verified: false },
    };
    expect(projectDatabasePreviewSchema.parse({ ...output, issues: [issue] }).issues).toEqual([
      databaseIssueSchema.parse(issue),
    ]);
    for (const invalid of [
      { ...issue, severity: 'fatal' },
      { ...issue, params: { nested: {} } },
      { ...issue, arbitrary: true },
      { ...issue, objectId: 'x'.repeat(161) },
    ]) {
      expect(databaseIssueSchema.safeParse(invalid).success).toBe(false);
      expect(projectDatabasePreviewSchema.safeParse({ ...output, issues: [invalid] }).success).toBe(
        false,
      );
    }
    expect(previewProjectDatabaseSchema.safeParse({ ...input, document: {} }).success).toBe(false);
  });
  it('returns a read-only preview and requires current version/sequence', async () => {
    const f = fixture();
    expect(await f.service.preview(actorId, projectId, request())).toMatchObject({
      canChange: true,
      issues: [],
    });
    expect(f.log).toEqual(['read', 'commit']);
    expect(f.updates).toEqual([]);
    await expect(
      f.service.preview(actorId, projectId, { ...request(), expectedSequence: 12 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(f.publishDatabaseContext).not.toHaveBeenCalled();
  });
  it('updates native context, counters and baseline in one locked transaction and notifies after commit', async () => {
    const f = fixture();
    const input = request();
    expect(await f.service.change(actorId, projectId, input)).toMatchObject({
      changed: true,
      version: 8,
      sequence: 12,
      database: { kind: 'mysql', revision: 4 },
    });
    expect(f.updates[0]).toMatchObject({
      databaseKind: 'mysql',
      databaseRevision: 4,
      syncSequence: 12,
    });
    expect(f.updates[0]!.document).toBeDefined();
    expect(f.transaction).toHaveBeenCalledWith(expect.any(Function));
    expect(f.log.slice(0, 5)).toEqual([
      'transaction',
      'read',
      'lock:update',
      'replay',
      'manageProject',
    ]);
    expect(f.log.indexOf('baseline-reset')).toBeGreaterThan(f.log.indexOf('write'));
    expect(f.log.slice(-2)).toEqual(['commit', 'notify']);
    expect(f.inserts.map((item) => item.values)).toContainEqual(
      expect.objectContaining({ path: '/database', sequence: 12 }),
    );
    expect(f.inserts.map((item) => item.values)).toContainEqual(
      expect.objectContaining({
        action: 'project.database_changed',
        details: expect.objectContaining({ sourceDocument: f.row.document, sourceSequence: 11 }),
      }),
    );
  });
  it('replays before archived status, missing native sequence, invalid source and latest-state validation', async () => {
    const f = fixture();
    // Optional fields omitted exactly as the original old request did.
    const { expectedSequence: _sequence, ...input } = request();
    const first = fixture(createEmptyDocument());
    const result = await first.service.change(actorId, projectId, input);
    const saved = first.inserts.find((item) => item.table === projectDatabaseOperations)!.values;
    f.setReplay(saved);
    f.row.status = 'archived';
    f.row.version = 100;
    (f.row.document as unknown as { database: unknown }).database = null;
    expect(await f.service.change(actorId, projectId, input)).toEqual(result);
    expect(f.updates).toEqual([]);
    expect(f.publishDatabaseContext).not.toHaveBeenCalled();
    expect(f.access.requireProject.mock.calls.map((call) => call[2])).toEqual(['read']);
    await expect(
      f.service.change(actorId, projectId, { ...input, targetKind: 'sqlite' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(f.service.change(randomUUID(), projectId, input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('recalculates apply against a physical design added after preview and enforces design permission', async () => {
    const f = fixture();
    const input = request();
    expect((await f.service.preview(actorId, projectId, input)).canChange).toBe(true);
    const table = createNativeTable(pg, 't');
    table.physical.name = 'records';
    const column = createNativeColumn(pg, table, 'c');
    column.physical.name = 'value';
    f.row.document = { ...createEmptyNativeDocument(pg), tables: [table], columns: [column] };
    await expect(f.service.change(actorId, projectId, input)).rejects.toMatchObject({
      response: {
        code: 'database.conversion-required',
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'database.conversion-target-not-ready' }),
        ]),
      },
    });
    expect(f.access.requireProject).toHaveBeenCalledWith(
      actorId,
      projectId,
      'design',
      expect.anything(),
    );
    expect(f.updates).toEqual([]);
    f.access.requireProject.mockImplementation(async (_actor, _project, permission) => {
      if (permission === 'design') throw new ForbiddenException();
    });
    await expect(f.service.change(actorId, projectId, input)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('applies the activated integer plan under lock and audits its exact source/map before notification', async () => {
    const table = createNativeTable(pg, 't');
    table.physical.name = 'records';
    const column = createNativeColumn(pg, table, 'c');
    column.physical.name = 'value';
    column.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:integer',
      parameters: {},
    };
    const document = { ...createEmptyNativeDocument(pg), tables: [table], columns: [column] };
    const plan = planNativeDatabaseConversion(document, pg, defaultDatabaseContext('mysql'));
    expect(plan.engineVerified).toBe(true);
    expect(plan.candidate?.columns?.[0]?.physical.type).toMatchObject({ typeId: 'mysql:int' });
    expect(plan.canApply).toBe(true);
    const f = fixture(document),
      before = structuredClone(f.row),
      input = request();
    expect(await f.service.preview(actorId, projectId, input)).toMatchObject({
      canChange: true,
      issues: plan.issues,
    });
    expect(await f.service.change(actorId, projectId, input)).toMatchObject({
      changed: true,
      version: 8,
      sequence: 12,
      database: { kind: 'mysql', revision: 4 },
    });
    // Mock SQL executors record writes without materializing them into the fixture row.
    expect(f.row).toEqual(before);
    expect(f.updates).toHaveLength(1);
    expect(f.updates[0]).toMatchObject({
      databaseKind: 'mysql',
      databaseRevision: 4,
      syncSequence: 12,
    });
    expect(f.log).toContain('baseline-reset');
    expect(f.inserts.map((item) => item.values)).toContainEqual(
      expect.objectContaining({
        action: 'project.database_changed',
        details: expect.objectContaining({
          sourceDocument: document,
          sourceVersion: 7,
          sourceSequence: 11,
          sequence: 12,
          sourceMap: plan.sourceMap,
          changedPaths: plan.changedPaths,
          engineVerified: true,
          conversion: 'verified-signed-integer-v1',
        }),
      }),
    );
    expect(f.publishDatabaseContext).toHaveBeenCalledWith(projectId, 12, 4);
    expect(f.log.slice(-2)).toEqual(['commit', 'notify']);
    expect(f.log.slice(f.log.indexOf('transaction'), f.log.indexOf('transaction') + 6)).toEqual([
      'transaction',
      'read',
      'lock:update',
      'replay',
      'manageProject',
      'design',
    ]);
  });
  it('requires read for replay but checks manageProject only for a new operation', async () => {
    const first = fixture();
    const input = request();
    const result = await first.service.change(actorId, projectId, input);
    const saved = first.inserts.find((item) => item.table === projectDatabaseOperations)!.values;
    const f = fixture();
    f.setReplay(saved);
    f.access.requireProject.mockImplementation(async (_actor, _project, permission) => {
      if (permission !== 'read') throw new ForbiddenException();
    });
    expect(await f.service.change(actorId, projectId, input)).toEqual(result);
    expect(f.access.requireProject.mock.calls.map((call) => call[2])).toEqual(['read']);
    f.setReplay(undefined);
    await expect(f.service.change(actorId, projectId, request())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(f.access.requireProject.mock.calls.map((call) => call[2])).toEqual([
      'read',
      'read',
      'manageProject',
    ]);
    expect(f.updates).toEqual([]);
    expect(f.inserts).toEqual([]);
    expect(f.publishDatabaseContext).not.toHaveBeenCalled();
  });
  it('rejects replay when read permission is lost before locking or inspecting the operation', async () => {
    const f = fixture();
    f.access.requireProject.mockRejectedValueOnce(new ForbiddenException());
    await expect(f.service.change(actorId, projectId, request())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(f.log).toEqual(['transaction']);
    expect(f.updates).toEqual([]);
    expect(f.inserts).toEqual([]);
    expect(f.publishDatabaseContext).not.toHaveBeenCalled();
  });
  it.each(['expectedVersion', 'expectedSequence', 'expectedDatabaseRevision'] as const)(
    'rejects stale %s without writes',
    async (field) => {
      const f = fixture();
      const input = request();
      input[field] += 1;
      await expect(f.service.change(actorId, projectId, input)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(f.updates).toEqual([]);
      expect(f.inserts).toEqual([]);
    },
  );
  it('requires sequence on new native apply while preserving optional v1 sequence behavior', async () => {
    const { expectedSequence: _sequence, ...input } = request();
    await expect(fixture().service.change(actorId, projectId, input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const v1 = fixture(createEmptyDocument());
    expect(await v1.service.change(actorId, projectId, input)).toMatchObject({
      changed: true,
      sequence: 11,
    });
    expect(v1.updates[0]!.document).toBeUndefined();
    expect(v1.updates[0]!.syncSequence).toBeUndefined();
  });
  it('blocks malformed full contracts, raw byte budgets, source context mismatches and logical graph errors', async () => {
    for (const change of [
      (doc: NativeDesignDocument) => {
        (doc as unknown as Record<string, unknown>).unrecognized = true;
      },
      (doc: NativeDesignDocument) => {
        doc.database = defaultDatabaseContext('sqlite');
      },
      (doc: NativeDesignDocument) => {
        doc.notes = [{ id: 'n', viewId: 'absent', text: 'bad graph' }];
      },
      (doc: NativeDesignDocument) => {
        doc.domains = Array.from({ length: 150 }, (_, n) => ({
          id: 'd' + n,
          name: 'd',
          description: '가'.repeat(4000),
        }));
      },
    ]) {
      const doc = createEmptyNativeDocument(pg);
      change(doc);
      const f = fixture(doc);
      await expect(f.service.change(actorId, projectId, request())).rejects.toBeDefined();
      expect(f.updates).toEqual([]);
      expect(f.inserts).toEqual([]);
    }
  });
  it.each(['version', 'syncSequence', 'databaseRevision'] as const)(
    'rejects %s overflow',
    async (field) => {
      const f = fixture();
      f.row[field] = 2147483647;
      const input = request();
      input.expectedVersion = f.row.version;
      input.expectedSequence = f.row.syncSequence;
      input.expectedDatabaseRevision = f.row.databaseRevision;
      await expect(f.service.change(actorId, projectId, input)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(f.updates).toEqual([]);
    },
  );
});
