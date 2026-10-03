import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createNativeColumn,
  createNativeTable,
  defaultDatabaseContext,
  deriveOperationChanges,
  nativeIntegerConversionRules,
  planNativeDatabaseConversion,
  type NativeDesignDocument,
} from '@ezerd/model';
import {
  nativeSyncEventSchema,
  nativeSyncOperationResultSchema,
  nativeSyncSnapshotSchema,
  projectDatabaseChangeResultSchema,
  projectDatabasePreviewSchema,
  projectDocumentStateSchema,
  type NativeEditorCommand,
  type NativeSyncSnapshot,
  type ProjectDocumentState,
} from '@ezerd/contracts';

type Actor = { id: string; token: string };
type Frame = Record<string, unknown>;
/** Captures bytes received by real ws clients; no gateway/publish stubs or timers are replaced. */
class Peer {
  readonly socket: WebSocket;
  readonly frames: Frame[] = [];
  private listeners = new Set<() => void>();
  private failure: Error | undefined;
  readonly opened: Promise<void>;
  constructor(base: string, actor: Actor) {
    const url = new URL('/api/sync', base.replace('http:', 'ws:'));
    url.searchParams.set('token', actor.token);
    this.socket = new WebSocket(url);
    this.socket.on('message', (raw) => {
      try {
        const value: unknown = JSON.parse(raw.toString());
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw Error('Invalid socket frame');
        this.frames.push(value as Frame);
      } catch {
        this.failure = Error('Invalid QA socket JSON frame');
      }
      for (const listener of this.listeners) listener();
    });
    this.socket.on('error', () => {
      this.failure = Error('QA socket failed');
      for (const listener of this.listeners) listener();
    });
    this.socket.on('close', () => {
      this.failure = Error('QA socket closed');
      for (const listener of this.listeners) listener();
    });
    this.opened = new Promise<void>((done, fail) => {
      const timer = setTimeout(() => {
        this.socket.terminate();
        fail(Error('QA socket authentication timed out'));
      }, 5000);
      this.socket.once('open', () => {
        clearTimeout(timer);
        done();
      });
      this.socket.once('error', () => {
        clearTimeout(timer);
        fail(Error('QA socket authentication failed'));
      });
    });
  }
  mark() {
    return this.frames.length;
  }
  wait(matches: (frame: Frame) => boolean, from: number): Promise<Frame> {
    return new Promise((done, fail) => {
      const timer = setTimeout(() => {
        this.listeners.delete(check);
        fail(Error('Expected real QA socket frame did not arrive'));
      }, 5000);
      const check = () => {
        const frame = this.frames.slice(from).find(matches);
        if (!frame && !this.failure) return;
        clearTimeout(timer);
        this.listeners.delete(check);
        if (frame) done(frame);
        else fail(this.failure);
      };
      this.listeners.add(check);
      check();
    });
  }
  async subscribe(id: string) {
    const from = this.mark();
    this.socket.send(JSON.stringify({ type: 'subscribe', projectId: id }));
    return this.wait((frame) => frame.type === 'subscribed' && frame.projectId === id, from);
  }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((done) => {
      this.socket.once('close', done);
      this.socket.terminate();
    });
  }
}
const cases = [
  { mode: 'empty', sourceKind: 'postgresql', targetKind: 'mysql' },
  { mode: 'empty', sourceKind: 'mysql', targetKind: 'postgresql' },
  { mode: 'signed', sourceKind: 'postgresql', targetKind: 'mysql' },
  { mode: 'signed', sourceKind: 'mysql', targetKind: 'postgresql' },
] as const;

