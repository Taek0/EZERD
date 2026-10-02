import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDomain, deriveOperationChanges } from '@ezerd/model';
import { transferProjects, preservationSnapshot } from '../scripts/workspace-transfer.mjs';

describe.runIf(process.env.EZERD_DB_TEST === '1')(
  'workspace access across HTTP and live connections',
  () => {
    let app: NestExpressApplication;
    let pool: pg.Pool;
    let base: string;
    let workspaceId: string;
    let projectId: string;
    const accounts: Record<string, { id: string; username: string; token: string }> = {};
    const sockets: WebSocket[] = [];
    const createdSpaces: string[] = [];
    const legacyProjectIds: string[] = [];
    async function api(path: string, method = 'GET', body?: unknown, who = 'owner') {
      const response = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(accounts[who] ? { authorization: `Bearer ${accounts[who]!.token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: await response.json() };
    }
    async function enroll(who: string, role: string) {
      const invitation = await api(`/workspaces/${workspaceId}/invitations`, 'POST', {
        username: accounts[who]!.username,
        role,
      });
      expect(invitation.status).toBe(201);
      const accepted = await api(
        `/workspace-invitations/${invitation.data.id}/accept`,
        'POST',
        {},
        who,
      );
      expect(accepted.status).toBe(201);
      return invitation.data.id as string;
    }
    async function operation(who: string) {
      const clientId = randomUUID();
      const baseline = await api(`/projects/${projectId}/sync-baseline`, 'POST', { clientId }, who);
      expect(baseline.status).toBe(201);
      const document = addDomain(
        baseline.data.document,
        { id: randomUUID(), name: 'New domain', description: '' },
        { x: 10, y: 20 },
      );
      return {
        operationId: randomUUID(),
        groupId: randomUUID(),
        clientId,
        baselineId: baseline.data.baselineId,
        baseSequence: baseline.data.sequence,
        baselineIssuedAt: baseline.data.baselineIssuedAt,
        kind: 'online',
        dependencyPaths: [],
        changes: deriveOperationChanges(baseline.data.document, document),
        baselineDocument: baseline.data.document,
        document,
      };
    }
    async function subscribe(who: string) {
      const socket = new WebSocket(
        `${base.replace('http:', 'ws:')}/api/sync?token=${accounts[who]!.token}`,
      );
      sockets.push(socket);
      const received: Array<Record<string, unknown>> = [];
      socket.on('message', (data) => received.push(JSON.parse(data.toString())));
      await once(socket, 'open');
      const response = once(socket, 'message');
      socket.send(JSON.stringify({ type: 'subscribe', projectId }));
      return { socket, received, response };
    }
    beforeAll(async () => {
      const { readConfig } = await import('../dist/config.js');
      const config = readConfig();
      const url = new URL(config.DATABASE_URL);
      if (!url.pathname.startsWith('/ezerd_workspace_test_'))
        throw new Error('Use test-workspaces.mjs disposable database runner.');
      pool = new pg.Pool({ connectionString: config.DATABASE_URL });
      const { AppModule } = await import('../dist/app.module.js');
      const { configureApplication } = await import('../dist/application.js');
      const { SyncGateway } = await import('../dist/sync/sync.gateway.js');
      app = await NestFactory.create<NestExpressApplication>(AppModule, {
        logger: false,
        bodyParser: false,
      });
      configureApplication(app);
      await app.listen(0, '127.0.0.1');
      app.get(SyncGateway).attach(app.getHttpServer());
      base = await app.getUrl();
      for (const who of ['owner', 'editor', 'viewer', 'outsider']) {
        const user = await api(
          '/users',
          'POST',
          { username: `${who}-${randomUUID().slice(0, 16)}`, pin: '0424' },
          'none',
        );
        expect(user.status).toBe(201);
        const session = await api(
          '/sessions',
          'POST',
          { userId: user.data.id, pin: '0424' },
          'none',
        );
        expect(session.status).toBe(201);
        accounts[who] = {
          id: user.data.id,
          username: user.data.username,
          token: session.data.token,
        };
      }
      const space = await api('/workspaces', 'POST', { name: 'Permission verification' });
      workspaceId = space.data.id;
      createdSpaces.push(workspaceId);
      await enroll('editor', 'editor');
      await enroll('viewer', 'viewer');
      const project = await api('/projects', 'POST', { name: 'Secured project', workspaceId });
      expect(project.status).toBe(201);
      projectId = project.data.id;
    });
    afterAll(async () => {
      for (const socket of sockets) socket.terminate();
      if (app) await app.close();
      if (pool) {
        if (legacyProjectIds.length)
          await pool.query('DELETE FROM projects WHERE id=ANY($1::uuid[])', [legacyProjectIds]);
        await pool.query('DELETE FROM projects WHERE workspace_id=ANY($1::uuid[])', [
          createdSpaces,
        ]);
        await pool.query('DELETE FROM workspace_invitations WHERE workspace_id=ANY($1::uuid[])', [
          createdSpaces,
        ]);
        await pool.query('DELETE FROM user_workspaces WHERE workspace_id=ANY($1::uuid[])', [
          createdSpaces,
        ]);
        await pool.query('DELETE FROM workspace WHERE workspace_id=ANY($1::uuid[])', [
          createdSpaces,
        ]);
        await pool.query('DELETE FROM workspace_audit_events WHERE workspace_id=ANY($1::uuid[])', [
          createdSpaces,
        ]);
        await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [
          Object.values(accounts).map((account) => account.id),
        ]);
        await pool.end();
      }
    });

    it('requires authentication and scopes every project read to membership', async () => {
      for (const path of [
        '/projects',
        `/projects/${projectId}`,
        `/projects/${projectId}/export`,
        `/projects/${projectId}/threads`,
        `/projects/${projectId}/personal-state`,
        `/projects/${projectId}/history`,
        `/projects/${projectId}/events`,
      ]) {
        expect((await api(path, 'GET', undefined, 'none')).status, path).toBe(401);
        if (path !== '/projects')
          expect((await api(path, 'GET', undefined, 'outsider')).status, path).toBe(403);
      }
      expect((await api('/projects', 'GET', undefined, 'outsider')).data).toEqual([]);
      expect(
        (await api(`/workspaces/${workspaceId}/members`, 'GET', undefined, 'outsider')).status,
      ).toBe(403);
      expect(
        (await api('/projects', 'POST', { name: 'Denied', workspaceId }, 'outsider')).status,
      ).toBe(403);
      expect((await api('/projects', 'POST', { name: 'No workspace' })).status).toBe(400);
    });

    it('allows viewer review and personal state while denying design and project management', async () => {
      const op = await operation('viewer');
      expect((await api(`/projects/${projectId}/operations`, 'POST', op, 'viewer')).status).toBe(
        403,
      );
      expect(
        (
          await api(
            `/projects/${projectId}`,
            'PATCH',
            { expectedVersion: 0, name: 'Denied' },
            'viewer',
          )
        ).status,
      ).toBe(403);
      expect(
        (await api('/projects', 'POST', { name: 'Denied', workspaceId }, 'viewer')).status,
      ).toBe(403);
      const transfer = (await api(`/projects/${projectId}/export`, 'GET', undefined, 'viewer'))
        .data;
      expect(
        (await api('/projects/import', 'POST', { workspaceId, transfer }, 'viewer')).status,
      ).toBe(403);
      const personal = await api(
        `/projects/${projectId}/personal-state`,
        'GET',
        undefined,
        'viewer',
      );
      const state = {
        ...personal.data.state,
        viewports: [{ viewId: 'overview', x: 35, y: 27, zoom: 1 }],
      };
      expect(
        (
          await api(
            `/projects/${projectId}/personal-state`,
            'PUT',
            { expectedVersion: personal.data.version, state },
            'viewer',
          )
        ).status,
      ).toBe(200);
      expect((await api(`/projects/${projectId}`)).data.document.domains).toEqual([]);
      const pin = await api(
        `/projects/${projectId}/threads`,
        'POST',
        {
          viewId: 'overview',
          objectId: null,
          x: 1,
          y: 2,
          body: 'Viewer pin',
          mentionIds: [accounts.editor!.id],
        },
        'viewer',
      );
      expect(pin.status).toBe(201);
      expect(
        (
          await api(
            `/threads/${pin.data.id}/messages`,
            'POST',
            { body: 'Reply', mentionIds: [] },
            'viewer',
          )
        ).status,
      ).toBe(201);
      expect(
        (await api(`/threads/${pin.data.id}`, 'PATCH', { resolved: true }, 'viewer')).status,
      ).toBe(200);
      expect(
        (
          await api(
            `/projects/${projectId}/threads`,
            'POST',
            {
              viewId: 'overview',
              objectId: null,
              x: 1,
              y: 2,
              body: 'External mention',
              mentionIds: [accounts.outsider!.id],
            },
            'viewer',
          )
        ).status,
      ).toBe(400);
      expect(
        (await api(`/users/${accounts.editor!.id}/notifications`, 'GET', undefined, 'viewer'))
          .status,
      ).toBe(403);
      expect(
        (await api(`/users/${accounts.editor!.id}/notifications`, 'GET', undefined, 'editor')).data,
      ).toHaveLength(1);
    });

    it('permits editor design edits but denies owner-only project deletion and enforces permissions before replay', async () => {
      const op = await operation('editor');
      const accepted = await api(`/projects/${projectId}/operations`, 'POST', op, 'editor');
      expect(accepted.data.status).toBe('accepted');
      expect(
        (
          await api(
            `/projects/${projectId}`,
            'DELETE',
            { expectedVersion: (await api(`/projects/${projectId}`)).data.project.version },
            'editor',
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await api(`/workspaces/${workspaceId}/members/${accounts.editor!.id}`, 'PATCH', {
            role: 'viewer',
          })
        ).status,
      ).toBe(200);
      expect((await api(`/projects/${projectId}/operations`, 'POST', op, 'editor')).status).toBe(
        403,
      );
      expect(
        (
          await api(
            `/projects/${projectId}/operations/${op.operationId}/undo`,
            'POST',
            { operationId: randomUUID(), groupId: randomUUID(), clientId: randomUUID() },
            'editor',
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await api(`/workspaces/${workspaceId}/members/${accounts.editor!.id}`, 'PATCH', {
            role: 'editor',
          })
        ).status,
      ).toBe(200);
    });

    it('rejects unauthorized subscriptions and immediately closes changed or revoked memberships', async () => {
      const outsider = await subscribe('outsider');
      const [outsiderCode] = await once(outsider.socket, 'close');
      expect(outsiderCode).toBe(1008);
      expect(outsider.received).toEqual([]);
      const viewer = await subscribe('viewer');
      await viewer.response;
      expect(viewer.received[0]!.type).toBe('subscribed');
      const viewerClosed = once(viewer.socket, 'close');
      await api(`/workspaces/${workspaceId}/members/${accounts.viewer!.id}`, 'PATCH', {
        role: 'editor',
      });
      expect((await viewerClosed)[0]).toBe(1008);
      expect(viewer.received.some((event) => event.type === 'workspace-access-changed')).toBe(true);
      await api(`/workspaces/${workspaceId}/members/${accounts.viewer!.id}`, 'PATCH', {
        role: 'viewer',
      });
      const editor = await subscribe('editor');
      await editor.response;
      const editorClosed = once(editor.socket, 'close');
      await api(`/workspaces/${workspaceId}/members/${accounts.editor!.id}`, 'DELETE');
      expect((await editorClosed)[0]).toBe(1008);
      expect((await api(`/projects/${projectId}/history`, 'GET', undefined, 'editor')).status).toBe(
        403,
      );
      expect(
        (await api(`/users/${accounts.editor!.id}/notifications`, 'GET', undefined, 'editor')).data,
      ).toEqual([]);
      await enroll('editor', 'editor');
    });

    it('makes archived spaces read only and lets owner restore and manage members', async () => {
      const owner = await subscribe('owner');
      await owner.response;
      const closed = once(owner.socket, 'close');
      expect(
        (await api(`/workspaces/${workspaceId}`, 'PATCH', { status: 'archived' })).status,
      ).toBe(200);
      expect((await closed)[0]).toBe(1008);
      expect((await api(`/projects/${projectId}/export`, 'GET', undefined, 'viewer')).status).toBe(
        200,
      );
      expect((await api('/projects', 'POST', { name: 'Denied', workspaceId })).status).toBe(403);
      const personal = (
        await api(`/projects/${projectId}/personal-state`, 'GET', undefined, 'viewer')
      ).data;
      expect(
        (
          await api(
            `/projects/${projectId}/personal-state`,
            'PUT',
            {
              expectedVersion: personal.version,
              state: {
                ...personal.state,
                viewports: [{ viewId: 'overview', x: 99, y: 0, zoom: 1 }],
              },
            },
            'viewer',
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await api(
            `/projects/${projectId}/threads`,
            'POST',
            { viewId: 'overview', objectId: null, x: 1, y: 2, body: 'Denied', mentionIds: [] },
            'viewer',
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await api(`/workspaces/${workspaceId}/members/${accounts.viewer!.id}`, 'PATCH', {
            role: 'editor',
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await api(`/workspaces/${workspaceId}/members/${accounts.viewer!.id}`, 'PATCH', {
            role: 'viewer',
          })
        ).status,
      ).toBe(200);
      expect((await api(`/workspaces/${workspaceId}`, 'DELETE')).status).toBe(409);
      expect((await api(`/workspaces/${workspaceId}`, 'PATCH', { status: 'active' })).status).toBe(
        200,
      );
    });

    it('revokes only the current login session and immediately closes its live subscriptions', async () => {
      const second = await api(
        '/sessions',
        'POST',
        { userId: accounts.viewer!.id, pin: '0424' },
        'none',
      );
      accounts.secondViewer = { ...accounts.viewer!, token: second.data.token };
      const current = await subscribe('viewer');
      const other = await subscribe('secondViewer');
      await Promise.all([current.response, other.response]);
      const closed = once(current.socket, 'close');
      expect((await api('/sessions/logout', 'POST', {}, 'none')).status).toBe(401);
      const revoked = await api('/sessions/logout', 'POST', {}, 'viewer');
      expect(revoked.status).toBe(201);
      expect(revoked.data).toEqual({ revoked: true });
      expect((await closed)[0]).toBe(1008);
      expect((await api(`/projects/${projectId}`, 'GET', undefined, 'viewer')).status).toBe(401);
      expect((await api(`/projects/${projectId}`, 'GET', undefined, 'secondViewer')).status).toBe(
        200,
      );
      expect(other.socket.readyState).toBe(WebSocket.OPEN);
    });

    it('transfers only explicit legacy identities atomically, preserves all rows, and safely reruns', async () => {
      const client = await pool.connect();
      const legacyId = randomUUID();
      legacyProjectIds.push(legacyId);
      const targetId = randomUUID();
      createdSpaces.push(targetId);
      try {
        // Simulate the nullable preparation state solely inside this disposable DB.
        await client.query('ALTER TABLE projects ALTER COLUMN workspace_id DROP NOT NULL');
        await client.query(
          "INSERT INTO projects(id,name,document) SELECT $1,'Legacy fixture',document FROM projects WHERE id=$2",
          [legacyId, projectId],
        );
        await client.query(
          'INSERT INTO project_personal_states(project_id,user_id,state,version) SELECT $1,user_id,state,version FROM project_personal_states WHERE project_id=$2',
          [legacyId, projectId],
        );
        await client.query(
          "INSERT INTO review_threads(project_id,view_id,x,y) VALUES($1,'overview',3,4)",
          [legacyId],
        );
        await client.query(
          "INSERT INTO review_messages(thread_id,author_id,body) SELECT id,$2,'Preserved message' FROM review_threads WHERE project_id=$1",
          [legacyId, accounts.viewer!.id],
        );
        await client.query(
          'INSERT INTO sync_operations(project_id,operation_id,group_id,client_id,actor_id,sequence,base_sequence,baseline_issued_at,baseline_id,kind,fingerprint,changes,result) SELECT $1,operation_id,group_id,client_id,actor_id,sequence,base_sequence,baseline_issued_at,baseline_id,kind,fingerprint,changes,result FROM sync_operations WHERE project_id=$2',
          [legacyId, projectId],
        );
        const transfer = {
          key: randomUUID(),
          ownerId: accounts.owner!.id,
          spaces: [
            {
              id: targetId,
              name: 'Legacy target',
              projects: [{ id: legacyId, name: 'Legacy fixture' }],
            },
          ],
        };
        const before = await preservationSnapshot(client, [legacyId]);
        await expect(
          transferProjects(
            client,
            {
              ...transfer,
              spaces: [{ ...transfer.spaces[0], projects: [{ id: legacyId, name: 'Wrong name' }] }],
            },
            { apply: true },
          ),
        ).rejects.toThrow('identity mismatch');
        expect(
          (await client.query('SELECT workspace_id FROM projects WHERE id=$1', [legacyId])).rows[0]
            .workspace_id,
        ).toBeNull();
        expect(
          (
            await client.query('SELECT workspace_id FROM workspace WHERE workspace_id=$1', [
              targetId,
            ])
          ).rowCount,
        ).toBe(0);
        const result = await transferProjects(client, transfer, { apply: true });
        expect(result.finalized).toBe(true);
        expect(result.preservation).toEqual(before);
        expect(result.assignments[0]!.workspace_id).toBe(targetId);
        await transferProjects(client, transfer, { apply: true });
        expect(
          (
            await client.query(
              "SELECT id FROM workspace_audit_events WHERE workspace_id=$1 AND action='projects.transferred'",
              [targetId],
            )
          ).rowCount,
        ).toBe(1);
        expect(
          (
            await client.query(
              'SELECT role FROM user_workspaces WHERE workspace_id=$1 AND user_id=$2',
              [targetId, accounts.owner!.id],
            )
          ).rows,
        ).toEqual([{ role: 'owner' }]);
        expect(await preservationSnapshot(client, [legacyId])).toEqual(before);
      } finally {
        client.release();
      }
    });
  },
);
