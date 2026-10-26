import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addTableReference,
  createEmptyNativeDocument,
  createNativeTable,
  defaultDatabaseContext,
  type NativeDesignDocument,
} from '@ezerd/model';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/application.js';
import { SyncGateway } from '../src/sync/sync.gateway.js';

function fixture(): NativeDesignDocument {
  const database = defaultDatabaseContext('postgresql');
  const source = createNativeTable(database, 'source');
  const target = createNativeTable(database, 'target');
  source.physical.name = 'source_records';
  target.physical.name = 'target_records';
  let document: NativeDesignDocument = {
    ...createEmptyNativeDocument(database),
    tables: [source, target],
    tableRelations: Array.from({ length: 150 }, (_, index) => ({
      id: `relation-${index}`,
      sourceTableId: source.id,
      targetTableId: target.id,
      scope: 'logical' as const,
      logical: {
        name: `Relation ${index}`,
        cardinality: 'one-to-many' as const,
        required: false,
      },
      physical: null,
    })),
  };
  document = addTableReference(document, source.id, '__tables__', { x: 0, y: 0 });
  document = addTableReference(document, target.id, '__tables__', { x: 800, y: 300 });
  return document;
}

const batch = () => ({
  type: 'batch_upsert_relation_layouts',
  viewId: '__tables__',
  routes: Array.from({ length: 150 }, (_, index) => ({
    relationId: `relation-${index}`,
    offset: 0,
    sourceAnchor: { side: 'right', ratio: (index + 1) / 151 },
    targetAnchor: { side: 'left', ratio: (index + 1) / 151 },
    waypoints: [{ x: 500, y: index * 4 }],
  })),
});

