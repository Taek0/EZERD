import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  defaultDatabaseContext,
  deleteNativeObjects,
  deriveOperationChanges,
  migrateDesignDocumentV1,
  type DatabaseKind,
  type NativeDesignDocument,
} from '@ezerd/model';
import {
  nativeHistoryCommandResultSchema,
  nativeHistoryPageSchema,
} from '../../../packages/contracts/src/native-history.js';

function fixture(kind: DatabaseKind = 'postgresql'): NativeDesignDocument {
  const old = createEmptyDocument();
  old.domains = [{ id: 'domain', name: 'Domain', description: '' }];
  old.tables = ['table', 'other'].map((id) => ({
    id,
    domainId: id === 'table' ? 'domain' : null,
    scope: 'both',
    logical: { name: id, definition: '' },
    physical: { name: id, schema: 'public', comment: '' },
    customProperties: { common: {}, logical: {}, physical: {} },
  }));
  old.columns = ['a/~', 'middle', 'last', 'external'].map((id) => ({
    id,
    tableId: id === 'external' ? 'other' : 'table',
    scope: 'both',
    logical: { name: id, definition: '', semanticType: '', required: false },
    physical: {
      name: id === 'a/~' ? 'first' : id,
      type: { name: 'integer', isArray: false },
      nullable: false,
      defaultExpression: 'old_unknown()',
      comment: '',
    },
    customProperties: { common: {}, logical: {}, physical: {} },
  }));
  old.keys = [
    { id: 'key', tableId: 'table', name: 'pk', kind: 'primary', scope: 'both', columnIds: ['a/~'] },
  ];
  old.tableRelations = [
    {
      id: 'relation',
      sourceTableId: 'other',
      targetTableId: 'table',
      scope: 'both',
      logical: { name: 'Relation', cardinality: 'one-to-many', required: false },
      physical: {
        name: 'fk',
        sourceColumnIds: ['external'],
        targetColumnIds: ['a/~'],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
    },
  ];
  old.layout.nodes = [
    {
      id: 'domain-node',
      objectId: 'domain',
      viewId: 'overview',
      x: 10,
      y: 20,
      width: 240,
      height: 160,
    },
    ...['table', 'other'].map((objectId, i) => ({
      id: 'node-' + objectId,
      objectId,
      viewId: '__tables__',
      x: 100 + i * 400,
      y: 200,
      width: 320,
      height: 260,
    })),
  ];
  old.layout.relations = [{ relationId: 'relation', viewId: '__tables__', offset: 17 }];
  const doc = migrateDesignDocumentV1(old, defaultDatabaseContext(kind)).document;
  doc.indexes = [
    {
      id: 'index',
      tableId: 'table',
      name: 'idx',
      scope: 'logical',
      unique: false,
      parts: [{ direction: 'asc', expression: { kind: 'column', columnId: 'a/~' } }],
      options:
        kind === 'postgresql'
          ? { database: 'postgresql', method: 'btree', includeColumnIds: ['last'] }
          : kind === 'mysql'
            ? { database: 'mysql', kind: 'btree' }
            : { database: 'sqlite' },
    },
  ];
  doc.checks = [
    {
      id: 'check',
      tableId: 'table',
      name: 'check',
      scope: 'logical',
      expression: {
        kind: 'binary',
        operator: '=',
        left: { kind: 'column', columnId: 'middle' },
        right: { kind: 'literal', literalType: 'string', value: 'a/~' },
      },
    },
  ];
  return doc;
}

describe.runIf(process.env.EZERD_DB_TEST === '1')(
  'native ledger history and conflict-safe compensation REST',
  () => {
    let app: NestExpressApplication, pool: pg.Pool, base: string, workspaceId: string;
    let ownerId: string,
      ownerToken: string,
      editorToken: string,
      viewerToken: string,
      outsiderToken: string;
    const userIds: string[] = [];
    const compiledRoot = process.env.NATIVE_HISTORY_TEST_DIR ?? resolve('apps/server/dist');
    // Keep Nest injection tokens in one native Node module cache rather than mixing
    // Vitest-transformed direct imports with native imports inside compiled controllers.
    const requireCompiled = createRequire(import.meta.url);
    const load = (path: string) => Promise.resolve(requireCompiled(resolve(compiledRoot, path)));
    const request = async (
      id: string,
      suffix: string,
      method = 'GET',
      body?: unknown,
      token: string | null = ownerToken,
    ) => {
      const response = await fetch(`${base}/api/projects/${id}/${suffix}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: await response.json() };
    };
    const row = async (id: string) =>
      (await pool.query('SELECT * FROM projects WHERE id=$1', [id])).rows[0];
    const seed = async (doc: NativeDesignDocument = fixture()) => {
      const id = randomUUID();
      await pool.query(
        'INSERT INTO projects (id,workspace_id,name,database_kind,database_profile_id,document) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',
        [
          id,
          workspaceId,
          'History QA',
          doc.database.kind,
          doc.database.profileId,
          JSON.stringify(doc),
        ],
      );
      return id;
    };
    const baseline = async (id: string, token = ownerToken, clientId = randomUUID()) => {
      const response = await request(id, 'native-sync/baseline', 'POST', { clientId }, token);
      expect(response.status, JSON.stringify(response.data)).toBe(201);
      return { ...response.data, clientId };
    };
    const edit = async (
      id: string,
      mutate: (document: NativeDesignDocument) => NativeDesignDocument | void,
      token = ownerToken,
    ) => {
      const issued = await baseline(id, token);
      const candidate = structuredClone(issued.document);
      const document = mutate(candidate) ?? candidate;
      const input = {
        protocolVersion: 2,
        operationId: randomUUID(),
        groupId: randomUUID(),
        clientId: issued.clientId,
        baselineId: issued.baselineId,
        baselineIssuedAt: issued.baselineIssuedAt,
        baseSequence: issued.sequence,
        database: issued.database,
        databaseRevision: issued.databaseRevision,
        kind: 'online',
        dependencyPaths: [],
        baselineDocument: issued.document,
        document,
        changes: deriveOperationChanges(issued.document, document),
      };
      const response = await request(id, 'native-sync/operations', 'POST', input, token);
      expect(response.status, JSON.stringify(response.data)).toBe(201);
      return { response, input };
    };
    const commandInput = async (id: string, token = ownerToken) => {
      const issued = await baseline(id, token);
      return {
        operationId: randomUUID(),
        groupId: randomUUID(),
        clientId: issued.clientId,
        baselineId: issued.baselineId,
        baselineIssuedAt: issued.baselineIssuedAt,
        expectedVersion: issued.projectVersion,
        expectedSequence: issued.sequence,
        database: issued.database,
        databaseRevision: issued.databaseRevision,
      };
    };
    const compensate = (
      id: string,
      source: string,
      command: string,
      input: unknown,
      token = ownerToken,
    ) => request(id, `native-history/${source}/${command}`, 'POST', input, token);
    const state = async (id: string) => ({
      project: await row(id),
      ledger: (
        await pool.query('SELECT * FROM sync_operations WHERE project_id=$1 ORDER BY sequence', [
          id,
        ])
      ).rows,
      versions: (
        await pool.query('SELECT * FROM sync_field_versions WHERE project_id=$1 ORDER BY path', [
          id,
        ])
      ).rows,
      baselines: (
        await pool.query(
          'SELECT * FROM sync_client_baselines WHERE project_id=$1 ORDER BY baseline_id',
          [id],
        )
      ).rows,
      tombstones: (
        await pool.query('SELECT * FROM sync_tombstones WHERE project_id=$1 ORDER BY object_id', [
          id,
        ])
      ).rows,
    });
    const acceptedEdit = async (
      id: string,
      mutate: (document: NativeDesignDocument) => NativeDesignDocument | void,
      token = ownerToken,
    ) => {
      const result = await edit(id, mutate, token);
      expect(result.response.data.status, JSON.stringify(result.response.data)).toBe('accepted');
      return result;
    };

    beforeAll(async () => {
      const configured = new URL(process.env.DATABASE_URL!);
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname) ||
        !/^\/ezerd_qa_/.test(configured.pathname)
      )
        throw new Error('Disposable local isolated DB required');
      pool = new pg.Pool({ connectionString: configured.toString() });
      const modules = await Promise.all(
        [
          'db/database.service.js',
          'workspace/workspace-access.service.js',
          'identity/session.js',
          'shared/rate-limit.service.js',
          'sync/native-history.service.js',
          'sync/native-history.controller.js',
          'sync/native-sync.service.js',
          'sync/native-sync.controller.js',
          'workspace/native-upgrade.service.js',
          'workspace/native-upgrade.controller.js',
          'sync/sync.gateway.js',
          'network/network-access.js',
          'workspace/workspace-events.service.js',
        ].map(load),
      );
      const providers = [
        modules[0].DatabaseService,
        modules[1].WorkspaceAccessService,
        modules[2].SessionService,
        modules[3].RateLimitService,
        modules[4].NativeHistoryService,
        modules[6].NativeSyncService,
        modules[8].NativeUpgradeService,
        modules[10].SyncGateway,
        modules[11].LanAccessService,
        modules[12].WorkspaceEventsService,
      ];
      class HistoryTestModule {}
      Module({
        providers,
        controllers: [
          modules[5].NativeHistoryController,
          modules[7].NativeSyncController,
          modules[9].NativeUpgradeController,
        ],
      })(HistoryTestModule);
      const applicationModule = process.env.NATIVE_HISTORY_TEST_DIR
        ? HistoryTestModule
        : (await load('app.module.js')).AppModule;
      app = await NestFactory.create<NestExpressApplication>(applicationModule, {
        logger: false,
        bodyParser: false,
        abortOnError: false,
      });
      if (process.env.NATIVE_HISTORY_TEST_DIR) {
        app.setGlobalPrefix('api');
        app.useBodyParser('json', { limit: '8mb' });
      } else {
        (await load('application.js')).configureApplication(app);
      }
      app.get(modules[10].SyncGateway).attach(app.getHttpServer());
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      workspaceId = randomUUID();
      await pool.query('INSERT INTO workspace (workspace_id,workspace_name) VALUES ($1,$2)', [
        workspaceId,
        'Native history QA',
      ]);
      const actor = async (role?: string) => {
        const id = randomUUID(),
          token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
        userIds.push(id);
        await pool.query('INSERT INTO users (id,username,pin_hash) VALUES ($1,$2,$3)', [
          id,
          'history-' + id.slice(0, 20),
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
      const owner = await actor('owner'),
        editor = await actor('editor');
      ownerId = owner.id;
      ownerToken = owner.token;
      editorToken = editor.token;
      viewerToken = (await actor('viewer')).token;
      outsiderToken = (await actor()).token;
    });
    afterAll(async () => {
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

    it.each(['postgresql', 'mysql', 'sqlite'] as const)(
      'undoes %s own scalar edit using current native baseline, ledger and polling events',
      async (kind) => {
        const id = await seed(fixture(kind));
        const source = await acceptedEdit(id, (doc) => {
          doc.tables![0]!.physical.comment = 'Changed';
        });
        const input = await commandInput(id),
          response = await compensate(id, source.input.operationId, 'undo', input);
        expect(response.status, JSON.stringify(response.data)).toBe(201);
        expect(nativeHistoryCommandResultSchema.safeParse(response.data).success).toBe(true);
        expect(response.data).toMatchObject({
          command: 'undo',
          sourceOperationId: source.input.operationId,
          identityMap: [],
          result: {
            status: 'accepted',
            sequence: 2,
            databaseRevision: 0,
            reasonCode: 'history.undo',
          },
        });
        expect((await row(id)).document.tables[0].physical.comment).toBe('');
        expect((await row(id)).version).toBe(2);
        const poll = await request(id, 'native-sync/events?since=1');
        expect(poll.data).toMatchObject({
          resetRequired: false,
          sequence: 2,
          events: [{ operationId: input.operationId, reasonCode: 'history.undo' }],
        });
        const saved = await state(id);
        expect(saved.ledger[1].base_sequence).toBe(1);
        expect(
          saved.versions.find((version: { path: string }) =>
            version.path.endsWith('/physical/comment'),
          ).sequence,
        ).toBe(2);
        expect(
          saved.baselines.some(
            (base: { baseline_id: string; last_sequence: number; user_id: string }) =>
              base.baseline_id === response.data.result.nextBaseline.baselineId &&
              base.last_sequence === 2 &&
              base.user_id === ownerId,
          ),
        ).toBe(true);
      },
    );

    it('preserves validated raw cached compensation ACK actor fields', async () => {
      const id = await seed(),
        source = await acceptedEdit(id, (doc) => {
          doc.tables![0]!.logical.name = 'Edited';
        });
      const input = await commandInput(id),
        accepted = await compensate(id, source.input.operationId, 'undo', input);
      expect(accepted.status).toBe(201);
      const raw = {
        ...accepted.data.result,
        actor: { ...accepted.data.result.actor, username: ' historical actor ' },
      };
      await pool.query(
        'UPDATE sync_operations SET result=$3::jsonb WHERE project_id=$1 AND operation_id=$2',
        [id, input.operationId, JSON.stringify(raw)],
      );
      const before = await state(id),
        replay = await compensate(id, source.input.operationId, 'undo', input);
      expect(replay.data).toEqual({ ...accepted.data, result: raw });
      expect(await state(id)).toEqual(before);
    });
    it('replays the exact accepted result before archived/context/baseline/source checks, including concurrent duplicates', async () => {
      const id = await seed(),
        source = await acceptedEdit(id, (doc) => {
          doc.tables![0]!.logical.name = 'Edited';
        });
      const input = await commandInput(id);
      const [one, two] = await Promise.all([
        compensate(id, source.input.operationId, 'undo', input),
        compensate(id, source.input.operationId, 'undo', input),
      ]);
      expect(one.status, JSON.stringify(one.data)).toBe(201);
      expect(two.data).toEqual(one.data);
      await pool.query("UPDATE projects SET status='archived',database_revision=1 WHERE id=$1", [
        id,
      ]);
      await pool.query('DELETE FROM sync_client_baselines WHERE project_id=$1', [id]);
      await pool.query('DELETE FROM sync_operations WHERE project_id=$1 AND operation_id=$2', [
        id,
        source.input.operationId,
      ]);
      const before = await state(id);
      expect((await compensate(id, source.input.operationId, 'undo', input)).data).toEqual(
        one.data,
      );
      expect(await state(id)).toEqual(before);
      expect((await compensate(id, source.input.operationId, 'restore', input)).status).toBe(409);
      expect(
        (
          await compensate(id, source.input.operationId, 'undo', {
            ...input,
            groupId: randomUUID(),
          })
        ).status,
      ).toBe(409);
    });

    it.each(
      (['undo', 'restore'] as const).flatMap((command) =>
        (['workspace-archived', 'actor-viewer', 'both'] as const).map((restriction) => ({
          command,
          restriction,
        })),
      ),
    )(
      'replays own $command ACK with retained read access under $restriction but forbids new writes and other actors',
      async ({ command, restriction }) => {
        const id = await seed();
        const source = await acceptedEdit(id, (doc) => {
          if (command === 'restore')
            return deleteNativeObjects(doc, [{ collection: 'tables', id: 'table' }]);
          doc.tables![0]!.logical.name = 'Edited';
        });
        const input = await commandInput(id);
        const accepted = await compensate(id, source.input.operationId, command, input);
        expect(accepted.status, JSON.stringify(accepted.data)).toBe(201);
        const fresh = await commandInput(id);
        if (restriction !== 'actor-viewer')
          await pool.query("UPDATE workspace SET status='archived' WHERE workspace_id=$1", [
            workspaceId,
          ]);
        if (restriction !== 'workspace-archived')
          await pool.query(
            "UPDATE user_workspaces SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",
            [workspaceId, ownerId],
          );
        try {
          const before = await state(id);
          expect((await request(id, 'native-history')).status).toBe(200);
          const replay = await compensate(id, source.input.operationId, command, input);
          expect(replay.status, JSON.stringify(replay.data)).toBe(201);
          expect(replay.data).toEqual(accepted.data);
          expect((await compensate(id, source.input.operationId, command, fresh)).status).toBe(403);
          for (const otherActor of [viewerToken, editorToken])
            expect(
              await compensate(id, source.input.operationId, command, input, otherActor),
            ).toMatchObject({ status: 403, data: { code: 'history.replay-actor-mismatch' } });
          expect(
            (await compensate(id, source.input.operationId, command, input, outsiderToken)).status,
          ).toBe(403);
          expect(
            (
              await compensate(id, source.input.operationId, command, {
                ...input,
                groupId: randomUUID(),
              })
            ).status,
          ).toBe(409);
          expect(await state(id)).toEqual(before);
          await pool.query('DELETE FROM user_workspaces WHERE workspace_id=$1 AND user_id=$2', [
            workspaceId,
            ownerId,
          ]);
          expect((await compensate(id, source.input.operationId, command, input)).status).toBe(403);
          expect(await state(id)).toEqual(before);
        } finally {
          await pool.query("UPDATE workspace SET status='active' WHERE workspace_id=$1", [
            workspaceId,
          ]);
          await pool.query(
            "INSERT INTO user_workspaces (workspace_id,user_id,role) VALUES ($1,$2,'owner') ON CONFLICT (workspace_id,user_id) DO UPDATE SET role='owner'",
            [workspaceId, ownerId],
          );
        }
      },
    );

    it.each(['postgresql', 'mysql', 'sqlite'] as const)(
      'restores %s deleted physical tree using proven snapshot, fresh identities and complete AST/FK/layout references',
      async (kind) => {
        const original = fixture(kind),
          id = await seed(original);
        const source = await acceptedEdit(id, (doc) =>
          deleteNativeObjects(doc, [{ collection: 'tables', id: 'table' }]),
        );
        const input = await commandInput(id),
          response = await compensate(id, source.input.operationId, 'restore', input);
        expect(response.status, JSON.stringify(response.data)).toBe(201);
        const saved = (await row(id)).document;
        const remapped = (from: string, kind = 'entity') =>
          response.data.identityMap.find(
            (item: { from: string; kind: string }) => item.from === from && item.kind === kind,
          )?.to;
        const parent = saved.tables.find(
          (table: { physical: { name: string } }) => table.physical.name === 'table',
        );
        expect(parent.id).toBe(remapped('table'));
        expect(parent.id).not.toBe('table');
        expect(parent.physical).toEqual(original.tables![0]!.physical);
        expect(saved.columns.map((column: { id: string }) => column.id)).toEqual([
          remapped('a/~'),
          remapped('middle'),
          remapped('last'),
          'external',
        ]);
        expect(saved.columns[0].tableId).toBe(parent.id);
        expect(saved.columns[0].physical).toEqual(original.columns![0]!.physical);
        expect(saved.keys[0].columnIds).toEqual([remapped('a/~')]);
        expect(saved.tableRelations[0]).toMatchObject({
          id: remapped('relation'),
          sourceTableId: 'other',
          targetTableId: parent.id,
          physical: { sourceColumnIds: ['external'], targetColumnIds: [remapped('a/~')] },
        });
        expect(saved.indexes[0].parts[0].expression.columnId).toBe(remapped('a/~'));
        if (kind === 'postgresql')
          expect(saved.indexes[0].options.includeColumnIds).toEqual([remapped('last')]);
        expect(saved.checks[0].expression.left.columnId).toBe(remapped('middle'));
        expect(saved.checks[0].expression.right.value).toBe('a/~');
        expect(
          saved.layout.nodes.find((node: { objectId: string }) => node.objectId === parent.id),
        ).toMatchObject({ id: remapped('node-table', 'node'), x: 100, y: 200 });
        expect(saved.layout.relations[0]).toMatchObject({
          viewId: '__tables__',
          relationId: remapped('relation'),
          offset: 17,
        });
        const tombstone = (
          await pool.query('SELECT * FROM sync_tombstones WHERE project_id=$1 AND object_id=$2', [
            id,
            'table',
          ])
        ).rows[0];
        expect(tombstone.operation_id).toBe(source.input.operationId);
        const before = await state(id);
        expect((await compensate(id, source.input.operationId, 'restore', input)).data).toEqual(
          response.data,
        );
        expect(await state(id)).toEqual(before);
        const second = await commandInput(id);
        expect(await compensate(id, source.input.operationId, 'restore', second)).toMatchObject({
          status: 409,
          data: { code: 'history.source-already-compensated' },
        });
      },
    );

    it('undoes multiple column deletions in original order with escaped IDs and retains unrelated editor changes', async () => {
      const doc = fixture();
      doc.keys = [];
      doc.tableRelations = [];
      doc.indexes = [];
      doc.checks = [];
      doc.layout.relations = [];
      const id = await seed(doc);
      const source = await acceptedEdit(id, (doc) =>
        deleteNativeObjects(doc, [
          { collection: 'columns', id: 'a/~' },
          { collection: 'columns', id: 'middle' },
        ]),
      );
      await acceptedEdit(
        id,
        (doc) => {
          doc.notes.push({ id: 'remote-note', viewId: 'overview', text: 'Keep collaborator' });
        },
        editorToken,
      );
      const input = await commandInput(id),
        response = await compensate(id, source.input.operationId, 'undo', input);
      expect(response.status, JSON.stringify(response.data)).toBe(201);
      const saved = (await row(id)).document;
      expect(
        saved.columns.map((column: { physical: { name: string } }) => column.physical.name),
      ).toEqual(['first', 'middle', 'last', 'external']);
      expect(saved.notes).toContainEqual({
        id: 'remote-note',
        viewId: 'overview',
        text: 'Keep collaborator',
      });
      expect(saved.columns[0].id).not.toBe('a/~');
      expect(response.data.result.sequence).toBe(3);
    });

    it('keeps ordinary retired-ID and arbitrary legacy creation blocked after a legitimate restore', async () => {
      const id = await seed(fixture('mysql'));
      const source = await acceptedEdit(id, (doc) =>
        deleteNativeObjects(doc, [{ collection: 'tables', id: 'table' }]),
      );
      const restored = await compensate(
        id,
        source.input.operationId,
        'restore',
        await commandInput(id),
      );
      expect(restored.status, JSON.stringify(restored.data)).toBe(201);
      const retired = await edit(id, (doc) => {
        const table = structuredClone(
          doc.tables!.find((table) => table.physical.name === 'table')!,
        );
        table.id = 'table';
        table.physical.name = 'retired-copy';
        doc.tables!.push(table);
      });
      expect(retired.response.data).toMatchObject({
        status: 'rejected',
        reasonCode: 'sync.identity-retired',
      });
      const newLegacy = await edit(id, (doc) => {
        const column = structuredClone(doc.columns![0]!);
        column.id = randomUUID();
        column.physical.name = 'arbitrary';
        doc.columns!.push(column);
      });
      expect(newLegacy.response.data).toMatchObject({
        status: 'rejected',
        reasonCode: 'database.candidate-invalid',
      });
      expect(
        newLegacy.response.data.issues.some(
          (issue: { code: string }) => issue.code === 'legacy.source-not-trusted',
        ),
      ).toBe(true);
    });

    it('rejects later field edits and reference read-set edits instead of overwriting collaborators', async () => {
      const id = await seed(),
        source = await acceptedEdit(id, (doc) => {
          doc.tables![0]!.physical.comment = 'Owner';
        });
      await acceptedEdit(
        id,
        (doc) => {
          doc.tables![0]!.physical.comment = 'Editor';
        },
        editorToken,
      );
      const input = await commandInput(id),
        before = await state(id);
      expect(await compensate(id, source.input.operationId, 'undo', input)).toMatchObject({
        status: 409,
        data: { code: 'history.field-conflict' },
      });
      expect(await state(id)).toEqual(before);
      const id2 = await seed(),
        deletion = await acceptedEdit(id2, (doc) =>
          deleteNativeObjects(doc, [{ collection: 'tables', id: 'table' }]),
        );
      await acceptedEdit(
        id2,
        (doc) => {
          doc.columns!.find((column) => column.id === 'external')!.scope = 'logical';
        },
        editorToken,
      );
      expect(
        await compensate(id2, deletion.input.operationId, 'restore', await commandInput(id2)),
      ).toMatchObject({ status: 409, data: { code: 'history.field-conflict' } });
    });

    it('does not grandfather a new SQL-name conflict against current document when restoring a historical object', async () => {
      const doc = fixture();
      doc.tableRelations = [];
      doc.layout.relations = [];
      const id = await seed(doc),
        source = await acceptedEdit(id, (doc) =>
          deleteNativeObjects(doc, [{ collection: 'tables', id: 'table' }]),
        );
      // Existing imported data, then a real allowed metadata edit introduces the conflicting SQL name.
      // No type gate is enabled or mutated by the fixture.
      const stored = (await row(id)).document;
      stored.tables.push({
        ...structuredClone(stored.tables[0]),
        id: 'third',
        physical: { ...stored.tables[0].physical, name: 'fresh' },
      });
      await pool.query('UPDATE projects SET document=$2::jsonb WHERE id=$1', [
        id,
        JSON.stringify(stored),
      ]);
      await acceptedEdit(
        id,
        (doc) => {
          doc.tables!.find((table) => table.id === 'third')!.physical.name = 'table';
        },
        editorToken,
      );
      const input = await commandInput(id),
        before = await state(id);
      const rejected = await compensate(id, source.input.operationId, 'restore', input);
      expect(rejected.status, JSON.stringify(rejected.data)).toBe(422);
      expect(
        rejected.data.issues.some(
          (issue: { code: string }) => issue.code === 'table.duplicate-name',
        ),
      ).toBe(true);
      expect(await state(id)).toEqual(before);
    });

    it('refuses to reissue legacy values on existing objects when undoing a safe normalization', async () => {
      const doc = fixture('mysql');
      doc.tableRelations = [];
      doc.layout.relations = [];
      doc.keys = [];
      doc.indexes = [];
      doc.checks = [];
      for (const item of [...doc.tables!, ...doc.columns!]) item.scope = 'logical';
      const id = await seed(doc),
        source = await acceptedEdit(id, (doc) => {
          doc.columns![0]!.physical.type = {
            kind: 'builtin',
            database: 'mysql',
            typeId: 'mysql:int',
            parameters: {},
          };
        });
      const input = await commandInput(id),
        before = await state(id);
      const rejected = await compensate(id, source.input.operationId, 'undo', input);
      expect(rejected.status).toBe(422);
      expect(
        rejected.data.issues.some(
          (issue: { code: string }) => issue.code === 'legacy.source-not-trusted',
        ),
      ).toBe(true);
      expect(await state(id)).toEqual(before);
    });

    it.each(['items', 'tombstone', 'expired-tombstone', 'source-result'] as const)(
      'blocks %s provenance corruption atomically',
      async (corruption) => {
        const id = await seed(),
          source = await acceptedEdit(id, (doc) =>
            deleteNativeObjects(doc, [{ collection: 'tables', id: 'table' }]),
          );
        if (corruption === 'items')
          await pool.query(
            "UPDATE sync_operations SET deletion_snapshot=jsonb_set(deletion_snapshot,'{items}','[]'::jsonb) WHERE project_id=$1 AND operation_id=$2",
            [id, source.input.operationId],
          );
        if (corruption === 'tombstone')
          await pool.query('UPDATE sync_tombstones SET operation_id=$2 WHERE project_id=$1', [
            id,
            randomUUID(),
          ]);
        if (corruption === 'expired-tombstone')
          await pool.query(
            "UPDATE sync_tombstones SET expires_at=NOW()-INTERVAL '1 second' WHERE project_id=$1",
            [id],
          );
        if (corruption === 'source-result')
          await pool.query(
            "UPDATE sync_operations SET result=jsonb_set(result,'{document,tables,0,logical,name}','\"forged\"'::jsonb) WHERE project_id=$1 AND operation_id=$2",
            [id, source.input.operationId],
          );
        const input = await commandInput(id),
          before = await state(id),
          rejected = await compensate(id, source.input.operationId, 'restore', input);
        expect(rejected.status, JSON.stringify(rejected.data)).toBe(409);
        expect(await state(id)).toEqual(before);
      },
    );

    it('checks actual baseline owner/client/time/current snapshot and exact head/context before applying', async () => {
      const id = await seed(),
        source = await acceptedEdit(id, (doc) => {
          doc.tables![0]!.logical.name = 'Changed';
        });
      const input = await commandInput(id),
        other = await commandInput(id, editorToken);
      const before = await state(id);
      for (const invalid of [
        { ...input, baselineId: randomUUID() },
        { ...input, clientId: randomUUID() },
        { ...input, baselineIssuedAt: '2020-01-01T00:00:00.000Z' },
        {
          ...input,
          baselineId: other.baselineId,
          baselineIssuedAt: other.baselineIssuedAt,
          clientId: other.clientId,
        },
      ])
        expect(await compensate(id, source.input.operationId, 'undo', invalid)).toMatchObject({
          status: 409,
          data: { code: 'history.baseline-invalid' },
        });
      for (const invalid of [
        { ...input, expectedSequence: 0 },
        { ...input, expectedVersion: 0 },
        { ...input, databaseRevision: 1 },
        { ...input, database: defaultDatabaseContext('mysql') },
      ])
        expect(await compensate(id, source.input.operationId, 'undo', invalid)).toMatchObject({
          status: 409,
          data: { code: 'database.context-changed' },
        });
      expect(await state(id)).toEqual(before);
    });

    it('requires same source actor and design role, allows archived read, and rejects client authority claims', async () => {
      const id = await seed(),
        source = await acceptedEdit(id, (doc) => {
          doc.tables![0]!.physical.comment = 'Edit';
        });
      const input = await commandInput(id),
        editorInput = await commandInput(id, editorToken);
      expect(
        await compensate(id, source.input.operationId, 'undo', editorInput, editorToken),
      ).toMatchObject({ status: 403, data: { code: 'history.source-actor-mismatch' } });
      expect(
        (await compensate(id, source.input.operationId, 'undo', input, viewerToken)).status,
      ).toBe(403);
      expect((await request(id, 'native-history', 'GET', undefined, outsiderToken)).status).toBe(
        403,
      );
      expect((await request(id, 'native-history', 'GET', undefined, null)).status).toBe(401);
      expect((await request(id, 'native-history?limit=101')).status).toBe(400);
      for (const key of [
        'before',
        'previous',
        'document',
        'trustedOrigin',
        'identityMap',
        'deletionSnapshot',
      ])
        expect(
          (await compensate(id, source.input.operationId, 'undo', { ...input, [key]: {} })).status,
        ).toBe(400);
      await pool.query("UPDATE projects SET status='archived' WHERE id=$1", [id]);
      expect((await request(id, 'native-history', 'GET', undefined, viewerToken)).status).toBe(200);
      expect(await compensate(id, source.input.operationId, 'undo', input)).toMatchObject({
        status: 409,
        data: { code: 'project.archived' },
      });
      await pool.query("UPDATE workspace SET status='archived' WHERE workspace_id=$1", [
        workspaceId,
      ]);
      try {
        expect((await request(id, 'native-history')).status).toBe(200);
        expect((await compensate(id, source.input.operationId, 'undo', input)).status).toBe(403);
      } finally {
        await pool.query("UPDATE workspace SET status='active' WHERE workspace_id=$1", [
          workspaceId,
        ]);
      }
    });

    it('preserves v1 ledger and actual upgrade raw audit through pagination and prevents crossing the native boundary', async () => {
      const id = randomUUID(),
        legacy = createEmptyDocument(),
        v1Operation = randomUUID(),
        clientId = randomUUID();
      legacy.notes = [{ id: 'old-note', viewId: 'overview', text: 'Original v1' }];
      await pool.query(
        'INSERT INTO projects (id,workspace_id,name,document,version,sync_sequence) VALUES ($1,$2,$3,$4::jsonb,1,1)',
        [id, workspaceId, 'Upgrade history', JSON.stringify(legacy)],
      );
      const oldResult = {
        operationId: v1Operation,
        groupId: randomUUID(),
        sequence: 1,
        status: 'accepted',
        actor: { id: ownerId, username: 'stored-actor', color: '#123456' },
        changedPaths: [],
        createdAt: new Date().toISOString(),
        nextBaseline: {
          baselineId: randomUUID(),
          baseSequence: 1,
          baselineIssuedAt: new Date().toISOString(),
          databaseRevision: 0,
        },
        document: legacy,
      };
      await pool.query(
        'INSERT INTO sync_operations (project_id,operation_id,group_id,client_id,actor_id,sequence,base_sequence,baseline_id,baseline_issued_at,kind,fingerprint,changes,result) VALUES ($1,$2,$3,$4,$5,1,0,$6,NOW(),$7,$8,$9::jsonb,$10::jsonb)',
        [
          id,
          v1Operation,
          oldResult.groupId,
          clientId,
          ownerId,
          oldResult.nextBaseline.baselineId,
          'online',
          'stored-v1',
          '[]',
          JSON.stringify(oldResult),
        ],
      );
      const upgradeInput = {
        operationId: randomUUID(),
        clientId,
        expectedVersion: 1,
        expectedSequence: 1,
        expectedDatabaseRevision: 0,
      };
      const upgraded = await request(id, 'document/upgrade', 'POST', upgradeInput);
      expect(upgraded.status, JSON.stringify(upgraded.data)).toBe(201);
      const source = await acceptedEdit(id, (doc) => {
        doc.notes[0]!.text = 'Native';
      });
      const before = await state(id),
        first = await request(id, 'native-history?since=0&limit=2');
      expect(first.status).toBe(200);
      expect(nativeHistoryPageSchema.safeParse(first.data).success).toBe(true);
      expect(first.data.history.map((entry: { format: string }) => entry.format)).toEqual([
        'legacy',
        'upgrade',
      ]);
      expect(first.data.history[0].result).toEqual(oldResult);
      expect(first.data.history[1].deletionSnapshot.sourceDocument).toEqual(legacy);
      expect(first.data.nextSince).toBe(2);
      const second = await request(id, `native-history?since=${first.data.nextSince}&limit=2`);
      expect(second.data.history[0]).toMatchObject({
        operationId: source.input.operationId,
        format: 'native',
      });
      expect(second.data.nextSince).toBeNull();
      expect(await state(id)).toEqual(before);
      const input = await commandInput(id);
      for (const sourceId of [v1Operation, upgradeInput.operationId])
        expect(
          await compensate(id, sourceId, 'undo', { ...input, operationId: randomUUID() }),
        ).toMatchObject({ status: 409, data: { code: 'history.format-boundary' } });
      await pool.query('UPDATE projects SET database_revision=2 WHERE id=$1', [id]);
      expect(
        await compensate(id, source.input.operationId, 'undo', await commandInput(id)),
      ).toMatchObject({ status: 409, data: { code: 'database.context-changed' } });
    });

    it('rejects history source rejection, non-deletion restore and expired history without altering state', async () => {
      const id = await seed(),
        scalar = await acceptedEdit(id, (doc) => {
          doc.tables![0]!.logical.name = 'Edit';
        });
      expect(
        await compensate(id, scalar.input.operationId, 'restore', await commandInput(id)),
      ).toMatchObject({ status: 409, data: { code: 'history.not-a-deletion' } });
      const rejected = await edit(id, (doc) => {
        const column = structuredClone(doc.columns![0]!);
        column.id = randomUUID();
        column.physical.name = 'new';
        doc.columns!.push(column);
      });
      expect(rejected.response.data.status).toBe('rejected');
      const input = await commandInput(id),
        before = await state(id);
      expect(await compensate(id, rejected.input.operationId, 'undo', input)).toMatchObject({
        status: 409,
        data: { code: 'history.source-invalid' },
      });
      expect(await state(id)).toEqual(before);
      await pool.query(
        "UPDATE sync_operations SET created_at=NOW()-INTERVAL '8 days' WHERE project_id=$1 AND operation_id=$2",
        [id, scalar.input.operationId],
      );
      expect(await compensate(id, scalar.input.operationId, 'undo', input)).toMatchObject({
        status: 409,
        data: { code: 'history.source-expired' },
      });
    });

    it('rolls back the project, ledger, field versions and baseline if accepted history insertion fails', async () => {
      const id = await seed(),
        source = await acceptedEdit(id, (doc) => {
          doc.tables![0]!.logical.name = 'Edit';
        });
      const input = await commandInput(id),
        before = await state(id);
      await pool.query(
        "CREATE FUNCTION native_history_fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.result->>'reasonCode' = 'history.undo' THEN RAISE EXCEPTION 'history QA failure'; END IF; RETURN NEW; END $$",
      );
      await pool.query(
        'CREATE TRIGGER native_history_fail_insert BEFORE INSERT ON sync_operations FOR EACH ROW EXECUTE FUNCTION native_history_fail_insert()',
      );
      try {
        expect((await compensate(id, source.input.operationId, 'undo', input)).status).toBe(500);
        expect(await state(id)).toEqual(before);
      } finally {
        await pool.query('DROP TRIGGER native_history_fail_insert ON sync_operations');
        await pool.query('DROP FUNCTION native_history_fail_insert()');
      }
    });

    it('does not include personal state in ledger read or compensation', async () => {
      const id = await seed(),
        source = await acceptedEdit(id, (doc) => {
          doc.tables![0]!.logical.name = 'Edit';
        });
      await pool.query(
        'INSERT INTO project_personal_states (project_id,user_id,version,state) VALUES ($1,$2,7,$3::jsonb)',
        [
          id,
          ownerId,
          JSON.stringify({ notes: [{ id: 'private', text: 'PRIVATE-HISTORY-SECRET' }] }),
        ],
      );
      const before = (
        await pool.query('SELECT * FROM project_personal_states WHERE project_id=$1', [id])
      ).rows;
      expect(JSON.stringify((await request(id, 'native-history')).data)).not.toContain(
        'PRIVATE-HISTORY-SECRET',
      );
      expect(
        (await compensate(id, source.input.operationId, 'undo', await commandInput(id))).status,
      ).toBe(201);
      expect(
        (await pool.query('SELECT * FROM project_personal_states WHERE project_id=$1', [id])).rows,
      ).toEqual(before);
    });

    it('remaps trusted PostgreSQL ENUM and generated expression references while retaining literal and label text', async () => {
      const doc = fixture();
      doc.tableRelations = [];
      doc.layout.relations = [];
      doc.enums = [{ id: 'enum', name: 'State', schema: 'public', values: ['a/~', 'middle'] }];
      doc.columns![0]!.physical.type = {
        kind: 'projectEnum',
        database: 'postgresql',
        enumId: 'enum',
      };
      doc.columns![1]!.physical.defaultValue = { kind: 'none' };
      doc.columns![1]!.physical.generation = {
        kind: 'computed',
        database: 'postgresql',
        storage: 'stored',
        expression: {
          kind: 'binary',
          operator: '+',
          left: { kind: 'column', columnId: 'last' },
          right: { kind: 'literal', literalType: 'number', value: '1' },
        },
      };
      const id = await seed(doc),
        source = await acceptedEdit(id, (doc) =>
          deleteNativeObjects(doc, [
            { collection: 'tables', id: 'table' },
            { collection: 'enums', id: 'enum' },
          ]),
        );
      const response = await compensate(
        id,
        source.input.operationId,
        'restore',
        await commandInput(id),
      );
      expect(response.status, JSON.stringify(response.data)).toBe(201);
      const saved = (await row(id)).document;
      expect(saved.enums[0].id).not.toBe('enum');
      expect(saved.enums[0].values).toEqual(['a/~', 'middle']);
      expect(saved.columns[0].physical.type.enumId).toBe(saved.enums[0].id);
      expect(saved.columns[1].physical.generation.expression.left.columnId).toBe(
        saved.columns[2].id,
      );
      expect(saved.columns[1].physical.generation.expression.right.value).toBe('1');
    });

    it('blocks unsafe legacy ENUM remap explicitly instead of changing legacy evidence', async () => {
      const doc = fixture('mysql');
      doc.tableRelations = [];
      doc.layout.relations = [];
      doc.enums = [{ id: 'enum', name: 'State', schema: 'public', values: ['a'] }];
      doc.columns![0]!.physical.type = {
        kind: 'legacy',
        source: 'document-v1',
        original: { name: 'enum', enumId: 'enum', isArray: false },
      };
      const id = await seed(doc),
        source = await acceptedEdit(id, (doc) =>
          deleteNativeObjects(doc, [
            { collection: 'tables', id: 'table' },
            { collection: 'enums', id: 'enum' },
          ]),
        );
      const input = await commandInput(id),
        before = await state(id);
      const rejected = await compensate(id, source.input.operationId, 'restore', input);
      expect(rejected.status, JSON.stringify(rejected.data)).toBe(422);
      expect(
        rejected.data.issues.some(
          (issue: { code: string }) => issue.code === 'document.enum-not-found',
        ),
      ).toBe(true);
      expect(await state(id)).toEqual(before);
    });

    it('checks sequence/version limits and merged restore document size without partial writes', async () => {
      const id = await seed(),
        source = await acceptedEdit(id, (doc) => {
          doc.tables![0]!.logical.name = 'Edit';
        });
      await pool.query('UPDATE projects SET version=2147483647 WHERE id=$1', [id]);
      const limitInput = await commandInput(id),
        limited = await state(id);
      expect(await compensate(id, source.input.operationId, 'undo', limitInput)).toMatchObject({
        status: 409,
        data: { code: 'sync.sequence-limit' },
      });
      expect(await state(id)).toEqual(limited);
      const large = migrateDesignDocumentV1(
        createEmptyDocument(),
        defaultDatabaseContext('postgresql'),
      ).document;
      large.notes = Array.from({ length: 74 }, (_, i) => ({
        id: `n${i}`,
        viewId: 'overview',
        text: 'x'.repeat(20000),
      }));
      const largeId = await seed(large);
      const deletion = await acceptedEdit(largeId, (doc) => {
        doc.notes = doc.notes.slice(1);
      });
      await acceptedEdit(
        largeId,
        (doc) => {
          doc.notes.push({ id: 'extra', viewId: 'overview', text: 'y'.repeat(20000) });
        },
        editorToken,
      );
      const input = await commandInput(largeId),
        before = await row(largeId);
      const rejected = await compensate(largeId, deletion.input.operationId, 'restore', input);
      expect(rejected).toMatchObject({ status: 409, data: { code: 'history.document-invalid' } });
      const after = await row(largeId);
      expect(after.version).toBe(before.version);
      expect(after.sync_sequence).toBe(before.sync_sequence);
      expect(createHash('sha256').update(JSON.stringify(after.document)).digest('hex')).toBe(
        createHash('sha256').update(JSON.stringify(before.document)).digest('hex'),
      );
      expect(
        (
          await pool.query(
            'SELECT COUNT(*) FROM sync_operations WHERE project_id=$1 AND operation_id=$2',
            [largeId, input.operationId],
          )
        ).rows[0].count,
      ).toBe('0');
    });

    it('restores only a proven virtual relation placement pair, while ordinary writes still reject the retired pair', async () => {
      const id = await seed(),
        source = await acceptedEdit(id, (doc) => {
          doc.layout.relations = [];
        });
      const input = await commandInput(id),
        restored = await compensate(id, source.input.operationId, 'restore', input);
      expect(restored.status, JSON.stringify(restored.data)).toBe(201);
      expect(restored.data.identityMap).toEqual([]);
      expect((await row(id)).document.layout.relations).toEqual(fixture().layout.relations);
      const deletion = await acceptedEdit(id, (doc) => {
        doc.layout.relations = [];
      });
      const ordinary = await edit(id, (doc) => {
        doc.layout.relations = structuredClone(fixture().layout.relations);
      });
      expect(ordinary.response.data).toMatchObject({
        status: 'rejected',
        reasonCode: 'sync.identity-retired',
      });
      expect((await row(id)).document.layout.relations).toEqual([]);
      expect(
        (await compensate(id, deletion.input.operationId, 'restore', await commandInput(id)))
          .status,
      ).toBe(201);
    });

    it('protects restored placement reference reads against later structural relationship edits', async () => {
      const id = await seed(),
        source = await acceptedEdit(id, (doc) => {
          doc.layout.relations = [];
        });
      await acceptedEdit(
        id,
        (doc) => {
          doc.tableRelations![0]!.physical = null;
          doc.tableRelations![0]!.scope = 'logical';
        },
        editorToken,
      );
      const input = await commandInput(id),
        before = await state(id);
      expect(await compensate(id, source.input.operationId, 'restore', input)).toMatchObject({
        status: 409,
        data: { code: 'history.field-conflict' },
      });
      expect(await state(id)).toEqual(before);
    });

    it('restores only deleted objects from a mixed bundle while undo compensates the complete bundle', async () => {
      for (const command of ['restore', 'undo']) {
        const id = await seed();
        const source = await acceptedEdit(id, (doc) => {
          const deleted = deleteNativeObjects(doc, [{ collection: 'columns', id: 'last' }]);
          deleted.tables!.find((table) => table.id === 'other')!.logical.name = 'Renamed in source';
          return deleted;
        });
        const response = await compensate(
          id,
          source.input.operationId,
          command,
          await commandInput(id),
        );
        expect(response.status, JSON.stringify(response.data)).toBe(201);
        const saved = (await row(id)).document;
        expect(
          saved.columns.map((column: { physical: { name: string } }) => column.physical.name),
        ).toEqual(['first', 'middle', 'last', 'external']);
        expect(
          saved.tables.find((table: { id: string }) => table.id === 'other').logical.name,
        ).toBe(command === 'restore' ? 'Renamed in source' : 'other');
      }
    });

    it('undoes only proven FK cleanup after a referenced-column deletion without relaxing existing-object legacy correction rules', async () => {
      const id = await seed();
      const source = await acceptedEdit(id, (doc) =>
        deleteNativeObjects(doc, [{ collection: 'columns', id: 'a/~' }]),
      );
      expect((await row(id)).document.tableRelations[0]).toMatchObject({
        scope: 'logical',
        physical: null,
      });
      const response = await compensate(
        id,
        source.input.operationId,
        'undo',
        await commandInput(id),
      );
      expect(response.status, JSON.stringify(response.data)).toBe(201);
      const saved = (await row(id)).document;
      const first = saved.columns.find(
        (column: { physical: { name: string } }) => column.physical.name === 'first',
      );
      expect(first.id).not.toBe('a/~');
      expect(saved.tableRelations[0]).toMatchObject({
        id: 'relation',
        scope: 'both',
        physical: { sourceColumnIds: ['external'], targetColumnIds: [first.id] },
      });
      expect(saved.keys[0].columnIds).toEqual([first.id]);
      expect(
        saved.columns.map((column: { physical: { name: string } }) => column.physical.name),
      ).toEqual(['first', 'middle', 'last', 'external']);
    });
  },
);
