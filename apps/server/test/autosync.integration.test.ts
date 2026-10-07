import { seedLegacyProject } from './legacy-project-fixture.js';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import {
  addDomain,
  addTable,
  deriveOperationChanges,
  removeKey,
  removeTable,
  sharedDocument,
  updateDomain,
} from '@ezerd/model';
import type { DesignDocument } from '@ezerd/model';

describe.runIf(process.env.EZERD_DB_TEST === '1')('autosync persistence', () => {
  let app: NestExpressApplication;
  let pool: pg.Pool;
  let base: string;
  let token = '';
  let projectId = '';
  let userId = '';
  let workspaceId = '';
  const otherUserIds: string[] = [];
  const request = async (
    path: string,
    method = 'GET',
    body?: unknown,
    authentication: boolean | string = true,
  ) => {
    const requestToken =
      typeof authentication === 'string' ? authentication : authentication ? token : '';
    const input =
      path === '/projects' && method === 'POST' && body && typeof body === 'object'
        ? { workspaceId, ...body }
        : body;
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(requestToken ? { authorization: `Bearer ${requestToken}` } : {}),
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    const text = await response.text();
    const result = {
      status: response.status,
      data: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text,
    };
    if (path === '/projects' && method === 'POST' && result.status === 201)
      await seedLegacyProject(pool, result.data.id);
    return result;
  };
  beforeAll(async () => {
    const { AppModule } = await import('../dist/app.module.js');
    const { readConfig } = await import('../dist/config.js');
    const config = readConfig();
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(config.DATABASE_URL).hostname))
      throw new Error('Integration tests require a local database.');
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
      { username: `sync-${randomUUID().slice(0, 24)}`, pin: '0424' },
      false,
    );
    userId = user.data.id;
    expect(user.status).toBe(201);
    const session = await request('/sessions', 'POST', { userId, pin: '0424' }, false);
    token = session.data.token;
    expect(session.status).toBe(201);
    const workspace = await request('/workspaces', 'POST', { name: `sync-${randomUUID()}` });
    expect(workspace.status).toBe(201);
    workspaceId = workspace.data.id;
    const project = await request('/projects', 'POST', { name: `sync-${randomUUID()}` });
    projectId = project.data.id;
    expect(project.status).toBe(201);
  });
  afterAll(async () => {
    if (pool) {
      if (projectId) await pool.query('DELETE FROM projects WHERE id=$1', [projectId]);
      if (workspaceId) {
        await pool.query('DELETE FROM workspace_invitations WHERE workspace_id=$1', [workspaceId]);
        await pool.query('DELETE FROM user_workspaces WHERE workspace_id=$1', [workspaceId]);
        await pool.query('DELETE FROM workspace WHERE workspace_id=$1', [workspaceId]);
        await pool.query('DELETE FROM workspace_audit_events WHERE workspace_id=$1', [workspaceId]);
      }
      if (otherUserIds.length)
        await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [otherUserIds]);
      if (userId) await pool.query('DELETE FROM users WHERE id=$1', [userId]);
      await pool.end();
    }
    if (app) await app.close();
  });

  it('changes an empty physical design atomically and keeps old editing contexts out', async () => {
    const created = await request('/projects', 'POST', {
      name: `database-context-${randomUUID()}`,
    });
    expect(created.status).toBe(201);
    const id = created.data.id;
    const path = `/projects/${id}`;
    try {
      expect(created.data).toMatchObject({
        databaseKind: 'postgresql',
        databaseProfileId: 'postgresql-18-v1',
        databaseRevision: 0,
      });
      const clientId = randomUUID();
      const baseline = (await request(`${path}/sync-baseline`, 'POST', { clientId })).data;
      const document = addDomain(
        baseline.document,
        { id: randomUUID(), name: 'logical-only', description: '' },
        { x: 0, y: 0 },
      );
      const makeOperation = (base: typeof baseline, next: DesignDocument) => ({
        operationId: randomUUID(),
        groupId: randomUUID(),
        clientId,
        baselineId: base.baselineId,
        baseSequence: base.sequence,
        baselineIssuedAt: base.baselineIssuedAt,
        databaseRevision: base.databaseRevision,
        kind: 'online',
        dependencyPaths: [],
        baselineDocument: base.document,
        document: next,
        changes: deriveOperationChanges(base.document, next),
      });
      const firstInput = makeOperation(baseline, document);
      const first = await request(`${path}/operations`, 'POST', firstInput);
      expect(first.data.status).toBe('accepted');
      const oldBaseline = (await request(`${path}/sync-baseline`, 'POST', { clientId })).data;
      const oldPending = makeOperation(
        oldBaseline,
        updateDomain(oldBaseline.document, document.domains[0]!.id, { name: 'offline intent' }),
      );
      const snapshot = (await request(path)).data;
      const input = {
        expectedVersion: snapshot.project.version,
        expectedSequence: first.data.sequence,
        expectedDatabaseRevision: 0,
        targetKind: 'mysql',
        operationId: randomUUID(),
      };
      const preview = await request(`${path}/database/preview`, 'POST', {
        expectedVersion: input.expectedVersion,
        expectedSequence: input.expectedSequence,
        targetKind: 'mysql',
      });
      expect(preview.data).toMatchObject({
        canChange: true,
        current: { revision: 0 },
        target: { kind: 'mysql', profileId: 'mysql-8.4-innodb-v1' },
      });
      expect(
        (
          await request(`${path}/database/change`, 'POST', {
            ...input,
            targetProfileId: 'sqlite-3.45-v1',
          })
        ).status,
      ).toBe(400);
      expect((await request(`${path}/database/change`, 'POST', input, false)).status).toBe(401);
      const simultaneous = await Promise.all([
        request(`${path}/database/change`, 'POST', input),
        request(`${path}/database/change`, 'POST', {
          ...input,
          operationId: randomUUID(),
          targetKind: 'sqlite',
        }),
      ]);
      expect(simultaneous.map((result) => result.status).sort()).toEqual([201, 409]);
      // Either serialized winner is valid; duplicate requests return the original result.
      const winnerIndex = simultaneous.findIndex((result) => result.status === 201);
      const winningInput =
        winnerIndex === 0
          ? input
          : { ...input, operationId: simultaneous[1]!.data.operationId, targetKind: 'sqlite' };
      const changed = simultaneous[winnerIndex]!.data;
      expect(changed).toMatchObject({
        changed: true,
        database: { revision: 1 },
        sequence: first.data.sequence,
      });
      expect((await request(`${path}/database/change`, 'POST', winningInput)).data).toEqual(
        changed,
      );
      expect(
        (
          await request(`${path}/database/change`, 'POST', {
            ...winningInput,
            targetKind: 'postgresql',
          })
        ).status,
      ).toBe(409);
      const unchangedDocument = (await request(path)).data;
      expect(unchangedDocument.document).toEqual(snapshot.document);
      expect(unchangedDocument.project.databaseRevision).toBe(1);
      expect((await request(`${path}/events?since=${changed.sequence}`)).data).toMatchObject({
        databaseRevision: 1,
        events: [],
      });
      expect((await request(`${path}/operations`, 'POST', firstInput)).data).toEqual(first.data);
      const rejected = await request(`${path}/operations`, 'POST', oldPending);
      expect(rejected.data).toMatchObject({
        status: 'rejected',
        reasonCode: 'database.context-changed',
        databaseRevision: 1,
        nextBaseline: { databaseRevision: 0 },
      });
      expect((await request(`${path}/operations`, 'POST', oldPending)).data).toEqual(rejected.data);
      expect(
        (
          await request(`${path}/operations/${firstInput.operationId}/undo`, 'POST', {
            operationId: randomUUID(),
            groupId: randomUUID(),
            clientId,
          })
        ).status,
      ).toBe(409);
      // A forged revision cannot relabel a deleted, old baseline as current.
      expect(
        (
          await request(`${path}/operations`, 'POST', {
            ...oldPending,
            operationId: randomUUID(),
            databaseRevision: 1,
          })
        ).data.status,
      ).toBe('rejected');
      const fresh = (await request(`${path}/sync-baseline`, 'POST', { clientId })).data;
      expect(fresh.databaseRevision).toBe(1);
      const capabilities = await request(`${path}/database/capabilities`);
      expect(capabilities.status).toBe(200);
      expect(capabilities.data).toMatchObject({
        database: changed.database,
        documentSchemaVersion: 1,
        capabilityScope: 'native-v2',
      });
      expect(
        capabilities.data.types.every(
          (type: { id: string; usable: boolean }) =>
            type.id.startsWith(`${changed.database.kind}:`) && !type.usable,
        ),
      ).toBe(true);
      expect((await request(`${path}/database/capabilities`, 'GET', undefined, false)).status).toBe(
        401,
      );
      const resumed = makeOperation(
        fresh,
        updateDomain(fresh.document, document.domains[0]!.id, { name: 'fresh context' }),
      );
      const accepted = await request(`${path}/operations`, 'POST', resumed);
      expect(accepted.data.status, accepted.data.reason).toBe('accepted');
      const current = (await request(path)).data;
      const same = await request(`${path}/database/change`, 'POST', {
        operationId: randomUUID(),
        expectedVersion: current.project.version,
        expectedDatabaseRevision: 1,
        targetKind: changed.database.kind,
      });
      expect(same.data).toMatchObject({ changed: false, database: { revision: 1 } });
      expect(same.data.version).toBe(current.project.version);
      const withPhysical = addTable(
        accepted.data.document,
        {
          id: randomUUID(),
          domainId: null,
          scope: 'physical',
          logical: { name: '', definition: '' },
          physical: { name: 'items', schema: '', comment: '' },
          customProperties: { common: {}, logical: {}, physical: {} },
        },
        { x: 0, y: 0 },
      );
      const tableBaseline = {
        ...accepted.data.nextBaseline,
        sequence: accepted.data.nextBaseline.baseSequence,
        document: sharedDocument(accepted.data.document),
      };
      const tableWrite = await request(
        `${path}/operations`,
        'POST',
        makeOperation(tableBaseline, withPhysical),
      );
      expect(tableWrite.data.status, JSON.stringify(tableWrite.data)).toBe('accepted');
      const full = (await request(path)).data;
      expect(
        (
          await request(`${path}/database/preview`, 'POST', {
            expectedVersion: full.project.version,
            targetKind: 'postgresql',
          })
        ).data,
      ).toMatchObject({ canChange: false, reasonCode: 'database.conversion-required' });
      expect(
        (
          await request(`${path}/database/change`, 'POST', {
            operationId: randomUUID(),
            expectedVersion: full.project.version,
            expectedDatabaseRevision: 1,
            targetKind: 'postgresql',
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await request(path, 'PATCH', {
            expectedVersion: full.project.version,
            databaseKind: 'postgresql',
          })
        ).status,
      ).toBe(409);
      expect((await request(path)).data.document).toEqual(full.document);
      // Replay the migration's backfill against a legacy row; JSON is never converted.
      await pool.query('update projects set database_profile_id=NULL where id=$1', [id]);
      const migration = readFileSync(
        new URL('../drizzle/0014_database_context.sql', import.meta.url),
        'utf8',
      );
      await pool.query(migration.split('--> statement-breakpoint').at(-1)!);
      const backfilled = (await request(path)).data;
      expect(backfilled.document).toEqual(full.document);
      expect(backfilled.project.databaseProfileId).toBe(changed.database.profileId);
      await expect(
        pool.query("update projects set database_profile_id='postgresql-18-v1' where id=$1", [id]),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        pool.query('update projects set database_revision=-1 where id=$1', [id]),
      ).rejects.toMatchObject({ code: '23514' });
      expect(
        (
          await request(path, 'PATCH', {
            expectedVersion: full.project.version,
            status: 'archived',
          })
        ).status,
      ).toBe(200);
      const archived = (await request(path)).data;
      expect(
        (
          await request(`${path}/database/preview`, 'POST', {
            expectedVersion: archived.project.version,
            targetKind: changed.database.kind,
          })
        ).data,
      ).toMatchObject({ canChange: false, reasonCode: 'database.project-archived' });
      expect(
        (
          await request(`${path}/database/change`, 'POST', {
            operationId: randomUUID(),
            expectedVersion: archived.project.version,
            expectedDatabaseRevision: 1,
            targetKind: changed.database.kind,
          })
        ).status,
      ).toBe(409);
    } finally {
      await pool.query('delete from projects where id=$1', [id]);
    }
  });

  it('accepts the canonical shared baseline returned to a browser', async () => {
    const isolated = await request('/projects', 'POST', {
      name: `browser-baseline-${randomUUID()}`,
    });
    expect(isolated.status).toBe(201);
    try {
      const clientId = randomUUID();
      const baseline = (
        await request(`/projects/${isolated.data.id}/sync-baseline`, 'POST', { clientId })
      ).data;
      const browserBaseline = sharedDocument(baseline.document);

      const document = addDomain(
        browserBaseline,
        { id: randomUUID(), name: '브라우저 기준', description: '' },
        { x: 12, y: 34 },
      );
      const operation = {
        operationId: randomUUID(),
        groupId: randomUUID(),
        clientId,
        baselineId: baseline.baselineId,
        baseSequence: baseline.sequence,
        baselineIssuedAt: baseline.baselineIssuedAt,
        kind: 'online',
        dependencyPaths: [],
        changes: deriveOperationChanges(browserBaseline, document),
        baselineDocument: browserBaseline,
        document,
      };
      const response = await request(`/projects/${isolated.data.id}/operations`, 'POST', operation);
      expect(response.status).toBe(201);
      expect(response.data.status, response.data.reason).toBe('accepted');
      expect(baseline.document).toEqual(browserBaseline);

      const alteredBaseline = addDomain(
        browserBaseline,
        { id: randomUUID(), name: '위조 기준', description: '' },
        { x: 1, y: 2 },
      );
      const alteredDocument = addDomain(
        alteredBaseline,
        { id: randomUUID(), name: '위조 기준 작업', description: '' },
        { x: 3, y: 4 },
      );
      const rejected = await request(`/projects/${isolated.data.id}/operations`, 'POST', {
        ...operation,
        operationId: randomUUID(),
        groupId: randomUUID(),
        changes: deriveOperationChanges(alteredBaseline, alteredDocument),
        baselineDocument: alteredBaseline,
        document: alteredDocument,
      });
      expect(rejected.status).toBe(201);
      expect(rejected.data.status).toBe('rejected');
      expect(rejected.data.reason).toContain('동기화 기준');
    } finally {
      await pool.query('delete from projects where id=$1', [isolated.data.id]);
    }
  });

  it('merges disjoint edits, replays duplicates, rejects mismatches and protects reconnect/deletion', async () => {
    expect((await request(`/projects/${projectId}/operations`, 'POST', {})).status).toBe(400);
    const initial = (
      await request(`/projects/${projectId}/sync-baseline`, 'POST', { clientId: randomUUID() })
    ).data;
    const clientId = randomUUID();
    const baseline = (await request(`/projects/${projectId}/sync-baseline`, 'POST', { clientId }))
      .data;
    const make = (document: DesignDocument, operationId = randomUUID()) => ({
      operationId,
      groupId: randomUUID(),
      clientId,
      baselineId: baseline.baselineId,
      baseSequence: baseline.sequence,
      baselineIssuedAt: baseline.baselineIssuedAt,
      kind: 'online',
      dependencyPaths: [],
      changes: deriveOperationChanges(baseline.document, document),
      baselineDocument: baseline.document,
      document,
    });
    const firstDoc = addDomain(
      baseline.document,
      { id: 'first', name: 'First', description: '' },
      { x: 0, y: 0 },
    );
    const firstInput = make(firstDoc);
    const first = await request(`/projects/${projectId}/operations`, 'POST', firstInput);
    expect(first.status).toBe(201);
    expect(first.data.status).toBe('accepted');
    expect((await request(`/projects/${projectId}/operations`, 'POST', firstInput)).data).toEqual(
      first.data,
    );
    expect(
      (
        await request(`/projects/${projectId}/operations`, 'POST', {
          ...firstInput,
          groupId: randomUUID(),
        })
      ).status,
    ).toBe(409);

    const secondDoc = addDomain(
      baseline.document,
      { id: 'second', name: 'Second', description: '' },
      { x: 20, y: 20 },
    );
    const second = await request(`/projects/${projectId}/operations`, 'POST', make(secondDoc));
    expect(second.data.status).toBe('accepted');
    const current = (await request(`/projects/${projectId}`)).data.document as DesignDocument;
    expect(current.domains.map((domain) => domain.id).sort()).toEqual(['first', 'second']);

    const sameBase = (await request(`/projects/${projectId}/sync-baseline`, 'POST', { clientId }))
      .data;
    const sameInput = (name: string) => {
      const document = updateDomain(sameBase.document, 'first', { name });
      return {
        operationId: randomUUID(),
        groupId: randomUUID(),
        clientId,
        baselineId: sameBase.baselineId,
        baseSequence: sameBase.sequence,
        baselineIssuedAt: sameBase.baselineIssuedAt,
        kind: 'online',
        dependencyPaths: [],
        changes: deriveOperationChanges(sameBase.document, document),
        baselineDocument: sameBase.document,
        document,
      };
    };
    const earlier = sameInput('Earlier');
    const later = sameInput('Later');
    expect((await request(`/projects/${projectId}/operations`, 'POST', earlier)).data.status).toBe(
      'accepted',
    );
    expect((await request(`/projects/${projectId}/operations`, 'POST', later)).data.status).toBe(
      'accepted',
    );
    expect(
      ((await request(`/projects/${projectId}`)).data.document as DesignDocument).domains.find(
        (domain) => domain.id === 'first',
      )?.name,
    ).toBe('Later');
    const guardedUndo = await request(
      `/projects/${projectId}/operations/${earlier.operationId}/undo`,
      'POST',
      { operationId: randomUUID(), groupId: randomUUID(), clientId },
    );
    expect(guardedUndo.status, JSON.stringify(guardedUndo.data)).toBe(201);
    expect(guardedUndo.data.status).toBe('rejected');

    const reconnect = {
      ...make(updateDomain(firstDoc, 'first', { name: 'offline' })),
      operationId: randomUUID(),
      groupId: randomUUID(),
      kind: 'reconnect',
    };
    expect(
      (await request(`/projects/${projectId}/operations`, 'POST', reconnect)).data.status,
    ).toBe('rejected');
    const deletionBase = (
      await request(`/projects/${projectId}/sync-baseline`, 'POST', { clientId })
    ).data;
    const deletedDoc = {
      ...deletionBase.document,
      domains: deletionBase.document.domains.filter(
        (domain: { id: string }) => domain.id !== 'first',
      ),
      layout: {
        ...deletionBase.document.layout,
        nodes: deletionBase.document.layout.nodes.filter(
          (node: { objectId: string }) => node.objectId !== 'first',
        ),
      },
    };
    const deletionInput = {
      operationId: randomUUID(),
      groupId: randomUUID(),
      clientId,
      baselineId: deletionBase.baselineId,
      baseSequence: deletionBase.sequence,
      baselineIssuedAt: deletionBase.baselineIssuedAt,
      kind: 'online',
      dependencyPaths: [],
      changes: deriveOperationChanges(deletionBase.document, deletedDoc),
      baselineDocument: deletionBase.document,
      document: deletedDoc,
    };
    expect(
      (await request(`/projects/${projectId}/operations`, 'POST', deletionInput)).data.status,
    ).toBe('accepted');
    const late = {
      ...deletionInput,
      operationId: randomUUID(),
      groupId: randomUUID(),
      document: updateDomain(deletionBase.document, 'first', { name: 'late' }),
      changes: deriveOperationChanges(
        deletionBase.document,
        updateDomain(deletionBase.document, 'first', { name: 'late' }),
      ),
    };
    expect((await request(`/projects/${projectId}/operations`, 'POST', late)).data.status).toBe(
      'rejected',
    );
    const restored = await request(
      `/projects/${projectId}/deletions/${deletionInput.operationId}/restore`,
      'POST',
      { operationId: randomUUID(), groupId: randomUUID(), clientId },
    );
    expect(restored.data.result.status).toBe('accepted');
    expect(
      restored.data.result.document.domains.some(
        (domain: { id: string; name: string }) => domain.id !== 'first' && domain.name === 'Later',
      ),
    ).toBe(true);
    const events = await request(`/projects/${projectId}/events?since=${initial.sequence}`);
    expect(events.data.sequence).toBeGreaterThan(initial.sequence);
    expect(events.data.events.length).toBeGreaterThan(0);
  });

  it('serializes duplicate requests and makes undo and restore retries idempotent', async () => {
    const clientId = randomUUID();
    const baseline = (await request(`/projects/${projectId}/sync-baseline`, 'POST', { clientId }))
      .data;
    const createdDocument = addDomain(
      baseline.document,
      { id: randomUUID(), name: '동시 작업', description: '' },
      { x: 1, y: 2 },
    );
    const operationId = randomUUID();
    const input = {
      operationId,
      groupId: randomUUID(),
      clientId,
      baselineId: baseline.baselineId,
      baseSequence: baseline.sequence,
      baselineIssuedAt: baseline.baselineIssuedAt,
      kind: 'online',
      dependencyPaths: [],
      changes: deriveOperationChanges(baseline.document, createdDocument),
      baselineDocument: baseline.document,
      document: createdDocument,
    };
    const [left, right] = await Promise.all([
      request(`/projects/${projectId}/operations`, 'POST', input),
      request(`/projects/${projectId}/operations`, 'POST', input),
    ]);
    expect(left.status).toBe(201);
    expect(right.status).toBe(201);
    expect(left.data).toEqual(right.data);
    expect(
      (
        await pool.query(
          'select count(*)::int count from sync_operations where project_id=$1 and operation_id=$2',
          [projectId, operationId],
        )
      ).rows[0].count,
    ).toBe(1);

    const deleteBaseline = (
      await request(`/projects/${projectId}/sync-baseline`, 'POST', { clientId })
    ).data;
    const domainId = createdDocument.domains.find(
      (domain: { name: string }) => domain.name === '동시 작업',
    )!.id;
    const deletedDocument = {
      ...deleteBaseline.document,
      domains: deleteBaseline.document.domains.filter(
        (domain: { id: string }) => domain.id !== domainId,
      ),
      layout: {
        ...deleteBaseline.document.layout,
        nodes: deleteBaseline.document.layout.nodes.filter(
          (node: { objectId: string }) => node.objectId !== domainId,
        ),
      },
    };
    const deleteId = randomUUID();
    const deleteInput = {
      operationId: deleteId,
      groupId: randomUUID(),
      clientId,
      baselineId: deleteBaseline.baselineId,
      baseSequence: deleteBaseline.sequence,
      baselineIssuedAt: deleteBaseline.baselineIssuedAt,
      kind: 'online',
      dependencyPaths: [],
      changes: deriveOperationChanges(deleteBaseline.document, deletedDocument),
      baselineDocument: deleteBaseline.document,
      document: deletedDocument,
    };
    expect(
      (await request(`/projects/${projectId}/operations`, 'POST', deleteInput)).data.status,
    ).toBe('accepted');
    const undoRequest = { operationId: randomUUID(), groupId: randomUUID(), clientId };
    const undo1 = await request(
      `/projects/${projectId}/operations/${deleteId}/undo`,
      'POST',
      undoRequest,
    );
    const undo2 = await request(
      `/projects/${projectId}/operations/${deleteId}/undo`,
      'POST',
      undoRequest,
    );
    expect(undo1.status).toBe(201);
    expect(undo2.status).toBe(201);
    expect(undo2.data).toEqual(undo1.data);
    expect(undo1.data.status).toBe('accepted');
    expect(
      (
        await pool.query(
          'select count(*)::int count from sync_operations where project_id=$1 and operation_id=$2',
          [projectId, undoRequest.operationId],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      undo1.data.document.domains.some(
        (domain: { id: string; name: string }) =>
          domain.name === '동시 작업' && domain.id !== domainId,
      ),
    ).toBe(true);

    const other = await request(
      '/users',
      'POST',
      { username: `other-${randomUUID().slice(0, 20)}`, pin: '0424' },
      false,
    );
    const otherSession = await request(
      '/sessions',
      'POST',
      { userId: other.data.id, pin: '0424' },
      false,
    );
    expect(other.status).toBe(201);
    otherUserIds.push(other.data.id);
    expect(otherSession.status).toBe(201);
    const invitation = await request(`/workspaces/${workspaceId}/invitations`, 'POST', {
      username: other.data.username,
      role: 'editor',
    });
    expect(invitation.status).toBe(201);
    expect(
      (
        await request(
          `/workspace-invitations/${invitation.data.id}/accept`,
          'POST',
          {},
          otherSession.data.token,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await request(
          `/projects/${projectId}/operations/${operationId}/undo`,
          'POST',
          { operationId: randomUUID(), groupId: randomUUID(), clientId: randomUUID() },
          otherSession.data.token,
        )
      ).status,
    ).toBe(409);
  });

  it('replays an accepted result before validating an expired server baseline', async () => {
    const clientId = randomUUID();
    const baseline = (await request(`/projects/${projectId}/sync-baseline`, 'POST', { clientId }))
      .data;
    const acceptedId = randomUUID();
    const acceptedDocument = addDomain(
      baseline.document,
      { id: acceptedId, name: '만료 전 승인', description: '' },
      { x: 7, y: 8 },
    );
    const acceptedInput = {
      operationId: randomUUID(),
      groupId: randomUUID(),
      clientId,
      baselineId: baseline.baselineId,
      baseSequence: baseline.sequence,
      baselineIssuedAt: baseline.baselineIssuedAt,
      kind: 'online',
      dependencyPaths: [],
      changes: deriveOperationChanges(baseline.document, acceptedDocument),
      baselineDocument: baseline.document,
      document: acceptedDocument,
    };
    const accepted = await request(`/projects/${projectId}/operations`, 'POST', acceptedInput);
    expect(accepted.status).toBe(201);
    expect(accepted.data.status).toBe('accepted');

    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000 - 60_000);
    await pool.query(
      'update sync_client_baselines set last_successful_sync_at=$1 where project_id=$2 and baseline_id=$3',
      [expiredAt, projectId, baseline.baselineId],
    );
    const replay = await request(`/projects/${projectId}/operations`, 'POST', acceptedInput);
    expect(replay.status).toBe(201);
    expect(replay.data).toEqual(accepted.data);
    expect(
      (await request(`/projects/${projectId}/operations/${acceptedInput.operationId}`)).data,
    ).toEqual(accepted.data);

    const expiredId = randomUUID();
    const expiredDocument = addDomain(
      baseline.document,
      { id: expiredId, name: '만료 뒤 신규 작업', description: '' },
      { x: 9, y: 10 },
    );
    const expiredInput = {
      ...acceptedInput,
      operationId: randomUUID(),
      groupId: randomUUID(),
      baselineIssuedAt: expiredAt.toISOString(),
      changes: deriveOperationChanges(baseline.document, expiredDocument),
      document: expiredDocument,
    };
    const rejected = await request(`/projects/${projectId}/operations`, 'POST', expiredInput);
    expect(rejected.status).toBe(201);
    expect(rejected.data.status).toBe('rejected');
    const current = (await request(`/projects/${projectId}`)).data.document as DesignDocument;
    expect(current.domains.some((domain) => domain.id === acceptedId)).toBe(true);
    expect(current.domains.some((domain) => domain.id === expiredId)).toBe(false);
  });

  it('restores deletion history just inside seven days and rejects it just outside', async () => {
    const clientId = randomUUID();
    const createDeletedDomain = async (name: string) => {
      const baseline = (await request(`/projects/${projectId}/sync-baseline`, 'POST', { clientId }))
        .data;
      const id = randomUUID();
      const document = addDomain(
        baseline.document,
        { id, name, description: '' },
        { x: 11, y: 12 },
      );
      const input = {
        operationId: randomUUID(),
        groupId: randomUUID(),
        clientId,
        baselineId: baseline.baselineId,
        baseSequence: baseline.sequence,
        baselineIssuedAt: baseline.baselineIssuedAt,
        kind: 'online',
        dependencyPaths: [],
        changes: deriveOperationChanges(baseline.document, document),
        baselineDocument: baseline.document,
        document,
      };
      expect((await request(`/projects/${projectId}/operations`, 'POST', input)).data.status).toBe(
        'accepted',
      );
      const deletionBaseline = (
        await request(`/projects/${projectId}/sync-baseline`, 'POST', { clientId })
      ).data;
      const deletedDocument = {
        ...deletionBaseline.document,
        domains: deletionBaseline.document.domains.filter(
          (domain: { id: string }) => domain.id !== id,
        ),
        layout: {
          ...deletionBaseline.document.layout,
          nodes: deletionBaseline.document.layout.nodes.filter(
            (node: { objectId: string }) => node.objectId !== id,
          ),
        },
      };
      const deletion = {
        operationId: randomUUID(),
        groupId: randomUUID(),
        clientId,
        baselineId: deletionBaseline.baselineId,
        baseSequence: deletionBaseline.sequence,
        baselineIssuedAt: deletionBaseline.baselineIssuedAt,
        kind: 'online',
        dependencyPaths: [],
        changes: deriveOperationChanges(deletionBaseline.document, deletedDocument),
        baselineDocument: deletionBaseline.document,
        document: deletedDocument,
      };
      expect(
        (await request(`/projects/${projectId}/operations`, 'POST', deletion)).data.status,
      ).toBe('accepted');
      return { id, deletionId: deletion.operationId };
    };

    const inside = await createDeletedDomain('7일 안쪽');
    await pool.query(
      'update sync_operations set created_at=$1 where project_id=$2 and operation_id=$3',
      [new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 60_000), projectId, inside.deletionId],
    );
    const insideRestore = await request(
      `/projects/${projectId}/deletions/${inside.deletionId}/restore`,
      'POST',
      { operationId: randomUUID(), groupId: randomUUID(), clientId },
    );
    expect(insideRestore.status).toBe(201);
    expect(insideRestore.data.result.status).toBe('accepted');
    expect(
      insideRestore.data.result.document.domains.some(
        (domain: { id: string; name: string }) =>
          domain.id !== inside.id && domain.name === '7일 안쪽',
      ),
    ).toBe(true);

    const outside = await createDeletedDomain('7일 바깥쪽');
    await pool.query(
      'update sync_operations set created_at=$1 where project_id=$2 and operation_id=$3',
      [new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 - 60_000), projectId, outside.deletionId],
    );
    const outsideRestore = await request(
      `/projects/${projectId}/deletions/${outside.deletionId}/restore`,
      'POST',
      { operationId: randomUUID(), groupId: randomUUID(), clientId },
    );
    expect(outsideRestore.status).toBe(404);
    expect(
      ((await request(`/projects/${projectId}`)).data.document as DesignDocument).domains.some(
        (domain) => domain.id === outside.id,
      ),
    ).toBe(false);
  });

  it('rejects an FK bundle atomically when a concurrent change removed its referenced key', async () => {
    const clientId = randomUUID();
    const baseline = (await request(`/projects/${projectId}/sync-baseline`, 'POST', { clientId }))
      .data;
    const suffix = randomUUID();
    const domainId = `atomic-domain-${suffix}`,
      parentId = `atomic-parent-${suffix}`,
      childId = `atomic-child-${suffix}`;
    const parentColumnId = `atomic-parent-column-${suffix}`,
      childColumnId = `atomic-child-column-${suffix}`,
      keyId = `atomic-key-${suffix}`;
    const metadata = { common: {}, logical: {}, physical: {} };
    const graph: DesignDocument = {
      ...baseline.document,
      domains: [
        ...baseline.document.domains,
        { id: domainId, name: '원자성 기준', description: '' },
      ],
      tables: [
        ...(baseline.document.tables ?? []),
        {
          id: parentId,
          domainId,
          scope: 'both',
          logical: { name: '부모', definition: '' },
          physical: { name: 'atomic_parent', schema: 'public', comment: '' },
          customProperties: metadata,
        },
        {
          id: childId,
          domainId,
          scope: 'both',
          logical: { name: '자식', definition: '' },
          physical: { name: 'atomic_child', schema: 'public', comment: '' },
          customProperties: metadata,
        },
      ],
      columns: [
        ...(baseline.document.columns ?? []),
        {
          id: parentColumnId,
          tableId: parentId,
          scope: 'both',
          logical: { name: 'id', definition: '', semanticType: '', required: true },
          physical: {
            name: 'id',
            type: { name: 'uuid', isArray: false },
            nullable: false,
            defaultExpression: null,
            comment: '',
          },
          customProperties: metadata,
        },
        {
          id: childColumnId,
          tableId: childId,
          scope: 'both',
          logical: { name: '부모', definition: '', semanticType: '', required: true },
          physical: {
            name: 'parent_id',
            type: { name: 'uuid', isArray: false },
            nullable: false,
            defaultExpression: null,
            comment: '',
          },
          customProperties: metadata,
        },
      ],
      keys: [
        ...(baseline.document.keys ?? []),
        {
          id: keyId,
          tableId: parentId,
          scope: 'both',
          kind: 'primary',
          name: 'atomic_parent_pk',
          columnIds: [parentColumnId],
        },
      ],
      tableRelations: [...(baseline.document.tableRelations ?? [])],
      layout: {
        ...baseline.document.layout,
        nodes: [
          ...baseline.document.layout.nodes,
          {
            id: `node-${parentId}`,
            objectId: parentId,
            viewId: domainId,
            x: 0,
            y: 0,
            width: 240,
            height: 200,
          },
          {
            id: `node-${childId}`,
            objectId: childId,
            viewId: domainId,
            x: 300,
            y: 0,
            width: 240,
            height: 200,
          },
          {
            id: `node-${domainId}`,
            objectId: domainId,
            viewId: 'overview',
            x: 0,
            y: 0,
            width: 240,
            height: 140,
          },
        ],
      },
    };
    const create = {
      operationId: randomUUID(),
      groupId: randomUUID(),
      clientId,
      baselineId: baseline.baselineId,
      baseSequence: baseline.sequence,
      baselineIssuedAt: baseline.baselineIssuedAt,
      kind: 'online',
      dependencyPaths: [],
      changes: deriveOperationChanges(baseline.document, graph),
      baselineDocument: baseline.document,
      document: graph,
    };
    expect((await request(`/projects/${projectId}/operations`, 'POST', create)).data.status).toBe(
      'accepted',
    );

    const sharedBaseline = (
      await request(`/projects/${projectId}/sync-baseline`, 'POST', { clientId })
    ).data;
    const withoutKey = removeKey(sharedBaseline.document, keyId);
    const deleteKey = {
      operationId: randomUUID(),
      groupId: randomUUID(),
      clientId,
      baselineId: sharedBaseline.baselineId,
      baseSequence: sharedBaseline.sequence,
      baselineIssuedAt: sharedBaseline.baselineIssuedAt,
      kind: 'online',
      dependencyPaths: [],
      changes: deriveOperationChanges(sharedBaseline.document, withoutKey),
      baselineDocument: sharedBaseline.document,
      document: withoutKey,
    };
    expect(
      (await request(`/projects/${projectId}/operations`, 'POST', deleteKey)).data.status,
    ).toBe('accepted');

    const relationId = `atomic-relation-${suffix}`;
    const bundledDocument: DesignDocument = {
      ...sharedBaseline.document,
      domains: sharedBaseline.document.domains.map((domain: { id: string }) =>
        domain.id === domainId ? { ...domain, name: '반영되면 안 됨' } : domain,
      ),
      tableRelations: [
        ...(sharedBaseline.document.tableRelations ?? []),
        {
          id: relationId,
          sourceTableId: childId,
          targetTableId: parentId,
          scope: 'both',
          logical: { name: '부모', cardinality: 'one-to-many', required: true },
          physical: {
            name: 'atomic_parent_fk',
            sourceColumnIds: [childColumnId],
            targetColumnIds: [parentColumnId],
            onDelete: 'NO ACTION',
            onUpdate: 'NO ACTION',
          },
        },
      ],
    };
    const bundle = {
      operationId: randomUUID(),
      groupId: randomUUID(),
      clientId,
      baselineId: sharedBaseline.baselineId,
      baseSequence: sharedBaseline.sequence,
      baselineIssuedAt: sharedBaseline.baselineIssuedAt,
      kind: 'online',
      dependencyPaths: [],
      changes: deriveOperationChanges(sharedBaseline.document, bundledDocument),
      baselineDocument: sharedBaseline.document,
      document: bundledDocument,
    };
    const rejected = await request(`/projects/${projectId}/operations`, 'POST', bundle);
    expect(rejected.status).toBe(201);
    expect(rejected.data.status).toBe('rejected');
    expect(rejected.data.reason).toContain('변경 대상이 삭제되었거나 현재 문서에 없습니다.');
    const current = (await request(`/projects/${projectId}`)).data.document as DesignDocument;
    expect(current.domains.find((domain) => domain.id === domainId)?.name).toBe('원자성 기준');
    expect(current.tableRelations?.some((relation) => relation.id === relationId) ?? false).toBe(
      false,
    );
  });

  it('restores deleted table structure with new ids while omitting an invalid external FK and its route', async () => {
    const clientId = randomUUID();
    const baseline = (await request(`/projects/${projectId}/sync-baseline`, 'POST', { clientId }))
      .data;
    const suffix = randomUUID();
    const domainId = `domain-${suffix}`,
      parentId = `parent-${suffix}`,
      childId = `child-${suffix}`,
      parentColumnId = `parent-column-${suffix}`,
      childColumnId = `child-column-${suffix}`,
      keyId = `key-${suffix}`,
      relationId = `relation-${suffix}`;
    const metadata = { common: {}, logical: {}, physical: {} };
    const graph: DesignDocument = {
      ...baseline.document,
      domains: [...baseline.document.domains, { id: domainId, name: '그래프', description: '' }],
      tables: [
        ...(baseline.document.tables ?? []),
        {
          id: parentId,
          domainId,
          scope: 'both',
          logical: { name: '부모', definition: '' },
          physical: { name: 'parent', schema: 'public', comment: '' },
          customProperties: metadata,
        },
        {
          id: childId,
          domainId,
          scope: 'both',
          logical: { name: '자식', definition: '' },
          physical: { name: 'child', schema: 'public', comment: childId },
          customProperties: metadata,
        },
      ],
      columns: [
        ...(baseline.document.columns ?? []),
        {
          id: parentColumnId,
          tableId: parentId,
          scope: 'both',
          logical: { name: 'id', definition: '', semanticType: '', required: true },
          physical: {
            name: 'id',
            type: { name: 'uuid', isArray: false },
            nullable: false,
            defaultExpression: null,
            comment: '',
          },
          customProperties: metadata,
        },
        {
          id: childColumnId,
          tableId: childId,
          scope: 'both',
          logical: { name: 'parent', definition: '', semanticType: '', required: true },
          physical: {
            name: 'parent_id',
            type: { name: 'uuid', isArray: false },
            nullable: false,
            defaultExpression: null,
            comment: '',
          },
          customProperties: metadata,
        },
      ],
      keys: [
        ...(baseline.document.keys ?? []),
        {
          id: keyId,
          tableId: parentId,
          scope: 'both',
          kind: 'primary',
          name: 'pk_parent',
          columnIds: [parentColumnId],
        },
      ],
      tableRelations: [
        ...(baseline.document.tableRelations ?? []),
        {
          id: relationId,
          sourceTableId: childId,
          targetTableId: parentId,
          scope: 'both',
          logical: { name: '부모', cardinality: 'one-to-many', required: true },
          physical: {
            name: 'fk_parent',
            sourceColumnIds: [childColumnId],
            targetColumnIds: [parentColumnId],
            onDelete: 'NO ACTION',
            onUpdate: 'NO ACTION',
          },
        },
      ],
      layout: {
        ...baseline.document.layout,
        nodes: [
          ...baseline.document.layout.nodes,
          {
            id: `node-${parentId}`,
            objectId: parentId,
            viewId: domainId,
            x: 0,
            y: 0,
            width: 240,
            height: 200,
          },
          {
            id: `node-${childId}`,
            objectId: childId,
            viewId: domainId,
            x: 300,
            y: 0,
            width: 240,
            height: 200,
          },
          {
            id: `node-${domainId}`,
            objectId: domainId,
            viewId: 'overview',
            x: 0,
            y: 0,
            width: 240,
            height: 140,
          },
        ],
        viewports: baseline.document.layout.viewports,
        relations: [
          ...(baseline.document.layout.relations ?? []),
          { relationId, viewId: domainId, offset: 0 },
        ],
      },
    };
    const createInput = {
      operationId: randomUUID(),
      groupId: randomUUID(),
      clientId,
      baselineId: baseline.baselineId,
      baseSequence: baseline.sequence,
      baselineIssuedAt: baseline.baselineIssuedAt,
      kind: 'online',
      dependencyPaths: [],
      changes: deriveOperationChanges(baseline.document, graph),
      baselineDocument: baseline.document,
      document: graph,
    };
    expect(
      (await request(`/projects/${projectId}/operations`, 'POST', createInput)).data.status,
    ).toBe('accepted');
    const deleteBaseline = (
      await request(`/projects/${projectId}/sync-baseline`, 'POST', { clientId })
    ).data;
    const withoutChild = removeTable(deleteBaseline.document, childId);
    const deletionId = randomUUID();
    const deletion = {
      operationId: deletionId,
      groupId: randomUUID(),
      clientId,
      baselineId: deleteBaseline.baselineId,
      baseSequence: deleteBaseline.sequence,
      baselineIssuedAt: deleteBaseline.baselineIssuedAt,
      kind: 'online',
      dependencyPaths: [],
      changes: deriveOperationChanges(deleteBaseline.document, withoutChild),
      baselineDocument: deleteBaseline.document,
      document: withoutChild,
    };
    expect((await request(`/projects/${projectId}/operations`, 'POST', deletion)).data.status).toBe(
      'accepted',
    );
    const keyBaseline = (
      await request(`/projects/${projectId}/sync-baseline`, 'POST', { clientId })
    ).data;
    const withoutKey = removeKey(keyBaseline.document, keyId);
    const keyDelete = {
      operationId: randomUUID(),
      groupId: randomUUID(),
      clientId,
      baselineId: keyBaseline.baselineId,
      baseSequence: keyBaseline.sequence,
      baselineIssuedAt: keyBaseline.baselineIssuedAt,
      kind: 'online',
      dependencyPaths: [],
      changes: deriveOperationChanges(keyBaseline.document, withoutKey),
      baselineDocument: keyBaseline.document,
      document: withoutKey,
    };
    expect(
      (await request(`/projects/${projectId}/operations`, 'POST', keyDelete)).data.status,
    ).toBe('accepted');
    const restoreRequest = { operationId: randomUUID(), groupId: randomUUID(), clientId };
    const restored = await request(
      `/projects/${projectId}/deletions/${deletionId}/restore`,
      'POST',
      restoreRequest,
    );
    expect(restored.status).toBe(201);
    expect(restored.data.result.status).toBe('accepted');
    const restoredChild = restored.data.result.document.tables.find(
      (table: { physical: { name: string } }) => table.physical.name === 'child',
    );
    expect(restoredChild.id).not.toBe(childId);
    expect(restoredChild.physical.comment).toBe(childId);
    expect(
      restored.data.result.document.tableRelations.some(
        (relation: { logical: { name: string } }) => relation.logical.name === '부모',
      ),
    ).toBe(false);
    expect(
      restored.data.result.document.layout.relations?.some(
        (route: { relationId: string }) => route.relationId === relationId,
      ),
    ).toBe(false);
    expect(
      restored.data.omittedRelations.some((path: string) => path.startsWith('/tableRelations/')),
    ).toBe(true);
    expect(
      restored.data.omittedRelations.some((path: string) => path.startsWith('/layout/relations/')),
    ).toBe(true);
    expect(
      (
        await request(
          `/projects/${projectId}/deletions/${deletionId}/restore`,
          'POST',
          restoreRequest,
        )
      ).data,
    ).toEqual(restored.data);
    expect(
      (
        await request(
          `/projects/${projectId}/deletions/${randomUUID()}/restore`,
          'POST',
          restoreRequest,
        )
      ).status,
    ).toBe(409);
  });
});
