import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  defaultDatabaseContext,
  migrateDesignDocumentV1,
  nativeReferenceProblems,
  type DatabaseKind,
  type DesignDocument,
} from '@ezerd/model';
import {
  nativeTransferImportResultSchema,
  versionedProjectTransferSchema,
} from '../../../packages/contracts/src/native-transfer.js';
import { importJsonSha256 } from '../src/shared/native-import-provenance.js';

function legacyDocument(): DesignDocument {
  const document = createEmptyDocument();
  document.domains = [{ id: 'domain', name: 'Domain', description: '' }];
  document.views = [{ id: 'view', name: 'Shared view', domainIds: ['domain'] }];
  document.notes = [{ id: 'note', viewId: 'view', text: 'Shared note' }];
  document.tables = ['parent', 'child'].map((id) => ({
    id,
    domainId: id === 'parent' ? 'domain' : null,
    scope: 'both',
    logical: { name: id, definition: '' },
    physical: { name: id, schema: 'public', comment: 'Original comment' },
    customProperties: { common: {}, logical: {}, physical: {} },
  }));
  document.columns = ['parent', 'child'].map((tableId) => ({
    id: tableId + '-column',
    tableId,
    scope: 'both',
    logical: { name: 'Id', definition: '', semanticType: '', required: false },
    physical: {
      name: 'id',
      type: { name: ' FLOAT4 ', isArray: false },
      nullable: false,
      defaultExpression: 'old_unverified()',
      comment: '',
    },
    customProperties: { common: {}, logical: {}, physical: {} },
  }));
  document.keys = [
    {
      id: 'key',
      tableId: 'parent',
      name: 'pk',
      kind: 'primary',
      columnIds: ['parent-column'],
      scope: 'both',
    },
  ];
  document.tableRelations = [
    {
      id: 'relation',
      sourceTableId: 'child',
      targetTableId: 'parent',
      scope: 'both',
      logical: { name: 'Parent', cardinality: 'one-to-many', required: false },
      physical: {
        name: 'fk',
        sourceColumnIds: ['child-column'],
        targetColumnIds: ['parent-column'],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
    },
  ];
  document.layout.nodes = [
    {
      id: 'domain-node',
      objectId: 'domain',
      viewId: 'overview',
      x: 20,
      y: 30,
      width: 240,
      height: 160,
    },
    { id: 'note-node', objectId: 'note', viewId: 'view', x: 41, y: 42, width: 240, height: 160 },
    ...['parent', 'child'].map((objectId, i) => ({
      id: objectId + '-node',
      objectId,
      viewId: '__tables__',
      x: i * 500 + 80,
      y: 90,
      width: 320,
      height: 260,
    })),
  ];
  document.layout.relations = [{ relationId: 'relation', viewId: '__tables__', offset: 20 }];
  document.layout.viewports.push({ viewId: 'view', x: 19, y: 23, zoom: 0.8 });
  return document;
}
function compact(document: unknown, kind: DatabaseKind = 'postgresql', version = 1) {
  return {
    format: 'ezerd-project',
    formatVersion: version,
    exportedAt: '2026-10-02T00:00:00.000Z',
    project: {
      name: 'Imported',
      databaseKind: kind,
      ...(version === 2 ? { databaseProfileId: defaultDatabaseContext(kind).profileId } : {}),
    },
    document,
  };
}

describe.runIf(process.env.EZERD_DB_TEST === '1')(
  'native project transfer REST and isolated storage',
  () => {
    let app: NestExpressApplication;
    let pool: pg.Pool;
    let base: string;
    let workspaceId: string;
    let ownerId: string;
    let ownerToken: string;
    let viewerToken: string;
    let editorToken: string;
    let outsiderToken: string;
    const userIds: string[] = [];
    const compiledRoot = process.env.NATIVE_TRANSFER_TEST_DIR ?? resolve('apps/server/dist');
    const load = (path: string) =>
      import(/* @vite-ignore */ pathToFileURL(resolve(compiledRoot, path)).href);
    const request = async (
      path: string,
      method = 'GET',
      body?: unknown,
      token: string | null = ownerToken,
    ) => {
      const response = await fetch(`${base}/api/projects${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: await response.json() };
    };
    const upload = (transfer: unknown, token = ownerToken) =>
      request('/native-transfer/import', 'POST', { workspaceId, transfer }, token);
    const row = async (id: string) =>
      (await pool.query('SELECT * FROM projects WHERE id=$1', [id])).rows[0];
    const seed = async (kind: DatabaseKind, document: unknown) => {
      const id = randomUUID();
      await pool.query(
        'INSERT INTO projects (id, workspace_id, name, database_kind, database_profile_id, database_revision, version, sync_sequence, document) VALUES ($1,$2,$3,$4,$5,3,7,11,$6::jsonb)',
        [
          id,
          workspaceId,
          'Raw source',
          kind,
          defaultDatabaseContext(kind).profileId,
          JSON.stringify(document),
        ],
      );
      return id;
    };
    const counts = async () =>
      (
        await pool.query(
          'SELECT (SELECT COUNT(*) FROM projects WHERE workspace_id=$1) AS projects, (SELECT COUNT(*) FROM workspace_audit_events WHERE workspace_id=$1) AS audits',
          [workspaceId],
        )
      ).rows[0];

    beforeAll(async () => {
      const configured = new URL(process.env.DATABASE_URL!);
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname) ||
        !/^\/ezerd_qa_/.test(configured.pathname)
      )
        throw new Error(
          'Run native transfer QA through scripts/test-isolated.ts against a disposable local DB.',
        );
      pool = new pg.Pool({ connectionString: configured.toString() });
      const [
        { DatabaseService },
        { WorkspaceAccessService },
        { SessionService },
        { RateLimitService },
        { NativeTransferService },
        { NativeTransferController },
      ] = await Promise.all([
        load('db/database.service.js'),
        load('workspace/workspace-access.service.js'),
        load('identity/session.js'),
        load('shared/rate-limit.service.js'),
        load('workspace/native-transfer.service.js'),
        load('workspace/native-transfer.controller.js'),
      ]);
      class TransferTestModule {}
      // Production classes, sessions, permissions and PostgreSQL transactions; no gate overrides.
      Module({
        controllers: [NativeTransferController],
        providers: [
          DatabaseService,
          WorkspaceAccessService,
          SessionService,
          RateLimitService,
          NativeTransferService,
        ],
      })(TransferTestModule);
      const testModule = process.env.NATIVE_TRANSFER_TEST_DIR
        ? TransferTestModule
        : (await load('app.module.js')).AppModule;
      app = await NestFactory.create<NestExpressApplication>(testModule, {
        logger: false,
        bodyParser: false,
      });
      if (process.env.NATIVE_TRANSFER_TEST_DIR) {
        app.setGlobalPrefix('api');
        app.useBodyParser('json', { limit: '8mb' });
      } else (await load('application.js')).configureApplication(app);
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      const actor = async (role?: string) => {
        const id = randomUUID(),
          token = 'a' + randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
        await pool.query('INSERT INTO users (id, username, pin_hash) VALUES ($1,$2,$3)', [
          id,
          'transfer-' + id.slice(0, 20),
          createHash('sha256').update('0024').digest('hex'),
        ]);
        userIds.push(id);
        await pool.query(
          "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1,$2,NOW()+INTERVAL '1 day')",
          [id, createHash('sha256').update(token).digest('hex')],
        );
        if (role)
          await pool.query(
            'INSERT INTO user_workspaces (workspace_id, user_id, role) VALUES ($1,$2,$3)',
            [workspaceId, id, role],
          );
        return { id, token };
      };
      workspaceId = randomUUID();
      await pool.query('INSERT INTO workspace (workspace_id, workspace_name) VALUES ($1,$2)', [
        workspaceId,
        'Native transfer QA',
      ]);
      const owner = await actor('owner');
      ownerId = owner.id;
      ownerToken = owner.token;
      viewerToken = (await actor('viewer')).token;
      editorToken = (await actor('editor')).token;
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
      'exports %s raw v1 snapshot, source coordinates and complete shared design without personal state',
      async (kind) => {
        const source = legacyDocument(),
          id = await seed(kind, source);
        await pool.query(
          'INSERT INTO project_personal_states (project_id,user_id,state) VALUES ($1,$2,$3::jsonb)',
          [id, ownerId, JSON.stringify({ notes: [{ id: 'private', text: 'PRIVATE-SECRET' }] })],
        );
        const before = await row(id);
        const response = await request(`/${id}/native-transfer`);
        expect(response.status).toBe(200);
        const output = versionedProjectTransferSchema.parse(response.data);
        expect(output.source).toEqual({
          projectId: id,
          version: 7,
          sequence: 11,
          databaseRevision: 3,
        });
        expect(output.project).toMatchObject({
          databaseKind: kind,
          databaseProfileId: defaultDatabaseContext(kind).profileId,
        });
        expect(output.sourceDocument).toEqual(source);
        expect(output.native.status).toBe('available');
        expect(JSON.stringify(output)).not.toContain('PRIVATE-SECRET');
        expect(await row(id)).toEqual(before);
        const imported = await upload(output);
        expect(imported.status).toBe(201);
        expect(imported.data.project.id).not.toBe(id);
        expect(imported.data).toMatchObject({
          sequence: 0,
          project: { status: 'active', version: 0, databaseRevision: 0 },
        });
        expect(
          (
            await pool.query('SELECT COUNT(*) FROM project_personal_states WHERE project_id=$1', [
              imported.data.project.id,
            ])
          ).rows[0].count,
        ).toBe('0');
      },
    );

    it.each(['postgresql', 'mysql', 'sqlite'] as const)(
      'imports %s v1 with server-derived previous, remapped ownership/FK/layout and preserved legacy evidence',
      async (kind) => {
        const source = legacyDocument(),
          response = await upload(compact(source, kind));
        expect(response.status).toBe(201);
        expect(nativeTransferImportResultSchema.safeParse(response.data).success).toBe(true);
        const saved = (await row(response.data.project.id)).document;
        const parent = saved.tables.find(
          (table: { physical: { name: string } }) => table.physical.name === 'parent',
        );
        const child = saved.tables.find(
          (table: { physical: { name: string } }) => table.physical.name === 'child',
        );
        expect(parent.id).not.toBe('parent');
        expect(parent.domainId).toBe(saved.domains[0].id);
        expect(child.domainId).toBeNull();
        expect(saved.keys[0].tableId).toBe(parent.id);
        const parentColumn = saved.columns.find(
          (column: { tableId: string }) => column.tableId === parent.id,
        );
        const childColumn = saved.columns.find(
          (column: { tableId: string }) => column.tableId === child.id,
        );
        expect(saved.keys[0].columnIds).toEqual([parentColumn.id]);
        expect(saved.tableRelations[0]).toMatchObject({
          sourceTableId: child.id,
          targetTableId: parent.id,
          physical: { sourceColumnIds: [childColumn.id], targetColumnIds: [parentColumn.id] },
        });
        expect(saved.layout.relations[0].relationId).toBe(saved.tableRelations[0].id);
        expect(
          saved.layout.nodes.find((node: { objectId: string }) => node.objectId === child.id),
        ).toMatchObject({ x: 580, y: 90, width: 320, height: 260 });
        expect(saved.views[0].domainIds).toEqual([saved.domains[0].id]);
        expect(saved.notes[0].viewId).toBe(saved.views[0].id);
        expect(parentColumn.physical.defaultValue.original).toBe('old_unverified()');
        if (kind !== 'postgresql') {
          expect(parentColumn.physical.type).toEqual({
            kind: 'legacy',
            source: 'document-v1',
            original: source.columns![0]!.physical.type,
          });
          expect(parent.physical.namespace).toEqual({
            kind: 'legacyNamespace',
            source: 'document-v1',
            original: 'public',
          });
          expect(
            response.data.migrationIssues.some(
              (issue: { code: string }) => issue.code === 'legacy.type-unresolved',
            ),
          ).toBe(true);
        }
        expect(
          response.data.migrationIssues.every((issue: { objectId: string; path: string }) =>
            issue.path.includes(issue.objectId),
          ),
        ).toBe(true);
        for (const table of [
          'sync_client_baselines',
          'sync_operations',
          'sync_field_versions',
          'project_personal_states',
        ])
          expect(
            (
              await pool.query(`SELECT COUNT(*) FROM ${table} WHERE project_id=$1`, [
                response.data.project.id,
              ])
            ).rows[0].count,
          ).toBe('0');
      },
    );

    it.each(['postgresql', 'mysql', 'sqlite'] as const)(
      'allows %s empty native v2 roundtrip without activating new types',
      async (kind) => {
        const document = migrateDesignDocumentV1(
          createEmptyDocument(),
          defaultDatabaseContext(kind),
        ).document;
        const imported = await upload(compact(document, kind, 2));
        expect(imported.status).toBe(201);
        const output = await request(`/${imported.data.project.id}/native-transfer`);
        expect(output.data.sourceDocument).toEqual(document);
        expect((await upload(output.data)).status).toBe(201);
      },
    );

    it('remaps native logical indexes/CHECK AST and include references without changing literal text', async () => {
      const document = migrateDesignDocumentV1(
        legacyDocument(),
        defaultDatabaseContext('postgresql'),
      ).document;
      for (const item of [
        ...document.tables!,
        ...document.columns!,
        ...document.keys!,
        ...document.tableRelations!,
      ])
        item.scope = 'logical';
      for (const column of document.columns!) column.physical.defaultValue = { kind: 'none' };
      for (const relation of document.tableRelations!) relation.physical = null;
      document.indexes = [
        {
          id: 'index',
          tableId: 'parent',
          name: 'idx',
          scope: 'logical',
          unique: false,
          parts: [{ direction: 'asc', expression: { kind: 'column', columnId: 'parent-column' } }],
          options: { database: 'postgresql', method: 'btree', includeColumnIds: ['parent-column'] },
        },
      ];
      document.checks = [
        {
          id: 'check',
          tableId: 'parent',
          name: 'check',
          scope: 'logical',
          expression: {
            kind: 'binary',
            operator: '=',
            left: { kind: 'column', columnId: 'parent-column' },
            right: { kind: 'literal', literalType: 'string', value: 'parent-column' },
          },
        },
      ];
      const imported = await upload(compact(document, 'postgresql', 2));
      expect(imported.status, JSON.stringify(imported.data)).toBe(201);
      const saved = (await row(imported.data.project.id)).document;
      expect(saved.indexes[0].parts[0].expression.columnId).toBe(saved.columns[0].id);
      expect(saved.indexes[0].options.includeColumnIds).toEqual([saved.columns[0].id]);
      expect(saved.checks[0].expression.left.columnId).toBe(saved.columns[0].id);
      expect(saved.checks[0].expression.right.value).toBe('parent-column');
      expect(
        (await request(`/${imported.data.project.id}/native-transfer`)).data.sourceDocument,
      ).toEqual(saved);
    });

    it('remaps PostgreSQL enum references only through server-derived v1 recovery', async () => {
      const document = legacyDocument();
      document.enums = [{ id: 'enum', name: 'State', schema: 'public', values: ['parent-column'] }];
      document.columns![0]!.physical.type = { name: 'enum', enumId: 'enum', isArray: false };
      const imported = await upload(compact(document));
      expect(imported.status).toBe(201);
      const saved = (await row(imported.data.project.id)).document;
      expect(saved.enums[0].id).not.toBe('enum');
      expect(saved.enums[0].values).toEqual(['parent-column']);
      expect(saved.columns[0].physical.type.enumId).toBe(saved.enums[0].id);
      const exported = await request(`/${imported.data.project.id}/native-transfer`);
      expect(exported.data.sourceDocument).toEqual(saved);
      expect((await upload(exported.data)).status).toBe(422);
    });

    it('exports unsupported physical objects raw, but still blocks unverified native features after legacy validation', async () => {
      const document = migrateDesignDocumentV1(
        legacyDocument(),
        defaultDatabaseContext('mysql'),
      ).document;
      document.checks = [
        {
          id: 'check',
          tableId: 'parent',
          name: 'check',
          scope: 'both',
          expression: { kind: 'column', columnId: 'parent-column' },
        },
      ];
      document.indexes = [
        {
          id: 'index',
          tableId: 'parent',
          name: 'index',
          scope: 'both',
          unique: false,
          parts: [{ direction: 'asc', expression: { kind: 'column', columnId: 'parent-column' } }],
          options: { database: 'mysql', kind: 'btree' },
        },
      ];
      const id = await seed('mysql', document),
        before = await row(id);
      const exported = await request(`/${id}/native-transfer`);
      expect(exported.status).toBe(200);
      expect(exported.data.sourceDocument).toEqual(document);
      const count = await counts();
      const denied = await upload(exported.data);
      expect(denied).toMatchObject({ status: 422, data: { code: 'database.validation-failed' } });
      expect(
        denied.data.issues.some(
          (issue: { code: string; params?: { feature?: string } }) =>
            issue.code === 'feature.not-implemented' &&
            ['index', 'check'].includes(issue.params?.feature ?? ''),
        ),
      ).toBe(true);
      expect(
        denied.data.issues.some(
          (issue: { code: string }) => issue.code === 'legacy.source-not-trusted',
        ),
      ).toBe(false);
      expect(await counts()).toEqual(count);
      expect(await row(id)).toEqual(before);
    });

    it('rejects a fresh native physical type using current gate coverage, regardless of supplied source metadata', async () => {
      const legacy = legacyDocument();
      for (const column of legacy.columns!) column.physical.defaultExpression = '';
      const document = migrateDesignDocumentV1(
        legacy,
        defaultDatabaseContext('postgresql'),
      ).document;
      const id = await seed('postgresql', document);
      const exported = await request(`/${id}/native-transfer`);
      const count = await counts();
      const denied = await upload(exported.data);
      expect(denied.status).toBe(422);
      expect(
        denied.data.issues.some((issue: { code: string }) => issue.code === 'type.not-implemented'),
      ).toBe(true);
      expect(await counts()).toEqual(count);
    });

    it('rejects tampered preview, native context mismatch and malformed graph before any insertion', async () => {
      const id = await seed('postgresql', legacyDocument());
      const exported = (await request(`/${id}/native-transfer`)).data;
      exported.native.document.tables[0].physical.name = 'forged';
      const count = await counts();
      expect(await upload(exported)).toMatchObject({
        status: 422,
        data: { code: 'project-transfer.preview-mismatch' },
      });
      const bad = legacyDocument();
      bad.columns![0]!.tableId = 'missing';
      expect(await upload(compact(bad))).toMatchObject({
        status: 422,
        data: { code: 'project-transfer.graph-invalid' },
      });
      const native = migrateDesignDocumentV1(
        createEmptyDocument(),
        defaultDatabaseContext('mysql'),
      ).document;
      expect((await upload(compact(native, 'postgresql', 2))).status).toBe(400);
      expect(await counts()).toEqual(count);
    });

    it('imports legacy ENUM evidence with matching graph IDs inside an independent new project namespace', async () => {
      const document = legacyDocument();
      document.enums = [{ id: 'legacy-enum', name: 'Status', schema: 'public', values: ['a'] }];
      document.columns![0]!.physical.type = { name: 'enum', enumId: 'legacy-enum', isArray: false };
      const id = await seed('mysql', document);
      const before = await row(id);
      expect((await request(`/${id}/native-transfer`)).data.sourceDocument).toEqual(document);
      const count = await counts();
      const file = compact(document, 'mysql'),
        imported = await upload(file);
      expect(imported.status, JSON.stringify(imported.data)).toBe(201);
      const saved = await row(imported.data.project.id);
      expect(saved.id).not.toBe(id);
      expect(saved).toMatchObject({
        workspace_id: workspaceId,
        version: 0,
        sync_sequence: 0,
        database_revision: 0,
        status: 'active',
      });
      expect(saved.document).toEqual(
        migrateDesignDocumentV1(document, defaultDatabaseContext('mysql')).document,
      );
      expect(nativeReferenceProblems(saved.document)).toEqual([]);
      expect(saved.document.columns[0].physical.type.original).toEqual(
        document.columns![0]!.physical.type,
      );
      expect(saved.document.enums[0].id).toBe(
        saved.document.columns[0].physical.type.original.enumId,
      );
      expect(saved.document.enums[0].values).toEqual(document.enums![0]!.values);
      expect(saved.document.layout).toEqual(document.layout);
      const audit = (
        await pool.query(
          "SELECT details FROM workspace_audit_events WHERE workspace_id=$1 AND action='project.imported' AND details->>'projectId'=$2",
          [workspaceId, saved.id],
        )
      ).rows[0].details.importProvenance;
      expect(audit).toMatchObject({
        authority: 'server-v1-migration',
        mappingPolicy: 'preserve-source-project-namespace',
        targetProjectId: saved.id,
        hashEncoding: 'canonical-json-utf8',
      });
      expect(audit.sourceDocument).toEqual(document);
      expect(audit.sourceDocumentSha256).toBe(importJsonSha256(document));
      expect(audit.transferSha256).toBe(importJsonSha256(file));
      expect(audit.identityMappingSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(await counts()).toEqual({
        projects: String(Number(count.projects) + 1),
        audits: String(Number(count.audits) + 1),
      });
      expect(await row(id)).toEqual(before);
    });

    it('enforces session, project read, createProject and active workspace permissions', async () => {
      const id = await seed('postgresql', createEmptyDocument());
      expect((await request(`/${id}/native-transfer`, 'GET', undefined, null)).status).toBe(401);
      expect(
        (await request(`/${id}/native-transfer`, 'GET', undefined, outsiderToken)).status,
      ).toBe(403);
      expect((await request(`/${id}/native-transfer`, 'GET', undefined, viewerToken)).status).toBe(
        200,
      );
      expect((await request('/bad-id/native-transfer')).status).toBe(400);
      expect((await request(`/${randomUUID()}/native-transfer`)).status).toBe(404);
      const empty = compact(createEmptyDocument());
      expect((await upload(empty, viewerToken)).status).toBe(403);
      expect((await upload(empty, outsiderToken)).status).toBe(403);
      expect((await upload(empty, editorToken)).status).toBe(201);
      await pool.query("UPDATE projects SET status='archived' WHERE id=$1", [id]);
      expect((await request(`/${id}/native-transfer`)).status).toBe(200);
      await pool.query("UPDATE workspace SET status='archived' WHERE workspace_id=$1", [
        workspaceId,
      ]);
      try {
        const count = await counts();
        expect((await upload(empty)).status).toBe(403);
        expect(await counts()).toEqual(count);
        expect((await request(`/${id}/native-transfer`)).status).toBe(200);
      } finally {
        await pool.query("UPDATE workspace SET status='active' WHERE workspace_id=$1", [
          workspaceId,
        ]);
      }
    });

    it('rolls back the new project when the real audit insertion fails', async () => {
      await pool.query(
        `CREATE FUNCTION native_transfer_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.workspace_id = '${workspaceId}'::uuid AND NEW.action = 'project.imported' THEN RAISE EXCEPTION 'transfer QA audit failure'; END IF; RETURN NEW; END $$`,
      );
      await pool.query(
        'CREATE TRIGGER native_transfer_fail_audit BEFORE INSERT ON workspace_audit_events FOR EACH ROW EXECUTE FUNCTION native_transfer_fail_audit()',
      );
      try {
        const count = await counts();
        expect(await upload(compact(createEmptyDocument()))).toMatchObject({
          status: 503,
          data: { code: 'project-transfer.storage-unavailable' },
        });
        expect(await counts()).toEqual(count);
      } finally {
        await pool.query('DROP TRIGGER native_transfer_fail_audit ON workspace_audit_events');
        await pool.query('DROP FUNCTION native_transfer_fail_audit()');
      }
    });

    it('reads document/context/counters from one MVCC snapshot during an uncommitted concurrent update', async () => {
      const before = legacyDocument(),
        id = await seed('postgresql', before);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const after = createEmptyDocument();
        await client.query(
          'UPDATE projects SET database_kind=$2,database_profile_id=$3,database_revision=4,version=8,sync_sequence=12,document=$4::jsonb WHERE id=$1',
          [id, 'mysql', defaultDatabaseContext('mysql').profileId, JSON.stringify(after)],
        );
        const old = await request(`/${id}/native-transfer`);
        expect(old.data).toMatchObject({
          source: { version: 7, sequence: 11, databaseRevision: 3 },
          project: { databaseKind: 'postgresql' },
          sourceDocument: before,
        });
        await client.query('COMMIT');
        const current = await request(`/${id}/native-transfer`);
        expect(current.data).toMatchObject({
          source: { version: 8, sequence: 12, databaseRevision: 4 },
          project: { databaseKind: 'mysql' },
          sourceDocument: after,
        });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('bounds document and transfer envelopes, including remap growth, without creating a partial project', async () => {
      const oversized = createEmptyDocument();
      oversized.notes = Array.from({ length: 76 }, (_, i) => ({
        id: `n${i}`,
        viewId: 'overview',
        text: 'x'.repeat(20000),
      }));
      const count = await counts();
      expect((await upload(compact(oversized))).status).toBe(400);
      const growth = createEmptyDocument();
      growth.notes = Array.from({ length: 74 }, (_, i) => ({
        id: `n${i}`,
        viewId: 'overview',
        text: 'x'.repeat(20000),
      }));
      const padding = 1_499_000 - Buffer.byteLength(JSON.stringify(growth), 'utf8');
      growth.notes.push({ id: 'pad', viewId: 'overview', text: 'x'.repeat(padding - 50) });
      const denied = await upload(compact(growth));
      expect(denied).toMatchObject({
        status: 422,
        data: { code: 'project-transfer.document-invalid' },
      });
      const doubled = createEmptyDocument();
      doubled.notes = oversized.notes.slice(0, 55);
      const id = await seed('postgresql', doubled);
      expect(await request(`/${id}/native-transfer`)).toMatchObject({
        status: 422,
        data: { code: 'project-transfer.export-invalid' },
      });
      const expected = { ...count, projects: String(Number(count.projects) + 1) };
      expect(await counts()).toEqual(expected);
    });
  },
);
