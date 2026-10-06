import { seedLegacyProject } from './legacy-project-fixture.js';
import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requestFingerprint } from '@ezerd/model';

type Actor = { id: string; token: string };
type Outcome = { status: number; data: any };

describe.runIf(process.env.EZERD_DB_TEST === '1')('actual AppModule native upgrade replay', () => {
  let app: NestExpressApplication, pool: pg.Pool, base: string, workspaceId: string;
  let owner: Actor, editor: Actor, viewer: Actor, outsider: Actor;
  let published: { mock: { calls: unknown[][] }; mockRestore: () => void };
  const userIds: string[] = [];
  const requireCompiled = createRequire(import.meta.url);
  const load = (path: string) => requireCompiled(resolve('apps/server/dist', path));
  const request = async (
    path: string,
    method = 'GET',
    body?: unknown,
    actor: Actor | null = owner,
  ): Promise<Outcome> => {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(actor ? { authorization: `Bearer ${actor.token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  };
  const upgrade = (id: string, input: unknown, actor = owner) =>
    request(`/projects/${id}/document/upgrade`, 'POST', input, actor);
  const project = async () => {
    const created = await request('/projects', 'POST', {
      name: 'Upgrade replay',
      workspaceId,
      databaseKind: 'postgresql',
    });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    await seedLegacyProject(pool, created.data.id);
    return created.data.id as string;
  };
  const inputFor = () => ({
    operationId: randomUUID(),
    clientId: randomUUID(),
    expectedVersion: 0,
    expectedSequence: 0,
    expectedDatabaseRevision: 0,
  });
  const state = async (id: string) => ({
    project: (await pool.query('SELECT * FROM projects WHERE id=$1', [id])).rows[0],
    ledger: (
      await pool.query('SELECT * FROM sync_operations WHERE project_id=$1 ORDER BY sequence', [id])
    ).rows,
    baselines: (
      await pool.query(
        'SELECT * FROM sync_client_baselines WHERE project_id=$1 ORDER BY baseline_id',
        [id],
      )
    ).rows,
    versions: (
      await pool.query('SELECT * FROM sync_field_versions WHERE project_id=$1 ORDER BY path', [id])
    ).rows,
    tombstones: (
      await pool.query('SELECT * FROM sync_tombstones WHERE project_id=$1 ORDER BY object_id', [id])
    ).rows,
    // Observe the real implementation; calls still publish normally after commit.
    databaseContextEvents: published.mock.calls.length,
  });
  const restoreAccess = async () => {
    await pool.query("UPDATE workspace SET status='active' WHERE workspace_id=$1", [workspaceId]);
    await pool.query(
      "INSERT INTO user_workspaces (workspace_id,user_id,role) VALUES ($1,$2,'owner') ON CONFLICT (workspace_id,user_id) DO UPDATE SET role='owner'",
      [workspaceId, owner.id],
    );
  };

  beforeAll(async () => {
    const configured = new URL(process.env.DATABASE_URL!);
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname) ||
      !configured.pathname.startsWith('/ezerd_qa_')
    )
      throw new Error('Use scripts/test-isolated.ts with a disposable local DB');
    pool = new pg.Pool({ connectionString: configured.toString() });
    app = await NestFactory.create<NestExpressApplication>(load('app.module.js').AppModule, {
      logger: false,
      bodyParser: false,
      abortOnError: false,
    });
    load('application.js').configureApplication(app);
    const gateway = app.get(load('sync/sync.gateway.js').SyncGateway);
    gateway.attach(app.getHttpServer());
    published = vi.spyOn(gateway, 'publishDatabaseContext');
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    const actor = async (): Promise<Actor> => {
      const created = await request(
        '/users',
        'POST',
        { username: 'upgrade-' + randomUUID().slice(0, 20), pin: '0024' },
        null,
      );
      expect(created.status).toBe(201);
      userIds.push(created.data.id);
      const session = await request(
        '/sessions',
        'POST',
        { userId: created.data.id, pin: '0024' },
        null,
      );
      expect(session.status).toBe(201);
      return { id: created.data.id, token: session.data.token };
    };
    owner = await actor();
    editor = await actor();
    viewer = await actor();
    outsider = await actor();
    const workspace = await request('/workspaces', 'POST', { name: 'Native upgrade replay QA' });
    expect(workspace.status).toBe(201);
    workspaceId = workspace.data.id;
    await pool.query(
      "INSERT INTO user_workspaces (workspace_id,user_id,role) VALUES ($1,$2,'editor'),($1,$3,'viewer')",
      [workspaceId, editor.id, viewer.id],
    );
  });
  afterAll(async () => {
    if (published) published.mockRestore();
    if (app) await app.close();
    if (!pool) return;
    try {
      await pool.query('DELETE FROM projects WHERE workspace_id=$1', [workspaceId]);
      await pool.query('DELETE FROM workspace_audit_events WHERE workspace_id=$1', [workspaceId]);
      await pool.query('DELETE FROM user_workspaces WHERE workspace_id=$1', [workspaceId]);
      await pool.query('DELETE FROM workspace WHERE workspace_id=$1', [workspaceId]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [userIds]);
    } finally {
      await pool.end();
    }
  });

  it.each(['actor-viewer', 'workspace-archived', 'project-archived', 'both'] as const)(
    'replays only the same actor/request under %s; fresh writes and read loss stay blocked',
    async (restriction) => {
      const id = await project(),
        input = inputFor(),
        accepted = await upgrade(id, input);
      expect(accepted.status, JSON.stringify(accepted.data)).toBe(201);
      expect(accepted.data).toMatchObject({ status: 'accepted', reasonCode: 'document.upgraded' });
      if (restriction === 'actor-viewer' || restriction === 'both')
        await pool.query(
          "UPDATE user_workspaces SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",
          [workspaceId, owner.id],
        );
      if (restriction === 'workspace-archived' || restriction === 'both')
        await pool.query("UPDATE workspace SET status='archived' WHERE workspace_id=$1", [
          workspaceId,
        ]);
      if (restriction === 'project-archived')
        await pool.query("UPDATE projects SET status='archived' WHERE id=$1", [id]);
      try {
        const before = await state(id),
          replay = await upgrade(id, input);
        expect(replay.status).toBe(201);
        expect(replay.data).toEqual(accepted.data);
        const different = await upgrade(id, { ...input, clientId: randomUUID() });
        expect(different.status).toBe(409);
        expect(different.data.code).toBe('sync.replay-mismatch');
        for (const other of [editor, viewer]) {
          const mismatch = await upgrade(id, input, other);
          expect(mismatch.status).toBe(409);
          expect(mismatch.data.code).toBe('sync.replay-mismatch');
        }
        const fresh = await upgrade(id, { ...input, operationId: randomUUID() });
        expect(fresh.status).toBe(restriction === 'project-archived' ? 409 : 403);
        if (restriction === 'project-archived') expect(fresh.data.code).toBe('project.archived');
        expect((await upgrade(id, input, outsider)).status).toBe(403);
        expect(await state(id)).toEqual(before);
        await pool.query('DELETE FROM user_workspaces WHERE workspace_id=$1 AND user_id=$2', [
          workspaceId,
          owner.id,
        ]);
        expect((await upgrade(id, input)).status).toBe(403);
        expect(await state(id)).toEqual(before);
      } finally {
        await restoreAccess();
      }
    },
  );

  it('returns the raw cached actor string and complete ACK without normalization or events', async () => {
    const id = await project(),
      input = inputFor(),
      accepted = await upgrade(id, input);
    expect(accepted.status).toBe(201);
    const rawAck = {
      ...accepted.data,
      actor: { ...accepted.data.actor, username: ' historical actor ' },
    };
    await pool.query(
      'UPDATE sync_operations SET result=$3::jsonb WHERE project_id=$1 AND operation_id=$2',
      [id, input.operationId, JSON.stringify(rawAck)],
    );
    const before = await state(id),
      replay = await upgrade(id, input);
    expect(replay.status).toBe(201);
    expect(replay.data).toEqual(rawAck);
    expect(await state(id)).toEqual(before);
  });

  it('replays a historical request before the latest full input schema; a fresh copy is rejected', async () => {
    const id = await project(),
      input = inputFor(),
      accepted = await upgrade(id, input);
    expect(accepted.status).toBe(201);
    const historical = { operationId: input.operationId, obsoleteUpgradeField: 'old request' };
    const hash = createHash('sha256')
      .update(
        requestFingerprint({
          command: 'upgrade_project_document',
          projectId: id,
          input: historical,
        }),
      )
      .digest('hex');
    // Fixture only models an old server-accepted request; it grants no authority for new writes.
    await pool.query(
      'UPDATE sync_operations SET fingerprint=$3 WHERE project_id=$1 AND operation_id=$2',
      [id, input.operationId, hash],
    );
    const before = await state(id),
      replay = await upgrade(id, historical);
    expect(replay.status).toBe(201);
    expect(replay.data).toEqual(accepted.data);
    const fresh = await upgrade(id, { ...historical, operationId: randomUUID() });
    expect(fresh.status).toBe(400);
    expect(fresh.data.code).toBe('document.upgrade-input-invalid');
    expect(await state(id)).toEqual(before);
  });

  it('replays before current context/head/source and baseline checks', async () => {
    const id = await project(),
      input = inputFor(),
      accepted = await upgrade(id, input);
    expect(accepted.status).toBe(201);
    await pool.query(
      'UPDATE projects SET database_revision=database_revision+1,version=version+1,sync_sequence=sync_sequence+1,document=$2::jsonb WHERE id=$1',
      [
        id,
        JSON.stringify({
          schemaVersion: 1,
          domains: [],
          domainRelations: [],
          notes: [],
          layout: { nodes: [], viewports: [] },
        }),
      ],
    );
    await pool.query('DELETE FROM sync_client_baselines WHERE project_id=$1', [id]);
    const before = await state(id),
      replay = await upgrade(id, input);
    expect(replay.status).toBe(201);
    expect(replay.data).toEqual(accepted.data);
    const fresh = await upgrade(id, { ...input, operationId: randomUUID() });
    expect(fresh.status).toBe(409);
    expect(fresh.data.code).toBe('database.context-changed');
    expect(await state(id)).toEqual(before);
  });

  it('serializes concurrent fresh upgrade requests into one ledger/baseline/event', async () => {
    const id = await project(),
      input = inputFor(),
      before = await state(id);
    const [one, two] = await Promise.all([upgrade(id, input), upgrade(id, input)]);
    expect(one.status, JSON.stringify(one.data)).toBe(201);
    expect(two.status, JSON.stringify(two.data)).toBe(201);
    expect(two.data).toEqual(one.data);
    const after = await state(id);
    expect(after.project.version).toBe(before.project.version + 1);
    expect(after.project.sync_sequence).toBe(before.project.sync_sequence + 1);
    expect(after.project.database_revision).toBe(before.project.database_revision + 1);
    expect(after.ledger.length).toBe(before.ledger.length + 1);
    expect(after.baselines.length).toBe(1);
    expect(after.databaseContextEvents).toBe(before.databaseContextEvents + 1);
    expect(after.ledger[0].deletion_snapshot.sourceDocument).toEqual(before.project.document);
    expect(after.tombstones).toEqual(before.tombstones);
    expect((await upgrade(id, input)).data).toEqual(one.data);
    expect(await state(id)).toEqual(after);
  });

  it('rejects structurally invalid stored ACKs without applying an upgrade', async () => {
    const id = await project(),
      input = inputFor(),
      accepted = await upgrade(id, input);
    expect(accepted.status).toBe(201);
    await pool.query(
      'UPDATE sync_operations SET result=$3::jsonb WHERE project_id=$1 AND operation_id=$2',
      [id, input.operationId, JSON.stringify({ ...accepted.data, actor: null })],
    );
    const before = await state(id),
      replay = await upgrade(id, input);
    expect(replay.status).toBe(409);
    expect(replay.data.code).toBe('sync.protocol-mismatch');
    expect(await state(id)).toEqual(before);
  });
});
