import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import pg from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  clipboardCommand,
  clipboardFixture,
} from '../../web/src/features/projects/native-clipboard-test-fixtures.js';
import {
  nativeSyncOperationResultSchema,
  type NativeClipboardPasteCommand,
} from '@ezerd/contracts';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/application.js';
import { SyncGateway } from '../src/sync/sync.gateway.js';

describe.runIf(process.env.EZERD_DB_TEST === '1')(
  'actual native clipboard REST/MCP ordinary writes',
  () => {
    let app: NestExpressApplication,
      pool: pg.Pool,
      base: string,
      workspaceId: string,
      userId: string,
      token: string,
      client: Client;
    const previousPort = process.env.PORT,
      previousUrl = process.env.MCP_PUBLIC_URL;
    const users: string[] = [];
    async function request(
      path: string,
      method = 'GET',
      body?: unknown,
      auth: string | null = token,
    ) {
      const response = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(auth ? { authorization: `Bearer ${auth}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: (await response.json()) as any };
    }
    async function freshProject(kind: 'postgresql' | 'mysql' | 'sqlite' = 'postgresql') {
      const created = await request('/projects', 'POST', {
        workspaceId,
        name: 'Clipboard QA',
        databaseKind: kind,
      });
      expect(created.status, JSON.stringify(created.data)).toBe(201);
      const id = created.data.id as string;
      const upgraded = await request(`/projects/${id}/document/upgrade`, 'POST', {
        operationId: randomUUID(),
        clientId: randomUUID(),
        expectedVersion: 0,
        expectedSequence: 0,
        expectedDatabaseRevision: 0,
      });
      expect(upgraded.status, JSON.stringify(upgraded.data)).toBe(201);
      return id;
    }
    async function input(id: string, commands: unknown[]) {
      const current = (await request(`/projects/${id}/document-state`)).data;
      const operationId = randomUUID();
      return {
        operationId,
        groupId: operationId,
        clientId: randomUUID(),
        expectedVersion: current.project.version,
        expectedSequence: current.sequence,
        expectedDatabaseRevision: current.project.databaseRevision,
        commands,
        includeDocument: true,
      };
    }
    async function paste(id: string, command: NativeClipboardPasteCommand) {
      return request(`/projects/${id}/native-sync/commands`, 'POST', await input(id, [command]));
    }
    beforeAll(async () => {
      const configured = new URL(process.env.DATABASE_URL!);
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname) ||
        !/^\/ezerd_qa_/.test(configured.pathname)
      )
        throw Error('Use scripts/test-isolated.ts against a disposable local QA DB');
      pool = new pg.Pool({ connectionString: configured.toString() });
      app = await NestFactory.create<NestExpressApplication>(AppModule, {
        logger: false,
        bodyParser: false,
        abortOnError: false,
      });
      configureApplication(app);
      app.get(SyncGateway).attach(app.getHttpServer());
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      process.env.PORT = new URL(base).port;
      process.env.MCP_PUBLIC_URL = `${base}/mcp`;
      const user = await request(
        '/users',
        'POST',
        { username: 'clipboard-' + randomUUID().slice(0, 22), pin: '0024' },
        null,
      );
      expect(user.status).toBe(201);
      userId = user.data.id;
      users.push(userId);
      const session = await request('/sessions', 'POST', { userId, pin: '0024' }, null);
      expect(session.status).toBe(201);
      token = session.data.token;
      const workspace = await request('/workspaces', 'POST', { name: 'Clipboard QA' });
      expect(workspace.status).toBe(201);
      workspaceId = workspace.data.id;
      const mcpToken = await request('/mcp-tokens', 'POST', { name: 'Clipboard QA' });
      expect(mcpToken.status).toBe(201);
      client = new Client({ name: 'native-clipboard-qa', version: '1.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
          requestInit: { headers: { authorization: `Bearer ${mcpToken.data.token}` } },
        }) as never,
      );
    });
    afterAll(async () => {
      await client?.close();
      await app?.close();
      if (previousPort === undefined) delete process.env.PORT;
      else process.env.PORT = previousPort;
      if (previousUrl === undefined) delete process.env.MCP_PUBLIC_URL;
      else process.env.MCP_PUBLIC_URL = previousUrl;
      if (!pool) return;
      try {
        if (workspaceId) {
          await pool.query('DELETE FROM projects WHERE workspace_id=$1', [workspaceId]);
          await pool.query('DELETE FROM workspace_audit_events WHERE workspace_id=$1', [
            workspaceId,
          ]);
          await pool.query('DELETE FROM user_workspaces WHERE workspace_id=$1', [workspaceId]);
          await pool.query('DELETE FROM workspace WHERE workspace_id=$1', [workspaceId]);
        }
        if (users.length) await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [users]);
      } finally {
        await pool.end();
      }
    });
    it.each(['postgresql', 'mysql', 'sqlite'] as const)(
      'persists %s logical fragments with fresh IDs and replays immutable ACKs',
      async (kind) => {
        const id = await freshProject(kind),
          command = clipboardCommand(clipboardFixture(kind)),
          body = await input(id, [command]);
        const result = await request(`/projects/${id}/native-sync/commands`, 'POST', body);
        expect(result.status, JSON.stringify(result.data)).toBe(201);
        const ack = nativeSyncOperationResultSchema.parse(result.data);
        expect(ack.status).toBe('accepted');
        expect(ack.document?.tables).toHaveLength(2);
        const persisted = (await request(`/projects/${id}/document-state`)).data.sourceDocument;
        expect(persisted.tables.map((table: { id: string }) => table.id)).toEqual(
          command.newIds.slice(0, 2),
        );
        expect(persisted.tableRelations[0]).toMatchObject({
          sourceTableId: command.newIds[1],
          targetTableId: command.newIds[0],
        });
        expect(persisted.checks[0].expression.left.columnId).toBe(command.newIds[2]);
        expect(persisted.columns[0].physical.defaultValue.value).toBe('9007199254740993');
        const replay = await request(`/projects/${id}/native-sync/commands`, 'POST', body);
        expect(replay.data).toEqual(result.data);
      },
    );
    it('executes the registered MCP clipboard command and rejects foreign DB/legacy tool inputs', async () => {
      const id = await freshProject(),
        command = clipboardCommand();
      const result = await client.callTool({
        name: 'apply_native_project_changes',
        arguments: { projectId: id, ...(await input(id, [command])) },
      });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      expect(nativeSyncOperationResultSchema.parse(result.structuredContent).status).toBe(
        'accepted',
      );
      const foreign = await client.callTool({
        name: 'apply_native_project_changes',
        arguments: {
          projectId: id,
          ...(await input(id, [clipboardCommand(clipboardFixture('mysql'), '20000000')])),
        },
      });
      expect(foreign.isError).toBe(true);
      const legacy = structuredClone(command);
      legacy.clipboard.document.columns![0]!.physical.type = {
        kind: 'legacy',
        source: 'document-v1',
        original: { name: 'opaque', isArray: false },
      };
      const blocked = await client.callTool({
        name: 'apply_native_project_changes',
        arguments: { projectId: id, ...(await input(id, [legacy])) },
      });
      expect(blocked.isError).toBe(true);
    });
    it('rejects logical legacy, foreign database and unresolved borrowed FK without altering persisted source', async () => {
      const id = await freshProject(),
        before = (await request(`/projects/${id}/document-state`)).data.sourceDocument;
      const legacy = clipboardCommand();
      legacy.clipboard.document.columns![0]!.physical.defaultValue = {
        kind: 'legacyExpression',
        source: 'document-v1',
        original: 'old()',
      };
      expect((await paste(id, legacy)).status).toBe(400);
      expect((await paste(id, clipboardCommand(clipboardFixture('mysql')))).status).toBe(400);
      const external = clipboardCommand();
      delete external.clipboard.sourceProjectId;
      external.clipboard.document.tableRelations![0]!.targetTableId = 'existing-short';
      expect((await paste(id, external)).status).toBe(400);
      expect((await request(`/projects/${id}/document-state`)).data.sourceDocument).toEqual(before);
    });
    it('preserves ordinary retired identity and batch claims instead of granting paste restore authority', async () => {
      const id = await freshProject(),
        command = clipboardCommand();
      expect((await paste(id, command)).data.status).toBe('accepted');
      const removed = await request(
        `/projects/${id}/native-sync/commands`,
        'POST',
        await input(id, [
          {
            type: 'delete_objects',
            targets: command.newIds.slice(0, 2).map((id) => ({ collection: 'tables', id })),
          },
        ]),
      );
      expect(removed.data.status).toBe('accepted');
      const retired = await paste(id, command);
      expect(retired.status).toBe(201);
      expect(retired.data).toMatchObject({
        status: 'rejected',
        reasonCode: 'sync.identity-retired',
      });
      const fresh = clipboardCommand(clipboardFixture(), '20000000');
      const batch = await request(
        `/projects/${id}/native-sync/commands`,
        'POST',
        await input(id, [
          fresh,
          {
            type: 'delete_objects',
            targets: fresh.newIds.slice(0, 2).map((id) => ({ collection: 'tables', id })),
          },
          fresh,
        ]),
      );
      expect(batch.status).toBe(400);
      expect((await request(`/projects/${id}/document-state`)).data.sourceDocument.tables).toEqual(
        [],
      );
    });
    it('keeps project write permissions for a clipboard carrying sourceProjectId metadata', async () => {
      const id = await freshProject(),
        user = await request(
          '/users',
          'POST',
          { username: 'clipboard-viewer-' + randomUUID().slice(0, 12), pin: '0024' },
          null,
        );
      expect(user.status).toBe(201);
      users.push(user.data.id);
      const session = await request(
        '/sessions',
        'POST',
        { userId: user.data.id, pin: '0024' },
        null,
      );
      expect(session.status).toBe(201);
      await pool.query(
        "INSERT INTO user_workspaces (workspace_id,user_id,role) VALUES ($1,$2,'viewer')",
        [workspaceId, user.data.id],
      );
      const body = await input(id, [clipboardCommand()]);
      expect(
        (await request(`/projects/${id}/native-sync/commands`, 'POST', body, session.data.token))
          .status,
      ).toBe(403);
    });
  },
);
