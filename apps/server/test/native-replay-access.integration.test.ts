import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deriveOperationChanges, requestFingerprint } from '@ezerd/model';

type Actor = { id: string; token: string; client: Client };
type Route = 'native-rest' | 'command-rest' | 'mcp';
type Outcome = { status: number; data: any };
const routes: Route[] = ['native-rest', 'command-rest', 'mcp'];

describe.runIf(process.env.EZERD_DB_TEST === '1')(
  'actual AppModule native REST/MCP replay access',
  () => {
    let app: NestExpressApplication, pool: pg.Pool, base: string, workspaceId: string;
    let owner: Actor, editor: Actor, viewer: Actor, outsider: Actor;
    const actors: Actor[] = [],
      userIds: string[] = [];
    const previousPort = process.env.PORT,
      previousMcpUrl = process.env.MCP_PUBLIC_URL;
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
    const state = async (id: string) => ({
      project: (await pool.query('SELECT * FROM projects WHERE id=$1', [id])).rows[0],
      ledger: (
        await pool.query('SELECT * FROM sync_operations WHERE project_id=$1 ORDER BY sequence', [
          id,
        ])
      ).rows,
      baselines: (
        await pool.query(
          'SELECT * FROM sync_client_baselines WHERE project_id=$1 ORDER BY baseline_id',
          [id],
        )
      ).rows,
      versions: (
        await pool.query('SELECT * FROM sync_field_versions WHERE project_id=$1 ORDER BY path', [
          id,
        ])
      ).rows,
      tombstones: (
        await pool.query('SELECT * FROM sync_tombstones WHERE project_id=$1 ORDER BY object_id', [
          id,
        ])
      ).rows,
    });
    const latestMcpLog = async (actor: Actor) => {
      const directory = process.env.MCP_LOG_DIR!;
      const files = (await readdir(directory)).filter((name) => name.endsWith('.jsonl')).sort();
      const entries = (
        await Promise.all(files.map((file) => readFile(resolve(directory, file), 'utf8')))
      ).flatMap((text) =>
        text
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      );
      return entries
        .filter(
          (entry) =>
            entry.event === 'tool-finished' &&
            entry.tool === 'apply_native_project_changes' &&
            entry.userId === actor.id,
        )
        .at(-1);
    };
    const call = async (
      route: Route,
      projectId: string,
      input: Record<string, unknown>,
      actor = owner,
    ): Promise<Outcome> => {
      if (route === 'native-rest')
        return request(`/projects/${projectId}/native-sync/operations`, 'POST', input, actor);
      if (route === 'command-rest')
        return request(`/projects/${projectId}/native-sync/commands`, 'POST', input, actor);
      const result = await actor.client.callTool({
        name: 'apply_native_project_changes',
        arguments: { ...input, projectId },
      });
      // MCP transports tool failures as isError. The server audit records the actual HttpException status.
      const entry = await latestMcpLog(actor);
      expect(entry).toBeDefined();
      if (result.isError) {
        expect(entry.errorCode).toMatch(/^HTTP_\d+$/);
        return { status: Number(entry.errorCode.slice(5)), data: result.content };
      }
      expect(entry.status).toBe('success');
      return { status: 201, data: result.structuredContent };
    };
    const project = async () => {
      const created = await request('/projects', 'POST', {
        name: 'Replay access',
        workspaceId,
        databaseKind: 'postgresql',
      });
      expect(created.status, JSON.stringify(created.data)).toBe(201);
      const id = created.data.id as string;
      const upgraded = await request(`/projects/${id}/document/upgrade`, 'POST', {
        operationId: randomUUID(),
        clientId: randomUUID(),
        expectedVersion: 0,
        expectedSequence: 0,
        expectedDatabaseRevision: 0,
      });
      expect(upgraded.status, JSON.stringify(upgraded.data)).toBe(201);
      return id;
    };
    const inputFor = async (route: Route, id: string): Promise<Record<string, any>> => {
      if (route === 'native-rest') {
        const clientId = randomUUID(),
          issued = await request(`/projects/${id}/native-sync/baseline`, 'POST', { clientId });
        expect(issued.status).toBe(201);
        const snapshot = issued.data,
          document = structuredClone(snapshot.document);
        document.domains.push({ id: randomUUID(), name: 'New domain', description: '' });
        return {
          protocolVersion: 2,
          operationId: randomUUID(),
          groupId: randomUUID(),
          clientId,
          baselineId: snapshot.baselineId,
          baseSequence: snapshot.sequence,
          baselineIssuedAt: snapshot.baselineIssuedAt,
          database: snapshot.database,
          databaseRevision: snapshot.databaseRevision,
          kind: 'online',
          dependencyPaths: [],
          baselineDocument: snapshot.document,
          document,
          changes: deriveOperationChanges(snapshot.document, document),
        };
      }
      const saved = (
        await pool.query(
          'SELECT version,sync_sequence,database_revision FROM projects WHERE id=$1',
          [id],
        )
      ).rows[0];
      return {
        operationId: randomUUID(),
        groupId: randomUUID(),
        clientId: randomUUID(),
        expectedVersion: saved.version,
        expectedSequence: saved.sync_sequence,
        expectedDatabaseRevision: saved.database_revision,
        includeDocument: true,
        commands: [
          {
            type: 'upsert_note',
            value: { id: randomUUID(), viewId: 'overview', text: 'Initial note' },
            placement: { x: 40, y: 50 },
          },
        ],
      };
    };
    const removeRead = () =>
      pool.query('DELETE FROM user_workspaces WHERE workspace_id=$1 AND user_id=$2', [
        workspaceId,
        owner.id,
      ]);
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
        !/^\/ezerd_qa_/.test(configured.pathname)
      )
        throw new Error('Use scripts/test-isolated.ts with a disposable local DB');
      pool = new pg.Pool({ connectionString: configured.toString() });
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
      process.env.MCP_PUBLIC_URL = `${base}/mcp`;
      const actor = async (): Promise<Actor> => {
        const created = await request(
          '/users',
          'POST',
          { username: 'replay-' + randomUUID().slice(0, 22), pin: '0024' },
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
        const principal = {
          id: created.data.id,
          token: session.data.token,
          client: new Client({ name: 'native-replay-access', version: '1.0.0' }),
        };
        const issued = await request(
          '/mcp-tokens',
          'POST',
          { name: 'Native replay access QA' },
          principal,
        );
        expect(issued.status).toBe(201);
        await principal.client.connect(
          // SDK 1.30 transport declarations disagree with Transport under exact optional types.
          new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
            requestInit: { headers: { authorization: `Bearer ${issued.data.token}` } },
          }) as never,
        );
        actors.push(principal);
        return principal;
      };
      owner = await actor();
      editor = await actor();
      viewer = await actor();
      outsider = await actor();
      const workspace = await request('/workspaces', 'POST', { name: 'Native replay access QA' });
      expect(workspace.status).toBe(201);
      workspaceId = workspace.data.id;
      await pool.query(
        "INSERT INTO user_workspaces (workspace_id,user_id,role) VALUES ($1,$2,'editor'),($1,$3,'viewer')",
        [workspaceId, editor.id, viewer.id],
      );
    });
    afterAll(async () => {
      for (const actor of actors) await actor.client.close();
      if (app) await app.close();
      if (previousPort === undefined) delete process.env.PORT;
      else process.env.PORT = previousPort;
      if (previousMcpUrl === undefined) delete process.env.MCP_PUBLIC_URL;
      else process.env.MCP_PUBLIC_URL = previousMcpUrl;
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

    it.each(
      routes.flatMap((route) =>
        ['workspace-archived', 'actor-viewer', 'both'].map((restriction) => ({
          route,
          restriction,
        })),
      ),
    )(
      '$route replays own immutable ACK under $restriction while fresh writes and read loss remain forbidden',
      async ({ route, restriction }) => {
        const id = await project(),
          input = await inputFor(route, id),
          accepted = await call(route, id, input);
        expect(accepted.status, JSON.stringify(accepted.data)).toBe(201);
        expect(accepted.data).toMatchObject({ status: 'accepted', actor: { id: owner.id } });
        if (restriction !== 'actor-viewer')
          await pool.query("UPDATE workspace SET status='archived' WHERE workspace_id=$1", [
            workspaceId,
          ]);
        if (restriction !== 'workspace-archived')
          await pool.query(
            "UPDATE user_workspaces SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",
            [workspaceId, owner.id],
          );
        try {
          const before = await state(id);
          const replay = await call(route, id, input);
          expect(replay.status, JSON.stringify(replay.data)).toBe(201);
          expect(replay.data).toEqual(accepted.data);
          expect((await call(route, id, { ...input, groupId: randomUUID() })).status).toBe(409);
          for (const other of [editor, viewer]) {
            const rejected = await call(route, id, input, other);
            expect(rejected.status, JSON.stringify(rejected.data)).toBe(409);
            if (route !== 'mcp') expect(rejected.data.code).toBe('sync.replay-mismatch');
          }
          expect((await call(route, id, { ...input, operationId: randomUUID() })).status).toBe(403);
          expect((await call(route, id, input, outsider)).status).toBe(403);
          expect(await state(id)).toEqual(before);
          await removeRead();
          expect((await call(route, id, input)).status).toBe(403);
          expect(await state(id)).toEqual(before);
        } finally {
          await restoreAccess();
        }
      },
    );

    it.each(routes)(
      '%s returns the original ACK before current format/context/head/baseline validation',
      async (route) => {
        const id = await project(),
          input = await inputFor(route, id),
          accepted = await call(route, id, input);
        expect(accepted.data.status).toBe('accepted');
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
          replay = await call(route, id, input);
        expect(replay.status, JSON.stringify(replay.data)).toBe(201);
        expect(replay.data).toEqual(accepted.data);
        expect(await state(id)).toEqual(before);
      },
    );

    it.each(routes)(
      '%s replays a stored historical request before the complete runtime input schema',
      async (route) => {
        const id = await project(),
          input = await inputFor(route, id),
          accepted = await call(route, id, input);
        expect(accepted.data.status).toBe('accepted');
        const obsolete: Record<string, unknown> =
          route === 'native-rest'
            ? { operationId: input.operationId, obsoleteNativeField: 'historical request' }
            : {
                ...input,
                commands: [
                  {
                    type: 'patch_table',
                    id: 'old-table',
                    patch: { obsoleteNativeField: 'historical request' },
                  },
                ],
              };
        const hash = createHash('sha256')
          .update(
            requestFingerprint(
              route === 'native-rest'
                ? obsolete
                : {
                    command: 'apply_native_project_changes',
                    projectId: id,
                    ...Object.fromEntries(
                      Object.entries(obsolete).filter(([key]) => key !== 'includeDocument'),
                    ),
                  },
            ),
          )
          .digest('hex');
        // A historical server ledger fixture; no validation or gate is changed to admit new writes.
        await pool.query(
          'UPDATE sync_operations SET fingerprint=$3 WHERE project_id=$1 AND operation_id=$2',
          [id, input.operationId, hash],
        );
        const before = await state(id),
          replay = await call(route, id, obsolete);
        expect(replay.status, JSON.stringify(replay.data)).toBe(201);
        expect(replay.data).toEqual(accepted.data);
        expect((await call(route, id, { ...obsolete, operationId: randomUUID() })).status).toBe(
          400,
        );
        expect(await state(id)).toEqual(before);
      },
    );

    it.each(routes)(
      '%s serializes concurrent identical requests into one ledger ACK',
      async (route) => {
        const id = await project(),
          input = await inputFor(route, id),
          before = await state(id);
        const [one, two] = await Promise.all([call(route, id, input), call(route, id, input)]);
        expect(one.status, JSON.stringify(one.data)).toBe(201);
        expect(two.status, JSON.stringify(two.data)).toBe(201);
        expect(two.data).toEqual(one.data);
        const after = await state(id);
        expect(after.project.version).toBe(before.project.version + 1);
        expect(after.project.sync_sequence).toBe(before.project.sync_sequence + 1);
        expect(after.ledger.length).toBe(before.ledger.length + 1);
        expect(after.baselines.length).toBe(
          before.baselines.length + (route === 'native-rest' ? 1 : 2),
        );
        const stable = await state(id);
        expect((await call(route, id, input)).data).toEqual(one.data);
        expect(await state(id)).toEqual(stable);
      },
    );

    it('preserves raw stored ACK fields for native REST, command REST and MCP', async () => {
      for (const route of ['native-rest', 'command-rest', 'mcp'] as const) {
        const id = await project(),
          input = await inputFor(route, id),
          accepted = await call(route, id, input);
        const rawAck = {
          ...accepted.data,
          actor: { ...accepted.data.actor, username: ' historical actor ' },
        };
        await pool.query(
          'UPDATE sync_operations SET result=$3::jsonb WHERE project_id=$1 AND operation_id=$2',
          [id, input.operationId, JSON.stringify(rawAck)],
        );
        const before = await state(id),
          replay = await call(route, id, input);
        expect(replay.status).toBe(201);
        expect(replay.data).toEqual(rawAck);
        expect(await state(id)).toEqual(before);
      }
    });

    it.each(['command-rest', 'mcp'] as const)(
      '%s rolls back baseline issuance when a fresh candidate fails',
      async (route) => {
        const id = await project(),
          input = await inputFor(route, id);
        input.commands = [
          { type: 'patch_table', id: 'missing-table', patch: { logical: { name: 'Fail' } } },
        ];
        const before = await state(id);
        expect((await call(route, id, input)).status).toBe(400);
        expect(await state(id)).toEqual(before);
      },
    );
  },
);
