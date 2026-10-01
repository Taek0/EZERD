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
  let userA: { id: string; username: string; session: string };
  let userB: { id: string; username: string; session: string };
  let workspaceId: string;
  const workspaces: string[] = [];
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
    return {
      id: created.data.id as string,
      username: created.data.username as string,
      session: login.data.token as string,
    };
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
    const space = await api('/workspaces', 'POST', { name: 'MCP integration' }, userA.session);
    expect(space.status).toBe(201);
    workspaceId = space.data.id;
    workspaces.push(workspaceId);
    const invitation = await api(
      `/workspaces/${workspaceId}/invitations`,
      'POST',
      { username: userB.username, role: 'editor' },
      userA.session,
    );
    expect(invitation.status).toBe(201);
    expect(
      (
        await api(
          `/workspace-invitations/${invitation.data.id}/accept`,
          'POST',
          undefined,
          userB.session,
        )
      ).status,
    ).toBe(201);
  });

  afterAll(async () => {
    if (pool) {
      if (projects.length)
        await pool.query('DELETE FROM projects WHERE id = ANY($1::uuid[])', [projects]);
      if (workspaces.length) {
        await pool.query('DELETE FROM user_workspaces WHERE workspace_id = ANY($1::uuid[])', [
          workspaces,
        ]);
        await pool.query('DELETE FROM workspace WHERE workspace_id = ANY($1::uuid[])', [
          workspaces,
        ]);
        await pool.query(
          'DELETE FROM workspace_audit_events WHERE workspace_id = ANY($1::uuid[])',
          [workspaces],
        );
      }
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

  it('enforces workspace lifecycle, viewer limits and revoked membership through MCP', async () => {
    const tokenA = await issue(userA.session, 'workspace owner');
    const tokenB = await issue(userB.session, 'workspace viewer');
    const a = client(tokenA.token),
      b = client(tokenB.token);
    await a.instance.connect(a.transport);
    await b.instance.connect(b.transport);
    const call = async (connection: typeof a, name: string, args: Record<string, unknown> = {}) => {
      const result = await connection.instance.callTool({ name, arguments: args });
      expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).not.toBe(true);
      return result.structuredContent as Record<string, any>;
    };
    try {
      expect(await call(a, 'whoami')).toMatchObject({ userId: userA.id, username: userA.username });
      const space = await call(a, 'create_workspace', { name: 'MCP private workspace' });
      const id = space.id as string;
      workspaces.push(id);
      expect((await call(a, 'list_workspaces')).workspaces).toEqual(
        expect.arrayContaining([expect.objectContaining({ id })]),
      );
      expect(
        (await b.instance.callTool({ name: 'get_workspace', arguments: { workspaceId: id } }))
          .isError,
      ).toBe(true);
      let invitation = await call(a, 'create_workspace_invitation', {
        workspaceId: id,
        invitation: { username: userB.username, role: 'viewer' },
      });
      expect(
        (await call(a, 'list_workspace_invitations', { workspaceId: id })).invitations,
      ).toHaveLength(1);
      expect((await call(b, 'list_my_workspace_invitations')).invitations).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: invitation.id })]),
      );
      expect(
        (
          await call(a, 'cancel_workspace_invitation', {
            workspaceId: id,
            invitationId: invitation.id,
          })
        ).status,
      ).toBe('cancelled');
      invitation = await call(a, 'create_workspace_invitation', {
        workspaceId: id,
        invitation: { username: userB.username, role: 'viewer' },
      });
      expect(
        (await call(b, 'decline_workspace_invitation', { invitationId: invitation.id })).status,
      ).toBe('declined');
      invitation = await call(a, 'create_workspace_invitation', {
        workspaceId: id,
        invitation: { username: userB.username, role: 'viewer' },
      });
      expect(
        (await call(b, 'accept_workspace_invitation', { invitationId: invitation.id })).status,
      ).toBe('accepted');
      expect(await call(b, 'get_workspace', { workspaceId: id })).toMatchObject({
        id,
        role: 'viewer',
      });
      expect((await call(b, 'list_workspace_members', { workspaceId: id })).members).toHaveLength(
        2,
      );
      const project = await call(a, 'create_project', {
        workspaceId: id,
        name: 'Private MCP project',
      });
      const projectId = project.id as string;
      projects.push(projectId);
      expect(project.workspaceId).toBe(id);
      expect((await call(b, 'list_projects', { workspaceId: id })).projects).toHaveLength(1);
      await call(b, 'get_project_summary', { projectId });
      const transfer = await call(b, 'export_project', { projectId });
      expect(transfer.project).toEqual({ name: project.name, databaseKind: 'postgresql' });
      expect(
        (
          await b.instance.callTool({
            name: 'create_project',
            arguments: { workspaceId: id, name: 'Viewer denied' },
          })
        ).isError,
      ).toBe(true);
      expect(
        (
          await b.instance.callTool({
            name: 'import_project',
            arguments: { workspaceId: id, transfer },
          })
        ).isError,
      ).toBe(true);
      expect(
        (
          await b.instance.callTool({
            name: 'apply_project_changes',
            arguments: {
              projectId,
              expectedVersion: 0,
              expectedSequence: 0,
              operationId: randomUUID(),
              groupId: randomUUID(),
              clientId: randomUUID(),
              commands: [
                { type: 'upsert_domain', value: { id: 'denied', name: 'Denied', description: '' } },
              ],
            },
          })
        ).isError,
      ).toBe(true);
      await call(b, 'create_review_thread', {
        projectId,
        thread: {
          viewId: 'overview',
          objectId: null,
          x: 0,
          y: 0,
          body: 'Viewer review',
          mentionIds: [],
        },
      });
      await call(b, 'apply_personal_changes', {
        projectId,
        expectedVersion: 0,
        operationId: randomUUID(),
        commands: [{ type: 'set_viewport', value: { viewId: 'overview', x: 10, y: 0, zoom: 1 } }],
      });
      await call(a, 'update_workspace', { workspaceId: id, update: { status: 'archived' } });
      expect(
        (
          await b.instance.callTool({
            name: 'create_review_thread',
            arguments: {
              projectId,
              thread: {
                viewId: 'overview',
                objectId: null,
                x: 0,
                y: 0,
                body: 'Archived denied',
                mentionIds: [],
              },
            },
          })
        ).isError,
      ).toBe(true);
      await call(b, 'get_project', { projectId });
      await call(a, 'update_workspace', {
        workspaceId: id,
        update: { status: 'active', name: 'Renamed space' },
      });
      expect(
        (
          await call(a, 'update_workspace_member', {
            workspaceId: id,
            userId: userB.id,
            update: { role: 'editor' },
          })
        ).role,
      ).toBe('editor');
      await call(a, 'remove_workspace_member', { workspaceId: id, userId: userB.id });
      for (const name of [
        'get_project',
        'get_project_summary',
        'get_project_history',
        'list_review_threads',
        'get_personal_state',
        'export_project',
        'diagnose_project',
      ]) {
        const rejected = await b.instance.callTool({ name, arguments: { projectId } });
        expect(rejected.isError, name).toBe(true);
        expect(rejected.structuredContent).toBeUndefined();
      }
      expect(
        (await call(b, 'list_projects')).projects.some(
          (item: { id: string }) => item.id === projectId,
        ),
      ).toBe(false);
      invitation = await call(a, 'create_workspace_invitation', {
        workspaceId: id,
        invitation: { username: userB.username, role: 'viewer' },
      });
      await call(b, 'accept_workspace_invitation', { invitationId: invitation.id });
      await call(b, 'leave_workspace', { workspaceId: id });
      expect(
        (await a.instance.callTool({ name: 'leave_workspace', arguments: { workspaceId: id } }))
          .isError,
      ).toBe(true);
      expect(
        (await a.instance.callTool({ name: 'delete_workspace', arguments: { workspaceId: id } }))
          .isError,
      ).toBe(true);
      const archived = await call(a, 'update_project', {
        projectId,
        update: { expectedVersion: 0, status: 'archived' },
      });
      await call(a, 'delete_project', { projectId, delete: { expectedVersion: archived.version } });
      projects.splice(projects.indexOf(projectId), 1);
      await call(a, 'delete_workspace', { workspaceId: id });
      workspaces.splice(workspaces.indexOf(id), 1);
    } finally {
      await a.instance.close();
      await b.instance.close();
    }
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
      expect(listedTools.tools).toHaveLength(48);
      for (const name of ['get_project_database_capabilities', 'get_project_document_state'])
        expect(listedTools.tools.find((tool) => tool.name === name)).toMatchObject({
          annotations: { readOnlyHint: true, destructiveHint: false },
        });
      const list = await a.instance.callTool({ name: 'list_projects', arguments: {} });
      expect(list.isError).not.toBe(true);
      const created = await a.instance.callTool({
        name: 'create_project',
        arguments: { workspaceId, name: 'MCP integration' },
      });
      const project = created.structuredContent as { id: string; version: number };
      projects.push(project.id);
      const opened = await a.instance.callTool({
        name: 'get_project',
        arguments: { projectId: project.id },
      });
      expect(opened.isError).not.toBe(true);
      expect(opened.structuredContent).toMatchObject({
        project: { id: project.id },
        syncSequence: 0,
      });
      expect(opened.structuredContent).not.toHaveProperty('personalViewIds');
      const capabilities = await a.instance.callTool({
        name: 'get_project_database_capabilities',
        arguments: { projectId: project.id },
      });
      expect(capabilities.isError).not.toBe(true);
      expect(capabilities.structuredContent).toMatchObject({
        database: { kind: 'postgresql', profileId: 'postgresql-18-v1', revision: 0 },
        documentSchemaVersion: 1,
        capabilityScope: 'native-v2',
      });
      const versioned = await a.instance.callTool({
        name: 'get_project_document_state',
        arguments: { projectId: project.id },
      });
      expect(versioned.isError).not.toBe(true);
      expect(versioned.structuredContent).toMatchObject({
        protocolVersion: 2,
        sequence: 0,
        sourceDocument: { schemaVersion: 1 },
        native: { status: 'available', document: { schemaVersion: 2 } },
      });
      const prematureNative = await a.instance.callTool({
        name: 'apply_native_project_changes',
        arguments: {
          projectId: project.id,
          expectedVersion: 0,
          expectedSequence: 0,
          expectedDatabaseRevision: 0,
          operationId: randomUUID(),
          groupId: randomUUID(),
          clientId: randomUUID(),
          commands: [
            {
              type: 'patch_table',
              id: 'missing',
              patch: { physical: { comment: 'not an upgrade' } },
            },
          ],
        },
      });
      expect(prematureNative.isError).toBe(true);
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
          thread: {
            viewId: 'overview',
            objectId: null,
            x: 1,
            y: 2,
            body: 'first',
            mentionIds: [userB.id],
          },
        },
      });
      const threadId = (thread.structuredContent as { id: string }).id;
      const notifications = await b.instance.callTool({
        name: 'list_notifications',
        arguments: { unreadOnly: true, limit: 1 },
      });
      const ownNotification = (
        notifications.structuredContent as {
          notifications: Array<{ id: string; threadId: string }>;
        }
      ).notifications.find((item) => item.threadId === threadId);
      expect(ownNotification).toBeDefined();
      expect(
        (
          await a.instance.callTool({
            name: 'update_notification',
            arguments: { notificationId: ownNotification!.id, update: { read: true } },
          })
        ).isError,
      ).toBe(true);
      const readNotification = await b.instance.callTool({
        name: 'update_notification',
        arguments: { notificationId: ownNotification!.id, update: { read: true } },
      });
      expect(readNotification.structuredContent).toHaveProperty('read', true);
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
      expect(listedThreads.structuredContent).not.toHaveProperty('threads.0.messages');
      const fullThread = await a.instance.callTool({
        name: 'get_review_thread',
        arguments: { threadId },
      });
      expect((fullThread.structuredContent as { messages: unknown[] }).messages).toHaveLength(2);
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

  it('stores combined views per user and exposes them to MCP and the web API', async () => {
    const created = await api(
      '/projects',
      'POST',
      { workspaceId, name: 'Personal MCP views' },
      userA.session,
    );
    expect(created.status).toBe(201);
    const projectId = created.data.id as string;
    projects.push(projectId);
    const tokenA = await issue(userA.session, 'personal A');
    const tokenB = await issue(userB.session, 'personal B');
    const a = client(tokenA.token);
    const b = client(tokenB.token);
    await a.instance.connect(a.transport);
    await b.instance.connect(b.transport);
    try {
      const shared = await a.instance.callTool({
        name: 'apply_project_changes',
        arguments: {
          projectId,
          expectedVersion: 0,
          expectedSequence: 0,
          operationId: randomUUID(),
          groupId: randomUUID(),
          clientId: randomUUID(),
          commands: [
            { type: 'upsert_domain', value: { id: 'sales', name: 'Sales', description: '' } },
          ],
        },
      });
      expect(shared.isError).not.toBe(true);
      const before = await a.instance.callTool({
        name: 'get_personal_state',
        arguments: { projectId },
      });
      expect(before.isError).not.toBe(true);
      expect(before.structuredContent).toMatchObject({ version: 0, state: { views: [] } });
      const operationId = randomUUID();
      const command = {
        projectId,
        expectedVersion: 0,
        operationId,
        commands: [
          {
            type: 'upsert_combined_view',
            value: { id: 'sales-view', name: 'My sales', domainIds: ['sales'] },
          },
          { type: 'set_viewport', value: { viewId: 'sales-view', x: 10, y: 20, zoom: 1.2 } },
        ],
      };
      const saved = await a.instance.callTool({
        name: 'apply_personal_changes',
        arguments: command,
      });
      expect(saved.isError).not.toBe(true);
      expect(saved.structuredContent).toMatchObject({
        version: 1,
        state: { views: [{ id: 'sales-view' }] },
      });
      expect(
        (
          await a.instance.callTool({
            name: 'apply_personal_changes',
            arguments: command,
          })
        ).structuredContent,
      ).toEqual(saved.structuredContent);
      const ownSummary = await a.instance.callTool({
        name: 'get_project_summary',
        arguments: { projectId },
      });
      expect(
        (ownSummary.structuredContent as { views: Array<{ id: string }> }).views,
      ).toContainEqual(expect.objectContaining({ id: 'sales-view' }));
      const other = await b.instance.callTool({
        name: 'get_personal_state',
        arguments: { projectId },
      });
      expect(other.structuredContent).toMatchObject({ version: 0, state: { views: [] } });
      expect(
        (
          await b.instance.callTool({
            name: 'apply_personal_changes',
            arguments: command,
          })
        ).isError,
      ).toBe(true);
      const web = await api(
        `/projects/${projectId}/personal-state`,
        'GET',
        undefined,
        userA.session,
      );
      expect(web.status).toBe(200);
      expect(web.data).toMatchObject({ version: 1, state: { views: [{ id: 'sales-view' }] } });
      const updated = await api(
        `/projects/${projectId}/personal-state`,
        'PUT',
        {
          expectedVersion: 1,
          state: {
            ...web.data.state,
            viewports: [
              ...web.data.state.viewports.filter(
                (item: { viewId: string }) => item.viewId !== 'sales-view',
              ),
              { viewId: 'sales-view', x: 30, y: 40, zoom: 1.5 },
            ],
          },
        },
        userA.session,
      );
      expect(updated.status).toBe(200);
      expect(updated.data.version).toBe(2);
      expect(
        (await api(`/projects/${projectId}/personal-state`, 'GET', undefined, userB.session)).data,
      ).toMatchObject({ version: 0, state: { views: [] } });
      const properties = { common: {}, logical: {}, physical: {} };
      const table = (id: string) => ({
        id,
        domainId: 'sales',
        scope: 'both',
        logical: { name: id, definition: '' },
        physical: { name: id, schema: 'public', comment: '' },
        customProperties: properties,
      });
      const tablesAdded = await a.instance.callTool({
        name: 'apply_project_changes',
        arguments: {
          projectId,
          expectedVersion: 1,
          expectedSequence: 1,
          operationId: randomUUID(),
          groupId: randomUUID(),
          clientId: randomUUID(),
          commands: [
            { type: 'upsert_table', value: table('orders'), placement: { x: 0, y: 0 } },
            { type: 'upsert_table', value: table('users'), placement: { x: 300, y: 0 } },
            {
              type: 'upsert_table_relation',
              value: {
                id: 'orders-users',
                sourceTableId: 'orders',
                targetTableId: 'users',
                scope: 'logical',
                logical: { name: 'owner', cardinality: 'many-to-many', required: false },
                physical: null,
              },
            },
          ],
        },
      });
      expect(tablesAdded.isError).not.toBe(true);
      const renamedTable = await a.instance.callTool({
        name: 'apply_project_changes',
        arguments: {
          projectId,
          expectedVersion: 2,
          expectedSequence: 2,
          operationId: randomUUID(),
          groupId: randomUUID(),
          clientId: randomUUID(),
          commands: [
            { type: 'patch_table', id: 'orders', patch: { logical: { name: 'Orders renamed' } } },
          ],
        },
      });
      expect(renamedTable.isError).not.toBe(true);
      const details = await a.instance.callTool({
        name: 'get_table_details',
        arguments: { projectId, tableId: 'orders' },
      });
      expect(details.structuredContent).toHaveProperty('table.logical.name', 'Orders renamed');
      const layout = await a.instance.callTool({
        name: 'apply_personal_changes',
        arguments: {
          projectId,
          expectedVersion: 2,
          operationId: randomUUID(),
          commands: [
            {
              type: 'add_table_reference',
              tableId: 'orders',
              viewId: 'sales-view',
              placement: { x: 0, y: 0, width: 260, height: 190 },
            },
            {
              type: 'add_table_reference',
              tableId: 'users',
              viewId: 'sales-view',
              placement: { x: 310, y: 0 },
            },
            {
              type: 'update_node_layout',
              nodeId: 'node:orders:sales-view',
              patch: { x: 20 },
            },
            {
              type: 'upsert_relation_layout',
              value: { relationId: 'orders-users', viewId: 'sales-view', offset: 12 },
            },
            {
              type: 'upsert_note',
              value: { id: 'private-note', viewId: 'sales-view', text: 'Personal' },
              placement: { x: 50, y: 300 },
            },
          ],
        },
      });
      expect(layout.isError).not.toBe(true);
      expect(layout.structuredContent).toMatchObject({
        version: 3,
        state: { notes: [{ id: 'private-note' }] },
      });
      const personalView = await a.instance.callTool({
        name: 'get_project_view',
        arguments: { projectId, viewId: 'sales-view' },
      });
      expect((personalView.structuredContent as { tables: unknown[] }).tables).toHaveLength(2);
      expect(personalView.structuredContent).toHaveProperty('relationLayouts.0.offset', 12);
      const viewRelations = await a.instance.callTool({
        name: 'list_view_relations',
        arguments: { projectId, viewId: 'sales-view' },
      });
      expect(viewRelations.structuredContent).toHaveProperty('relations.0.layout.offset', 12);
      const layoutDiagnosis = await a.instance.callTool({
        name: 'diagnose_layout',
        arguments: { projectId, viewId: 'sales-view' },
      });
      expect(layoutDiagnosis.isError).not.toBe(true);
      expect(layoutDiagnosis.structuredContent).toHaveProperty('diagnostics');
      const otherView = await b.instance.callTool({
        name: 'get_project_view',
        arguments: { projectId, viewId: 'sales-view' },
      });
      expect(otherView.isError).toBe(true);
      const personalPatch = await a.instance.callTool({
        name: 'apply_personal_changes',
        arguments: {
          projectId,
          expectedVersion: 3,
          operationId: randomUUID(),
          commands: [
            { type: 'patch_combined_view', id: 'sales-view', patch: { name: 'Renamed view' } },
            { type: 'patch_note', id: 'private-note', patch: { text: 'Updated note' } },
          ],
        },
      });
      expect(personalPatch.isError).not.toBe(true);
      expect(personalPatch.structuredContent).toMatchObject({
        version: 4,
        state: { views: [{ name: 'Renamed view' }], notes: [{ text: 'Updated note' }] },
      });
      const removedPersonal = await a.instance.callTool({
        name: 'apply_personal_changes',
        arguments: {
          projectId,
          expectedVersion: 4,
          operationId: randomUUID(),
          commands: [
            { type: 'delete_relation_layout', relationId: 'orders-users', viewId: 'sales-view' },
            { type: 'remove_table_reference', nodeId: 'node:users:sales-view' },
            { type: 'delete_note', id: 'private-note' },
          ],
        },
      });
      expect(removedPersonal.isError).not.toBe(true);
      expect(removedPersonal.structuredContent).toMatchObject({
        version: 5,
        state: { relations: [], notes: [] },
      });
      expect(
        (
          removedPersonal.structuredContent as { state: { nodes: Array<{ objectId: string }> } }
        ).state.nodes.some((node) => node.objectId === 'users'),
      ).toBe(false);
      const transfer = await a.instance.callTool({
        name: 'export_project',
        arguments: { projectId },
      });
      expect(transfer.structuredContent).toMatchObject({
        format: 'ezerd-project',
        document: { domains: [{ id: 'sales' }] },
      });
      const imported = await a.instance.callTool({
        name: 'import_project',
        arguments: { workspaceId, transfer: transfer.structuredContent },
      });
      expect(imported.isError).not.toBe(true);
      const importedId = (imported.structuredContent as { id: string }).id;
      expect(importedId).not.toBe(projectId);
      projects.push(importedId);
      const importedDocument = await a.instance.callTool({
        name: 'get_project',
        arguments: { projectId: importedId },
      });
      expect(importedDocument.isError, JSON.stringify(importedDocument)).not.toBe(true);
      expect(importedDocument.structuredContent).toHaveProperty('document.tables.0.id', 'orders');
    } finally {
      await a.instance.close();
      await b.instance.close();
    }
  });

  it('paginates project and review listings with stable cursors', async () => {
    const token = await issue(userA.session, 'pagination');
    const connection = client(token.token);
    await connection.instance.connect(connection.transport);
    const search = `MCP-page-${randomUUID().slice(0, 8)}`;
    try {
      for (let index = 0; index < 3; index++) {
        const created = await connection.instance.callTool({
          name: 'create_project',
          arguments: { workspaceId, name: `${search}-${index}` },
        });
        projects.push((created.structuredContent as { id: string }).id);
      }
      const listed: string[] = [];
      let cursor: string | null = null;
      for (let index = 0; index < 3; index++) {
        const page = await connection.instance.callTool({
          name: 'list_projects',
          arguments: { search, limit: 1, ...(cursor ? { cursor } : {}) },
        });
        expect(page.isError).not.toBe(true);
        const content = page.structuredContent as {
          projects: Array<{ id: string }>;
          nextCursor: string | null;
        };
        expect(content.projects).toHaveLength(1);
        listed.push(content.projects[0]!.id);
        cursor = content.nextCursor;
      }
      expect(new Set(listed).size).toBe(3);
      expect(cursor).toBeNull();
      expect(
        (
          await connection.instance.callTool({
            name: 'list_projects',
            arguments: { search, cursor: 'invalid-cursor' },
          })
        ).isError,
      ).toBe(true);
      const projectId = listed[0]!;
      for (let index = 0; index < 2; index++) {
        const thread = await connection.instance.callTool({
          name: 'create_review_thread',
          arguments: {
            projectId,
            thread: {
              viewId: 'overview',
              objectId: null,
              x: index,
              y: 0,
              body: `Review ${index}`,
              mentionIds: [],
            },
          },
        });
        expect(thread.isError).not.toBe(true);
      }
      const first = await connection.instance.callTool({
        name: 'list_review_threads',
        arguments: { projectId, limit: 1 },
      });
      const firstPage = first.structuredContent as {
        threads: Array<{ id: string }>;
        nextCursor: string;
      };
      expect(firstPage.threads).toHaveLength(1);
      expect(firstPage.nextCursor).toBeTruthy();
      const second = await connection.instance.callTool({
        name: 'list_review_threads',
        arguments: { projectId, limit: 1, cursor: firstPage.nextCursor },
      });
      const secondPage = second.structuredContent as {
        threads: Array<{ id: string }>;
        nextCursor: string | null;
      };
      expect(secondPage.threads).toHaveLength(1);
      expect(secondPage.threads[0]!.id).not.toBe(firstPage.threads[0]!.id);
      expect(secondPage.nextCursor).toBeNull();
    } finally {
      await connection.instance.close();
    }
  });
});
