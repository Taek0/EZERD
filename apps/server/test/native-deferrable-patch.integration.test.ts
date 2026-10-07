import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nativeSyncOperationResultSchema, type NativeEditorCommand } from '@ezerd/contracts';
import type { NativeDesignDocument } from '@ezerd/model';
import { deferrableFixture } from './native-deferrable-fixture.js';

describe.runIf(process.env.EZERD_DB_TEST === '1')(
  'actual locked native root deferrable patch write and replay',
  () => {
    let app: NestExpressApplication,
      pool: pg.Pool,
      base: string,
      token: string,
      userId: string,
      workspaceId: string;
    const oldPort = process.env.PORT,
      oldMcpUrl = process.env.MCP_PUBLIC_URL;
    const requireCompiled = createRequire(import.meta.url),
      load = (path: string) => requireCompiled(resolve('apps/server/dist', path));
    async function api(path: string, method = 'GET', value?: unknown) {
      const response = await fetch(base + '/api' + path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: 'Bearer ' + token } : {}),
        },
        ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      });
      return { status: response.status, data: (await response.json()) as any };
    }
    const stored = async (id: string) =>
      (
        await pool.query(
          'SELECT document,version,sync_sequence,database_revision FROM projects WHERE id=$1',
          [id],
        )
      ).rows[0];
    const operations = async (id: string) =>
      (
        await pool.query(
          'SELECT operation_id,changes,result FROM sync_operations WHERE project_id=$1 ORDER BY sequence',
          [id],
        )
      ).rows;
    const input = (version: number, sequence: number, commands: NativeEditorCommand[]) => ({
      operationId: randomUUID(),
      groupId: randomUUID(),
      clientId: randomUUID(),
      expectedVersion: version,
      expectedSequence: sequence,
      expectedDatabaseRevision: 0,
      includeDocument: true,
      commands,
    });
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        !/^\/ezerd_qa_/.test(url.pathname)
      )
        throw Error('Disposable local isolated DB required');
      pool = new pg.Pool({ connectionString: url.toString() });
      app = await NestFactory.create<NestExpressApplication>(load('app.module.js').AppModule, {
        logger: false,
        bodyParser: false,
        abortOnError: false,
      });
      load('application.js').configureApplication(app);
      app.get(load('sync/sync.gateway.js').SyncGateway).attach(app.getHttpServer());
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      process.env.PORT = new URL(base).port;
      process.env.MCP_PUBLIC_URL = base + '/mcp';
      const created = await api('/users', 'POST', {
        username: 'deferrable-' + randomUUID().slice(0, 20),
        pin: '0024',
      });
      expect(created.status).toBe(201);
      userId = created.data.id;
      const session = await api('/sessions', 'POST', { userId, pin: '0024' });
      expect(session.status).toBe(201);
      token = session.data.token;
      const workspace = await api('/workspaces', 'POST', { name: 'Native deferrable isolated QA' });
      expect(workspace.status).toBe(201);
      workspaceId = workspace.data.id;
    });
    afterAll(async () => {
      await app?.close();
      if (oldPort === undefined) delete process.env.PORT;
      else process.env.PORT = oldPort;
      if (oldMcpUrl === undefined) delete process.env.MCP_PUBLIC_URL;
      else process.env.MCP_PUBLIC_URL = oldMcpUrl;
      if (pool)
        try {
          if (workspaceId) {
            await pool.query('DELETE FROM projects WHERE workspace_id=$1', [workspaceId]);
            await pool.query('DELETE FROM workspace_audit_events WHERE workspace_id=$1', [
              workspaceId,
            ]);
            await pool.query('DELETE FROM user_workspaces WHERE workspace_id=$1', [workspaceId]);
            await pool.query('DELETE FROM workspace WHERE workspace_id=$1', [workspaceId]);
          }
          if (userId) await pool.query('DELETE FROM users WHERE id=$1', [userId]);
        } finally {
          await pool.end();
        }
    });
    it.each(['postgresql', 'mysql', 'sqlite'] as const)(
      '%s preserves omitted raw options, clears null under current previous validation, then replays the immutable ACK',
      async (kind) => {
        const created = await api('/projects', 'POST', {
          workspaceId,
          databaseKind: kind,
          formatVersion: 2,
          name: 'Deferrable ' + kind,
        });
        expect(created.status, JSON.stringify(created.data)).toBe(201);
        const id: string = created.data.id,
          source = deferrableFixture(kind);
        // Simulate a pre-existing compatible stored document, not a new feature grant or registry override.
        await pool.query(
          'UPDATE projects SET document=$2::jsonb,version=7,sync_sequence=11 WHERE id=$1',
          [id, JSON.stringify(source)],
        );
        const initial = await stored(id);
        expect(initial.document).toEqual(source);
        const route = `/projects/${id}/native-sync/commands`;
        const omission = input(7, 11, [
          { type: 'patch_key', id: 'key/a~b', patch: {} },
          {
            type: 'patch_foreign_key',
            id: 'fk/a~b',
            patch: { logical: { name: ' Metadata edit while preserving raw options ' } },
          },
        ]);
        const omitted = await api(route, 'POST', omission);
        expect(omitted.status, JSON.stringify(omitted.data)).toBe(201);
        const omittedAck = nativeSyncOperationResultSchema.parse(omitted.data);
        expect(omittedAck.status, JSON.stringify(omittedAck)).toBe('accepted');
        const beforeClear = await stored(id);
        expect(beforeClear).toMatchObject({ version: 8, sync_sequence: 12, database_revision: 0 });
        expect(beforeClear.document.keys[0].deferrable).toEqual(source.keys![0]!.deferrable);
        expect(beforeClear.document.tableRelations[0].deferrable).toEqual(
          source.tableRelations![0]!.deferrable,
        );
        expect(beforeClear.document.columns).toEqual(source.columns);
        const request = input(8, 12, [
          { type: 'patch_key', id: 'key/a~b', patch: { deferrable: null } },
          { type: 'patch_foreign_key', id: 'fk/a~b', patch: { deferrable: null } },
        ]);
        const response = await api(route, 'POST', request);
        expect(response.status, JSON.stringify(response.data)).toBe(201);
        const ack = nativeSyncOperationResultSchema.parse(response.data);
        expect(ack.status, JSON.stringify(ack)).toBe('accepted');
        const expected: NativeDesignDocument = structuredClone(beforeClear.document);
        delete expected.keys![0]!.deferrable;
        delete expected.tableRelations![0]!.deferrable;
        const current = await stored(id);
        expect(current).toMatchObject({
          version: 9,
          sync_sequence: 13,
          database_revision: 0,
          document: expected,
        });
        expect(ack.document).toEqual(expected);
        expect(ack.changedPaths).toEqual([
          '/keys/key~1a~0b/deferrable',
          '/tableRelations/fk~1a~0b/deferrable',
        ]);
        const rows = await operations(id);
        expect(rows).toHaveLength(2);
        expect(rows[1]!.changes).toEqual([
          {
            path: '/keys/key~1a~0b/deferrable',
            before: { initially: 'deferred' },
            after: null,
            afterExists: false,
          },
          {
            path: '/tableRelations/fk~1a~0b/deferrable',
            before: { initially: 'immediate' },
            after: null,
            afterExists: false,
          },
        ]);
        const fields = (
          await pool.query(
            'SELECT path,sequence,operation_id FROM sync_field_versions WHERE project_id=$1 AND operation_id=$2 ORDER BY path',
            [id, request.operationId],
          )
        ).rows;
        expect(fields).toEqual(
          ack.changedPaths.map((path) => ({
            path,
            sequence: 13,
            operation_id: request.operationId,
          })),
        );
        const same = await api(route, 'POST', request);
        expect(same.data).toEqual(response.data);
        expect(await stored(id)).toEqual(current);
        expect(await operations(id)).toEqual(rows);
        const alias = {
          ...request,
          commands: [
            { type: 'patch_key', id: 'key/a~b', patch: {} },
            { type: 'patch_foreign_key', id: 'fk/a~b', patch: {} },
          ],
        };
        const mismatch = await api(route, 'POST', alias);
        expect(mismatch).toMatchObject({ status: 409, data: { code: 'sync.replay-mismatch' } });
        expect(await stored(id)).toEqual(current);
        // Reapplying a stale explicit patch with identical current values is still a no-op.
        // Omitted deferrable fields must not recreate the options cleared by another writer.
        const stale = { ...omission, operationId: randomUUID(), groupId: randomUUID() };
        expect(await api(route, 'POST', stale)).toMatchObject({
          status: 400,
          data: { code: 'sync.no-changes' },
        });
        expect(await stored(id)).toEqual(current);
        expect(await operations(id)).toEqual(rows);
        const later = await api(
          route,
          'POST',
          input(9, 13, [
            {
              type: 'patch_foreign_key',
              id: 'fk/a~b',
              patch: { logical: { name: 'Later current document' } },
            },
          ]),
        );
        expect(later.status).toBe(201);
        expect(nativeSyncOperationResultSchema.parse(later.data).status).toBe('accepted');
        const afterLater = await stored(id),
          afterLaterRows = await operations(id);
        expect(afterLater).toMatchObject({ version: 10, sync_sequence: 14 });
        expect((await api(route, 'POST', request)).data).toEqual(response.data);
        expect(await stored(id)).toEqual(afterLater);
        expect(await operations(id)).toEqual(afterLaterRows);
        // Even when registry gates activate, a deferrable key cannot be a FK reference target.
        const invalid = input(10, 14, [
          { type: 'patch_key', id: 'key/a~b', patch: { deferrable: { initially: 'deferred' } } },
        ]);
        const rejected = await api(route, 'POST', invalid);
        expect(rejected.status).toBe(201);
        const rejectedAck = nativeSyncOperationResultSchema.parse(rejected.data);
        expect(rejectedAck.status).toBe('rejected');
        expect(rejectedAck.issues).toContainEqual(
          expect.objectContaining({ code: 'foreign-key.referenced-key-required' }),
        );
        expect(await stored(id)).toMatchObject({
          document: afterLater.document,
          version: 10,
          sync_sequence: 15,
          database_revision: 0,
        });
        const rejectedRows = await operations(id);
        expect((await api(route, 'POST', invalid)).data).toEqual(rejected.data);
        expect(await operations(id)).toEqual(rejectedRows);
      },
    );
  },
);
