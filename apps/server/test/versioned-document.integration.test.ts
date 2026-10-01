import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  addDomain,
  createEmptyDocument,
  defaultDatabaseContext,
  deriveOperationChanges,
  migrateDesignDocumentV1,
  type DesignDocument,
} from '@ezerd/model';
import { projectDocumentStateSchema } from '@ezerd/contracts';

function legacyDocument(): DesignDocument {
  const doc = createEmptyDocument();
  doc.tables = [
    {
      id: 't',
      domainId: null,
      scope: 'both',
      logical: { name: 'T', definition: '' },
      physical: { name: 'table', schema: 'public', comment: '' },
      customProperties: { common: {}, logical: {}, physical: {} },
    },
  ];
  doc.columns = [
    {
      id: 'c',
      tableId: 't',
      scope: 'both',
      logical: { name: 'C', definition: '', semanticType: '', required: false },
      physical: {
        name: 'id',
        type: { name: ' FLOAT4 ', isArray: false },
        nullable: true,
        defaultExpression: 'old()',
        comment: '',
      },
      customProperties: { common: {}, logical: {}, physical: {} },
    },
  ];
  return doc;
}
describe.runIf(process.env.EZERD_DB_TEST === '1')(
  'versioned HTTP document read and legacy guards',
  () => {
    let app: NestExpressApplication;
    let pool: pg.Pool;
    let base: string;
    let token: string;
    let actorId: string;
    let workspaceId: string;
    const projectIds: string[] = [];
    const userIds: string[] = [];
    const previousPort = process.env.PORT;
    const previousMcpUrl = process.env.MCP_PUBLIC_URL;
    const request = async (
      path: string,
      method = 'GET',
      body?: unknown,
      auth: string | null = token,
    ) => {
      const response = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(auth ? { authorization: `Bearer ${auth}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: await response.json() };
    };
    const createProject = async (kind = 'postgresql') => {
      const result = await request('/projects', 'POST', {
        name: `native-read-${randomUUID()}`,
        workspaceId,
        databaseKind: kind,
      });
      expect(result.status).toBe(201);
      projectIds.push(result.data.id);
      return result.data.id as string;
    };
    const stored = async (id: string) =>
      (
        await pool.query(
          'SELECT document, version, sync_sequence, database_kind, database_profile_id, database_revision, updated_at FROM projects WHERE id=$1',
          [id],
        )
      ).rows[0];
    beforeAll(async () => {
      const { AppModule } = await import('../dist/app.module.js');
      const { readConfig } = await import('../dist/config.js');
      const config = readConfig();
      if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.DATABASE_URL).hostname))
        throw new Error('Local DB fixtures only');
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
      const user = await request(
        '/users',
        'POST',
        { username: `versioned-${randomUUID().slice(0, 20)}`, pin: '0024' },
        null,
      );
      expect(user.status).toBe(201);
      actorId = user.data.id;
      userIds.push(actorId);
      token = (await request('/sessions', 'POST', { userId: actorId, pin: '0024' }, null)).data
        .token;
      const workspace = await request('/workspaces', 'POST', { name: `versioned-${randomUUID()}` });
      expect(workspace.status).toBe(201);
      workspaceId = workspace.data.id;
    });
    afterAll(async () => {
      if (previousPort === undefined) delete process.env.PORT;
      else process.env.PORT = previousPort;
      if (previousMcpUrl === undefined) delete process.env.MCP_PUBLIC_URL;
      else process.env.MCP_PUBLIC_URL = previousMcpUrl;
      if (app) await app.close();
      if (!pool) return;
      try {
        if (projectIds.length)
          await pool.query('DELETE FROM projects WHERE id=ANY($1::uuid[])', [projectIds]);
        if (workspaceId) {
          await pool.query('DELETE FROM workspace_invitations WHERE workspace_id=$1', [
            workspaceId,
          ]);
          await pool.query('DELETE FROM user_workspaces WHERE workspace_id=$1', [workspaceId]);
          await pool.query('DELETE FROM workspace_audit_events WHERE workspace_id=$1', [
            workspaceId,
          ]);
          await pool.query('DELETE FROM workspace WHERE workspace_id=$1', [workspaceId]);
        }
        if (userIds.length)
          await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [userIds]);
      } finally {
        await pool.end();
      }
    });
    it.each(['postgresql', 'mysql', 'sqlite'])(
      'reads %s v1 source/preview under one unchanged saved context',
      async (kind) => {
        const id = await createProject(kind);
        const source = legacyDocument();
        await pool.query(
          'UPDATE projects SET document=$2::jsonb, version=7, sync_sequence=11, database_revision=3 WHERE id=$1',
          [id, JSON.stringify(source)],
        );
        const before = await stored(id);
        const baselineBefore = await pool.query(
          'SELECT COUNT(*) FROM sync_client_baselines WHERE project_id=$1',
          [id],
        );
        const response = await request(`/projects/${id}/document-state`);
        expect(response.status).toBe(200);
        expect(projectDocumentStateSchema.safeParse(response.data).success).toBe(true);
        expect(response.data).toMatchObject({
          protocolVersion: 2,
          sequence: 11,
          project: { version: 7, databaseKind: kind, databaseRevision: 3 },
          sourceDocument: source,
          native: { status: 'available', document: { schemaVersion: 2, database: { kind } } },
        });
        const type = response.data.native.document.columns[0].physical.type;
        expect(type.kind).toBe(kind === 'postgresql' ? 'builtin' : 'legacy');
        expect(
          response.data.native.document.layout.nodes.some(
            (node: { viewId: string }) => node.viewId === '__tables__',
          ),
        ).toBe(true);
        expect(await stored(id)).toEqual(before);
        expect(
          (await pool.query('SELECT COUNT(*) FROM sync_client_baselines WHERE project_id=$1', [id]))
            .rows,
        ).toEqual(baselineBefore.rows);
        const capabilities = await request(`/projects/${id}/database/capabilities`);
        expect(capabilities.data).toMatchObject({
          version: 7,
          sequence: 11,
          documentSchemaVersion: 1,
          database: { kind, revision: 3 },
        });
        expect((await request(`/projects/${id}`)).status).toBe(200);
      },
    );
    it('authenticates and enforces read access; archived state remains readable without writes', async () => {
      const id = await createProject();
      expect((await request(`/projects/${id}/document-state`, 'GET', undefined, null)).status).toBe(
        401,
      );
      const stranger = await request(
        '/users',
        'POST',
        { username: `stranger-${randomUUID().slice(0, 20)}`, pin: '0024' },
        null,
      );
      userIds.push(stranger.data.id);
      const session = await request(
        '/sessions',
        'POST',
        { userId: stranger.data.id, pin: '0024' },
        null,
      );
      expect(
        (await request(`/projects/${id}/document-state`, 'GET', undefined, session.data.token))
          .status,
      ).toBe(403);
      await pool.query("UPDATE projects SET status='archived' WHERE id=$1", [id]);
      expect((await request(`/projects/${id}/document-state`)).data.project.status).toBe(
        'archived',
      );
      expect((await request(`/projects/${randomUUID()}/document-state`)).status).toBe(404);
    });
    it('reads fixture native metadata/capabilities and rejects old consumers without modifying native state', async () => {
      const id = await createProject();
      const path = `/projects/${id}`;
      const clientId = randomUUID();
      const old = (await request(`${path}/sync-baseline`, 'POST', { clientId })).data;
      const document = addDomain(
        old.document,
        { id: 'domain', name: 'accepted', description: '' },
        { x: 0, y: 0 },
      );
      const input = {
        operationId: randomUUID(),
        groupId: randomUUID(),
        clientId,
        baselineId: old.baselineId,
        baseSequence: old.sequence,
        baselineIssuedAt: old.baselineIssuedAt,
        databaseRevision: old.databaseRevision,
        kind: 'online',
        dependencyPaths: [],
        baselineDocument: old.document,
        document,
        changes: deriveOperationChanges(old.document, document),
      };
      const accepted = await request(`${path}/operations`, 'POST', input);
      expect(accepted.data.status).toBe('accepted');
      const source = migrateDesignDocumentV1(
        legacyDocument(),
        defaultDatabaseContext('postgresql'),
      ).document;
      // Until activation this fixture is seeded directly, never through a product v2 write route.
      await pool.query('UPDATE projects SET document=$2::jsonb WHERE id=$1', [
        id,
        JSON.stringify(source),
      ]);
      const before = await stored(id);
      const state = await request(`${path}/document-state`);
      expect(state.status).toBe(200);
      expect(state.data.sourceDocument).toEqual(source);
      expect(state.data.project.preview).toMatchObject({
        tableCount: 1,
        tables: [{ columns: [{ type: 'REAL' }] }],
      });
      expect((await request(`${path}/database/capabilities`)).data.documentSchemaVersion).toBe(2);
      for (const [url, method, body] of [
        [path, 'GET', undefined],
        [`${path}/export`, 'GET', undefined],
        [`${path}/sync-baseline`, 'POST', { clientId }],
        [`${path}/events?since=0`, 'GET', undefined],
        [`${path}/operations`, 'POST', { ...input, operationId: randomUUID() }],
      ] as const) {
        const response = await request(url, method, body);
        expect(response).toMatchObject({
          status: 409,
          data: { code: 'document.client-upgrade-required' },
        });
      }
      const replay = await request(`${path}/operations`, 'POST', input);
      expect(replay).toEqual(accepted);
      expect((await request(`${path}/operations/${input.operationId}`)).data).toEqual(
        accepted.data,
      );
      expect(await stored(id)).toEqual(before);
      const changed = await request(path, 'PATCH', {
        expectedVersion: before.version,
        databaseKind: 'mysql',
      });
      expect(changed).toMatchObject({
        status: 409,
        data: { code: 'document.client-upgrade-required' },
      });
      const preview = await request(`${path}/database/preview`, 'POST', {
        expectedVersion: before.version,
        expectedSequence: before.sync_sequence,
        targetKind: 'mysql',
      });
      expect(preview.data).toMatchObject({
        canChange: false,
        reasonCode: 'database.native-change-not-ready',
      });
      const change = await request(`${path}/database/change`, 'POST', {
        operationId: randomUUID(),
        expectedVersion: before.version,
        expectedSequence: before.sync_sequence,
        expectedDatabaseRevision: before.database_revision,
        targetKind: 'mysql',
      });
      expect(change).toMatchObject({
        status: 409,
        data: { code: 'document.client-upgrade-required' },
      });
      expect(await stored(id)).toEqual(before);
      const rename = await request(path, 'PATCH', {
        expectedVersion: before.version,
        name: 'native-readable',
      });
      expect(rename.status).toBe(200);
      expect((await stored(id)).document).toEqual(source);
    });
    it('serves the same native snapshot over authenticated HTTP MCP and denies nonmembers', async () => {
      const id = await createProject();
      const source = migrateDesignDocumentV1(
        legacyDocument(),
        defaultDatabaseContext('postgresql'),
      ).document;
      await pool.query('UPDATE projects SET document=$2::jsonb WHERE id=$1', [
        id,
        JSON.stringify(source),
      ]);
      const before = await stored(id);
      const issued = await request('/mcp-tokens', 'POST', { name: 'versioned read' });
      expect(issued.status).toBe(201);
      const client = new Client({ name: 'native-read-fixture', version: '1.0.0' });
      const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${issued.data.token}` } },
      });
      try {
        await client.connect(transport);
        const tools = await client.listTools();
        expect(
          tools.tools.find((tool) => tool.name === 'get_project_document_state'),
        ).toMatchObject({
          annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        });
        const expected = (await request(`/projects/${id}/document-state`)).data;
        const result = await client.callTool({
          name: 'get_project_document_state',
          arguments: { projectId: id },
        });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toEqual(expected);
        expect(projectDocumentStateSchema.safeParse(result.structuredContent).success).toBe(true);
        const personal = await client.callTool({
          name: 'get_personal_state',
          arguments: { projectId: id },
        });
        expect(personal.isError).not.toBe(true);
        const savedPersonal = await client.callTool({
          name: 'apply_personal_changes',
          arguments: {
            projectId: id,
            expectedVersion: 0,
            operationId: randomUUID(),
            commands: [
              { type: 'set_viewport', value: { viewId: '__tables__', x: 12, y: 34, zoom: 1 } },
            ],
          },
        });
        expect(savedPersonal.isError).not.toBe(true);
        expect(savedPersonal.structuredContent).toMatchObject({
          version: 1,
          state: {
            viewports: expect.arrayContaining([{ viewId: '__tables__', x: 12, y: 34, zoom: 1 }]),
          },
        });
        expect(
          (await client.callTool({ name: 'get_project', arguments: { projectId: id } })).isError,
        ).toBe(true);
        expect(await stored(id)).toEqual(before);
        expect(
          (await pool.query('SELECT COUNT(*) FROM sync_client_baselines WHERE project_id=$1', [id]))
            .rows[0].count,
        ).toBe('0');
      } finally {
        await client.close();
      }
      const stranger = await request(
        '/users',
        'POST',
        { username: `mcp-stranger-${randomUUID().slice(0, 18)}`, pin: '0024' },
        null,
      );
      userIds.push(stranger.data.id);
      const session = (
        await request('/sessions', 'POST', { userId: stranger.data.id, pin: '0024' }, null)
      ).data.token;
      const otherToken = await request('/mcp-tokens', 'POST', { name: 'no access' }, session);
      const other = new Client({ name: 'native-denied-fixture', version: '1.0.0' });
      try {
        await other.connect(
          new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
            requestInit: { headers: { Authorization: `Bearer ${otherToken.data.token}` } },
          }),
        );
        const result = await other.callTool({
          name: 'get_project_document_state',
          arguments: { projectId: id },
        });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toBeUndefined();
        expect(await stored(id)).toEqual(before);
      } finally {
        await other.close();
      }
    });
    it.each(['postgresql', 'mysql', 'sqlite'])(
      'applies real MCP personal commands to %s native sources with replay, atomicity and user isolation',
      async (kind) => {
        const id = await createProject(kind);
        const source = migrateDesignDocumentV1(
          legacyDocument(),
          defaultDatabaseContext(kind as 'postgresql' | 'mysql' | 'sqlite'),
        ).document;
        source.domains = [{ id: 'd', name: 'Domain', description: '' }];
        source.tables![0]!.domainId = 'd';
        source.tables!.push({
          ...structuredClone(source.tables![0]!),
          id: 't2',
          physical: { ...structuredClone(source.tables![0]!.physical), name: 'table2' },
        });
        source.columns!.push({ ...structuredClone(source.columns![0]!), id: 'c2', tableId: 't2' });
        source.tableRelations = [
          {
            id: 'r',
            sourceTableId: 't',
            targetTableId: 't2',
            scope: 'both',
            logical: { name: 'Relation', cardinality: 'one-to-many', required: false },
            physical: null,
          },
        ];
        source.indexes = [
          {
            id: 'index',
            tableId: 't',
            name: 'index',
            scope: 'logical',
            unique: false,
            parts: [{ direction: 'asc', expression: { kind: 'column', columnId: 'c' } }],
            options:
              kind === 'mysql'
                ? { database: 'mysql', kind: 'btree' }
                : kind === 'sqlite'
                  ? { database: 'sqlite' }
                  : { database: 'postgresql', method: 'btree' },
          },
        ];
        source.layout.nodes = [
          { id: 'node-d', objectId: 'd', viewId: 'overview', x: 0, y: 0, width: 240, height: 160 },
          ...['t', 't2'].map((objectId, i) => ({
            id: 'global-' + objectId,
            objectId,
            viewId: '__tables__',
            x: i * 400 + 100,
            y: 200,
            width: 320,
            height: 260,
          })),
        ];
        await pool.query(
          'UPDATE projects SET document=$2::jsonb, version=7, sync_sequence=11 WHERE id=$1',
          [id, JSON.stringify(source)],
        );
        const before = await stored(id);
        const issued = await request('/mcp-tokens', 'POST', { name: 'native personal commands' });
        const client = new Client({ name: 'native-personal-fixture', version: '1.0.0' });
        const call = (arguments_: Record<string, unknown>) =>
          client.callTool({ name: 'apply_personal_changes', arguments: arguments_ });
        try {
          await client.connect(
            new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
              requestInit: { headers: { Authorization: `Bearer ${issued.data.token}` } },
            }),
          );
          const input = {
            projectId: id,
            expectedVersion: 0,
            operationId: randomUUID(),
            commands: [
              {
                type: 'upsert_combined_view',
                value: { id: 'view', name: 'Own', domainIds: ['d'] },
              },
              { type: 'set_viewport', value: { viewId: 'view', x: 120, y: 30, zoom: 1.5 } },
              {
                type: 'upsert_note',
                value: { id: 'note', viewId: 'view', text: 'Original', color: '#123456' },
                placement: { x: 10, y: 20 },
              },
              { type: 'patch_note', id: 'note', patch: { text: 'Updated', color: null } },
              { type: 'update_node_layout', nodeId: 'node:t:view', patch: { x: 80, width: 600 } },
              {
                type: 'upsert_relation_layout',
                value: { relationId: 'r', viewId: 'view', offset: 15 },
              },
              { type: 'patch_combined_view', id: 'view', patch: { name: 'Renamed' } },
            ],
          };
          const result = await call(input);
          expect(result.isError).not.toBe(true);
          expect(result.structuredContent).toMatchObject({
            version: 1,
            projectVersion: 7,
            syncSequence: 11,
            state: {
              views: [{ id: 'view', name: 'Renamed' }],
              notes: [{ id: 'note', text: 'Updated' }],
              relations: [{ relationId: 'r', viewId: 'view', offset: 15 }],
            },
          });
          const saved = (await request(`/projects/${id}/personal-state`)).data;
          expect(saved).toEqual(result.structuredContent);
          expect(saved.state.nodes).toContainEqual(
            expect.objectContaining({ objectId: 't', viewId: 'view', x: 80, width: 600 }),
          );
          expect(saved.state.notes[0]).not.toHaveProperty('color');
          expect((await call(input)).structuredContent).toEqual(saved);
          expect(
            (
              await call({
                ...input,
                commands: [
                  { type: 'set_viewport', value: { viewId: '__tables__', x: 0, y: 0, zoom: 1 } },
                ],
              })
            ).isError,
          ).toBe(true);
          expect((await call({ ...input, operationId: randomUUID() })).isError).toBe(true);
          const invalid = {
            projectId: id,
            expectedVersion: 1,
            operationId: randomUUID(),
            commands: [
              { type: 'patch_note', id: 'note', patch: { text: 'Must roll back', color: null } },
              {
                type: 'upsert_relation_layout',
                value: { relationId: 'missing', viewId: 'view', offset: 1 },
              },
            ],
          };
          expect((await call(invalid)).isError).toBe(true);
          expect((await request(`/projects/${id}/personal-state`)).data).toEqual(saved);
          expect(
            (
              await call({
                ...invalid,
                operationId: randomUUID(),
                commands: [
                  {
                    type: 'upsert_note',
                    value: { id: 'index', viewId: 'view', text: 'Collision' },
                  },
                ],
              })
            ).isError,
          ).toBe(true);
          expect(
            (
              await pool.query(
                'SELECT COUNT(*) FROM project_personal_operations WHERE project_id=$1',
                [id],
              )
            ).rows[0].count,
          ).toBe('1');
          expect(await stored(id)).toEqual(before);
          for (const table of ['sync_client_baselines', 'sync_operations'])
            expect(
              (await pool.query(`SELECT COUNT(*) FROM ${table} WHERE project_id=$1`, [id])).rows[0]
                .count,
            ).toBe('0');

          const other = await request(
            '/users',
            'POST',
            { username: `native-private-${randomUUID().slice(0, 16)}`, pin: '0024' },
            null,
          );
          userIds.push(other.data.id);
          const session = (
            await request('/sessions', 'POST', { userId: other.data.id, pin: '0024' }, null)
          ).data.token;
          const otherIssued = await request(
            '/mcp-tokens',
            'POST',
            { name: 'other native personal' },
            session,
          );
          const viewer = new Client({ name: 'native-personal-viewer', version: '1.0.0' });
          try {
            await viewer.connect(
              new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
                requestInit: { headers: { Authorization: `Bearer ${otherIssued.data.token}` } },
              }),
            );
            expect(
              (
                await viewer.callTool({
                  name: 'apply_personal_changes',
                  arguments: {
                    projectId: id,
                    expectedVersion: 0,
                    operationId: randomUUID(),
                    commands: [
                      {
                        type: 'set_viewport',
                        value: { viewId: '__tables__', x: 1, y: 2, zoom: 1 },
                      },
                    ],
                  },
                })
              ).isError,
            ).toBe(true);
            const invitation = await request(`/workspaces/${workspaceId}/invitations`, 'POST', {
              username: other.data.username,
              role: 'viewer',
            });
            expect(
              (
                await request(
                  `/workspace-invitations/${invitation.data.id}/accept`,
                  'POST',
                  {},
                  session,
                )
              ).status,
            ).toBe(201);
            expect(
              (await viewer.callTool({ name: 'get_personal_state', arguments: { projectId: id } }))
                .structuredContent,
            ).toMatchObject({ version: 0, state: { views: [], notes: [] } });
            expect(
              (
                await viewer.callTool({
                  name: 'apply_personal_changes',
                  arguments: { ...input, expectedVersion: 0 },
                })
              ).isError,
            ).toBe(true);
            const own = await viewer.callTool({
              name: 'apply_personal_changes',
              arguments: {
                projectId: id,
                expectedVersion: 0,
                operationId: randomUUID(),
                commands: [
                  { type: 'set_viewport', value: { viewId: '__tables__', x: 1, y: 2, zoom: 1 } },
                ],
              },
            });
            expect(own.isError).not.toBe(true);
            expect(own.structuredContent).toMatchObject({
              version: 1,
              state: { views: [], notes: [] },
            });
            expect((await request(`/projects/${id}/personal-state`)).data).toEqual(saved);
          } finally {
            await viewer.close();
          }
          const current = (await request(`/projects/${id}/personal-state`)).data;
          const deleted = await call({
            projectId: id,
            expectedVersion: current.version,
            operationId: randomUUID(),
            commands: [
              { type: 'remove_table_reference', nodeId: 'node:t:view' },
              {
                type: 'add_table_reference',
                tableId: 't',
                viewId: 'view',
                placement: { x: 60, y: 70, width: 500 },
              },
              { type: 'delete_relation_layout', relationId: 'r', viewId: 'view' },
              { type: 'delete_note', id: 'note' },
              { type: 'delete_combined_view', id: 'view' },
            ],
          });
          expect(deleted.isError).not.toBe(true);
          expect(deleted.structuredContent).toMatchObject({
            version: 2,
            state: { views: [], notes: [], nodes: [], relations: [] },
          });
          expect(await stored(id)).toEqual(before);
        } finally {
          await client.close();
        }
      },
    );
    it.each(['postgresql', 'mysql', 'sqlite'])(
      'stores only personal state and reviews on a %s native canvas',
      async (kind) => {
        const id = await createProject(kind);
        const source = migrateDesignDocumentV1(
          legacyDocument(),
          defaultDatabaseContext(kind as 'postgresql' | 'mysql' | 'sqlite'),
        ).document;
        source.domains = [{ id: 'd', name: 'domain', description: '' }];
        source.tables![0]!.domainId = 'd';
        source.indexes = [
          {
            id: 'index',
            tableId: 't',
            name: '',
            scope: 'logical',
            unique: false,
            parts: [{ direction: 'asc', expression: { kind: 'column', columnId: 'c' } }],
            options:
              kind === 'mysql'
                ? { database: 'mysql', kind: 'btree' }
                : kind === 'sqlite'
                  ? { database: 'sqlite' }
                  : { database: 'postgresql', method: 'btree' },
          },
        ];
        source.layout.nodes = [
          {
            id: 'domain-node',
            objectId: 'd',
            viewId: 'overview',
            x: 0,
            y: 0,
            width: 240,
            height: 160,
          },
          {
            id: 'table-node',
            objectId: 't',
            viewId: '__tables__',
            x: 100,
            y: 200,
            width: 320,
            height: 260,
          },
        ];
        await pool.query('UPDATE projects SET document=$2::jsonb WHERE id=$1', [
          id,
          JSON.stringify(source),
        ]);
        const before = await stored(id);
        const first = await request(`/projects/${id}/personal-state`);
        expect(first.status).toBe(200);
        const state = {
          ...first.data.state,
          views: [{ id: 'view', name: 'mine', domainIds: ['d'] }],
          notes: [{ id: 'note', viewId: 'view', text: 'my private note' }],
          nodes: [
            {
              id: 'private-node',
              objectId: 'note',
              viewId: 'view',
              x: 0,
              y: 0,
              width: 240,
              height: 160,
            },
          ],
          viewports: [{ viewId: '__tables__', x: 12, y: 34, zoom: 0.8 }],
        };
        const saved = await request(`/projects/${id}/personal-state`, 'PUT', {
          expectedVersion: first.data.version,
          state,
        });
        expect(saved).toMatchObject({ status: 200, data: { version: 1, state } });
        expect((await request(`/projects/${id}/personal-state`)).data.state).toEqual(state);
        const collision = structuredClone(state);
        collision.notes[0].id = 'index';
        collision.nodes[0].objectId = 'index';
        expect(
          (
            await request(`/projects/${id}/personal-state`, 'PUT', {
              expectedVersion: 1,
              state: collision,
            })
          ).status,
        ).toBe(400);
        const pin = await request(`/projects/${id}/threads`, 'POST', {
          viewId: 'd',
          objectId: 't',
          x: 100,
          y: 200,
          body: 'native canvas review',
          mentionIds: [],
        });
        expect(pin.status).toBe(201);
        expect(pin.data.messages[0].authorId).toBe(actorId);
        const privatePin = await request(`/projects/${id}/threads`, 'POST', {
          viewId: 'view',
          objectId: 'note',
          x: 0,
          y: 0,
          body: 'my private placement review',
          mentionIds: [],
        });
        expect(privatePin.status).toBe(201);
        expect(
          (
            await request(`/projects/${id}/threads`, 'POST', {
              viewId: 'd',
              objectId: 'missing',
              x: 0,
              y: 0,
              body: 'invalid',
              mentionIds: [],
            })
          ).status,
        ).toBe(400);
        const other = await request(
          '/users',
          'POST',
          { username: `viewer-${randomUUID().slice(0, 20)}`, pin: '0024' },
          null,
        );
        userIds.push(other.data.id);
        const session = (
          await request('/sessions', 'POST', { userId: other.data.id, pin: '0024' }, null)
        ).data.token;
        expect(
          (await request(`/projects/${id}/personal-state`, 'GET', undefined, session)).status,
        ).toBe(403);
        const invitation = await request(`/workspaces/${workspaceId}/invitations`, 'POST', {
          username: other.data.username,
          role: 'viewer',
        });
        expect(
          (
            await request(
              `/workspace-invitations/${invitation.data.id}/accept`,
              'POST',
              {},
              session,
            )
          ).status,
        ).toBe(201);
        const viewer = await request(`/projects/${id}/personal-state`, 'GET', undefined, session);
        expect(viewer.data.state.notes).toEqual([]);
        expect(viewer.data.version).toBe(0);
        expect(
          (
            await request(
              `/projects/${id}/threads`,
              'POST',
              {
                viewId: 'view',
                objectId: 'note',
                x: 0,
                y: 0,
                body: 'not my private placement',
                mentionIds: [],
              },
              session,
            )
          ).status,
        ).toBe(400);
        expect(
          (
            await request(
              `/projects/${id}/personal-state`,
              'PUT',
              {
                expectedVersion: 0,
                state: {
                  ...viewer.data.state,
                  viewports: [{ viewId: '__tables__', x: 50, y: 60, zoom: 1 }],
                },
              },
              session,
            )
          ).status,
        ).toBe(200);
        expect((await request(`/projects/${id}/personal-state`)).data.state).toEqual(state);
        expect(await stored(id)).toEqual(before);
      },
    );
    it('keeps a native DB mismatch explicit instead of interpreting it in the project dialect', async () => {
      const id = await createProject('mysql');
      const source = migrateDesignDocumentV1(
        legacyDocument(),
        defaultDatabaseContext('postgresql'),
      ).document;
      await pool.query('UPDATE projects SET document=$2::jsonb WHERE id=$1', [
        id,
        JSON.stringify(source),
      ]);
      const before = await stored(id);
      const state = await request(`/projects/${id}/document-state`);
      expect(state).toMatchObject({
        status: 200,
        data: {
          sourceDocument: source,
          native: { status: 'unavailable', code: 'database.context-changed' },
        },
      });
      expect(projectDocumentStateSchema.safeParse(state.data).success).toBe(true);
      expect(await stored(id)).toEqual(before);
    });
  },
);
