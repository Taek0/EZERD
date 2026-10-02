import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import pg from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  createEmptyNativeDocument,
  sharedDocument,
  defaultDatabaseContext,
  type DatabaseKind,
} from '@ezerd/model';
import { projectDocumentStateSchema, projectSchema } from '@ezerd/contracts';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/application.js';
import { SyncGateway } from '../src/sync/sync.gateway.js';

describe.runIf(process.env.EZERD_DB_TEST === '1')(
  'actual fresh native project REST/MCP creation',
  () => {
    let app: NestExpressApplication,
      pool: pg.Pool,
      base: string,
      workspaceId: string,
      client: Client;
    type Actor = { id: string; token: string };
    let owner: Actor, editor: Actor, viewer: Actor, outsider: Actor;
    const users: string[] = [],
      previousPort = process.env.PORT,
      previousUrl = process.env.MCP_PUBLIC_URL;
    async function request(
      path: string,
      method = 'GET',
      body?: unknown,
      actor: Actor | null = owner,
    ) {
      const response = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(actor ? { authorization: `Bearer ${actor.token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: (await response.json()) as any };
    }
    const row = async (id: string) =>
      (await pool.query('SELECT * FROM projects WHERE id=$1', [id])).rows[0];
    async function create(
      kind: DatabaseKind = 'postgresql',
      formatVersion?: 1 | 2,
      name?: string,
      actor = owner,
      target = workspaceId,
    ) {
      return request(
        '/projects',
        'POST',
        {
          workspaceId: target,
          databaseKind: kind,
          ...(formatVersion !== undefined ? { formatVersion } : {}),
          ...(name !== undefined ? { name } : {}),
        },
        actor,
      );
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
      async function actor(): Promise<Actor> {
        const created = await request(
          '/users',
          'POST',
          { username: 'creation-' + randomUUID().slice(0, 22), pin: '0024' },
          null,
        );
        expect(created.status).toBe(201);
        users.push(created.data.id);
        const session = await request(
          '/sessions',
          'POST',
          { userId: created.data.id, pin: '0024' },
          null,
        );
        expect(session.status).toBe(201);
        return { id: created.data.id, token: session.data.token };
      }
      owner = await actor();
      editor = await actor();
      viewer = await actor();
      outsider = await actor();
      const workspace = await request('/workspaces', 'POST', { name: 'Native creation QA' });
      expect(workspace.status).toBe(201);
      workspaceId = workspace.data.id;
      await pool.query(
        "INSERT INTO user_workspaces (workspace_id,user_id,role) VALUES ($1,$2,'editor'),($1,$3,'viewer')",
        [workspaceId, editor.id, viewer.id],
      );
      const token = await request('/mcp-tokens', 'POST', { name: 'Native creation QA' });
      expect(token.status).toBe(201);
      client = new Client({ name: 'native-creation-qa', version: '1.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
          requestInit: { headers: { authorization: `Bearer ${token.data.token}` } },
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
      'stores fresh %s native context/factory/version zero without upgrade or private state',
      async (kind) => {
        const created = await create(kind, 2, 'Fresh native');
        expect(created.status, JSON.stringify(created.data)).toBe(201);
        const project = projectSchema.parse(created.data),
          context = defaultDatabaseContext(kind),
          persisted = await row(project.id);
        expect(project).toMatchObject({
          databaseKind: kind,
          databaseProfileId: context.profileId,
          databaseRevision: 0,
          version: 0,
          status: 'active',
        });
        expect(persisted).toMatchObject({
          database_kind: kind,
          database_profile_id: context.profileId,
          database_revision: 0,
          version: 0,
          sync_sequence: 0,
        });
        expect(persisted.document).toEqual(sharedDocument(createEmptyNativeDocument(context)));
        const state = projectDocumentStateSchema.parse(
          (await request(`/projects/${project.id}/document-state`)).data,
        );
        expect(state.sourceDocument.schemaVersion).toBe(2);
        expect(state.native.status).toBe('available');
        expect(state.sourceDocument.domains).toEqual([]);
        expect(state.sourceDocument.layout.viewports).toEqual([]);
        expect((await request(`/projects/${project.id}`)).status).toBe(409);
        const caps = (await request(`/projects/${project.id}/database/capabilities`)).data;
        expect(caps.documentSchemaVersion).toBe(2);
        expect(caps.database).toMatchObject({ ...context, revision: 0 });
        expect(caps.types.every((item: { usable: boolean }) => !item.usable)).toBe(true);
        expect(caps.features.every((item: { usable: boolean }) => !item.usable)).toBe(true);
        const count = (
          await pool.query(
            'SELECT (SELECT COUNT(*) FROM project_personal_states WHERE project_id=$1) AS personal, (SELECT COUNT(*) FROM sync_operations WHERE project_id=$1) AS ledger',
            [project.id],
          )
        ).rows[0];
        expect(count).toEqual({ personal: '0', ledger: '0' });
      },
    );
    it.each([undefined, 1] as const)(
      'preserves legacy REST creation and legacy reads for format %s',
      async (format) => {
        const created = await create('mysql', format, 'Legacy');
        expect(created.status).toBe(201);
        expect((await row(created.data.id)).document.schemaVersion).toBe(1);
        const legacy = await request(`/projects/${created.data.id}`);
        expect(legacy.status).toBe(200);
        expect(legacy.data.document.schemaVersion).toBe(1);
        expect(
          (await request(`/projects/${created.data.id}/database/capabilities`)).data
            .documentSchemaVersion,
        ).toBe(1);
      },
    );
    it('isolates native personal camera defaults and never invents a default domain or another user canvas', async () => {
      const created = await create('sqlite', 2, 'Private defaults');
      expect(created.status).toBe(201);
      const id = created.data.id;
      const original = (await row(id)).document,
        own = (await request(`/projects/${id}/personal-state`)).data;
      expect(own.state).toMatchObject({
        views: [],
        notes: [],
        nodes: [],
        viewports: [{ viewId: '__tables__', x: 0, y: 0, zoom: 1 }],
      });
      const saved = await request(`/projects/${id}/personal-state`, 'PUT', {
        expectedVersion: 0,
        state: { ...own.state, viewports: [{ viewId: '__tables__', x: 111, y: 222, zoom: 2 }] },
      });
      expect(saved.status, JSON.stringify(saved.data)).toBe(200);
      const theirs = (await request(`/projects/${id}/personal-state`, 'GET', undefined, viewer))
        .data;
      expect(theirs.version).toBe(0);
      expect(theirs.state.viewports).toEqual(own.state.viewports);
      expect((await row(id)).document).toEqual(original);
      expect(original.domains).toEqual([]);
    });
    it('keeps permission, ownership and archive creation protection for native and legacy paths', async () => {
      expect((await create('postgresql', 2, 'Viewer', viewer)).status).toBe(403);
      expect((await create('postgresql', 2, 'Outsider', outsider)).status).toBe(403);
      const edited = await create('postgresql', 2, 'Editor created', editor);
      expect(edited.status).toBe(201);
      const audit = (
        await pool.query(
          "SELECT actor_id,details FROM workspace_audit_events WHERE workspace_id=$1 AND action='project.created' AND details->>'projectId'=$2",
          [workspaceId, edited.data.id],
        )
      ).rows[0];
      expect(audit.actor_id).toBe(editor.id);
      const owners = (
        await pool.query(
          "SELECT user_id FROM user_workspaces WHERE workspace_id=$1 AND role='owner'",
          [workspaceId],
        )
      ).rows;
      expect(owners).toEqual([{ user_id: owner.id }]);
      await pool.query("UPDATE workspace SET status='archived' WHERE workspace_id=$1", [
        workspaceId,
      ]);
      try {
        for (const format of [1, 2] as const)
          expect((await create('mysql', format, 'Blocked')).status).toBe(403);
      } finally {
        await pool.query("UPDATE workspace SET status='active' WHERE workspace_id=$1", [
          workspaceId,
        ]);
      }
    });
    it('serializes native/legacy automatic gallery names while considering manual and archived names', async () => {
      const first = await create('postgresql', 2);
      expect(first.data.name).toBe('새 프로젝트');
      const manual = await create('mysql', 1, '새 프로젝트 7');
      expect(manual.status).toBe(201);
      await request(`/projects/${manual.data.id}`, 'PATCH', {
        expectedVersion: 0,
        status: 'archived',
      });
      const created = await Promise.all([
        create('postgresql', 2, ' '),
        create('mysql', 1),
        create('sqlite', 2),
        create('postgresql', undefined),
      ]);
      expect(created.every((result) => result.status === 201)).toBe(true);
      expect(created.map((result) => result.data.name).sort()).toEqual([
        '새 프로젝트 10',
        '새 프로젝트 11',
        '새 프로젝트 8',
        '새 프로젝트 9',
      ]);
      const gallery = await request(`/projects?workspaceId=${workspaceId}`);
      expect(gallery.status).toBe(200);
      expect(
        gallery.data.some(
          (project: { id: string; preview: { tableCount: number } }) =>
            project.id === created[0]!.data.id && project.preview.tableCount === 0,
        ),
      ).toBe(true);
    });
    it('rejects arbitrary documents, ownership/revision/profile overrides and invalid native options', async () => {
      const before = (
        await pool.query('SELECT COUNT(*) FROM projects WHERE workspace_id=$1', [workspaceId])
      ).rows[0].count;
      for (const extra of [
        { formatVersion: 3 },
        { formatVersion: '2' },
        { document: createEmptyNativeDocument(defaultDatabaseContext('postgresql')) },
        { ownerId: owner.id },
        { databaseRevision: 99 },
        { databaseProfileId: 'mysql-8.4-innodb-v1' },
        { native: true },
      ]) {
        expect(
          (await request('/projects', 'POST', { workspaceId, formatVersion: 2, ...extra })).status,
        ).toBe(400);
      }
      expect(
        (await pool.query('SELECT COUNT(*) FROM projects WHERE workspace_id=$1', [workspaceId]))
          .rows[0].count,
      ).toBe(before);
    });
    it.each(['postgresql', 'mysql', 'sqlite'] as const)(
      'creates native %s through the registered MCP tool without upgrade',
      async (kind) => {
        const tools = await client.listTools(),
          tool = tools.tools.find((tool) => tool.name === 'create_project')!;
        expect(tool.description).toContain('formatVersion: 2');
        expect(tool.inputSchema.properties).toHaveProperty('formatVersion');
        const result = await client.callTool({
          name: 'create_project',
          arguments: { workspaceId, name: 'MCP native', databaseKind: kind, formatVersion: 2 },
        });
        expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
        const project = projectSchema.parse(result.structuredContent);
        expect((await row(project.id)).document.schemaVersion).toBe(2);
        const state = await client.callTool({
          name: 'get_project_document_state',
          arguments: { projectId: project.id },
        });
        expect(state.isError).not.toBe(true);
        expect(
          projectDocumentStateSchema.parse(state.structuredContent).sourceDocument.schemaVersion,
        ).toBe(2);
        const operationId = randomUUID(),
          domainId = randomUUID();
        const edited = await client.callTool({
          name: 'apply_native_project_changes',
          arguments: {
            projectId: project.id,
            operationId,
            groupId: operationId,
            clientId: randomUUID(),
            expectedVersion: 0,
            expectedSequence: 0,
            expectedDatabaseRevision: 0,
            commands: [
              {
                type: 'add_domain',
                value: { id: domainId, name: 'First domain', description: '' },
                placement: { x: 40, y: 40 },
              },
            ],
            includeDocument: true,
          },
        });
        expect(edited.isError, JSON.stringify(edited.content)).not.toBe(true);
        expect((await row(project.id)).document.domains).toEqual([
          { id: domainId, name: 'First domain', description: '' },
        ]);
      },
    );
    it('keeps the omitted create_project MCP format backward compatible', async () => {
      const result = await client.callTool({
        name: 'create_project',
        arguments: { workspaceId, databaseKind: 'mysql' },
      });
      expect(result.isError).not.toBe(true);
      const project = projectSchema.parse(result.structuredContent);
      expect((await row(project.id)).document.schemaVersion).toBe(1);
      const invalid = await client.callTool({
        name: 'create_project',
        arguments: { workspaceId, formatVersion: 3 },
      });
      expect(invalid.isError).toBe(true);
    });
  },
);
