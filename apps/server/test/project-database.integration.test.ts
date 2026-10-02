import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  createEmptyNativeDocument,
  createNativeColumn,
  createNativeTable,
  defaultDatabaseContext,
  type DatabaseKind,
  type NativeDesignDocument,
} from '@ezerd/model';
import { DatabaseService } from '../src/db/database.service.js';
import { WorkspaceAccessService } from '../src/workspace/workspace-access.service.js';
import { ProjectDatabaseService } from '../src/workspace/project-database.service.js';
import { NativeSyncService } from '../src/sync/native-sync.service.js';
import type { SyncGateway } from '../src/sync/sync.gateway.js';

describe.runIf(process.env.EZERD_DB_TEST === '1')(
  'native DB conversion real PostgreSQL transactions',
  () => {
    let pool: pg.Pool;
    let database: DatabaseService;
    let access: WorkspaceAccessService;
    let service: ProjectDatabaseService;
    let sync: NativeSyncService;
    const workspaceId = randomUUID();
    const ownerId = randomUUID();
    const viewerId = randomUUID();
    const editorId = randomUUID();
    const outsiderId = randomUUID();
    const publishDatabaseContext = vi.fn();
    const input = (targetKind: DatabaseKind = 'mysql') => ({
      operationId: randomUUID(),
      expectedVersion: 7,
      expectedSequence: 11,
      expectedDatabaseRevision: 3,
      targetKind,
    });
    const row = async (id: string) =>
      (await pool.query('SELECT * FROM projects WHERE id=$1', [id])).rows[0];
    const seed = async (kind: DatabaseKind = 'postgresql', document?: unknown) => {
      const id = randomUUID();
      await pool.query(
        'INSERT INTO projects (id,workspace_id,name,database_kind,database_profile_id,database_revision,version,sync_sequence,document) VALUES ($1,$2,$3,$4,$5,3,7,11,$6::jsonb)',
        [
          id,
          workspaceId,
          'Conversion ' + id,
          kind,
          defaultDatabaseContext(kind).profileId,
          JSON.stringify(document ?? createEmptyNativeDocument(defaultDatabaseContext(kind))),
        ],
      );
      return id;
    };
    const counts = async (id: string) =>
      (
        await pool.query(
          "SELECT (SELECT COUNT(*) FROM project_database_operations WHERE project_id=$1) AS operations, (SELECT COUNT(*) FROM workspace_audit_events WHERE details->>'projectId'=$1::text) AS audits, (SELECT COUNT(*) FROM sync_client_baselines WHERE project_id=$1) AS baselines, (SELECT COUNT(*) FROM sync_field_versions WHERE project_id=$1) AS fields",
          [id],
        )
      ).rows[0];
    beforeAll(async () => {
      const configured = new URL(process.env.DATABASE_URL!);
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname) ||
        !/^\/ezerd_qa_/.test(configured.pathname)
      )
        throw new Error('Use scripts/test-isolated.ts and a disposable local DB.');
      pool = new pg.Pool({ connectionString: configured.toString() });
      database = new DatabaseService();
      access = new WorkspaceAccessService(database);
      const gateway = { publishDatabaseContext } as unknown as SyncGateway;
      service = new ProjectDatabaseService(database, access, gateway);
      sync = new NativeSyncService(database, access, gateway);
      await pool.query('INSERT INTO workspace (workspace_id,workspace_name) VALUES ($1,$2)', [
        workspaceId,
        'Native conversion QA',
      ]);
      for (const [id, role] of [
        [ownerId, 'owner'],
        [editorId, 'editor'],
        [viewerId, 'viewer'],
        [outsiderId, null],
      ]) {
        await pool.query('INSERT INTO users (id,username,pin_hash) VALUES ($1,$2,$3)', [
          id,
          'conversion-' + id!.slice(0, 16),
          '0'.repeat(64),
        ]);
        if (role)
          await pool.query(
            'INSERT INTO user_workspaces (workspace_id,user_id,role) VALUES ($1,$2,$3)',
            [workspaceId, id, role],
          );
      }
    });
    afterAll(async () => {
      if (database) await database.onApplicationShutdown();
      if (!pool) return;
      try {
        await pool.query('DELETE FROM projects WHERE workspace_id=$1', [workspaceId]);
        await pool.query('DELETE FROM workspace_audit_events WHERE workspace_id=$1', [workspaceId]);
        await pool.query('DELETE FROM user_workspaces WHERE workspace_id=$1', [workspaceId]);
        await pool.query('DELETE FROM workspace WHERE workspace_id=$1', [workspaceId]);
        await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [
          [ownerId, viewerId, editorId, outsiderId],
        ]);
      } finally {
        await pool.end();
      }
    });
    it.each([
      ['postgresql', 'mysql'],
      ['postgresql', 'sqlite'],
      ['mysql', 'postgresql'],
      ['mysql', 'sqlite'],
      ['sqlite', 'postgresql'],
      ['sqlite', 'mysql'],
    ] as const)(
      'atomically changes empty %s to %s and preserves raw logical content/audit',
      async (sourceKind, targetKind) => {
        const document = createEmptyNativeDocument(defaultDatabaseContext(sourceKind));
        document.domains = [{ id: 'd', name: '  Original raw name  ', description: 'Keep' }];
        document.notes = [
          { id: 'n', viewId: 'overview', text: 'UUID varchar SQL remain untouched' },
        ];
        document.layout.nodes = [
          { id: 'node', objectId: 'd', viewId: 'overview', x: 40, y: 50, width: 200, height: 150 },
        ];
        const id = await seed(sourceKind, document);
        const request = input(targetKind);
        const before = await row(id);
        const preview = await service.preview(viewerId, id, request);
        expect(preview).toMatchObject({ canChange: true, version: 7, sequence: 11, issues: [] });
        expect(await row(id)).toEqual(before);
        const notifications = publishDatabaseContext.mock.calls.length;
        const result = await service.change(ownerId, id, request);
        const saved = await row(id);
        expect(saved).toMatchObject({
          database_kind: targetKind,
          database_profile_id: defaultDatabaseContext(targetKind).profileId,
          database_revision: 4,
          version: 8,
          sync_sequence: 12,
        });
        expect(saved.document).toEqual({
          ...document,
          database: defaultDatabaseContext(targetKind),
        });
        expect(result).toMatchObject({ changed: true, sequence: 12, version: 8 });
        expect(publishDatabaseContext.mock.calls.length).toBe(notifications + 1);
        const audit = (
          await pool.query(
            "SELECT details FROM workspace_audit_events WHERE details->>'operationId'=$1",
            [request.operationId],
          )
        ).rows[0].details;
        expect(audit).toMatchObject({
          sourceDocument: document,
          sourceVersion: 7,
          sourceSequence: 11,
          changedPaths: ['/database'],
          sequence: 12,
        });
        expect(await counts(id)).toEqual({
          operations: '1',
          audits: '1',
          baselines: '0',
          fields: '1',
        });
      },
    );
    it('keeps native polling reset, old histories/tombstones and personal state after a DB boundary', async () => {
      const id = await seed();
      const clientId = randomUUID();
      const user = { id: ownerId, username: 'conversion-owner', color: '#123456' };
      await sync.baseline(id, clientId, user);
      await pool.query(
        'INSERT INTO sync_field_versions (project_id,path,sequence,operation_id) VALUES ($1,$2,11,$3)',
        [id, '/columns/retired', randomUUID()],
      );
      await pool.query(
        "INSERT INTO sync_tombstones (project_id,object_id,operation_id,sequence,snapshot,expires_at) VALUES ($1,$2,$3,11,'{}',NOW()+INTERVAL '1 day')",
        [id, 'retired', randomUUID()],
      );
      await pool.query(
        "INSERT INTO sync_operations (project_id,operation_id,group_id,client_id,actor_id,sequence,base_sequence,baseline_issued_at,baseline_id,kind,fingerprint,changes,result) VALUES ($1,$2,$2,$3,$4,11,10,NOW(),$5,'online',$6,'[]','{}')",
        [id, randomUUID(), clientId, ownerId, randomUUID(), '1'.repeat(64)],
      );
      await pool.query(
        "INSERT INTO project_personal_states (project_id,user_id,state) VALUES ($1,$2,'{}')",
        [id, ownerId],
      );
      const oldField = (
        await pool.query('SELECT * FROM sync_field_versions WHERE project_id=$1', [id])
      ).rows[0];
      const oldHistory = (
        await pool.query('SELECT * FROM sync_operations WHERE project_id=$1', [id])
      ).rows[0];
      await service.change(ownerId, id, input());
      expect(
        (
          await pool.query('SELECT * FROM sync_field_versions WHERE project_id=$1 AND path=$2', [
            id,
            '/columns/retired',
          ])
        ).rows[0],
      ).toEqual(oldField);
      expect(
        (await pool.query('SELECT * FROM sync_operations WHERE project_id=$1', [id])).rows[0],
      ).toEqual(oldHistory);
      expect(
        (await pool.query('SELECT COUNT(*) FROM sync_tombstones WHERE project_id=$1', [id])).rows[0]
          .count,
      ).toBe('1');
      expect(
        (await pool.query('SELECT COUNT(*) FROM project_personal_states WHERE project_id=$1', [id]))
          .rows[0].count,
      ).toBe('1');
      expect((await counts(id)).baselines).toBe('0');
      // No fabricated native sync result: the intentional sequence gap requests a full reload.
      const events = await sync.events(id, 11, user);
      expect(events).toMatchObject({
        resetRequired: true,
        sequence: 12,
        databaseRevision: 4,
        events: [],
        document: { database: defaultDatabaseContext('mysql') },
      });
      expect((await sync.baseline(id, clientId, user)).databaseRevision).toBe(4);
    });
    it('replays after later DB changes/archiving/invalid current source without duplicate audit or WS', async () => {
      const id = await seed();
      const first = input();
      const result = await service.change(ownerId, id, first);
      await service.change(ownerId, id, {
        ...input('sqlite'),
        expectedVersion: 8,
        expectedSequence: 12,
        expectedDatabaseRevision: 4,
      });
      await pool.query("UPDATE projects SET status='archived',document='{}' WHERE id=$1", [id]);
      const before = await row(id);
      const previousCounts = await counts(id);
      const notifications = publishDatabaseContext.mock.calls.length;
      expect(await service.change(ownerId, id, first)).toEqual(result);
      expect(await row(id)).toEqual(before);
      expect(await counts(id)).toEqual(previousCounts);
      expect(publishDatabaseContext.mock.calls.length).toBe(notifications);
      await expect(
        service.change(ownerId, id, { ...first, targetKind: 'sqlite' }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(service.change(editorId, id, first)).rejects.toBeInstanceOf(ConflictException);
    });
    it.each(['viewer', 'archived'] as const)(
      'replays the same actor ACK after %s change while rejecting new writes and lost read access',
      async (mode) => {
        const id = await seed();
        const first = input();
        const result = await service.change(editorId, id, first);
        try {
          if (mode === 'viewer')
            await pool.query(
              "UPDATE user_workspaces SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",
              [workspaceId, editorId],
            );
          else
            await pool.query("UPDATE workspace SET status='archived' WHERE workspace_id=$1", [
              workspaceId,
            ]);
          const before = await row(id);
          const beforeCounts = await counts(id);
          const notifications = publishDatabaseContext.mock.calls.length;
          expect(await service.change(editorId, id, first)).toEqual(result);
          expect(await service.change(editorId, id, first)).toEqual(result);
          const fresh = {
            ...input('sqlite'),
            expectedVersion: 8,
            expectedSequence: 12,
            expectedDatabaseRevision: 4,
          };
          await expect(service.change(editorId, id, fresh)).rejects.toBeInstanceOf(
            ForbiddenException,
          );
          await expect(
            service.change(editorId, id, { ...first, targetKind: 'sqlite' }),
          ).rejects.toMatchObject({ response: { code: 'operation.identity-conflict' } });
          await expect(service.change(ownerId, id, first)).rejects.toMatchObject({
            response: { code: 'operation.identity-conflict' },
          });
          await expect(service.change(outsiderId, id, first)).rejects.toBeInstanceOf(
            ForbiddenException,
          );
          await pool.query('DELETE FROM user_workspaces WHERE workspace_id=$1 AND user_id=$2', [
            workspaceId,
            editorId,
          ]);
          await expect(service.change(editorId, id, first)).rejects.toBeInstanceOf(
            ForbiddenException,
          );
          expect(await row(id)).toEqual(before);
          expect(await counts(id)).toEqual(beforeCounts);
          expect(publishDatabaseContext.mock.calls.length).toBe(notifications);
        } finally {
          await pool.query("UPDATE workspace SET status='active' WHERE workspace_id=$1", [
            workspaceId,
          ]);
          await pool.query(
            "INSERT INTO user_workspaces (workspace_id,user_id,role) VALUES ($1,$2,'editor') ON CONFLICT (workspace_id,user_id) DO UPDATE SET role='editor'",
            [workspaceId, editorId],
          );
        }
      },
    );
    it('serializes concurrent duplicate operation IDs and stale competing changes', async () => {
      const id = await seed();
      const first = input();
      const notifications = publishDatabaseContext.mock.calls.length;
      const duplicate = await Promise.all([
        service.change(ownerId, id, first),
        service.change(ownerId, id, first),
      ]);
      expect(duplicate[0]).toEqual(duplicate[1]);
      expect(await counts(id)).toMatchObject({ operations: '1', audits: '1' });
      expect(publishDatabaseContext.mock.calls.length).toBe(notifications + 1);
      const secondId = await seed();
      const competing = await Promise.allSettled([
        service.change(ownerId, secondId, input()),
        service.change(ownerId, secondId, input('sqlite')),
      ]);
      expect(competing.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
      const rejection = competing.find(
        (item) => item.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(rejection.reason).toBeInstanceOf(ConflictException);
      expect(await counts(secondId)).toMatchObject({ operations: '1', audits: '1' });
    });
    it('waits on the same row lock as a document writer and rejects its stale snapshot', async () => {
      const id = await seed();
      const client = await pool.connect();
      await client.query('BEGIN');
      try {
        await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [id]);
        const pending = service.change(ownerId, id, input()).then(
          () => ({ error: null }),
          (error: unknown) => ({ error }),
        );
        await client.query(
          'UPDATE projects SET version=version+1,sync_sequence=sync_sequence+1 WHERE id=$1',
          [id],
        );
        await client.query('COMMIT');
        expect((await pending).error).toBeInstanceOf(ConflictException);
        expect(await row(id)).toMatchObject({
          database_kind: 'postgresql',
          version: 8,
          sync_sequence: 12,
        });
        expect(await counts(id)).toMatchObject({ operations: '0', audits: '0' });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
    it('rolls back project/document, ledger, audit, baseline and field versions if storage fails before commit', async () => {
      const id = await seed();
      const before = await row(id);
      await sync.baseline(id, randomUUID(), { id: ownerId, username: 'owner', color: '#123456' });
      const beforeCounts = await counts(id);
      const notifications = publishDatabaseContext.mock.calls.length;
      const original = database.db.transaction.bind(database.db);
      const hook = vi.spyOn(database.db, 'transaction').mockImplementationOnce((callback, config) =>
        original(async (tx) => {
          await callback(tx);
          throw new Error('Injected post-write storage failure');
        }, config),
      );
      try {
        await expect(service.change(ownerId, id, input())).rejects.toBeInstanceOf(
          ServiceUnavailableException,
        );
      } finally {
        hook.mockRestore();
      }
      expect(await row(id)).toEqual(before);
      expect(await counts(id)).toEqual(beforeCounts);
      expect(publishDatabaseContext.mock.calls.length).toBe(notifications);
    });
    it('blocks actual nonempty native writes under current readiness and checks role/read permissions', async () => {
      const context = defaultDatabaseContext('postgresql');
      const table = createNativeTable(context, 't');
      table.physical.name = 'records';
      const column = createNativeColumn(context, table, 'c');
      column.physical.name = 'id';
      column.physical.type = {
        kind: 'builtin',
        database: 'postgresql',
        typeId: 'postgresql:integer',
        parameters: {},
      };
      const document: NativeDesignDocument = {
        ...createEmptyNativeDocument(context),
        tables: [table],
        columns: [column],
      };
      const id = await seed('postgresql', document);
      const before = await row(id);
      const preview = await service.preview(viewerId, id, input());
      expect(preview).toMatchObject({
        canChange: false,
        reasonCode: 'database.conversion-required',
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'database.conversion-mapping-unverified',
            objectId: 'c',
          }),
        ]),
      });
      const permission = vi.spyOn(access, 'requireProject');
      try {
        await expect(service.change(ownerId, id, input())).rejects.toMatchObject({
          response: {
            issues: expect.arrayContaining([
              expect.objectContaining({ code: 'database.conversion-target-not-ready' }),
            ]),
          },
        });
        expect(permission).toHaveBeenCalledWith(ownerId, id, 'design', expect.anything());
      } finally {
        permission.mockRestore();
      }
      await expect(service.change(viewerId, id, input())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.preview(outsiderId, id, input())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(await row(id)).toEqual(before);
      expect(await counts(id)).toMatchObject({ operations: '0', audits: '0' });
    });
    it('retains v1 empty physical change and native no-op compatibility', async () => {
      const legacy = createEmptyDocument();
      const id = await seed('postgresql', legacy);
      const { expectedSequence: _sequence, ...request } = input();
      expect(await service.change(ownerId, id, request)).toMatchObject({
        changed: true,
        sequence: 11,
        version: 8,
      });
      expect((await row(id)).document).toEqual(legacy);
      const nativeId = await seed();
      const before = await row(nativeId);
      expect(await service.change(ownerId, nativeId, input('postgresql'))).toMatchObject({
        changed: false,
        sequence: 11,
        version: 7,
      });
      expect(await row(nativeId)).toEqual(before);
      expect(await counts(nativeId)).toMatchObject({ operations: '1', audits: '0', fields: '0' });
    });
  },
);
