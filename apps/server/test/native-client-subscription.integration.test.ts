import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import pg from 'pg';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { nativeSyncOperationResultSchema, type NativeEditorCommand } from '@ezerd/contracts';
import { NativeBackgroundRefresh } from '../../web/src/features/projects/native-background-refresh.js';
import { projectEntry, type ProjectEntry } from '../../web/src/features/projects/project-entry.js';
import {
  startNativeSyncSubscription,
  type NativeSyncEnvironment,
  type NativeSyncSocket,
} from '../../web/src/features/projects/native-sync-subscription.js';

type Actor = { id: string; token: string };

/** Browser transport adapter over real ws bytes; no gateway or timers are mocked. */
class BrowserSocket implements NativeSyncSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly socket: WebSocket;
  readonly frames: Record<string, unknown>[] = [];
  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on('open', () => this.onopen?.());
    this.socket.on('message', (raw) => {
      const data = raw.toString();
      this.frames.push(JSON.parse(data) as Record<string, unknown>);
      this.onmessage?.({ data });
    });
    this.socket.on('close', (code) => this.onclose?.({ code }));
    this.socket.on('error', () => this.onerror?.());
  }
  send(data: string) {
    this.socket.send(data);
  }
  close() {
    this.socket.close();
  }
}

describe.runIf(process.env.EZERD_DB_TEST === '1')(
  'native browser subscriber against actual server and MCP',
  () => {
    let app: NestExpressApplication, pool: pg.Pool, base: string, workspaceId: string;
    let owner: Actor, editor: Actor;
    const users: string[] = [];
    const sockets: BrowserSocket[] = [];
    const stops: (() => void)[] = [];
    const oldPort = process.env.PORT,
      oldMcpUrl = process.env.MCP_PUBLIC_URL;
    const compiled = createRequire(import.meta.url);
    const load = (path: string) => compiled(resolve('apps/server/dist', path));
    async function api(actor: Actor | null, path: string, method = 'GET', body?: unknown) {
      const response = await fetch(base + '/api' + path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(actor ? { authorization: 'Bearer ' + actor.token } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: await response.json() };
    }
    async function entry(actor: Actor, id: string): Promise<ProjectEntry> {
      const [snapshot, personal] = await Promise.all([
        api(actor, `/projects/${id}/document-state`),
        api(actor, `/projects/${id}/personal-state`),
      ]);
      expect(snapshot.status).toBe(200);
      expect(personal.status).toBe(200);
      return projectEntry(snapshot.data, personal.data);
    }
    const input = (entry: ProjectEntry, commands: NativeEditorCommand[]) => ({
      operationId: randomUUID(),
      groupId: randomUUID(),
      clientId: randomUUID(),
      expectedVersion: entry.snapshot.project.version,
      expectedSequence: entry.snapshot.sequence,
      expectedDatabaseRevision: entry.snapshot.project.databaseRevision,
      commands,
    });
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        !/^\/ezerd_qa_[a-f0-9]{32}$/.test(url.pathname)
      )
        throw Error('Normal test-isolated UUID database required');
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
      const actor = async (name: string): Promise<Actor> => {
        const created = await api(null, '/users', 'POST', {
          username: 'native-subscriber-' + name + '-' + randomUUID().slice(0, 8),
          pin: '0024',
        });
        expect(created.status).toBe(201);
        users.push(created.data.id);
        const session = await api(null, '/sessions', 'POST', {
          userId: created.data.id,
          pin: '0024',
        });
        expect(session.status).toBe(201);
        return { id: created.data.id, token: session.data.token };
      };
      owner = await actor('owner');
      editor = await actor('editor');
      const workspace = await api(owner, '/workspaces', 'POST', { name: 'Native subscriber QA' });
      expect(workspace.status).toBe(201);
      workspaceId = workspace.data.id;
      await pool.query(
        "INSERT INTO user_workspaces(workspace_id,user_id,role) VALUES($1,$2,'editor')",
        [workspaceId, editor.id],
      );
    });
    afterAll(async () => {
      stops.forEach((stop) => stop());
      await Promise.all(
        sockets.map(async ({ socket }) => {
          if (socket.readyState === WebSocket.CLOSED) return;
          await new Promise<void>((done) => {
            socket.once('close', done);
            socket.terminate();
          });
        }),
      );
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
          if (users.length) await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [users]);
        } finally {
          await pool.end();
        }
    });

    it('automatically applies MCP and another user edits, catches up after reconnect, then stops on access removal', async () => {
      const created = await api(owner, '/projects', 'POST', {
        workspaceId,
        name: 'Native browser receive QA',
        formatVersion: 2,
        databaseKind: 'postgresql',
      });
      expect(created.status).toBe(201);
      const id: string = created.data.id;
      let current = await entry(owner, id);
      const errors: unknown[] = [];
      const applied: ProjectEntry[] = [];
      let accessChanges = 0;
      const refresh = new NativeBackgroundRefresh({
        current: () => ({ identity: 'owner:' + id, entry: current }),
        load: () => entry(owner, id),
        apply: (next) => {
          current = next;
          applied.push(next);
        },
        error: (cause) => errors.push(cause),
      });
      const environment: NativeSyncEnvironment = {
        createSocket: (url) => {
          const socket = new BrowserSocket(url);
          sockets.push(socket);
          return socket;
        },
        now: Date.now,
        setTimeout,
        clearTimeout,
        listen: () => () => {},
      };
      const stop = startNativeSyncSubscription({
        projectId: id,
        workspaceId,
        token: owner.token,
        baseUrl: base,
        getCurrentHead: () => ({
          sequence: current.snapshot.sequence,
          databaseRevision: current.snapshot.project.databaseRevision,
        }),
        refresh: () => refresh.refresh(),
        accessChanged: () => {
          accessChanges++;
        },
        isOwnOperation: () => false,
        environment,
      });
      stops.push(stop);
      await vi.waitFor(() =>
        expect(sockets[0]!.frames.some((frame) => frame.type === 'subscribed')).toBe(true),
      );
      const issued = await api(owner, '/mcp-tokens', 'POST', {
        name: 'Actual subscriber integration',
      });
      expect(issued.status).toBe(201);
      const mcp = new Client({ name: 'native-subscriber-integration', version: '1.0.0' });
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
          requestInit: { headers: { authorization: 'Bearer ' + issued.data.token } },
        }),
      );
      try {
        const external = await mcp.callTool({
          name: 'apply_native_project_changes',
          arguments: {
            projectId: id,
            ...input(current, [
              {
                type: 'add_domain',
                value: { id: 'shared', name: 'MCP live domain', description: '' },
                placement: { x: 0, y: 0 },
              },
            ]),
          },
        });
        expect(external.isError).not.toBe(true);
        await vi.waitFor(() => expect(current.document?.domains[0]?.name).toBe('MCP live domain'));
        expect(applied).toHaveLength(1);
        expect(sockets[0]!.frames.some((frame) => frame.type === 'operation')).toBe(true);

        const anotherUser = await api(
          editor,
          `/projects/${id}/native-sync/commands`,
          'POST',
          input(current, [
            { type: 'patch_domain', id: 'shared', patch: { name: 'Second user live edit' } },
          ]),
        );
        expect(anotherUser.status).toBe(201);
        expect(nativeSyncOperationResultSchema.parse(anotherUser.data).status).toBe('accepted');
        await vi.waitFor(() =>
          expect(current.document?.domains[0]?.name).toBe('Second user live edit'),
        );
        expect(applied).toHaveLength(2);

        // Disconnect before the write: only the real reconnect subscribed head can invalidate this snapshot.
        const initialSocket = sockets[0]!.socket;
        await new Promise<void>((done) => {
          initialSocket.once('close', done);
          initialSocket.terminate();
        });
        const offlineEdit = await api(
          editor,
          `/projects/${id}/native-sync/commands`,
          'POST',
          input(current, [
            { type: 'patch_domain', id: 'shared', patch: { name: 'Missed while disconnected' } },
          ]),
        );
        expect(offlineEdit.status).toBe(201);
        expect(nativeSyncOperationResultSchema.parse(offlineEdit.data).status).toBe('accepted');
        await vi.waitFor(
          () => expect(current.document?.domains[0]?.name).toBe('Missed while disconnected'),
          { timeout: 5000 },
        );
        expect(sockets).toHaveLength(2);
        expect(sockets[1]!.frames[0]).toMatchObject({
          type: 'subscribed',
          sequence: current.snapshot.sequence,
        });
        expect(sockets[1]!.frames.some((frame) => frame.type === 'operation')).toBe(false);
        expect(applied).toHaveLength(3);
        expect(errors).toEqual([]);

        // Revocation is delivered over a live second-user socket and stops its subscription.
        const editorSockets: BrowserSocket[] = [];
        const editorStop = startNativeSyncSubscription({
          projectId: id,
          workspaceId,
          token: editor.token,
          baseUrl: base,
          getCurrentHead: () => ({ sequence: current.snapshot.sequence, databaseRevision: 0 }),
          refresh: async () => {
            throw Error('Unchanged editor must not refresh');
          },
          accessChanged: () => {
            accessChanges++;
          },
          isOwnOperation: () => false,
          environment: {
            ...environment,
            createSocket: (url) => {
              const socket = new BrowserSocket(url);
              sockets.push(socket);
              editorSockets.push(socket);
              return socket;
            },
          },
        });
        stops.push(editorStop);
        await vi.waitFor(() =>
          expect(editorSockets[0]!.frames.some((frame) => frame.type === 'subscribed')).toBe(true),
        );
        const removed = await api(
          owner,
          `/workspaces/${workspaceId}/members/${editor.id}`,
          'DELETE',
        );
        expect(removed.status).toBe(200);
        await vi.waitFor(() => expect(accessChanges).toBe(1));
        expect(
          editorSockets[0]!.frames.some((frame) => frame.type === 'workspace-access-changed'),
        ).toBe(true);
        await vi.waitFor(() => expect(editorSockets[0]!.socket.readyState).toBe(WebSocket.CLOSED));
        const deniedSockets: BrowserSocket[] = [];
        const deniedStop = startNativeSyncSubscription({
          projectId: id,
          workspaceId,
          token: editor.token,
          baseUrl: base,
          getCurrentHead: () => ({ sequence: current.snapshot.sequence, databaseRevision: 0 }),
          refresh: async () => {
            throw Error('Denied subscriber must not refresh');
          },
          accessChanged: () => {
            accessChanges++;
          },
          isOwnOperation: () => false,
          environment: {
            ...environment,
            createSocket: (url) => {
              const socket = new BrowserSocket(url);
              sockets.push(socket);
              deniedSockets.push(socket);
              return socket;
            },
          },
        });
        stops.push(deniedStop);
        await vi.waitFor(() => expect(accessChanges).toBe(2));
        expect(deniedSockets).toHaveLength(1);
        expect(deniedSockets[0]!.frames.some((frame) => frame.type === 'subscribed')).toBe(false);
        expect((await api(editor, `/projects/${id}/document-state`)).status).toBe(403);
      } finally {
        stop();
        await mcp.close();
      }
    }, 15000);
  },
);