describe.runIf(process.env.EZERD_DB_TEST === '1')(
  'actual two-client native DB conversion WebSocket contexts',
  () => {
    let app: NestExpressApplication,
      pool: pg.Pool,
      base: string,
      workspaceId: string,
      owner: Actor,
      editor: Actor;
    const peers: Peer[] = [],
      users: string[] = [];
    const oldPort = process.env.PORT,
      oldMcpUrl = process.env.MCP_PUBLIC_URL;
    const compiled = createRequire(import.meta.url),
      load = (path: string) => compiled(resolve('apps/server/dist', path));
    async function api(actor: Actor | null, path: string, method = 'GET', body?: unknown) {
      const response = await fetch(base + '/api' + path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(actor ? { authorization: 'Bearer ' + actor.token } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: (await response.json()) as any };
    }
    async function state(actor: Actor, id: string) {
      const result = await api(actor, `/projects/${id}/document-state`);
      expect(result.status).toBe(200);
      return projectDocumentStateSchema.parse(result.data);
    }
    const stored = async (id: string) =>
      (
        await pool.query(
          'SELECT document,version,sync_sequence,database_kind,database_profile_id,database_revision FROM projects WHERE id=$1',
          [id],
        )
      ).rows[0];
    const durable = async (id: string) => ({
      project: await stored(id),
      conversions: (
        await pool.query(
          'SELECT * FROM project_database_operations WHERE project_id=$1 ORDER BY operation_id',
          [id],
        )
      ).rows,
      audit: (
        await pool.query(
          "SELECT * FROM workspace_audit_events WHERE details->>'projectId'=$1 ORDER BY id",
          [id],
        )
      ).rows,
      operations: (
        await pool.query('SELECT * FROM sync_operations WHERE project_id=$1 ORDER BY sequence', [
          id,
        ])
      ).rows,
    });
    const commandInput = (head: ProjectDocumentState, commands: NativeEditorCommand[]) => ({
      operationId: randomUUID(),
      groupId: randomUUID(),
      clientId: randomUUID(),
      expectedVersion: head.project.version,
      expectedSequence: head.sequence,
      expectedDatabaseRevision: head.project.databaseRevision,
      includeDocument: true,
      commands,
    });
    async function baseline(actor: Actor, id: string) {
      const clientId = randomUUID(),
        result = await api(actor, `/projects/${id}/native-sync/baseline`, 'POST', { clientId });
      expect(result.status).toBe(201);
      return { clientId, value: nativeSyncSnapshotSchema.parse(result.data) };
    }
    function operation(value: NativeSyncSnapshot, clientId: string, description: string) {
      const document = structuredClone(value.document);
      document.domains[0]!.description = description;
      return {
        protocolVersion: 2,
        database: value.database,
        databaseRevision: value.databaseRevision,
        operationId: randomUUID(),
        groupId: randomUUID(),
        clientId,
        baselineId: value.baselineId,
        baseSequence: value.sequence,
        baselineIssuedAt: value.baselineIssuedAt,
        kind: 'online',
        dependencyPaths: [],
        baselineDocument: value.document,
        document,
        changes: deriveOperationChanges(value.document, document),
      };
    }
    async function receiveOperations(
      id: string,
      operationId: string,
      cursors: number[],
      pair: Peer[],
    ) {
      return Promise.all(
        pair.map((peer, index) =>
          peer
            .wait(
              (frame) =>
                frame.type === 'operation' &&
                frame.projectId === id &&
                !!frame.event &&
                (frame.event as Record<string, unknown>).operationId === operationId,
              cursors[index]!,
            )
            .then((frame) => nativeSyncEventSchema.parse(frame.event)),
        ),
      );
    }
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        !/^\/ezerd_qa_[a-f0-9]{32}$/.test(url.pathname)
      )
        throw Error('Normal test-isolated UUID database required');
      pool = new pg.Pool({ connectionString: url.toString() });
      app = await NestFactory.create<NestExpressApplication>(load('app.module.js').AppModule, {
        logger: false,
        bodyParser: false,
        abortOnError: false,
      });
      load('application.js').configureApplication(app);
      app.get(load('sync/sync.gateway.js').SyncGateway).attach(app.getHttpServer());
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      process.env.PORT = new URL(base).port;
      process.env.MCP_PUBLIC_URL = base + '/mcp';
      const actor = async (name: string): Promise<Actor> => {
        const created = await api(null, '/users', 'POST', {
          username: 'conversion-ws-' + name + '-' + randomUUID().slice(0, 16),
          pin: '0024',
        });
        expect(created.status).toBe(201);
        users.push(created.data.id);
        const session = await api(null, '/sessions', 'POST', {
          userId: created.data.id,
          pin: '0024',
        });
        expect(session.status).toBe(201);
        return { id: created.data.id, token: session.data.token };
      };
      owner = await actor('owner');
      editor = await actor('editor');
      const workspace = await api(owner, '/workspaces', 'POST', {
        name: 'Two real conversion sockets QA',
      });
      expect(workspace.status).toBe(201);
      workspaceId = workspace.data.id;
      await pool.query(
        "INSERT INTO user_workspaces(workspace_id,user_id,role) VALUES($1,$2,'editor')",
        [workspaceId, editor.id],
      );
    });
    afterAll(async () => {
      await Promise.all(peers.map((peer) => peer.close()));
      await app?.close();
      if (oldPort === undefined) delete process.env.PORT;
      else process.env.PORT = oldPort;
      if (oldMcpUrl === undefined) delete process.env.MCP_PUBLIC_URL;
      else process.env.MCP_PUBLIC_URL = oldMcpUrl;
      if (pool)
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
    it.each(cases)(
      '$mode $sourceKind → $targetKind: receives real context heads, reloads both snapshots, and fences old/new writes and replay',
      async ({ mode, sourceKind, targetKind }) => {
        const created = await api(owner, '/projects', 'POST', {
          workspaceId,
          databaseKind: sourceKind,
          formatVersion: 2,
          name: `WS ${mode} ${sourceKind}`,
        });
        expect(created.status).toBe(201);
        const id: string = created.data.id;
        const initial = await state(owner, id);
        const commands: NativeEditorCommand[] = [
          {
            type: 'add_domain',
            value: {
              id: 'domain',
              name: ' Raw shared domain ',
              description: 'raw UUID INTEGER text',
            },
            nodeId: 'domain-node',
            placement: { x: 10, y: 20 },
          },
        ];
        if (mode === 'signed') {
          const context = defaultDatabaseContext(sourceKind),
            table = createNativeTable(context, 'table', 'domain');
          table.physical.name = 'records';
          table.physical.comment = '原文 preserved';
          table.logical.name = ' Raw logical table ';
          table.customProperties.common = { raw: ' SMALLINT INTEGER BIGINT ' };
          if (sourceKind === 'mysql')
            table.physical.options = { database: 'mysql', engine: 'InnoDB' }; // Registry verified conversion excludes explicit environment overrides.
          commands.push({ type: 'add_table', value: table });
          for (const rule of nativeIntegerConversionRules) {
            const column = createNativeColumn(context, table, 'value-' + rule.bits);
            column.physical.name = 'value_' + rule.bits;
            column.physical.type =
              sourceKind === 'postgresql'
                ? {
                    kind: 'builtin',
                    database: sourceKind,
                    typeId: rule.postgresTypeId as
                      'postgresql:smallint' | 'postgresql:integer' | 'postgresql:bigint',
                    parameters: {},
                  }
                : {
                    kind: 'builtin',
                    database: sourceKind,
                    typeId: rule.mysqlTypeId as 'mysql:smallint' | 'mysql:int' | 'mysql:bigint',
                    parameters: {},
                  };
            commands.push({ type: 'add_column', value: column });
          }
        }
        const prepared = await api(
          owner,
          `/projects/${id}/native-sync/commands`,
          'POST',
          commandInput(initial, commands),
        );
        expect(prepared.status).toBe(201);
        expect(
          nativeSyncOperationResultSchema.parse(prepared.data).status,
          JSON.stringify(prepared.data),
        ).toBe('accepted');
        const before = await state(owner, id),
          source = before.sourceDocument as NativeDesignDocument,
          target = defaultDatabaseContext(targetKind),
          plan = planNativeDatabaseConversion(source, source.database, target);
        expect(plan.canApply, JSON.stringify(plan.issues)).toBe(true);
        const expected = plan.document!;
        const pair = [new Peer(base, owner), new Peer(base, editor)];
        peers.push(...pair);
        try {
          await Promise.all(pair.map((peer) => peer.opened));
          const joins = await Promise.all(pair.map((peer) => peer.subscribe(id)));
          for (const join of joins)
            expect(join).toEqual({
              type: 'subscribed',
              projectId: id,
              sequence: before.sequence,
              databaseRevision: before.project.databaseRevision,
            });
          const oldContexts = await Promise.all([baseline(owner, id), baseline(editor, id)]);
          const input = {
            operationId: randomUUID(),
            expectedVersion: before.project.version,
            expectedSequence: before.sequence,
            expectedDatabaseRevision: before.project.databaseRevision,
            targetKind,
          };
          const preview = await api(owner, `/projects/${id}/database/preview`, 'POST', {
            expectedVersion: input.expectedVersion,
            expectedSequence: input.expectedSequence,
            targetKind,
          });
          expect(preview.status).toBe(201);
          expect(projectDatabasePreviewSchema.parse(preview.data).canChange).toBe(true);
          const cursors = pair.map((peer) => peer.mark());
          const converted = await api(owner, `/projects/${id}/database/change`, 'POST', input);
          expect(converted.status, JSON.stringify(converted.data)).toBe(201);
          const result = projectDatabaseChangeResultSchema.parse(converted.data);
          expect(result).toMatchObject({
            changed: true,
            version: before.project.version + 1,
            sequence: before.sequence + 1,
            database: { ...target, revision: before.project.databaseRevision + 1 },
          });
          const heads = await Promise.all(
            pair.map((peer, index) =>
              peer.wait(
                (frame) =>
                  frame.type === 'head' &&
                  frame.projectId === id &&
                  frame.sequence === result.sequence &&
                  frame.databaseRevision === result.database.revision,
                cursors[index]!,
              ),
            ),
          );
          for (const head of heads)
            expect(head).toEqual({
              type: 'head',
              projectId: id,
              sequence: result.sequence,
              databaseRevision: result.database.revision,
            });
          for (const [index, peer] of pair.entries())
            expect(
              peer.frames.slice(cursors[index]).some((frame) => frame.type === 'operation'),
            ).toBe(false);
          const snapshots = await Promise.all([state(owner, id), state(editor, id)]);
          for (const snapshot of snapshots) {
            expect(snapshot).toMatchObject({
              sequence: result.sequence,
              project: {
                version: result.version,
                databaseKind: targetKind,
                databaseProfileId: target.profileId,
                databaseRevision: result.database.revision,
              },
              sourceDocument: expected,
            });
            expect(snapshot.native.status).toBe('available');
          }
          expect(await stored(id)).toMatchObject({
            document: expected,
            version: result.version,
            sync_sequence: result.sequence,
            database_revision: result.database.revision,
          });
          if (mode === 'signed')
            expect(expected.columns!.map((column) => column.physical.type)).toEqual(
              nativeIntegerConversionRules.map((rule) => ({
                kind: 'builtin',
                database: targetKind,
                typeId: targetKind === 'mysql' ? rule.mysqlTypeId : rule.postgresTypeId,
                parameters: {},
              })),
            );
          expect(
            (
              await pool.query(
                'SELECT COUNT(*) AS count FROM sync_client_baselines WHERE project_id=$1',
                [id],
              )
            ).rows[0].count,
          ).toBe('0');
          for (const actor of [owner, editor]) {
            const polling = await api(
              actor,
              `/projects/${id}/native-sync/events?since=${before.sequence}`,
            );
            expect(polling.status).toBe(200);
            expect(polling.data).toMatchObject({
              resetRequired: true,
              sequence: result.sequence,
              databaseRevision: result.database.revision,
              database: target,
              events: [],
              document: expected,
            });
          }
          const afterConversion = await durable(id);
          expect(afterConversion.conversions).toHaveLength(1);
          const conversionAudits = afterConversion.audit.filter(
            (event) => event.action === 'project.database_changed',
          );
          expect(conversionAudits).toHaveLength(1);
          expect(conversionAudits[0].details).toMatchObject({
            projectId: id,
            operationId: input.operationId,
            from: { ...source.database, revision: before.project.databaseRevision },
            to: result.database,
            sourceDocument: source,
            sourceVersion: before.project.version,
            sourceSequence: before.sequence,
            changedPaths: plan.changedPaths,
            sequence: result.sequence,
          });
          expect((await api(owner, `/projects/${id}/database/change`, 'POST', input)).data).toEqual(
            converted.data,
          );
          expect(await durable(id)).toEqual(afterConversion);
          const stale = await api(
            editor,
            `/projects/${id}/native-sync/commands`,
            'POST',
            commandInput(before, [
              {
                type: 'patch_domain',
                id: 'domain',
                patch: { description: 'stale command must not write' },
              },
            ]),
          );
          expect(stale).toMatchObject({ status: 409, data: { code: 'database.context-changed' } });
          expect(await durable(id)).toEqual(afterConversion);
          const oldOperation = operation(
              oldContexts[0]!.value,
              oldContexts[0]!.clientId,
              'old context must not write',
            ),
            oldCursors = pair.map((peer) => peer.mark());
          const rejected = await api(
            owner,
            `/projects/${id}/native-sync/operations`,
            'POST',
            oldOperation,
          );
          expect(rejected.status).toBe(201);
          const rejectedAck = nativeSyncOperationResultSchema.parse(rejected.data);
          expect(rejectedAck).toMatchObject({
            status: 'rejected',
            reasonCode: 'database.context-changed',
            sequence: result.sequence + 1,
            operationId: oldOperation.operationId,
            database: target,
            databaseRevision: result.database.revision,
          });
          for (const event of await receiveOperations(
            id,
            oldOperation.operationId,
            oldCursors,
            pair,
          ))
            expect(event).toMatchObject({ ...rejectedAck, changes: [] });
          expect((await stored(id)).document).toEqual(expected);
          expect((await stored(id)).version).toBe(result.version);
          const acceptedRequests: {
            actor: Actor;
            input: ReturnType<typeof operation>;
            response: unknown;
          }[] = [];
          for (const actor of [owner, editor]) {
            const fresh = await baseline(actor, id);
            expect(fresh.value).toMatchObject({
              database: target,
              databaseRevision: result.database.revision,
              document: (await stored(id)).document,
              projectVersion: (await stored(id)).version,
              sequence: (await stored(id)).sync_sequence,
            });
            const write = operation(fresh.value, fresh.clientId, 'new context ' + actor.id),
              from = pair.map((peer) => peer.mark()),
              response = await api(actor, `/projects/${id}/native-sync/operations`, 'POST', write);
            expect(response.status).toBe(201);
            const ack = nativeSyncOperationResultSchema.parse(response.data);
            expect(ack).toMatchObject({
              status: 'accepted',
              sequence: fresh.value.sequence + 1,
              database: target,
              databaseRevision: result.database.revision,
              operationId: write.operationId,
            });
            for (const event of await receiveOperations(id, write.operationId, from, pair))
              expect(event).toEqual({ ...ack, changes: write.changes });
            expect(await stored(id)).toMatchObject({
              document: write.document,
              version: fresh.value.projectVersion + 1,
              sync_sequence: ack.sequence,
              database_revision: result.database.revision,
            });
            acceptedRequests.push({ actor, input: write, response: response.data });
          }
          const current = await durable(id),
            replayFrom = pair.map((peer) => peer.mark());
          for (const request of acceptedRequests)
            expect(
              (
                await api(
                  request.actor,
                  `/projects/${id}/native-sync/operations`,
                  'POST',
                  request.input,
                )
              ).data,
            ).toEqual(request.response);
          expect((await api(owner, `/projects/${id}/database/change`, 'POST', input)).data).toEqual(
            converted.data,
          );
          expect(await durable(id)).toEqual(current);
          const barriers = await Promise.all(pair.map((peer) => peer.subscribe(id)));
          for (const barrier of barriers)
            expect(barrier).toMatchObject({
              sequence: current.project.sync_sequence,
              databaseRevision: result.database.revision,
            });
          for (const [index, peer] of pair.entries())
            expect(
              peer.frames.slice(replayFrom[index]).some((frame) => frame.type === 'operation'),
            ).toBe(false);
          const finalSnapshots = await Promise.all([state(owner, id), state(editor, id)]);
          for (const snapshot of finalSnapshots)
            expect(snapshot).toMatchObject({
              sequence: current.project.sync_sequence,
              sourceDocument: current.project.document,
              project: {
                version: current.project.version,
                databaseRevision: result.database.revision,
                databaseKind: targetKind,
              },
            });
        } finally {
          await Promise.all(pair.map((peer) => peer.close()));
        }
      },
      15000,
    );
  },
);
