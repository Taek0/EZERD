import { seedLegacyProject } from './legacy-project-fixture.js';
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
      await seedLegacyProject(pool, projectId);
      expect(project.workspaceId).toBe(id);
      expect((await call(b, 'list_projects', { workspaceId: id })).projects).toHaveLength(1);
      await call(b, 'get_project_document_state', { projectId });
      const transfer = await call(b, 'export_project', { projectId });
      expect(transfer.project).toMatchObject({ name: project.name, databaseKind: 'postgresql' });
      expect(transfer).toMatchObject({ formatVersion: 2, sourceDocument: { schemaVersion: 1 } });
      const imported = await call(a, 'import_project', { workspaceId: id, transfer });
      projects.push(imported.id);
      const importedState = await call(a, 'get_project_document_state', { projectId: imported.id });
      expect(importedState.sourceDocument.schemaVersion).toBe(2);
      const nativeFile = await call(a, 'export_project', { projectId: imported.id });
      expect(nativeFile).toMatchObject({ formatVersion: 2, sourceDocument: { schemaVersion: 2 } });
      const archivedImport = await call(a, 'update_project', {
        projectId: imported.id,
        update: { expectedVersion: imported.version, status: 'archived' },
      });
      await call(a, 'delete_project', {
        projectId: imported.id,
        delete: { expectedVersion: archivedImport.version },
      });
      projects.splice(projects.indexOf(imported.id), 1);
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
      const source = await call(a, 'get_project_document_state', { projectId });
      await call(a, 'upgrade_project_document', {
        projectId,
        operationId: randomUUID(),
        clientId: randomUUID(),
        expectedVersion: source.project.version,
        expectedSequence: source.sequence,
        expectedDatabaseRevision: source.project.databaseRevision,
      });
      const own = await call(b, 'get_personal_state', { projectId });
      await call(b, 'apply_personal_changes', {
        projectId,
        expectedVersion: own.version,
        expectedDatabaseRevision: own.databaseRevision,
        expectedProjectVersion: own.projectVersion,
        expectedSyncSequence: own.syncSequence,
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
      await call(b, 'get_project_document_state', { projectId });
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
        'get_project_document_state',
        'get_native_project_history',
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
        update: {
          expectedVersion: (await call(a, 'get_project_document_state', { projectId })).project
            .version,
          status: 'archived',
        },
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
