import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
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
          'SELECT document, version, sync_sequence, database_kind, database_profile_id, database_revision FROM projects WHERE id=$1',
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
