import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  createEmptyNativeDocument,
  createNativeTable,
  createNativeColumn,
  defaultDatabaseContext,
  addTableReference,
  upsertCombinedView,
  extractPersonalState,
  updateNodeLayout,
  type DatabaseKind,
  type NativeDesignDocument,
} from '@ezerd/model';
import {
  nativeCanvasMoveCommand,
  nativeSelectionPlacements,
  nativeAutoLayoutPlacements,
} from '../../web/src/features/projects/native-canvas-selection.js';
import { nativeCanvasDeleteCommands } from '../../web/src/features/projects/native-canvas-delete.js';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/application.js';
import { SyncGateway } from '../src/sync/sync.gateway.js';

describe.runIf(process.env.EZERD_DB_TEST === '1')(
  'restored canvas commands actual HTTP and durable source isolation',
  () => {
    let app: NestExpressApplication,
      pool: pg.Pool,
      base: string,
      workspace: string,
      user: string,
      token: string;
    async function api(path: string, method = 'GET', body?: unknown) {
      const response = await fetch(base + '/api' + path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: 'Bearer ' + token } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: await response.json() };
    }
    const state = async (id: string) => (await api(`/projects/${id}/document-state`)).data;
    beforeAll(async () => {
      const configured = new URL(process.env.DATABASE_URL!);
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname) ||
        !/^\/ezerd_qa_/.test(configured.pathname)
      )
        throw Error('Use isolated QA DB');
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
      const actor = await api('/users', 'POST', {
        username: 'canvas-parity-' + randomUUID().slice(0, 15),
        pin: '0024',
      });
      expect(actor.status).toBe(201);
      user = actor.data.id;
      const session = await api('/sessions', 'POST', { userId: user, pin: '0024' });
      token = session.data.token;
      const space = await api('/workspaces', 'POST', { name: 'Restored canvas QA' });
      workspace = space.data.id;
    });
    afterAll(async () => {
      await app?.close();
      if (pool) {
        try {
          if (workspace) {
            await pool.query('delete from projects where workspace_id=$1', [workspace]);
            await pool.query('delete from workspace_audit_events where workspace_id=$1', [
              workspace,
            ]);
            await pool.query('delete from user_workspaces where workspace_id=$1', [workspace]);
            await pool.query('delete from workspace where workspace_id=$1', [workspace]);
          }
          if (user) await pool.query('delete from users where id=$1', [user]);
        } finally {
          await pool.end();
        }
      }
    });
    it.each(['postgresql', 'mysql', 'sqlite'] as const)(
      'persists %s selected group, ACK replay, filtered auto layout, private batch and cascade',
      async (kind: DatabaseKind) => {
        const project = await api('/projects', 'POST', {
          workspaceId: workspace,
          name: 'Canvas ' + kind,
          databaseKind: kind,
          formatVersion: 2,
        });
        expect(project.status).toBe(201);
        const id = project.data.id;
        const database = defaultDatabaseContext(kind),
          a = createNativeTable(database, 'a', 'd'),
          b = createNativeTable(database, 'b', 'd'),
          c = createNativeTable(database, 'hidden', 'd');
        a.physical.name = 'records';
        b.physical.name = 'owners';
        c.physical.name = 'outside_filter';
        const columns = [a, b, c].map((table) => {
          const column = createNativeColumn(database, table, table.id + '-id');
          column.physical.name = 'id';
          return column;
        });
        let doc: NativeDesignDocument = {
          ...createEmptyNativeDocument(database),
          domains: [{ id: 'd', name: 'D', description: '' }],
          tables: [a, b, c],
          columns,
        };
        for (const [table, x] of [
          ['a', 40],
          ['b', 480],
          ['hidden', 940],
        ] as const)
          doc = addTableReference(doc, table, '__tables__', { x, y: 50, width: 360, height: 260 });
        await pool.query('update projects set document=$2::jsonb where id=$1', [
          id,
          JSON.stringify(doc),
        ]);
        let head = await state(id);
        const packet = (commands: unknown[]) => {
          const operationId = randomUUID();
          return {
            operationId,
            groupId: operationId,
            clientId: randomUUID(),
            expectedVersion: head.project.version,
            expectedSequence: head.sequence,
            expectedDatabaseRevision: head.project.databaseRevision,
            commands,
            includeDocument: true,
          };
        };
        const moved = nativeSelectionPlacements(doc.layout.nodes.slice(0, 2), 75, -30);
        const commands = moved.map((node) =>
          nativeCanvasMoveCommand(doc, node, { x: node.x, y: node.y }),
        );
        const request = packet(commands),
          saved = await api(`/projects/${id}/native-sync/commands`, 'POST', request);
        expect(saved.status, JSON.stringify(saved.data)).toBe(201);
        const committed = await state(id);
        expect(
          committed.sourceDocument.layout.nodes.slice(0, 2).map((n: any) => [n.x, n.y]),
        ).toEqual([
          [115, 20],
          [555, 20],
        ]);
        expect(committed.sourceDocument.columns).toEqual(columns);
        const replay = await api(`/projects/${id}/native-sync/commands`, 'POST', request);
        expect(replay.status).toBe(201);
        expect(await state(id)).toEqual(committed);
        head = committed;
        const invalid = await api(
          `/projects/${id}/native-sync/commands`,
          'POST',
          packet([
            commands[0],
            { type: 'update_node_layout', nodeId: 'missing', patch: { x: 300 } },
          ]),
        );
        expect(invalid.status).toBeGreaterThanOrEqual(400);
        expect(await state(id)).toEqual(committed);
        const placements = nativeAutoLayoutPlacements(
          committed.sourceDocument,
          committed.sourceDocument.layout.nodes.slice(0, 2),
          '__tables__',
        );
        const layout = await api(
          `/projects/${id}/native-sync/commands`,
          'POST',
          packet(
            placements.map((node) =>
              nativeCanvasMoveCommand(committed.sourceDocument, node, { x: node.x, y: node.y }),
            ),
          ),
        );
        expect(layout.status).toBe(201);
        head = await state(id);
        expect(head.sourceDocument.layout.nodes.find((n: any) => n.objectId === 'hidden')).toEqual(
          doc.layout.nodes[2],
        );
        const privateDoc = upsertCombinedView(head.sourceDocument, {
          id: 'mine',
          name: 'My view',
          domainIds: ['d'],
        });
        const privateMoved = nativeSelectionPlacements(
          privateDoc.layout.nodes.filter((node) => node.viewId === 'mine'),
          25,
          35,
        );
        let personalCandidate = privateDoc;
        for (const node of privateMoved)
          personalCandidate = updateNodeLayout(personalCandidate, node.id, {
            x: node.x,
            y: node.y,
          });
        const beforePersonal = (await api(`/projects/${id}/personal-state`)).data;
        const personal = await api(`/projects/${id}/personal-state`, 'PUT', {
          expectedVersion: beforePersonal.version,
          expectedDatabaseRevision: beforePersonal.databaseRevision,
          expectedProjectVersion: beforePersonal.projectVersion,
          expectedSyncSequence: beforePersonal.syncSequence,
          state: extractPersonalState(personalCandidate),
        });
        expect(personal.status, JSON.stringify(personal.data)).toBe(200);
        expect(
          (await api(`/projects/${id}/personal-state`)).data.state.nodes
            .filter((n: any) => n.viewId === 'mine')
            .map((n: any) => [n.x, n.y]),
        ).toEqual(privateMoved.map((n) => [n.x, n.y]));
        expect(await state(id)).toEqual(head);
        const deletion = await api(
          `/projects/${id}/native-sync/commands`,
          'POST',
          packet(nativeCanvasDeleteCommands(head.sourceDocument, ['a', 'b'], '__tables__')),
        );
        expect(deletion.status).toBe(201);
        const after = await state(id);
        expect(after.sourceDocument.tables.map((t: any) => t.id)).toEqual(['hidden']);
        expect(after.sourceDocument.columns.map((c: any) => c.tableId)).toEqual(['hidden']);
        expect((await api(`/projects/${id}`)).status).toBe(409);
      },
    );
  },
);