describe.runIf(process.env.EZERD_DB_TEST === '1')('native relation layout batch over HTTP', () => {
  let app: NestExpressApplication;
  let pool: pg.Pool;
  let base: string;
  let workspaceId: string;
  let userId: string;
  let token: string;

  async function api(path: string, method = 'GET', body?: unknown, auth = true) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(auth ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: (await response.json()) as any };
  }
  const state = async (projectId: string) =>
    (await api(`/projects/${projectId}/document-state`)).data;
  async function input(projectId: string, commands: unknown[]) {
    const current = await state(projectId);
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

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !/^\/ezerd_qa_[a-f0-9]{32}$/.test(url.pathname)
    )
      throw new Error('A disposable local isolated QA database is required');
    pool = new pg.Pool({ connectionString: url.toString() });
    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: false,
      bodyParser: false,
      abortOnError: false,
    });
    configureApplication(app);
    app.get(SyncGateway).attach(app.getHttpServer());
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    const user = await api(
      '/users',
      'POST',
      { username: `relation-batch-${randomUUID().slice(0, 16)}`, pin: '0024' },
      false,
    );
    expect(user.status).toBe(201);
    userId = user.data.id;
    const session = await api('/sessions', 'POST', { userId, pin: '0024' }, false);
    expect(session.status).toBe(201);
    token = session.data.token;
    const workspace = await api('/workspaces', 'POST', { name: 'Relation batch QA' });
    expect(workspace.status).toBe(201);
    workspaceId = workspace.data.id;
  });

  afterAll(async () => {
    await app?.close();
    if (!pool) return;
    try {
      if (workspaceId) {
        await pool.query('DELETE FROM projects WHERE workspace_id=$1', [workspaceId]);
        await pool.query('DELETE FROM workspace_audit_events WHERE workspace_id=$1', [workspaceId]);
        await pool.query('DELETE FROM user_workspaces WHERE workspace_id=$1', [workspaceId]);
        await pool.query('DELETE FROM workspace WHERE workspace_id=$1', [workspaceId]);
      }
      if (userId) await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    } finally {
      await pool.end();
    }
  });

  it('persists 150 routes once, replays the ACK, rejects invalid batches, and undoes only routes', async () => {
    const created = await api('/projects', 'POST', {
      workspaceId,
      name: 'Relation batch',
      databaseKind: 'postgresql',
      formatVersion: 2,
    });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    const projectId = created.data.id as string;
    const original = fixture();
    original.tables![0]!.customProperties.physical.source = '  preserve metadata  ';
    await pool.query('UPDATE projects SET document=$2::jsonb WHERE id=$1', [
      projectId,
      JSON.stringify(original),
    ]);
    const path = `/projects/${projectId}/native-sync/commands`;
    const request = await input(projectId, [batch()]);
    const accepted = await api(path, 'POST', request);
    expect(accepted.status, JSON.stringify(accepted.data)).toBe(201);
    expect(accepted.data).toMatchObject({ status: 'accepted', operationId: request.operationId });
    expect(accepted.data.changedPaths).toHaveLength(150);
    expect(
      accepted.data.changedPaths.every((path: string) => path.startsWith('/layout/relations/')),
    ).toBe(true);
    const saved = await state(projectId);
    const persisted = (await pool.query('SELECT document FROM projects WHERE id=$1', [projectId]))
      .rows[0].document;
    expect(persisted.tables[0].customProperties).toEqual(original.tables![0]!.customProperties);
    expect(persisted.tables[1]).not.toHaveProperty('customProperties');
    expect(saved.sourceDocument.tables).toEqual(original.tables);
    const storedAck = (
      await pool.query(
        'SELECT result FROM sync_operations WHERE project_id=$1 AND operation_id=$2',
        [projectId, request.operationId],
      )
    ).rows[0].result;
    expect(storedAck.document.tables[1]).not.toHaveProperty('customProperties');
    expect(saved.sourceDocument.layout.relations).toHaveLength(150);
    expect(saved.sourceDocument.tableRelations).toEqual(original.tableRelations);
    expect(saved.sourceDocument.layout.nodes).toEqual(original.layout.nodes);
    const replay = await api(path, 'POST', request);
    expect(replay.status).toBe(201);
    expect(replay.data).toEqual(accepted.data);
    expect(await state(projectId)).toEqual(saved);

    const invalid = await input(projectId, [
      {
        ...batch(),
        routes: [
          ...batch().routes.slice(0, 149),
          { ...batch().routes[149]!, relationId: 'missing' },
        ],
      },
    ]);
    expect((await api(path, 'POST', invalid)).status).toBe(400);
    expect(await state(projectId)).toEqual(saved);
    expect(
      await api(path, 'POST', {
        ...(await input(projectId, [batch()])),
        expectedVersion: saved.project.version + 1,
      }),
    ).toMatchObject({ status: 409 });
    expect(await state(projectId)).toEqual(saved);

    const node = saved.sourceDocument.layout.nodes[0];
    const moved = await api(
      path,
      'POST',
      await input(projectId, [
        { type: 'update_node_layout', nodeId: node.id, patch: { x: node.x + 120 } },
      ]),
    );
    expect(moved.data.status, JSON.stringify(moved.data)).toBe('accepted');
    const undoClientId = randomUUID();
    const baseline = await api(`/projects/${projectId}/native-sync/baseline`, 'POST', {
      clientId: undoClientId,
    });
    expect(baseline.status).toBe(201);
    const undoId = randomUUID();
    const undo = await api(
      `/projects/${projectId}/native-history/${request.operationId}/undo`,
      'POST',
      {
        operationId: undoId,
        groupId: undoId,
        clientId: undoClientId,
        baselineId: baseline.data.baselineId,
        baselineIssuedAt: baseline.data.baselineIssuedAt,
        expectedVersion: baseline.data.projectVersion,
        expectedSequence: baseline.data.sequence,
        database: baseline.data.database,
        databaseRevision: baseline.data.databaseRevision,
      },
    );
    expect(undo.status, JSON.stringify(undo.data)).toBe(201);
    expect(undo.data.result.status).toBe('accepted');
    const restored = await state(projectId);
    expect(restored.sourceDocument.layout.relations).toEqual([]);
    expect(restored.sourceDocument.layout.nodes[0].x).toBe(node.x + 120);
    expect(restored.sourceDocument.tableRelations).toEqual(original.tableRelations);
    expect((await api(path, 'POST', request)).data).toEqual(accepted.data);
    expect(await state(projectId)).toEqual(restored);
  });
});
