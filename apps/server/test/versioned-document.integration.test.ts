import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  addDomain,
  createEmptyDocument,
  defaultDatabaseContext,
  deriveOperationChanges,
  migrateDesignDocumentV1,
  createNativeTable,
  createNativeColumn,
  type DesignDocument,
} from '@ezerd/model';
import {
  projectDocumentStateSchema,
  nativeSyncOperationResultSchema,
  nativeSyncSnapshotSchema,
  projectDDLExportSchema,
  nativeHistoryPageSchema,
  nativeHistoryCommandResultSchema,
} from '@ezerd/contracts';

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
    let ownerMcpToken: string;
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
      const { SyncGateway } = await import('../dist/sync/sync.gateway.js');
      app.get(SyncGateway).attach(app.getHttpServer());
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
      const issued = await request('/mcp-tokens', 'POST', { name: 'versioned fixture' });
      expect(issued.status).toBe(201);
      ownerMcpToken = issued.data.token;
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
      'exports %s DDL from an unchanged whole-project snapshot and gates incompatible formats',
      async (kind) => {
        const id = await createProject(kind),
          source = legacyDocument();
        source.columns![0]!.physical.defaultExpression = null;
        await pool.query('UPDATE projects SET document=$2::jsonb WHERE id=$1', [
          id,
          JSON.stringify(source),
        ]);
        const before = await stored(id);
        expect((await request(`/projects/${id}/ddl`, 'GET', undefined, null)).status).toBe(401);
        const exported = await request(`/projects/${id}/ddl`);
        expect(exported.status).toBe(200);
        expect(projectDDLExportSchema.safeParse(exported.data).success).toBe(true);
        expect(exported.data).toMatchObject({
          projectId: id,
          documentSchemaVersion: 1,
          database: { kind },
          encoding: 'UTF-8',
          canExport: kind === 'postgresql',
        });
        if (kind === 'postgresql')
          expect(exported.data.sql).toContain('CREATE TABLE "public"."table"');
        else expect(exported.data.sql).toBe('');
        const issued = { status: 201, data: { token: ownerMcpToken } };
        const client = new Client({ name: 'ddl-read', version: '1.0.0' });
        try {
          await client.connect(
            new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
              requestInit: { headers: { Authorization: `Bearer ${issued.data.token}` } },
            }),
          );
          const result = await client.callTool({
            name: 'export_project_ddl',
            arguments: { projectId: id },
          });
          expect(result.isError).not.toBe(true);
          expect(result.structuredContent).toEqual(exported.data);
        } finally {
          await client.close();
        }
        expect(await stored(id)).toEqual(before);
        const native = migrateDesignDocumentV1(
          source,
          defaultDatabaseContext(kind as 'postgresql' | 'mysql' | 'sqlite'),
        ).document;
        await pool.query('UPDATE projects SET document=$2::jsonb WHERE id=$1', [
          id,
          JSON.stringify(native),
        ]);
        const gated = await request(`/projects/${id}/ddl`);
        expect(gated.data).toMatchObject({ documentSchemaVersion: 2, canExport: false, sql: '' });
        expect(gated.data.issues.length).toBeGreaterThan(0);
      },
    );
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
        reasonCode: 'database.conversion-required',
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
        data: { code: 'database.conversion-required' },
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
      const issued = { status: 201, data: { token: ownerMcpToken } };
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
            expectedDatabaseRevision: (await stored(id)).database_revision,
            expectedProjectVersion: (await stored(id)).version,
            expectedSyncSequence: (await stored(id)).sync_sequence,
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
      'upgrades %s v1 through actual HTTP/MCP while preserving source history and old accepted replay',
      async (kind) => {
        const id = await createProject(kind);
        const oldClientId = randomUUID();
        const old = (
          await request(`/projects/${id}/sync-baseline`, 'POST', { clientId: oldClientId })
        ).data;
        const legacy = legacyDocument();
        const oldInput = {
          operationId: randomUUID(),
          groupId: randomUUID(),
          clientId: oldClientId,
          baselineId: old.baselineId,
          baseSequence: old.sequence,
          baselineIssuedAt: old.baselineIssuedAt,
          databaseRevision: old.databaseRevision,
          kind: 'online',
          dependencyPaths: [],
          baselineDocument: old.document,
          document: legacy,
          changes: deriveOperationChanges(old.document, legacy),
        };
        const oldAccepted = await request(`/projects/${id}/operations`, 'POST', oldInput);
        expect(oldAccepted.data).toMatchObject({ status: 'accepted', sequence: 1 });
        // Emulate an older raw v1 row without rewriting it on reads.
        await pool.query('UPDATE projects SET document=$2::jsonb WHERE id=$1', [
          id,
          JSON.stringify(legacy),
        ]);
        const before = await stored(id);
        const preUpgrade = (
          await request(`/projects/${id}/sync-baseline`, 'POST', { clientId: randomUUID() })
        ).data;
        const issued = { status: 201, data: { token: ownerMcpToken } };
        const client = new Client({ name: 'native-upgrade-fixture', version: '1.0.0' });
        try {
          await client.connect(
            new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
              requestInit: { headers: { Authorization: `Bearer ${issued.data.token}` } },
            }),
          );
          const input = {
            operationId: randomUUID(),
            clientId: randomUUID(),
            expectedVersion: before.version,
            expectedSequence: before.sync_sequence,
            expectedDatabaseRevision: before.database_revision,
          };
          const upgraded =
            kind === 'postgresql'
              ? (await request(`/projects/${id}/document/upgrade`, 'POST', input)).data
              : (
                  await client.callTool({
                    name: 'upgrade_project_document',
                    arguments: { projectId: id, ...input },
                  })
                ).structuredContent;
          expect(upgraded).toMatchObject({
            protocolVersion: 2,
            status: 'accepted',
            reasonCode: 'document.upgraded',
            sequence: 2,
            databaseRevision: 1,
            document: { schemaVersion: 2, database: { kind } },
          });
          const after = await stored(id);
          expect(after.version).toBe(before.version + 1);
          expect(after.database_revision).toBe(before.database_revision + 1);
          const converted = migrateDesignDocumentV1(
            legacy,
            defaultDatabaseContext(kind as 'postgresql' | 'mysql' | 'sqlite'),
          ).document;
          expect(after.document).toEqual(converted);
          expect(after.document.columns[0].physical.type.kind).toBe(
            kind === 'postgresql' ? 'builtin' : 'legacy',
          );
          const history = (
            await pool.query(
              'SELECT deletion_snapshot FROM sync_operations WHERE project_id=$1 AND operation_id=$2',
              [id, input.operationId],
            )
          ).rows[0].deletion_snapshot;
          expect(history).toMatchObject({
            command: 'upgrade',
            sourceDocument: legacy,
            sourceDatabase: { kind, revision: 0 },
          });
          expect((await request(`/projects/${id}/document/upgrade`, 'POST', input)).data).toEqual(
            upgraded,
          );
          expect(
            (
              await client.callTool({
                name: 'upgrade_project_document',
                arguments: { projectId: id, ...input },
              })
            ).structuredContent,
          ).toEqual(upgraded);
          expect(
            (
              await request(`/projects/${id}/document/upgrade`, 'POST', {
                ...input,
                operationId: randomUUID(),
              })
            ).status,
          ).toBe(409);
          expect((await request(`/projects/${id}/operations`, 'POST', oldInput)).data).toEqual(
            oldAccepted.data,
          );
          const invalidOld = {
            ...oldInput,
            operationId: randomUUID(),
            baselineId: preUpgrade.baselineId,
            baseSequence: preUpgrade.sequence,
            baselineIssuedAt: preUpgrade.baselineIssuedAt,
          };
          expect((await request(`/projects/${id}/operations`, 'POST', invalidOld)).status).toBe(
            409,
          );
          expect((await request(`/projects/${id}/native-sync/events?since=1`)).data).toMatchObject({
            resetRequired: true,
            events: [],
            document: { schemaVersion: 2 },
          });
          const baselineRows = (
            await pool.query(
              'SELECT baseline_id, database_revision FROM sync_client_baselines WHERE project_id=$1',
              [id],
            )
          ).rows;
          expect(baselineRows).toEqual([
            { baseline_id: upgraded.nextBaseline.baselineId, database_revision: 1 },
          ]);
          const current = (await request(`/projects/${id}/document-state`)).data;
          const edited = await client.callTool({
            name: 'apply_native_project_changes',
            arguments: {
              projectId: id,
              expectedVersion: current.project.version,
              expectedSequence: current.sequence,
              expectedDatabaseRevision: current.project.databaseRevision,
              operationId: randomUUID(),
              groupId: randomUUID(),
              clientId: randomUUID(),
              commands: [
                {
                  type: 'patch_column',
                  id: 'c',
                  patch: { physical: { comment: 'Safe edit after upgrade' } },
                },
              ],
            },
          });
          expect(edited.isError, JSON.stringify(edited)).not.toBe(true);
          expect(edited.structuredContent).toMatchObject({ status: 'accepted', sequence: 3 });
          expect((await stored(id)).document.columns[0].physical.type).toEqual(
            converted.columns![0]!.physical.type,
          );
          expect((await request(`/projects/${id}/document/upgrade`, 'POST', input)).data).toEqual(
            upgraded,
          );
          expect((await stored(id)).sync_sequence).toBe(3);
        } finally {
          await client.close();
        }
      },
    );
    it('upgrades once under concurrent replay and rolls back stale/unauthorized requests', async () => {
      const id = await createProject();
      const input = {
        operationId: randomUUID(),
        clientId: randomUUID(),
        expectedVersion: 0,
        expectedSequence: 0,
        expectedDatabaseRevision: 0,
      };
      const [first, second] = await Promise.all([
        request(`/projects/${id}/document/upgrade`, 'POST', input),
        request(`/projects/${id}/document/upgrade`, 'POST', input),
      ]);
      expect(first.status).toBe(201);
      expect(second.data).toEqual(first.data);
      expect(await stored(id)).toMatchObject({
        version: 1,
        sync_sequence: 1,
        database_revision: 1,
      });
      expect(
        (await pool.query('SELECT COUNT(*) FROM sync_operations WHERE project_id=$1', [id])).rows[0]
          .count,
      ).toBe('1');
      expect(
        (
          await request(`/projects/${id}/document/upgrade`, 'POST', {
            ...input,
            clientId: randomUUID(),
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await request(`/projects/${id}/document/upgrade`, 'POST', {
            ...input,
            operationId: randomUUID(),
          })
        ).status,
      ).toBe(409);
      const otherProject = await createProject();
      const other = await request(
        '/users',
        'POST',
        { username: `upgrade-viewer-${randomUUID().slice(0, 14)}`, pin: '0024' },
        null,
      );
      userIds.push(other.data.id);
      const session = (
        await request('/sessions', 'POST', { userId: other.data.id, pin: '0024' }, null)
      ).data.token;
      const invitation = await request(`/workspaces/${workspaceId}/invitations`, 'POST', {
        username: other.data.username,
        role: 'viewer',
      });
      expect(
        (await request(`/workspace-invitations/${invitation.data.id}/accept`, 'POST', {}, session))
          .status,
      ).toBe(201);
      const before = await stored(otherProject);
      expect(
        (
          await request(
            `/projects/${otherProject}/document/upgrade`,
            'POST',
            { ...input, operationId: randomUUID() },
            session,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await request(`/projects/${otherProject}/document/upgrade`, 'POST', {
            ...input,
            operationId: randomUUID(),
            expectedDatabaseRevision: 99,
          })
        ).status,
      ).toBe(409);
      expect(await stored(otherProject)).toEqual(before);
      await pool.query('UPDATE projects SET status=$2 WHERE id=$1', [id, 'archived']);
      expect((await request(`/projects/${id}/document/upgrade`, 'POST', input)).data).toEqual(
        first.data,
      );
      expect((await stored(id)).sync_sequence).toBe(1);
    });
    it.each(['postgresql', 'mysql', 'sqlite'])(
      'stores %s shared native canvas references, notes and moves without changing physical data',
      async (kind) => {
        const id = await createProject(kind),
          source = migrateDesignDocumentV1(
            legacyDocument(),
            defaultDatabaseContext(kind as 'postgresql' | 'mysql' | 'sqlite'),
          ).document;
        await pool.query('UPDATE projects SET document=$2::jsonb WHERE id=$1', [
          id,
          JSON.stringify(source),
        ]);
        const input = {
          operationId: randomUUID(),
          groupId: randomUUID(),
          clientId: randomUUID(),
          expectedVersion: 0,
          expectedSequence: 0,
          expectedDatabaseRevision: 0,
          includeDocument: true,
          commands: [
            {
              type: 'add_table_reference',
              tableId: 't',
              viewId: '__tables__',
              nodeId: 'native-node',
              placement: { x: 30, y: 40, width: 400 },
            },
            {
              type: 'upsert_note',
              value: { id: 'shared-note', viewId: '__tables__', text: 'Native shared note' },
              placement: { x: 500, y: 30, width: 300 },
            },
          ],
        };
        const path = `/projects/${id}/native-sync/commands`,
          saved = await request(path, 'POST', input);
        expect(saved.data.status, JSON.stringify(saved.data)).toBe('accepted');
        expect((await stored(id)).document.columns).toEqual(source.columns);
        expect((await stored(id)).document.layout.nodes).toContainEqual(
          expect.objectContaining({ id: 'native-node', objectId: 't', x: 30, y: 40 }),
        );
        const moved = await request(path, 'POST', {
          ...input,
          operationId: randomUUID(),
          expectedVersion: 1,
          expectedSequence: 1,
          commands: [
            { type: 'update_node_layout', nodeId: 'native-node', patch: { x: 200, y: 210 } },
            { type: 'patch_note', id: 'shared-note', patch: { text: 'Updated note' } },
          ],
        });
        expect(moved.data.status, JSON.stringify(moved.data)).toBe('accepted');
        expect((await stored(id)).document.layout.nodes).toContainEqual(
          expect.objectContaining({ id: 'native-node', x: 200, y: 210 }),
        );
        const deleted = await request(path, 'POST', {
          ...input,
          operationId: randomUUID(),
          expectedVersion: 2,
          expectedSequence: 2,
          commands: [{ type: 'delete_note', id: 'shared-note' }],
        });
        expect(deleted.data.status, JSON.stringify(deleted.data)).toBe('accepted');
        expect((await stored(id)).document.notes).toEqual([]);
        expect((await stored(id)).document.columns).toEqual(source.columns);
      },
    );
    it.each(['postgresql', 'mysql', 'sqlite'])(
      'stores %s native logical creation through structured command contracts and protects reused IDs',
      async (kind) => {
        const id = await createProject(kind);
        const context = defaultDatabaseContext(kind as 'postgresql' | 'mysql' | 'sqlite');
        const source = migrateDesignDocumentV1(legacyDocument(), context).document;
        await pool.query('UPDATE projects SET document=$2::jsonb WHERE id=$1', [
          id,
          JSON.stringify(source),
        ]);
        const table = createNativeTable(context, 'logical-table', null, 'logical');
        table.logical.name = 'Logical draft';
        const column = createNativeColumn(context, table, 'logical-column');
        column.logical.name = 'Draft attribute';
        const input = {
          operationId: randomUUID(),
          groupId: randomUUID(),
          clientId: randomUUID(),
          expectedVersion: 0,
          expectedSequence: 0,
          expectedDatabaseRevision: 0,
          includeDocument: true,
          commands: [
            { type: 'add_table', value: table },
            { type: 'add_column', value: column },
          ],
        };
        const path = `/projects/${id}/native-sync/commands`;
        const saved = await request(path, 'POST', input);
        expect(saved.status, JSON.stringify(saved.data)).toBe(201);
        expect(saved.data.status).toBe('accepted');
        const current = (await stored(id)).document;
        expect(current.tables).toContainEqual(table);
        expect(current.columns).toContainEqual(column);
        expect(current.columns[0]).toEqual(source.columns![0]);
        const reused = await request(path, 'POST', {
          ...input,
          operationId: randomUUID(),
          expectedVersion: 1,
          expectedSequence: 1,
          commands: [
            { type: 'delete_objects', targets: [{ collection: 'tables', id: table.id }] },
            { type: 'add_table', value: table },
          ],
        });
        expect(reused.status).toBe(400);
        expect(reused.data.code).toBe('document.duplicate-identities');
        expect((await stored(id)).document).toEqual(current);
        const removed = await request(path, 'POST', {
          ...input,
          operationId: randomUUID(),
          expectedVersion: 1,
          expectedSequence: 1,
          commands: [{ type: 'delete_objects', targets: [{ collection: 'tables', id: table.id }] }],
        });
        expect(removed.data.status, JSON.stringify(removed.data)).toBe('accepted');
        expect((await stored(id)).document).toEqual(source);
      },
    );
    it.each(['postgresql', 'mysql', 'sqlite'])(
      'saves %s native web property commands without losing source attributes',
      async (kind) => {
        const id = await createProject(kind);
        const source = migrateDesignDocumentV1(
          legacyDocument(),
          defaultDatabaseContext(kind as 'postgresql' | 'mysql' | 'sqlite'),
        ).document;
        await pool.query('UPDATE projects SET document=$2::jsonb WHERE id=$1', [
          id,
          JSON.stringify(source),
        ]);
        const input = {
          operationId: randomUUID(),
          groupId: randomUUID(),
          clientId: randomUUID(),
          expectedVersion: 0,
          expectedSequence: 0,
          expectedDatabaseRevision: 0,
          includeDocument: true,
          commands: [
            {
              type: 'patch_column',
              id: 'c',
              patch: {
                physical: { comment: 'Web draft saved' },
                logical: { definition: 'Reviewed definition' },
              },
            },
          ],
        };
        const path = `/projects/${id}/native-sync/commands`;
        const before = await stored(id);
        expect((await request(path, 'POST', input, null)).status).toBe(401);
        expect((await request(path, 'POST', { ...input, projectId: id })).status).toBe(400);
        expect(await stored(id)).toEqual(before);
        const saved = await request(path, 'POST', input);
        expect(saved.status, JSON.stringify(saved.data)).toBe(201);
        expect(nativeSyncOperationResultSchema.safeParse(saved.data).success).toBe(true);
        expect(saved.data).toMatchObject({
          status: 'accepted',
          sequence: 1,
          actor: { id: actorId },
        });
        const expected = structuredClone(source);
        expected.columns[0].physical.comment = 'Web draft saved';
        expected.columns[0].logical.definition = 'Reviewed definition';
        expect((await stored(id)).document).toEqual(expected);
        expect((await request(path, 'POST', input)).data).toEqual(saved.data);
        expect(
          (await request(`/projects/${id}/native-sync/operations/${input.operationId}`)).data,
        ).toEqual(saved.data);
        expect((await stored(id)).sync_sequence).toBe(1);
        await pool.query('UPDATE projects SET status=$2 WHERE id=$1', [id, 'archived']);
        expect(
          (
            await request(path, 'POST', {
              ...input,
              operationId: randomUUID(),
              expectedVersion: 1,
              expectedSequence: 1,
            })
          ).status,
        ).toBe(409);
        expect((await stored(id)).document).toEqual(expected);
      },
    );
    it.each(['postgresql', 'mysql', 'sqlite'])(
      'persists %s native REST/MCP operations with truthful ACKs, replay and retired identity protection',
      async (kind) => {
        const id = await createProject(kind);
        const source = migrateDesignDocumentV1(
          legacyDocument(),
          defaultDatabaseContext(kind as 'postgresql' | 'mysql' | 'sqlite'),
        ).document;
        await pool.query('UPDATE projects SET document=$2::jsonb WHERE id=$1', [
          id,
          JSON.stringify(source),
        ]);
        const initialClientId = randomUUID();
        const initial = (
          await request(`/projects/${id}/native-sync/baseline`, 'POST', {
            clientId: initialClientId,
          })
        ).data;
        expect(nativeSyncSnapshotSchema.safeParse(initial).success).toBe(true);
        const makeInput = (
          baseline: typeof initial,
          document: typeof source,
          extra: Record<string, unknown> = {},
        ) => ({
          protocolVersion: 2,
          database: baseline.database,
          databaseRevision: baseline.databaseRevision,
          operationId: randomUUID(),
          groupId: randomUUID(),
          clientId: baseline.clientId,
          baselineId: baseline.baselineId,
          baseSequence: baseline.sequence,
          baselineIssuedAt: baseline.baselineIssuedAt,
          kind: 'online',
          dependencyPaths: [],
          baselineDocument: baseline.document,
          document,
          changes: deriveOperationChanges(baseline.document, document),
          ...extra,
        });
        // Use the actual client ID stored in the trusted server baseline.
        initial.clientId = initialClientId;
        const candidate = structuredClone(initial.document);
        candidate.columns[0].physical.comment = 'Native shared edit';
        const input = makeInput(initial, candidate);
        const accepted = await request(`/projects/${id}/native-sync/operations`, 'POST', input);
        expect(accepted.status, JSON.stringify(accepted.data)).toBe(201);
        expect(nativeSyncOperationResultSchema.safeParse(accepted.data).success).toBe(true);
        expect(accepted.data).toMatchObject({
          protocolVersion: 2,
          status: 'accepted',
          sequence: 1,
          actor: { id: actorId },
          changedPaths: ['/columns/c/physical/comment'],
        });
        expect((await stored(id)).document.columns[0].physical.type).toEqual(
          source.columns![0]!.physical.type,
        );
        expect((await stored(id)).document.columns[0].physical.defaultValue).toEqual(
          source.columns![0]!.physical.defaultValue,
        );
        expect(
          await request(`/projects/${id}/native-sync/operations/${input.operationId}`),
        ).toMatchObject({ status: 200, data: accepted.data });
        expect((await request(`/projects/${id}/operations/${input.operationId}`)).status).toBe(409);
        expect(
          (await request(`/projects/${id}/native-sync/operations`, 'POST', input)).data,
        ).toEqual(accepted.data);
        expect(
          (
            await request(`/projects/${id}/native-sync/operations`, 'POST', {
              ...input,
              groupId: randomUUID(),
            })
          ).status,
        ).toBe(409);
        const events = await request(`/projects/${id}/native-sync/events?since=0`);
        expect(events.data).toMatchObject({
          protocolVersion: 2,
          sequence: 1,
          resetRequired: false,
          events: [{ status: 'accepted', changes: [{ path: '/columns/c/physical/comment' }] }],
        });

        const issued = { status: 201, data: { token: ownerMcpToken } };
        const client = new Client({ name: 'native-shared-fixture', version: '1.0.0' });
        try {
          await client.connect(
            new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
              requestInit: { headers: { Authorization: `Bearer ${issued.data.token}` } },
            }),
          );
          const state = (await request(`/projects/${id}/document-state`)).data;
          const command = {
            projectId: id,
            expectedVersion: state.project.version,
            expectedSequence: state.sequence,
            expectedDatabaseRevision: state.project.databaseRevision,
            operationId: randomUUID(),
            groupId: randomUUID(),
            clientId: randomUUID(),
            commands: [
              {
                type: 'patch_table',
                id: 't',
                patch: { physical: { comment: 'MCP native table edit' } },
              },
            ],
          };
          const result = await client.callTool({
            name: 'apply_native_project_changes',
            arguments: command,
          });
          expect(result.isError, JSON.stringify(result)).not.toBe(true);
          expect(result.structuredContent).toMatchObject({
            protocolVersion: 2,
            status: 'accepted',
            sequence: 2,
          });
          expect(result.structuredContent).not.toHaveProperty('document');
          const withDocument = await client.callTool({
            name: 'apply_native_project_changes',
            arguments: { ...command, includeDocument: true },
          });
          expect(withDocument.isError, JSON.stringify(withDocument)).not.toBe(true);
          expect(withDocument.structuredContent).toHaveProperty('document.schemaVersion', 2);
          expect(withDocument.structuredContent).toHaveProperty(
            'document.tables.0.physical.comment',
            'MCP native table edit',
          );
          expect((await stored(id)).sync_sequence).toBe(2);
          const nextClientId = randomUUID();
          const next = (
            await request(`/projects/${id}/native-sync/baseline`, 'POST', {
              clientId: nextClientId,
            })
          ).data;
          next.clientId = nextClientId;
          const forbidden = structuredClone(next.document);
          forbidden.columns[0].physical.type =
            kind === 'postgresql'
              ? { kind: 'builtin', database: kind, typeId: 'postgresql:text', parameters: {} }
              : kind === 'mysql'
                ? { kind: 'builtin', database: kind, typeId: 'mysql:int', parameters: {} }
                : { kind: 'builtin', database: kind, typeId: 'sqlite:integer', parameters: {} };
          forbidden.columns[0].physical.defaultValue = { kind: 'none' };
          const invalidInput = makeInput(next, forbidden);
          const rejected = await request(
            `/projects/${id}/native-sync/operations`,
            'POST',
            invalidInput,
          );
          expect(rejected.status).toBe(201);
          expect(rejected.data).toMatchObject({
            status: 'rejected',
            sequence: 3,
            reasonCode: 'database.candidate-invalid',
          });
          expect(
            rejected.data.issues.some(
              (issue: { code: string }) => issue.code === 'type.not-implemented',
            ),
          ).toBe(true);
          expect((await stored(id)).version).toBe(2);
          expect((await stored(id)).document.columns[0].physical.type).toEqual(
            source.columns![0]!.physical.type,
          );
          expect(
            (await request(`/projects/${id}/native-sync/operations`, 'POST', invalidInput)).data,
          ).toEqual(rejected.data);
          expect(
            (await request(`/projects/${id}/native-sync/operations`, 'POST', input)).data,
          ).toEqual(accepted.data);
          const beforeDeletion = (await request(`/projects/${id}/document-state`)).data;
          const deletion = await client.callTool({
            name: 'apply_native_project_changes',
            arguments: {
              ...command,
              operationId: randomUUID(),
              expectedVersion: beforeDeletion.project.version,
              expectedSequence: beforeDeletion.sequence,
              commands: [{ type: 'delete_objects', targets: [{ collection: 'columns', id: 'c' }] }],
            },
          });
          expect(deletion.isError, JSON.stringify(deletion)).not.toBe(true);
          expect(deletion.structuredContent).toMatchObject({ status: 'accepted', sequence: 4 });
          expect((await stored(id)).document.columns).toEqual([]);
          expect(
            (await pool.query('SELECT object_id FROM sync_tombstones WHERE project_id=$1', [id]))
              .rows,
          ).toEqual([{ object_id: 'c' }]);
          const afterDeletionClient = randomUUID();
          const afterDeletion = (
            await request(`/projects/${id}/native-sync/baseline`, 'POST', {
              clientId: afterDeletionClient,
            })
          ).data;
          afterDeletion.clientId = afterDeletionClient;
          const resurrected = structuredClone(afterDeletion.document);
          resurrected.columns.push(source.columns![0]!);
          const retired = await request(
            `/projects/${id}/native-sync/operations`,
            'POST',
            makeInput(afterDeletion, resurrected),
          );
          expect(retired.data).toMatchObject({
            status: 'rejected',
            reasonCode: 'sync.identity-retired',
            sequence: 5,
          });
          expect((await stored(id)).document.columns).toEqual([]);
          await pool.query(
            'UPDATE projects SET database_revision=database_revision+1 WHERE id=$1',
            [id],
          );
          expect(
            (await client.callTool({ name: 'apply_native_project_changes', arguments: command }))
              .structuredContent,
          ).toEqual(result.structuredContent);
          expect((await stored(id)).sync_sequence).toBe(5);
          expect((await request(`/projects/${id}/native-sync/events?since=0`)).data).toMatchObject({
            resetRequired: true,
            events: [],
            document: { schemaVersion: 2 },
          });
        } finally {
          await client.close();
        }
      },
    );
    it('publishes the native ACK over authenticated WS after the database commit', async () => {
      const id = await createProject();
      const source = migrateDesignDocumentV1(
        legacyDocument(),
        defaultDatabaseContext('postgresql'),
      ).document;
      await pool.query('UPDATE projects SET document=$2::jsonb WHERE id=$1', [
        id,
        JSON.stringify(source),
      ]);
      const url = new URL('/api/sync', base.replace('http:', 'ws:'));
      url.searchParams.set('token', token);
      const socket = new WebSocket(url);
      const receive = (type: string) =>
        new Promise<Record<string, any>>((resolve, reject) => {
          const timer = setTimeout(() => {
            socket.off('message', listener);
            reject(new Error('Native WS message timeout'));
          }, 5000);
          const listener = (raw: unknown) => {
            const message = JSON.parse(String(raw));
            if (message.type !== type) return;
            clearTimeout(timer);
            socket.off('message', listener);
            resolve(message);
          };
          socket.on('message', listener);
        });
      try {
        await new Promise<void>((resolve, reject) => {
          socket.once('open', resolve);
          socket.once('error', () => reject(new Error('Native WS connection failed')));
        });
        const subscribed = receive('subscribed');
        socket.send(JSON.stringify({ type: 'subscribe', projectId: id }));
        expect(await subscribed).toMatchObject({ projectId: id, sequence: 0 });
        const clientId = randomUUID();
        const initial = (
          await request(`/projects/${id}/native-sync/baseline`, 'POST', { clientId })
        ).data;
        const candidate = structuredClone(initial.document);
        candidate.columns[0].physical.comment = 'WS committed native edit';
        const pending = receive('operation');
        const accepted = await request(`/projects/${id}/native-sync/operations`, 'POST', {
          protocolVersion: 2,
          database: initial.database,
          databaseRevision: initial.databaseRevision,
          operationId: randomUUID(),
          groupId: randomUUID(),
          clientId,
          baselineId: initial.baselineId,
          baseSequence: initial.sequence,
          baselineIssuedAt: initial.baselineIssuedAt,
          kind: 'online',
          dependencyPaths: [],
          baselineDocument: initial.document,
          document: candidate,
          changes: deriveOperationChanges(initial.document, candidate),
        });
        const message = await pending;
        expect(message.event).toMatchObject({
          ...accepted.data,
          changes: [{ path: '/columns/c/physical/comment' }],
        });
        expect((await stored(id)).document.columns[0].physical.comment).toBe(
          'WS committed native edit',
        );
        expect((await stored(id)).sync_sequence).toBe(message.event.sequence);
      } finally {
        socket.terminate();
      }
    });
    it('serializes concurrent native replay, guards raw claims/read sets and rejects foreign baselines', async () => {
      const id = await createProject();
      const source = migrateDesignDocumentV1(
        legacyDocument(),
        defaultDatabaseContext('postgresql'),
      ).document;
      await pool.query('UPDATE projects SET document=$2::jsonb WHERE id=$1', [
        id,
        JSON.stringify(source),
      ]);
      const clientId = randomUUID();
      const initial = (await request(`/projects/${id}/native-sync/baseline`, 'POST', { clientId }))
        .data;
      const candidate = structuredClone(initial.document);
      candidate.columns[0].physical.comment = 'Concurrent accepted write';
      const input = {
        protocolVersion: 2,
        database: initial.database,
        databaseRevision: initial.databaseRevision,
        operationId: randomUUID(),
        groupId: randomUUID(),
        clientId,
        baselineId: initial.baselineId,
        baseSequence: initial.sequence,
        baselineIssuedAt: initial.baselineIssuedAt,
        kind: 'online',
        dependencyPaths: [],
        baselineDocument: initial.document,
        document: candidate,
        changes: deriveOperationChanges(initial.document, candidate),
      };
      const [first, second] = await Promise.all([
        request(`/projects/${id}/native-sync/operations`, 'POST', input),
        request(`/projects/${id}/native-sync/operations`, 'POST', input),
      ]);
      expect(first.data).toMatchObject({ status: 'accepted', sequence: 1 });
      expect(second.data).toEqual(first.data);
      expect(
        (await pool.query('SELECT COUNT(*) FROM sync_operations WHERE project_id=$1', [id])).rows[0]
          .count,
      ).toBe('1');
      expect(
        (
          await request(`/projects/${id}/native-sync/operations`, 'POST', {
            ...input,
            operationId: randomUUID(),
            changes: [{ ...input.changes[0], after: 'Forged claim' }],
          })
        ).status,
      ).toBe(400);
      const trimmed = structuredClone(input);
      trimmed.operationId = randomUUID();
      trimmed.baselineDocument.columns[0].id = ' c ';
      expect(
        (await request(`/projects/${id}/native-sync/operations`, 'POST', trimmed)).status,
      ).toBe(400);
      expect((await stored(id)).sync_sequence).toBe(1);
      const conflicting = await request(`/projects/${id}/native-sync/operations`, 'POST', {
        ...input,
        operationId: randomUUID(),
        dependencyPaths: ['/columns/c/physical/comment'],
      });
      expect(conflicting.data).toMatchObject({
        status: 'rejected',
        reasonCode: 'sync.field-conflict',
        sequence: 2,
      });
      expect((await stored(id)).version).toBe(1);
      const other = await request(
        '/users',
        'POST',
        { username: `native-actor-${randomUUID().slice(0, 16)}`, pin: '0024' },
        null,
      );
      userIds.push(other.data.id);
      const session = (
        await request('/sessions', 'POST', { userId: other.data.id, pin: '0024' }, null)
      ).data.token;
      const invitation = await request(`/workspaces/${workspaceId}/invitations`, 'POST', {
        username: other.data.username,
        role: 'editor',
      });
      expect(
        (await request(`/workspace-invitations/${invitation.data.id}/accept`, 'POST', {}, session))
          .status,
      ).toBe(201);
      const stolen = await request(
        `/projects/${id}/native-sync/operations`,
        'POST',
        { ...input, operationId: randomUUID() },
        session,
      );
      expect(stolen.data).toMatchObject({
        status: 'rejected',
        reasonCode: 'sync.baseline-invalid',
        sequence: 3,
        actor: { id: other.data.id },
      });
      expect(
        (await request(`/projects/${id}/native-sync/operations`, 'POST', input, session)).status,
      ).toBe(409);
      expect(
        (
          await request(
            `/projects/${id}/native-sync/operations`,
            'POST',
            { ...input, operationId: randomUUID(), actor: { id: actorId } },
            session,
          )
        ).status,
      ).toBe(400);
      const before = await stored(id);
      const all = (await request(`/projects/${id}/native-sync/events?since=0`)).data;
      expect(all.events.map((event: { sequence: number }) => event.sequence)).toEqual([1, 2, 3]);
      expect((await request(`/projects/${id}/native-sync/events?since=999`)).data).toMatchObject({
        resetRequired: true,
        document: { schemaVersion: 2 },
      });
      await pool.query('UPDATE projects SET status=$2 WHERE id=$1', [id, 'archived']);
      expect((await request(`/projects/${id}/native-sync/operations`, 'POST', input)).data).toEqual(
        first.data,
      );
      expect(
        (await request(`/projects/${id}/native-sync/baseline`, 'POST', { clientId: randomUUID() }))
          .status,
      ).toBe(409);
      expect((await stored(id)).document).toEqual(before.document);
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
        const issued = { status: 201, data: { token: ownerMcpToken } };
        const client = new Client({ name: 'native-personal-fixture', version: '1.0.0' });
        const call = (arguments_: Record<string, unknown>) =>
          client.callTool({
            name: 'apply_personal_changes',
            arguments: {
              expectedDatabaseRevision: 0,
              expectedProjectVersion: 7,
              expectedSyncSequence: 11,
              ...arguments_,
            },
          });
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
          await pool.query('UPDATE projects SET status=$2 WHERE id=$1', [id, 'archived']);
          expect((await call(input)).structuredContent).toEqual(saved);
          expect(
            (await call({ ...input, operationId: randomUUID(), expectedVersion: 1 })).isError,
          ).toBe(true);
          await pool.query('UPDATE projects SET status=$2 WHERE id=$1', [id, 'active']);
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
                expectedDatabaseRevision: 0,
                expectedProjectVersion: 7,
                expectedSyncSequence: 11,
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
        for (const context of [
          {},
          { expectedDatabaseRevision: first.data.databaseRevision },
          {
            expectedDatabaseRevision: first.data.databaseRevision + 1,
            expectedProjectVersion: first.data.projectVersion,
            expectedSyncSequence: first.data.syncSequence,
          },
          {
            expectedDatabaseRevision: first.data.databaseRevision,
            expectedProjectVersion: first.data.projectVersion + 1,
            expectedSyncSequence: first.data.syncSequence,
          },
          {
            expectedDatabaseRevision: first.data.databaseRevision,
            expectedProjectVersion: first.data.projectVersion,
            expectedSyncSequence: first.data.syncSequence + 1,
          },
        ]) {
          const rejected = await request(`/projects/${id}/personal-state`, 'PUT', {
            expectedVersion: first.data.version,
            state,
            ...context,
          });
          expect(rejected.status, JSON.stringify(rejected.data)).toBe(409);
          expect((await request(`/projects/${id}/personal-state`)).data).toEqual(first.data);
          expect(await stored(id)).toEqual(before);
        }
        const saveInput = {
          expectedDatabaseRevision: first.data.databaseRevision,
          expectedProjectVersion: first.data.projectVersion,
          expectedSyncSequence: first.data.syncSequence,
          expectedVersion: first.data.version,
          state,
        };
        const raced = await Promise.all([
          request(`/projects/${id}/personal-state`, 'PUT', saveInput),
          request(`/projects/${id}/personal-state`, 'PUT', saveInput),
        ]);
        expect(raced.map((response) => response.status).sort()).toEqual([200, 409]);
        const saved = raced.find((response) => response.status === 200)!;
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
              expectedDatabaseRevision: first.data.databaseRevision,
              expectedProjectVersion: first.data.projectVersion,
              expectedSyncSequence: first.data.syncSequence,
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
                expectedDatabaseRevision: viewer.data.databaseRevision,
                expectedProjectVersion: viewer.data.projectVersion,
                expectedSyncSequence: viewer.data.syncSequence,
              },
              session,
            )
          ).status,
        ).toBe(200);
        expect((await request(`/projects/${id}/personal-state`)).data.state).toEqual(state);
        expect(await stored(id)).toEqual(before);
      },
    );
    it.each(['postgresql', 'mysql', 'sqlite'] as const)(
      'consumes %s native history baseline, undo and fresh-ID restore through MCP',
      async (kind) => {
        const id = await createProject(kind);
        const native = migrateDesignDocumentV1(
          createEmptyDocument(),
          defaultDatabaseContext(kind),
        ).document;
        native.tables = [createNativeTable(native.database, 'logical-table', null, 'logical')];
        await pool.query('UPDATE projects SET document=$2::jsonb WHERE id=$1', [
          id,
          JSON.stringify(native),
        ]);
        const client = new Client({ name: 'native-history', version: '1.0.0' });
        try {
          await client.connect(
            new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
              requestInit: { headers: { Authorization: `Bearer ${ownerMcpToken}` } },
            }),
          );
          const call = async (name: string, input: Record<string, unknown>) => {
            const result = await client.callTool({ name, arguments: input });
            expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
            return result.structuredContent as Record<string, any>;
          };
          const apply = async (commands: unknown[]) => {
            const head = await stored(id);
            return call('apply_native_project_changes', {
              projectId: id,
              operationId: randomUUID(),
              groupId: randomUUID(),
              clientId: randomUUID(),
              expectedVersion: head.version,
              expectedSequence: head.sync_sequence,
              expectedDatabaseRevision: head.database_revision,
              commands,
              includeDocument: true,
            });
          };
          const compensate = async (sourceOperationId: string, command: 'undo' | 'restore') => {
            const head = await stored(id),
              clientId = randomUUID();
            const baseline = await call('get_native_project_baseline', {
              projectId: id,
              clientId,
              expected: {
                version: head.version,
                sequence: head.sync_sequence,
                databaseRevision: head.database_revision,
              },
            });
            const input = {
              projectId: id,
              sourceOperationId,
              request: {
                operationId: randomUUID(),
                groupId: randomUUID(),
                clientId,
                baselineId: baseline.baselineId,
                baselineIssuedAt: baseline.baselineIssuedAt,
                expectedVersion: baseline.projectVersion,
                expectedSequence: baseline.sequence,
                database: baseline.database,
                databaseRevision: baseline.databaseRevision,
              },
            };
            const name =
              command === 'undo'
                ? 'undo_native_project_operation'
                : 'restore_native_project_deletion';
            const output = nativeHistoryCommandResultSchema.parse(await call(name, input));
            expect(await call(name, input)).toEqual(output);
            return output;
          };
          const edited = await apply([
            {
              type: 'patch_table',
              id: 'logical-table',
              patch: { logical: { definition: 'Changed' } },
            },
          ]);
          const page = nativeHistoryPageSchema.parse(
            await call('get_native_project_history', { projectId: id }),
          );
          expect(
            page.history.find((entry) => entry.operationId === edited.operationId)?.format,
          ).toBe('native');
          const undone = await compensate(edited.operationId, 'undo');
          expect(undone.result.status).toBe('accepted');
          expect((await stored(id)).document.tables[0].logical.definition).toBe('');
          const deleted = await apply([
            { type: 'delete_objects', targets: [{ collection: 'tables', id: 'logical-table' }] },
          ]);
          const restored = await compensate(deleted.operationId, 'restore');
          expect(restored.result.status).toBe('accepted');
          expect((await stored(id)).document.tables[0].id).not.toBe('logical-table');
          expect(restored.identityMap).toContainEqual({
            kind: 'entity',
            from: 'logical-table',
            to: (await stored(id)).document.tables[0].id,
          });
        } finally {
          await client.close();
        }
      },
    );
    it.each(['postgresql', 'mysql', 'sqlite'] as const)(
      'persists %s native domain lifecycle without rewriting legacy physical data',
      async (kind) => {
        const id = await createProject(kind),
          native = migrateDesignDocumentV1(legacyDocument(), defaultDatabaseContext(kind)).document;
        await pool.query('UPDATE projects SET document=$2::jsonb WHERE id=$1', [
          id,
          JSON.stringify(native),
        ]);
        const apply = async (commands: unknown[]) => {
          const head = await stored(id);
          return request(`/projects/${id}/native-sync/commands`, 'POST', {
            operationId: randomUUID(),
            groupId: randomUUID(),
            clientId: randomUUID(),
            expectedVersion: head.version,
            expectedSequence: head.sync_sequence,
            expectedDatabaseRevision: head.database_revision,
            includeDocument: true,
            commands,
          });
        };
        const added = await apply(
          ['a', 'b'].map((domainId) => ({
            type: 'add_domain',
            value: { id: domainId, name: domainId, description: '' },
            placement: { x: 10, y: 20 },
          })),
        );
        expect(added.status, JSON.stringify(added.data)).toBe(201);
        expect(added.data.status).toBe('accepted');
        const moved = await apply([
          { type: 'move_table_domain', tableId: 't', targetDomainId: 'a' },
        ]);
        expect(moved.data.status, JSON.stringify(moved.data)).toBe('accepted');
        expect((await stored(id)).document.columns).toEqual(native.columns);
        expect((await stored(id)).document.tables[0].physical).toEqual(native.tables![0]!.physical);
        const before = await stored(id);
        expect(
          (await apply([{ type: 'delete_domain', id: 'a', policy: { kind: 'rejectNonempty' } }]))
            .status,
        ).toBe(400);
        expect(await stored(id)).toEqual(before);
        const deleted = await apply([
          { type: 'delete_domain', id: 'a', policy: { kind: 'moveTables', targetDomainId: 'b' } },
        ]);
        expect(deleted.data.status, JSON.stringify(deleted.data)).toBe('accepted');
        const saved = await stored(id);
        expect(saved.document.domains.map((domain: { id: string }) => domain.id)).toEqual(['b']);
        expect(saved.document.tables[0].domainId).toBe('b');
        expect(saved.document.columns).toEqual(native.columns);
        expect(saved.document.tables[0].physical).toEqual(native.tables![0]!.physical);
      },
    );
    it.each(['postgresql', 'mysql', 'sqlite'] as const)(
      'fences a %s native command through the actual MCP cancellation tool',
      async (kind) => {
        const id = await createProject(kind),
          native = migrateDesignDocumentV1(legacyDocument(), defaultDatabaseContext(kind)).document;
        await pool.query('UPDATE projects SET document=$2::jsonb WHERE id=$1', [
          id,
          JSON.stringify(native),
        ]);
        const before = await stored(id),
          input = {
            operationId: randomUUID(),
            groupId: randomUUID(),
            clientId: randomUUID(),
            expectedVersion: before.version,
            expectedSequence: before.sync_sequence,
            expectedDatabaseRevision: before.database_revision,
            includeDocument: true,
            commands: [{ type: 'patch_table', id: 't', patch: { logical: { name: 'Late' } } }],
          };
        const client = new Client({ name: 'native-cancel', version: '1.0.0' });
        try {
          await client.connect(
            new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
              requestInit: { headers: { Authorization: `Bearer ${ownerMcpToken}` } },
            }),
          );
          const cancelled = await client.callTool({
            name: 'cancel_native_project_request',
            arguments: { projectId: id, kind: 'native-command', request: input },
          });
          expect(cancelled.isError, JSON.stringify(cancelled.content)).not.toBe(true);
          expect(cancelled.structuredContent).toMatchObject({
            outcome: 'cancelled',
            result: { status: 'rejected', reasonCode: 'operation.cancelled' },
          });
          const late = await client.callTool({
            name: 'apply_native_project_changes',
            arguments: { projectId: id, ...input },
          });
          expect(late.isError, JSON.stringify(late.content)).not.toBe(true);
          expect(late.structuredContent).toEqual(cancelled.structuredContent!.result);
          expect(await stored(id)).toEqual(before);
          expect(
            (
              await pool.query(
                'SELECT count(*)::int AS n FROM native_request_cancellations WHERE project_id=$1',
                [id],
              )
            ).rows[0].n,
          ).toBe(1);
        } finally {
          await client.close();
        }
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
