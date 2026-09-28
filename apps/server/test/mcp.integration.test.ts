import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import pg from 'pg';

describe.runIf(process.env.EZERD_DB_TEST === '1')('MCP PostgreSQL and HTTP integration', () => {
  let app: NestExpressApplication;
  let pool: pg.Pool;
  let base: string;
  let userA: { id: string; session: string };
  let userB: { id: string; session: string };
  const users: string[] = [];
  const projects: string[] = [];

  async function api(path: string, method = 'GET', body?: unknown, session?: string) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(session ? { authorization: `Bearer ${session}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      data: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text,
    };
  }

  async function createUser(label: string) {
    const created = await api('/users', 'POST', {
      username: `mcp-${label}-${randomUUID().slice(0, 8)}`,
      pin: '0012',
    });
    expect(created.status).toBe(201);
    users.push(created.data.id);
    const login = await api('/sessions', 'POST', { userId: created.data.id, pin: '0012' });
    expect(login.status).toBe(201);
    return { id: created.data.id as string, session: login.data.token as string };
  }

  async function issue(session: string, name: string) {
    const response = await api('/mcp-tokens', 'POST', { name }, session);
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    return response.data as { id: string; token: string };
  }

  function client(token: string) {
    const instance = new Client({ name: 'integration', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    return { instance, transport };
  }

  beforeAll(async () => {
    const { AppModule } = await import('../dist/app.module.js');
    const { readConfig } = await import('../dist/config.js');
    const config = readConfig();
    pool = new pg.Pool({ connectionString: config.DATABASE_URL });
    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: false,
      bodyParser: false,
    });
    const { configureApplication } = await import('../dist/application.js');
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    process.env.PORT = new URL(base).port;
    process.env.MCP_PUBLIC_URL = `${base}/mcp`;
    userA = await createUser('a');
    userB = await createUser('b');
  });

  afterAll(async () => {
    if (pool) {
      if (projects.length)
        await pool.query('DELETE FROM projects WHERE id = ANY($1::uuid[])', [projects]);
      if (users.length) await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
      await pool.end();
    }
    if (app) await app.close();
  });

  it('enforces token ownership, hashing, expiry and revocation', async () => {
    expect((await api('/mcp-tokens', 'POST', { name: 'missing-session' })).status).toBe(401);
    const owned = await issue(userA.session, 'owner token');
    expect(
      (await api(`/mcp-tokens/${owned.id}/record`, 'DELETE', undefined, userA.session)).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${base}/mcp`, {
          method: 'POST',
          headers: { authorization: `Bearer ${userA.session}`, 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(401);
    expect((await api('/mcp-tokens', 'GET', undefined, owned.token)).status).toBe(401);
    expect(
      (
        await fetch(`${base}/mcp`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${owned.token}`,
            'content-type': 'application/json',
            origin: 'https://evil.invalid',
          },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect((await api('/mcp-tokens', 'GET', undefined, userA.session)).data[0]).not.toHaveProperty(
      'token',
    );
    expect((await api('/mcp-tokens', 'GET', undefined, userB.session)).data).toEqual([]);
    expect((await api(`/mcp-tokens/${owned.id}`, 'DELETE', undefined, userB.session)).status).toBe(
      404,
    );
    const stored = await pool.query('SELECT token_hash FROM mcp_tokens WHERE id = $1', [owned.id]);
    expect(stored.rows[0].token_hash).toBe(createHash('sha256').update(owned.token).digest('hex'));
    expect(stored.rows[0].token_hash).not.toContain(owned.token);

    const expired = await issue(userA.session, 'expired token');
    await pool.query(
      "UPDATE mcp_tokens SET expires_at = now() - interval '1 minute' WHERE id = $1",
      [expired.id],
    );
    expect(
      (
        await fetch(`${base}/mcp`, {
          method: 'POST',
          headers: { authorization: `Bearer ${expired.token}`, 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(401);
    expect((await api(`/mcp-tokens/${owned.id}`, 'DELETE', undefined, userA.session)).status).toBe(
      200,
    );
    expect((await api(`/mcp-tokens/${owned.id}/record`, 'DELETE')).status).toBe(401);
    expect(
      (await api(`/mcp-tokens/${owned.id}/record`, 'DELETE', undefined, userB.session)).status,
    ).toBe(404);
    const removed = await api(`/mcp-tokens/${owned.id}/record`, 'DELETE', undefined, userA.session);
    expect(removed.status).toBe(200);
    expect(removed.data).toEqual({ id: owned.id, deleted: true });
    expect((await pool.query('SELECT id FROM mcp_tokens WHERE id = $1', [owned.id])).rows).toEqual(
      [],
    );
    expect(
      (
        await fetch(`${base}/mcp`, {
          method: 'POST',
          headers: { authorization: `Bearer ${owned.token}`, 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(401);
  });

  it('executes every MCP tool with concurrency, replay and actor protections', async () => {
    const tokenA = await issue(userA.session, 'tool actor A');
    const tokenB = await issue(userB.session, 'tool actor B');
    const a = client(tokenA.token);
    const b = client(tokenB.token);
    await a.instance.connect(a.transport);
    await b.instance.connect(b.transport);
    try {
      const listedTools = await a.instance.listTools();
      expect(listedTools.tools).toHaveLength(19);
      const list = await a.instance.callTool({ name: 'list_projects', arguments: {} });
      expect(list.isError).not.toBe(true);
      const created = await a.instance.callTool({
        name: 'create_project',
        arguments: { name: 'MCP integration' },
      });
      const project = created.structuredContent as { id: string; version: number };
      projects.push(project.id);
      const opened = await a.instance.callTool({
        name: 'get_project',
        arguments: { projectId: project.id },
      });
      expect(opened.structuredContent).toMatchObject({
        project: { id: project.id },
        syncSequence: 0,
      });
      const renamed = await a.instance.callTool({
        name: 'update_project',
        arguments: {
          projectId: project.id,
          update: { expectedVersion: 0, name: 'MCP integration renamed' },
        },
      });
      expect((renamed.structuredContent as { version: number }).version).toBe(1);
      expect(
        (
          await a.instance.callTool({
            name: 'update_project',
            arguments: { projectId: project.id, update: { expectedVersion: 0, name: 'stale' } },
          })
        ).isError,
      ).toBe(true);

      const addOperation = randomUUID();
      const applyArguments = {
        projectId: project.id,
        expectedVersion: 1,
        expectedSequence: 0,
        operationId: addOperation,
        groupId: randomUUID(),
        clientId: randomUUID(),
        commands: [
          { type: 'upsert_domain', value: { id: 'sales', name: 'Sales', description: '' } },
        ],
      };
      const applied = await a.instance.callTool({
        name: 'apply_project_changes',
        arguments: applyArguments,
      });
      expect(applied.isError).not.toBe(true);
      expect((applied.structuredContent as { actor: { id: string } }).actor.id).toBe(userA.id);
      expect(applied.structuredContent).not.toHaveProperty('document');
      const appliedWithDocument = await a.instance.callTool({
        name: 'apply_project_changes',
        arguments: { ...applyArguments, includeDocument: true },
      });
      expect(appliedWithDocument.isError).not.toBe(true);
      expect(appliedWithDocument.structuredContent).toHaveProperty('document.domains');
      expect(
        (
          await a.instance.callTool({
            name: 'apply_project_changes',
            arguments: applyArguments,
          })
        ).structuredContent,
      ).toEqual(applied.structuredContent);
      expect(
        (
          await a.instance.callTool({
            name: 'apply_project_changes',
            arguments: {
              ...applyArguments,
              commands: [
                {
                  type: 'upsert_domain',
                  value: { id: 'sales', name: 'Changed replay', description: '' },
                },
              ],
            },
          })
        ).isError,
      ).toBe(true);
      expect(
        (
          await a.instance.callTool({
            name: 'apply_project_changes',
            arguments: { ...applyArguments, operationId: randomUUID() },
          })
        ).isError,
      ).toBe(true);

      const diagnosis = await a.instance.callTool({
        name: 'diagnose_project',
        arguments: { projectId: project.id },
      });
      expect(diagnosis.structuredContent).toEqual({ diagnostics: [] });
      const summary = await a.instance.callTool({
        name: 'get_project_summary',
        arguments: { projectId: project.id },
      });
      expect(summary.structuredContent).toMatchObject({
        counts: { domains: 1 },
        syncSequence: 1,
      });
      expect(summary.structuredContent).not.toHaveProperty('document');
      const view = await a.instance.callTool({
        name: 'get_project_view',
        arguments: { projectId: project.id, viewId: 'overview' },
      });
      expect((view.structuredContent as { nodes: unknown[] }).nodes).toHaveLength(1);
      const tables = await a.instance.callTool({
        name: 'list_tables',
        arguments: { projectId: project.id },
      });
      expect(tables.structuredContent).toMatchObject({ tables: [], nextCursor: null });
      const history = await a.instance.callTool({
        name: 'get_project_history',
        arguments: { projectId: project.id, since: 0 },
      });
      expect((history.structuredContent as { history: unknown[] }).history.length).toBeGreaterThan(
        0,
      );
      expect(history.structuredContent).not.toHaveProperty('history.0.document');
      expect(history.structuredContent).not.toHaveProperty('history.0.changes');

      const undoRequest = {
        operationId: randomUUID(),
        groupId: randomUUID(),
        clientId: randomUUID(),
      };
      expect(
        (
          await b.instance.callTool({
            name: 'undo_project_operation',
            arguments: {
              projectId: project.id,
              sourceOperationId: addOperation,
              request: undoRequest,
            },
          })
        ).isError,
      ).toBe(true);
      const undone = await a.instance.callTool({
        name: 'undo_project_operation',
        arguments: { projectId: project.id, sourceOperationId: addOperation, request: undoRequest },
      });
      expect(undone.isError).not.toBe(true);
      const restored = await a.instance.callTool({
        name: 'restore_project_deletion',
        arguments: {
          projectId: project.id,
          deletedOperationId: undoRequest.operationId,
          request: { operationId: randomUUID(), groupId: randomUUID(), clientId: randomUUID() },
        },
      });
      expect(restored.isError).not.toBe(true);
      expect(restored.structuredContent).not.toHaveProperty('result.document');
      const historyPage = await a.instance.callTool({
        name: 'get_project_history',
        arguments: { projectId: project.id, since: 0, limit: 1, includeChanges: true },
      });
      expect(historyPage.structuredContent).toHaveProperty('nextSince', 1);
      expect(historyPage.structuredContent).toHaveProperty('history.0.changes');

      const thread = await a.instance.callTool({
        name: 'create_review_thread',
        arguments: {
          projectId: project.id,
          thread: { viewId: 'overview', objectId: null, x: 1, y: 2, body: 'first', mentionIds: [] },
        },
      });
      const threadId = (thread.structuredContent as { id: string }).id;
      const replied = await b.instance.callTool({
        name: 'reply_review_thread',
        arguments: { threadId, message: { body: 'reply', mentionIds: [] } },
      });
      expect(replied.isError).not.toBe(true);
      const messages = (replied.structuredContent as { messages: Array<{ authorId: string }> })
        .messages;
      expect(messages.at(-1)?.authorId).toBe(userB.id);
      const updatedThread = await a.instance.callTool({
        name: 'update_review_thread',
        arguments: { threadId, update: { resolved: true } },
      });
      const listedThreads = await a.instance.callTool({
        name: 'list_review_threads',
        arguments: { projectId: project.id },
      });
      expect((listedThreads.structuredContent as { threads: unknown[] }).threads).toHaveLength(1);
      expect(
        (
          await a.instance.callTool({
            name: 'delete_review_thread',
            arguments: {
              threadId,
              delete: {
                expectedUpdatedAt: (updatedThread.structuredContent as { updatedAt: string })
                  .updatedAt,
              },
            },
          })
        ).isError,
      ).not.toBe(true);

      const latest = await a.instance.callTool({
        name: 'get_project',
        arguments: { projectId: project.id },
      });
      const latestProject = (latest.structuredContent as { project: { version: number } }).project;
      const archived = await a.instance.callTool({
        name: 'update_project',
        arguments: {
          projectId: project.id,
          update: { expectedVersion: latestProject.version, status: 'archived' },
        },
      });
      expect(
        (
          await a.instance.callTool({
            name: 'delete_project',
            arguments: {
              projectId: project.id,
              delete: {
                expectedVersion: (archived.structuredContent as { version: number }).version,
              },
            },
          })
        ).isError,
      ).not.toBe(true);
      projects.splice(projects.indexOf(project.id), 1);
    } finally {
      await a.instance.close();
      await b.instance.close();
    }
  });
});
