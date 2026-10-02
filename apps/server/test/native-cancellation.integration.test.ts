import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, defaultDatabaseContext, deriveOperationChanges } from '@ezerd/model';
import {
  MAX_NATIVE_CANCELLATION_BYTES,
  NATIVE_CANCELLATION_REASON,
  nativeCancellationResultSchema,
  type NativeCancellationInput,
} from '../../../packages/contracts/src/native-cancellation.js';

type Actor = { id: string; token: string };
type Outcome = { status: number; data: any };
type Kind = NativeCancellationInput['kind'];
type Pending = { kind: Kind; request: Record<string, any>; sourceOperationId?: string };
const kinds: Kind[] = [
  'protocol-operation',
  'native-command',
  'native-upgrade',
  'history-undo',
  'history-restore',
];

describe.runIf(process.env.EZERD_DB_TEST === '1')('native durable cancellation REST', () => {
  let app: NestExpressApplication, pool: pg.Pool, base: string, workspaceId: string;
  let owner: Actor, editor: Actor, outsider: Actor;
  let published: { mock: { calls: unknown[][] }; mockRestore: () => void };
  let contexts: { mock: { calls: unknown[][] }; mockRestore: () => void };
  const userIds: string[] = [],
    sockets: WebSocket[] = [];
  const requireCompiled = createRequire(import.meta.url);
  const load = (path: string) =>
    requireCompiled(resolve(process.env.NATIVE_CANCELLATION_TEST_DIR ?? 'apps/server/dist', path));
  const request = async (
    id: string,
    suffix: string,
    method = 'GET',
    body?: unknown,
    actor: Actor | null = owner,
  ): Promise<Outcome> => {
    const response = await fetch(`${base}/api/projects/${id}/${suffix}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(actor ? { authorization: `Bearer ${actor.token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  };
  const cancel = (id: string, input: Pending, actor = owner) =>
    request(id, 'native-sync/cancel', 'POST', input, actor);
  const apply = (id: string, input: Pending, actor = owner) =>
    request(
      id,
      input.kind === 'protocol-operation'
        ? 'native-sync/operations'
        : input.kind === 'native-upgrade'
          ? 'document/upgrade'
          : input.kind === 'native-command'
            ? 'native-sync/commands'
            : `native-history/${input.sourceOperationId}/${input.kind === 'history-undo' ? 'undo' : 'restore'}`,
      'POST',
      input.request,
      actor,
    );
  const ack = (input: Pending, result: any) =>
    input.kind.startsWith('history-') ? result.result : result;
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
    markers: (
      await pool.query(
        'SELECT * FROM native_request_cancellations WHERE project_id=$1 ORDER BY operation_id',
        [id],
      )
    ).rows,
    events: published.mock.calls.length,
    contextEvents: contexts.mock.calls.length,
  });
  const project = async (native = true) => {
    const id = randomUUID(),
      database = defaultDatabaseContext('postgresql');
    await pool.query(
      'INSERT INTO projects (id,workspace_id,name,database_kind,database_profile_id,document) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',
      [
        id,
        workspaceId,
        'Cancellation QA',
        database.kind,
        database.profileId,
        JSON.stringify(createEmptyDocument()),
      ],
    );
    if (native) {
      const upgraded = await request(id, 'document/upgrade', 'POST', {
        operationId: randomUUID(),
        clientId: randomUUID(),
        expectedVersion: 0,
        expectedSequence: 0,
        expectedDatabaseRevision: 0,
      });
      expect(upgraded.status, JSON.stringify(upgraded.data)).toBe(201);
    }
    return id;
  };
  const baseline = async (id: string) => {
    const clientId = randomUUID(),
      issued = await request(id, 'native-sync/baseline', 'POST', { clientId });
    expect(issued.status).toBe(201);
    return { ...issued.data, clientId };
  };
  const operation = async (id: string, mutate?: (document: any) => void): Promise<Pending> => {
    const issued = await baseline(id),
      document = structuredClone(issued.document);
    if (mutate) mutate(document);
    else document.domains.push({ id: randomUUID(), name: 'New domain', description: '' });
    return {
      kind: 'protocol-operation',
      request: {
        protocolVersion: 2,
        operationId: randomUUID(),
        groupId: randomUUID(),
        clientId: issued.clientId,
        baselineId: issued.baselineId,
        baseSequence: issued.sequence,
        baselineIssuedAt: issued.baselineIssuedAt,
        database: issued.database,
        databaseRevision: issued.databaseRevision,
        kind: 'online',
        dependencyPaths: [],
        baselineDocument: issued.document,
        document,
        changes: deriveOperationChanges(issued.document, document),
      },
    };
  };
  const pending = async (id: string, kind: Kind): Promise<Pending> => {
    if (kind === 'protocol-operation') return operation(id);
    if (kind === 'native-upgrade') {
      const row = (await state(id)).project;
      return {
        kind,
        request: {
          operationId: randomUUID(),
          clientId: randomUUID(),
          expectedVersion: row.version,
          expectedSequence: row.sync_sequence,
          expectedDatabaseRevision: row.database_revision,
        },
      };
    }
    if (kind === 'native-command') {
      const row = (await state(id)).project;
      return {
        kind,
        request: {
          operationId: randomUUID(),
          groupId: randomUUID(),
          clientId: randomUUID(),
          expectedVersion: row.version,
          expectedSequence: row.sync_sequence,
          expectedDatabaseRevision: row.database_revision,
          includeDocument: true,
          commands: [
            {
              type: 'upsert_note',
              value: { id: randomUUID(), viewId: 'overview', text: 'Note' },
              placement: { x: 30, y: 40 },
            },
          ],
        },
      };
    }
    const source = await operation(id),
      sourceResult = await apply(id, source);
    expect(sourceResult.data.status, JSON.stringify(sourceResult.data)).toBe('accepted');
    let sourceOperationId = source.request.operationId;
    if (kind === 'history-restore') {
      const deletion = await operation(id, (document) => {
        document.domains = [];
      });
      const deleted = await apply(id, deletion);
      expect(deleted.data.status, JSON.stringify(deleted.data)).toBe('accepted');
      sourceOperationId = deletion.request.operationId;
    }
    const issued = await baseline(id);
    return {
      kind,
      sourceOperationId,
      request: {
        operationId: randomUUID(),
        groupId: randomUUID(),
        clientId: issued.clientId,
        baselineId: issued.baselineId,
        baselineIssuedAt: issued.baselineIssuedAt,
        expectedVersion: issued.projectVersion,
        expectedSequence: issued.sequence,
        database: issued.database,
        databaseRevision: issued.databaseRevision,
      },
    };
  };
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
      throw new Error('Disposable local isolated DB required');
    pool = new pg.Pool({ connectionString: configured.toString() });
    let applicationModule;
    if (process.env.NATIVE_CANCELLATION_TEST_DIR) {
      // Explicit pre-registration QA with real classes, never an AppModule claim.
      const paths = [
        ['db/database.service.js', 'DatabaseService'],
        ['workspace/workspace-access.service.js', 'WorkspaceAccessService'],
        ['identity/session.js', 'SessionService'],
        ['shared/rate-limit.service.js', 'RateLimitService'],
        ['sync/sync.gateway.js', 'SyncGateway'],
        ['network/network-access.js', 'LanAccessService'],
        ['workspace/workspace-events.service.js', 'WorkspaceEventsService'],
        ['sync/native-sync.service.js', 'NativeSyncService'],
        ['sync/sync.service.js', 'SyncService'],
        ['sync/native-history.service.js', 'NativeHistoryService'],
        ['workspace/native-upgrade.service.js', 'NativeUpgradeService'],
        ['mcp/mcp-native-document.service.js', 'McpNativeDocumentService'],
        ['sync/native-cancellation.service.js', 'NativeCancellationService'],
      ];
      const controllers = [
        ['sync/native-sync.controller.js', 'NativeSyncController'],
        ['sync/native-history.controller.js', 'NativeHistoryController'],
        ['workspace/native-upgrade.controller.js', 'NativeUpgradeController'],
        ['sync/native-command.controller.js', 'NativeCommandController'],
        ['sync/native-cancellation.controller.js', 'NativeCancellationController'],
      ];
      class CancellationTestModule {}
      Module({
        providers: paths.map(([path, name]) => load(path!)[name!]),
        controllers: controllers.map(([path, name]) => load(path!)[name!]),
      })(CancellationTestModule);
      applicationModule = CancellationTestModule;
    } else applicationModule = load('app.module.js').AppModule;
    app = await NestFactory.create<NestExpressApplication>(applicationModule, {
      logger: false,
      bodyParser: false,
      abortOnError: false,
    });
    load('application.js').configureApplication(app);
    const gateway = app.get(load('sync/sync.gateway.js').SyncGateway);
    gateway.attach(app.getHttpServer());
    published = vi.spyOn(gateway, 'publish');
    contexts = vi.spyOn(gateway, 'publishDatabaseContext');
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    workspaceId = randomUUID();
    await pool.query('INSERT INTO workspace (workspace_id,workspace_name) VALUES ($1,$2)', [
      workspaceId,
      'Native cancellation QA',
    ]);
    const actor = async (role?: string): Promise<Actor> => {
      const id = randomUUID(),
        token = randomUUID() + randomUUID();
      userIds.push(id);
      await pool.query('INSERT INTO users (id,username,pin_hash) VALUES ($1,$2,$3)', [
        id,
        'cancel-' + id.slice(0, 20),
        createHash('sha256').update('0024').digest('hex'),
      ]);
      await pool.query(
        "INSERT INTO sessions (user_id,token_hash,expires_at) VALUES ($1,$2,NOW()+INTERVAL '1 day')",
        [id, createHash('sha256').update(token).digest('hex')],
      );
      if (role)
        await pool.query(
          'INSERT INTO user_workspaces (workspace_id,user_id,role) VALUES ($1,$2,$3)',
          [workspaceId, id, role],
        );
      return { id, token };
    };
    owner = await actor('owner');
    editor = await actor('editor');
    outsider = await actor();
  });
  afterAll(async () => {
    for (const socket of sockets) socket.terminate();
    if (published) published.mockRestore();
    if (contexts) contexts.mockRestore();
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

  it.each(kinds)(
    '%s cancellation fences late identical apply and changed-body reuse without issuing authority',
    async (kind) => {
      const id = await project(kind !== 'native-upgrade'),
        input = await pending(id, kind),
        before = await state(id),
        cancelled = await cancel(id, input);
      expect(cancelled.status, JSON.stringify(cancelled.data)).toBe(201);
      expect(nativeCancellationResultSchema.safeParse(cancelled.data).success).toBe(true);
      expect(cancelled.data).toMatchObject({
        outcome: 'cancelled',
        result: { status: 'rejected', reasonCode: NATIVE_CANCELLATION_REASON, changedPaths: [] },
      });
      const after = await state(id);
      expect(after.project.document).toEqual(before.project.document);
      expect(after.project.version).toBe(before.project.version);
      expect(after.project.database_revision).toBe(before.project.database_revision);
      expect(after.project).toEqual(before.project);
      expect(after.ledger).toEqual(before.ledger);
      expect(after.baselines).toEqual(before.baselines);
      expect(after.versions).toEqual(before.versions);
      expect(after.tombstones).toEqual(before.tombstones);
      expect(after.events).toBe(before.events);
      expect(after.contextEvents).toBe(before.contextEvents);
      expect(after.markers.length).toBe(before.markers.length + 1);
      const row = after.markers.at(-1)!;
      expect(row.kind).toBe(kind);
      expect(row.metadata).toEqual(
        kind.startsWith('history-')
          ? {
              nativeHistory: {
                command: kind === 'history-undo' ? 'undo' : 'restore',
                sourceOperationId: input.sourceOperationId,
                identityMap: [],
              },
            }
          : {},
      );
      expect(Object.hasOwn(row, 'request')).toBe(false);
      expect(cancelled.data.result.sequence).toBe(before.project.sync_sequence);
      expect(row.group_id).toBe(
        kind === 'native-upgrade' ? input.request.operationId : input.request.groupId,
      );
      expect(
        after.baselines.some(
          (item) => item.baseline_id === cancelled.data.result.nextBaseline.baselineId,
        ),
      ).toBe(false);
      const late = await apply(id, input);
      expect(late.status, JSON.stringify(late.data)).toBe(201);
      expect(ack(input, late.data)).toEqual(cancelled.data.result);
      if (kind.startsWith('history-')) expect(late.data.identityMap).toEqual([]);
      expect((await cancel(id, input, editor)).status).toBe(403);
      expect((await apply(id, input, editor)).status).toBe(kind.startsWith('history-') ? 403 : 409);
      expect((await cancel(id, input)).data).toEqual(cancelled.data);
      expect(
        (await apply(id, { ...input, request: { ...input.request, clientId: randomUUID() } }))
          .status,
      ).toBe(409);
      expect(
        (await cancel(id, { ...input, request: { ...input.request, clientId: randomUUID() } }))
          .status,
      ).toBe(409);
      if (kind.startsWith('history-'))
        expect((await cancel(id, { ...input, sourceOperationId: randomUUID() })).status).toBe(409);
      expect(await state(id)).toEqual(after);
    },
  );

  it.each(kinds)(
    '%s accepted before cancel returns the original raw ACK and changes nothing',
    async (kind) => {
      const id = await project(kind !== 'native-upgrade'),
        input = await pending(id, kind),
        accepted = await apply(id, input),
        result = ack(input, accepted.data);
      expect(accepted.status, JSON.stringify(accepted.data)).toBe(201);
      expect(result.status, JSON.stringify(result)).toBe('accepted');
      const raw = { ...result, actor: { ...result.actor, username: ' historical actor ' } };
      await pool.query(
        'UPDATE sync_operations SET result=$3::jsonb WHERE project_id=$1 AND operation_id=$2',
        [id, input.request.operationId, JSON.stringify(raw)],
      );
      const before = await state(id),
        response = await cancel(id, input);
      expect(response.status).toBe(201);
      expect(response.data).toEqual({ outcome: 'recorded', result: raw });
      expect(await state(id)).toEqual(before);
    },
  );

  it.each(kinds)('%s concurrent cancel/apply has exactly one durable outcome', async (kind) => {
    const id = await project(kind !== 'native-upgrade'),
      input = await pending(id, kind),
      before = await state(id);
    const [cancellation, applied] = await Promise.all([cancel(id, input), apply(id, input)]);
    expect(cancellation.status, JSON.stringify(cancellation.data)).toBe(201);
    expect(applied.status, JSON.stringify(applied.data)).toBe(201);
    const result = ack(input, applied.data),
      accepted = result.status === 'accepted';
    expect(cancellation.data).toEqual({ outcome: accepted ? 'recorded' : 'cancelled', result });
    const after = await state(id);
    expect(after.project.sync_sequence).toBe(before.project.sync_sequence + (accepted ? 1 : 0));
    expect(after.project.version).toBe(before.project.version + (accepted ? 1 : 0));
    expect(after.ledger.length).toBe(before.ledger.length + (accepted ? 1 : 0));
    expect(after.markers.length).toBe(before.markers.length + (accepted ? 0 : 1));
    expect(after.events).toBe(before.events + (accepted && kind !== 'native-upgrade' ? 1 : 0));
    expect(after.contextEvents).toBe(
      before.contextEvents + (accepted && kind === 'native-upgrade' ? 1 : 0),
    );
    expect(after.baselines.length).toBe(
      before.baselines.length + (accepted ? (kind === 'native-command' ? 2 : 1) : 0),
    );
    if (!accepted) {
      expect(after.project.document).toEqual(before.project.document);
      expect(after.versions).toEqual(before.versions);
      expect(after.tombstones).toEqual(before.tombstones);
    }
    expect((await cancel(id, input)).data).toEqual(cancellation.data);
    expect(ack(input, (await apply(id, input)).data)).toEqual(result);
    expect(await state(id)).toEqual(after);
  });

  it.each(
    kinds.flatMap((kind) =>
      ['viewer', 'workspace-archived', 'project-archived', 'both'].map((restriction) => ({
        kind,
        restriction,
      })),
    ),
  )(
    '$kind retained read allows new cancellation and replay under $restriction',
    async ({ kind, restriction }) => {
      const id = await project(kind !== 'native-upgrade'),
        input = await pending(id, kind);
      if (restriction === 'viewer' || restriction === 'both')
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
        const cancelled = await cancel(id, input);
        expect(cancelled.status).toBe(201);
        expect(cancelled.data.outcome).toBe('cancelled');
        const stable = await state(id);
        expect((await cancel(id, input)).data).toEqual(cancelled.data);
        expect(ack(input, (await apply(id, input)).data)).toEqual(cancelled.data.result);
        const reused = await cancel(id, input, editor);
        expect(reused.status).toBe(403);
        expect(reused.data.code).toBe('native.cancellation-actor-mismatch');
        expect((await cancel(id, input, outsider)).status).toBe(403);
        await pool.query('DELETE FROM user_workspaces WHERE workspace_id=$1 AND user_id=$2', [
          workspaceId,
          owner.id,
        ]);
        expect((await cancel(id, input)).status).toBe(403);
        expect(
          (await cancel(id, { ...input, request: { ...input.request, operationId: randomUUID() } }))
            .status,
        ).toBe(403);
        expect(await state(id)).toEqual(stable);
      } finally {
        await restoreAccess();
      }
    },
  );

  it.each(kinds)(
    '%s obsolete full request can be cancelled and late replay bypasses new input validation',
    async (kind) => {
      const id = await project(kind !== 'native-upgrade'),
        input: Pending = {
          kind,
          request: {
            operationId: randomUUID(),
            groupId: randomUUID(),
            clientId: randomUUID(),
            oldRequest: { previous: 'untrusted', document: { legacy: true } },
          },
          ...(kind.startsWith('history-') ? { sourceOperationId: randomUUID() } : {}),
        };
      const cancelled = await cancel(id, input);
      expect(cancelled.status).toBe(201);
      const stable = await state(id),
        late = await apply(id, input);
      expect(late.status, JSON.stringify(late.data)).toBe(201);
      expect(ack(input, late.data)).toEqual(cancelled.data.result);
      expect(
        (await apply(id, { ...input, request: { ...input.request, operationId: randomUUID() } }))
          .status,
      ).toBe(400);
      expect(await state(id)).toEqual(stable);
    },
  );

  it('native command includeDocument is presentation-only and optional matching projectId hashes like MCP', async () => {
    const id = await project(),
      input = await pending(id, 'native-command');
    const cancelled = await cancel(id, {
      ...input,
      request: { ...input.request, projectId: id, includeDocument: false },
    });
    expect(cancelled.status).toBe(201);
    expect((await apply(id, input)).data).toEqual(cancelled.data.result);
    expect((await cancel(id, input)).data).toEqual(cancelled.data);
    const stable = await state(id);
    expect(
      (await cancel(id, { ...input, request: { ...input.request, projectId: randomUUID() } }))
        .status,
    ).toBe(400);
    expect(await state(id)).toEqual(stable);
  });

  it('preserves a recorded protocol v1 raw ACK without a native marker or event', async () => {
    const id = await project(false),
      input: Pending = {
        kind: 'protocol-operation',
        request: {
          operationId: randomUUID(),
          groupId: randomUUID(),
          clientId: randomUUID(),
          old: true,
        },
      };
    const result = {
      operationId: input.request.operationId,
      groupId: input.request.groupId,
      sequence: 0,
      status: 'accepted',
      actor: { id: owner.id, username: ' old actor ', color: '#112233' },
      changedPaths: [],
      createdAt: new Date().toISOString(),
      nextBaseline: {
        baselineId: randomUUID(),
        baseSequence: 0,
        baselineIssuedAt: new Date().toISOString(),
      },
    };
    const { requestFingerprint } = await import('@ezerd/model');
    await pool.query(
      "INSERT INTO sync_operations (project_id,operation_id,group_id,client_id,actor_id,sequence,base_sequence,baseline_id,baseline_issued_at,kind,fingerprint,changes,result) VALUES ($1,$2,$3,$4,$5,0,0,$6,NOW(),'online',$7,'[]'::jsonb,$8::jsonb)",
      [
        id,
        input.request.operationId,
        input.request.groupId,
        input.request.clientId,
        owner.id,
        result.nextBaseline.baselineId,
        createHash('sha256').update(requestFingerprint(input.request)).digest('hex'),
        JSON.stringify(result),
      ],
    );
    const recorded = await state(id),
      replay = await cancel(id, input);
    expect(replay.status).toBe(201);
    expect(replay.data).toEqual({ outcome: 'recorded', result });
    expect(await state(id)).toEqual(recorded);
  });

  it('protects INTMAX, UUID envelope, original byte budget and authentication without partial writes', async () => {
    const id = await project(),
      input = await pending(id, 'native-command');
    await pool.query('UPDATE projects SET sync_sequence=2147483647 WHERE id=$1', [id]);
    const start = await state(id),
      limited = await cancel(id, input);
    expect(limited.status).toBe(201);
    expect(limited.data.result.sequence).toBe(2147483647);
    const before = await state(id);
    expect(before.project).toEqual(start.project);
    expect(before.ledger).toEqual(start.ledger);
    expect(before.events).toBe(start.events);
    expect(
      (await cancel(id, { ...input, request: { ...input.request, operationId: 'invalid' } }))
        .status,
    ).toBe(400);
    expect(
      (
        await cancel(id, {
          ...input,
          request: { ...input.request, bytes: 'x'.repeat(MAX_NATIVE_CANCELLATION_BYTES) },
        })
      ).status,
    ).toBe(400);
    expect((await request(id, 'native-sync/cancel', 'POST', input, null)).status).toBe(401);
    expect(await state(id)).toEqual(before);
  });

  it('rolls back marker insertion without changing project state or events', async () => {
    const id = await project(),
      input = await pending(id, 'native-command'),
      before = await state(id);
    const client = await pool.connect();
    try {
      await client.query(
        `CREATE FUNCTION reject_cancellation_qa() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.project_id = '${id}'::uuid THEN RAISE EXCEPTION 'isolated cancellation insert failure'; END IF; RETURN NEW; END $$`,
      );
      await client.query(
        'CREATE TRIGGER reject_cancellation_qa BEFORE INSERT ON native_request_cancellations FOR EACH ROW EXECUTE FUNCTION reject_cancellation_qa()',
      );
      expect((await cancel(id, input)).status).toBe(500);
      expect(await state(id)).toEqual(before);
    } finally {
      await client.query(
        'DROP TRIGGER IF EXISTS reject_cancellation_qa ON native_request_cancellations',
      );
      await client.query('DROP FUNCTION IF EXISTS reject_cancellation_qa()');
      client.release();
    }
  });

  it('does not turn the cancellation nextBaseline UUID into authority for a new write', async () => {
    const id = await project(),
      input = await operation(id),
      cancelled = await cancel(id, input);
    expect(cancelled.status).toBe(201);
    const before = await state(id);
    const reused = await apply(id, {
      ...input,
      request: {
        ...input.request,
        operationId: randomUUID(),
        baselineId: cancelled.data.result.nextBaseline.baselineId,
        baselineIssuedAt: cancelled.data.result.nextBaseline.baselineIssuedAt,
      },
    });
    expect(reused.status).toBe(201);
    expect(reused.data.status).toBe('rejected');
    const after = await state(id);
    expect(after.project.document).toEqual(before.project.document);
    expect(after.project.version).toBe(before.project.version);
    expect(after.baselines).toEqual(before.baselines);
    expect(after.versions).toEqual(before.versions);
  });

  it('rechecks read after waiting for the project lock so read loss cannot create a cancellation', async () => {
    const id = await project(),
      input = await pending(id, 'native-command'),
      before = await state(id);
    const client = await pool.connect();
    let inFlight: Promise<{ status: number; data: any }> | undefined;
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [id]);
      inFlight = cancel(id, input);
      await vi.waitFor(async () => {
        const waits = await pool.query(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%for update%'",
        );
        expect(waits.rows[0].count).toBeGreaterThan(0);
      });
      await pool.query('DELETE FROM user_workspaces WHERE workspace_id=$1 AND user_id=$2', [
        workspaceId,
        owner.id,
      ]);
      await client.query('COMMIT');
      expect((await inFlight).status).toBe(403);
      expect(await state(id)).toEqual(before);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      if (inFlight) await inFlight;
      await restoreAccess();
    }
  });

  it('keeps cancellation proof past ledger retention and baseline TTL and removes it on project deletion', async () => {
    const id = await project(),
      input = await pending(id, 'native-command'),
      cancelled = await cancel(id, input);
    expect(cancelled.status).toBe(201);
    await pool.query(
      "UPDATE native_request_cancellations SET created_at=NOW()-INTERVAL '14 days' WHERE project_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE sync_operations SET created_at=NOW()-INTERVAL '14 days' WHERE project_id=$1",
      [id],
    );
    await pool.query(
      "UPDATE sync_client_baselines SET last_successful_sync_at=NOW()-INTERVAL '14 days' WHERE project_id=$1",
      [id],
    );
    await app.get<any>(load('sync/sync.service.js').SyncService).cleanupExpired();
    const before = await state(id);
    expect(before.ledger).toEqual([]);
    expect(before.baselines).toEqual([]);
    expect(before.markers).toHaveLength(1);
    expect((await cancel(id, input)).data).toEqual(cancelled.data);
    expect((await apply(id, input)).data).toEqual(cancelled.data.result);
    expect(await state(id)).toEqual(before);
    await pool.query('DELETE FROM projects WHERE id=$1', [id]);
    expect(
      (await pool.query('SELECT * FROM native_request_cancellations WHERE project_id=$1', [id]))
        .rows,
    ).toEqual([]);
  });

  it('keeps the ordinary ledger ahead of a conflicting cancellation marker', async () => {
    const id = await project(),
      input = await operation(id),
      accepted = await apply(id, input);
    expect(accepted.data.status).toBe('accepted');
    const ledger = (await state(id)).ledger.at(-1)!;
    const fakeCancellation = {
      ...accepted.data,
      status: 'rejected',
      reason: NATIVE_CANCELLATION_REASON,
      reasonCode: NATIVE_CANCELLATION_REASON,
      changedPaths: [],
    };
    delete fakeCancellation.document;
    // An inconsistent historical fixture demonstrates ledger priority; clients cannot insert markers.
    await pool.query(
      'INSERT INTO native_request_cancellations (project_id,operation_id,actor_id,fingerprint,kind,client_id,group_id,result) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
      [
        id,
        input.request.operationId,
        owner.id,
        ledger.fingerprint,
        input.kind,
        input.request.clientId,
        input.request.groupId,
        JSON.stringify(fakeCancellation),
      ],
    );
    const before = await state(id);
    expect((await cancel(id, input)).data).toEqual({ outcome: 'recorded', result: accepted.data });
    expect((await apply(id, input)).data).toEqual(accepted.data);
    expect((await request(id, `native-sync/operations/${input.request.operationId}`)).data).toEqual(
      accepted.data,
    );
    expect(await state(id)).toEqual(before);
  });

  it('concurrent identical cancellations insert only one immutable marker', async () => {
    const id = await project(),
      input = await pending(id, 'native-command'),
      before = await state(id);
    const [one, two] = await Promise.all([cancel(id, input), cancel(id, input)]);
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    expect(two.data).toEqual(one.data);
    const after = await state(id);
    expect(after.markers).toHaveLength(1);
    expect({ ...after, markers: [] }).toEqual(before);
  });

  it('rejects global operation ID reuse in a different project without partial state changes', async () => {
    const first = await project(),
      second = await project(),
      input = await pending(first, 'native-command');
    expect((await cancel(first, input)).status).toBe(201);
    const before = await state(second),
      duplicate = await cancel(second, input);
    expect(duplicate.status).toBe(409);
    expect(duplicate.data.code).toBe('sync.replay-mismatch');
    expect(await state(second)).toEqual(before);
  });
  it('preserves raw uppercase UUIDs despite PostgreSQL canonical UUID storage', async () => {
    const id = await project(false),
      input = await pending(id, 'native-upgrade');
    input.request.operationId = input.request.operationId.toUpperCase();
    input.request.clientId = input.request.clientId.toUpperCase();
    const cancelled = await cancel(id, input);
    expect(cancelled.status).toBe(201);
    const before = await state(id);
    expect((await cancel(id, input)).data).toEqual(cancelled.data);
    expect((await apply(id, input)).data).toEqual(cancelled.data.result);
    expect(
      (
        await cancel(id, {
          ...input,
          request: { ...input.request, operationId: input.request.operationId.toLowerCase() },
        })
      ).status,
    ).toBe(409);
    expect(await state(id)).toEqual(before);
  });
  it('hashes an own __proto__ JSON field verbatim and rejects a changed historical body', async () => {
    const id = await project(false),
      original = await pending(id, 'native-upgrade');
    const body = JSON.stringify(original.request).slice(0, -1);
    const input: Pending = {
      ...original,
      request: JSON.parse(body + ',"__proto__":{"audit":" original "}}'),
    };
    const changed: Pending = {
      ...original,
      request: JSON.parse(body + ',"__proto__":{"audit":" changed "}}'),
    };
    const cancelled = await cancel(id, input);
    expect(cancelled.status).toBe(201);
    const before = await state(id);
    expect((await cancel(id, input)).data).toEqual(cancelled.data);
    expect((await apply(id, input)).data).toEqual(cancelled.data.result);
    expect((await cancel(id, changed)).status).toBe(409);
    expect((await apply(id, changed)).status).toBe(409);
    expect(await state(id)).toEqual(before);
  });

  it.each(['protocol-operation', 'native-upgrade', 'history-undo'] as Kind[])(
    '%s preserves raw cancellation actor strings on the late REST replay',
    async (kind) => {
      const id = await project(kind !== 'native-upgrade'),
        input = await pending(id, kind),
        cancelled = await cancel(id, input);
      expect(cancelled.status).toBe(201);
      const raw = {
        ...cancelled.data.result,
        actor: { ...cancelled.data.result.actor, username: ' historical cancelled actor ' },
      };
      await pool.query(
        'UPDATE native_request_cancellations SET result=$2::jsonb WHERE operation_id=$1',
        [input.request.operationId, JSON.stringify(raw)],
      );
      const before = await state(id);
      expect((await cancel(id, input)).data).toEqual({ outcome: 'cancelled', result: raw });
      expect(ack(input, (await apply(id, input)).data)).toEqual(raw);
      expect(
        (await request(id, `native-sync/operations/${input.request.operationId}`)).data,
      ).toEqual(raw);
      const marker = before.markers[0];
      expect(
        await app
          .get<any>(load('sync/native-sync.service.js').NativeSyncService)
          .findReplay(id, input.request.operationId, marker.fingerprint, {
            id: owner.id,
            username: 'Owner',
            color: '#112233',
          }),
      ).toEqual(raw);
      expect(await state(id)).toEqual(before);
    },
  );

  it('exposes the marker via lookup without WS operations or sync stream changes', async () => {
    const id = await project(),
      input = await pending(id, 'native-command');
    const socket = new WebSocket(
      `${base.replace('http://', 'ws://')}/api/sync?token=${owner.token}`,
    );
    sockets.push(socket);
    const messages: any[] = [];
    socket.on('message', (message) => messages.push(JSON.parse(message.toString())));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    socket.send(JSON.stringify({ type: 'subscribe', projectId: id }));
    await vi.waitFor(() =>
      expect(messages.some((message) => message.type === 'subscribed')).toBe(true),
    );
    const before = await state(id),
      cancelled = await cancel(id, input);
    expect(cancelled.status).toBe(201);
    expect((await request(id, `native-sync/operations/${input.request.operationId}`)).data).toEqual(
      cancelled.data.result,
    );
    const polled = await request(id, `native-sync/events?since=${before.project.sync_sequence}`);
    expect(polled.data.events).toEqual([]);
    expect(polled.data.sequence).toBe(before.project.sync_sequence);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      messages.some((message) => message.event?.operationId === input.request.operationId),
    ).toBe(false);
    expect((await state(id)).events).toBe(before.events);
    const stable = await state(id);
    expect((await cancel(id, input)).data).toEqual(cancelled.data);
    expect(await state(id)).toEqual(stable);
    socket.terminate();
  });
});
