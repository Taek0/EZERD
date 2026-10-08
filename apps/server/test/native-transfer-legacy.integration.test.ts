import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  createNativeColumn,
  defaultDatabaseContext,
  deriveOperationChanges,
  type DatabaseKind,
  type DesignDocument,
} from '@ezerd/model';
import { importJsonSha256 } from '../src/shared/native-import-provenance.js';

const kinds: DatabaseKind[] = ['postgresql', 'mysql', 'sqlite'];
type Outcome = { status: number; data: any };
type Actor = { id: string; token: string };
function fixture(): DesignDocument {
  const doc = createEmptyDocument();
  doc.domains = [{ id: 'domain', name: 'Domain', description: ' original ' }];
  doc.views = [{ id: 'view', name: 'Shared', domainIds: ['domain'] }];
  doc.notes = [{ id: 'note', viewId: 'view', text: ' raw shared text ' }];
  doc.tables = [
    {
      id: 'table',
      domainId: 'domain',
      scope: 'both',
      logical: { name: 'Table', definition: '' },
      physical: { name: 'legacy_table', schema: ' Legacy_NS ', comment: ' raw comment ' },
      customProperties: { common: { token: 'enum/~' }, logical: {}, physical: {} },
    },
  ];
  doc.columns = [
    {
      id: 'column',
      tableId: 'table',
      scope: 'both',
      logical: { name: 'Status', definition: '', semanticType: '', required: false },
      physical: {
        name: 'status',
        type: { name: ' ENUM RAW ', enumId: 'enum/~', length: 16, isArray: false },
        nullable: true,
        defaultExpression: "  unknown('enum/~')  ",
        comment: ' original ',
      },
      customProperties: { common: {}, logical: {}, physical: {} },
    },
  ];
  doc.enums = [
    {
      id: 'enum/~',
      name: 'LegacyStatus',
      schema: 'public',
      values: [' alpha ', "β'\\token", 'enum/~'],
    },
  ];
  doc.layout.nodes = [
    {
      id: 'domain-node',
      objectId: 'domain',
      viewId: 'overview',
      x: 10,
      y: 11,
      width: 240,
      height: 160,
    },
    {
      id: 'table-node',
      objectId: 'table',
      viewId: '__tables__',
      x: 40,
      y: 41,
      width: 320,
      height: 260,
    },
    {
      id: 'shared-node',
      objectId: 'table',
      viewId: 'view',
      x: 100,
      y: 101,
      width: 320,
      height: 260,
    },
    { id: 'note-node', objectId: 'note', viewId: 'view', x: 140, y: 141, width: 240, height: 160 },
  ];
  doc.layout.viewports.push({ viewId: 'view', x: 13, y: 14, zoom: 0.8 });
  return doc;
}
const transfer = (document: unknown, kind: DatabaseKind, version = 1) => ({
  format: 'ezerd-project',
  formatVersion: version,
  exportedAt: '2026-10-02T00:00:00.000Z',
  project: {
    name: 'Legacy import',
    databaseKind: kind,
    ...(version === 2 ? { databaseProfileId: defaultDatabaseContext(kind).profileId } : {}),
  },
  document,
});

describe.runIf(process.env.EZERD_DB_TEST === '1')(
  'actual AppModule validated native legacy import',
  () => {
    let app: NestExpressApplication, pool: pg.Pool, base: string, workspaceId: string;
    let owner: Actor, editor: Actor, viewer: Actor, outsider: Actor;
    const userIds: string[] = [],
      requireCompiled = createRequire(import.meta.url);
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
    const upload = (file: unknown, actor: Actor | null = owner) =>
      request('/projects/native-transfer/import', 'POST', { workspaceId, transfer: file }, actor);
    const row = async (id: string) =>
      (await pool.query('SELECT * FROM projects WHERE id=$1', [id])).rows[0];
    const counts = async () =>
      (
        await pool.query(
          'SELECT (SELECT count(*)::int FROM projects WHERE workspace_id=$1) AS projects,(SELECT count(*)::int FROM workspace_audit_events WHERE workspace_id=$1) AS audits',
          [workspaceId],
        )
      ).rows[0];
    const imported = async (kind: DatabaseKind) => {
      const original = fixture(),
        file = transfer(original, kind),
        result = await upload(file);
      expect(result.status, JSON.stringify(result.data)).toBe(201);
      return { id: result.data.project.id as string, original, file, result: result.data };
    };
    const exported = async (id: string) => {
      const result = await request(`/projects/${id}/native-transfer`);
      expect(result.status, JSON.stringify(result.data)).toBe(200);
      return result.data;
    };
    const audit = async (id: string) =>
      (
        await pool.query(
          "SELECT details FROM workspace_audit_events WHERE workspace_id=$1 AND action='project.imported' AND details->>'projectId'=$2",
          [workspaceId, id],
        )
      ).rows[0].details.importProvenance;
    const projectState = async (id: string) => ({
      project: await row(id),
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
    const baseline = async (id: string) => {
      const clientId = randomUUID(),
        result = await request(`/projects/${id}/native-sync/baseline`, 'POST', { clientId });
      expect(result.status, JSON.stringify(result.data)).toBe(201);
      return { ...result.data, clientId };
    };
    const deleteLegacy = async (id: string, removeEnum: boolean) => {
      const issued = await baseline(id),
        document = structuredClone(issued.document);
      document.columns = [];
      if (removeEnum) document.enums = [];
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
      const result = await request(`/projects/${id}/native-sync/operations`, 'POST', input);
      expect(result.status, JSON.stringify(result.data)).toBe(201);
      expect(result.data.status, JSON.stringify(result.data)).toBe('accepted');
      return input.operationId;
    };
    const restore = async (id: string, source: string) => {
      const issued = await baseline(id),
        input = {
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
      const before = await projectState(id),
        result = await request(`/projects/${id}/native-history/${source}/restore`, 'POST', input);
      return { before, result };
    };

    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        !url.pathname.startsWith('/ezerd_qa_')
      )
        throw new Error('Disposable local isolated DB required');
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
      const actor = async (): Promise<Actor> => {
        const created = await request(
          '/users',
          'POST',
          { username: 'legacy-' + randomUUID().slice(0, 20), pin: '0024' },
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
      const workspace = await request('/workspaces', 'POST', { name: 'Native legacy import QA' });
      expect(workspace.status).toBe(201);
      workspaceId = workspace.data.id;
      await pool.query(
        "INSERT INTO user_workspaces (workspace_id,user_id,role) VALUES ($1,$2,'editor'),($1,$3,'viewer')",
        [workspaceId, editor.id, viewer.id],
      );
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

    it.each(kinds)(
      '%s compatibility import creates a Native project with exact raw audit evidence',
      async (kind) => {
        const original = transfer(fixture(), kind),
          before = structuredClone(original);
        const result = await request('/projects/import', 'POST', {
          workspaceId,
          transfer: original,
        });
        expect(result.status).toBe(201);
        const saved = await row(result.data.id);
        expect(saved.document.schemaVersion).toBe(2);
        expect(saved.document.database.kind).toBe(kind);
        const state = await request(`/projects/${result.data.id}/document-state`);
        expect(state.status).toBe(200);
        expect(state.data.sourceDocument).toEqual(saved.document);
        const evidence = (
          await pool.query(
            "SELECT details FROM workspace_audit_events WHERE workspace_id=$1 AND details->>'projectId'=$2",
            [workspaceId, result.data.id],
          )
        ).rows[0].details;
        expect(evidence.importProvenance.sourceDocument).toEqual(original.document);
        expect(original).toEqual(before);
      },
    );
    it.each(kinds)(
      '%s v1 legacy ENUM imports and native2 roundtrips in a new project namespace with exact raw evidence',
      async (kind) => {
        const source = await imported(kind),
          first = await row(source.id),
          file = await exported(source.id),
          uploaded = await upload(file);
        expect(uploaded.status, JSON.stringify(uploaded.data)).toBe(201);
        const second = await row(uploaded.data.project.id);
        expect(second.id).not.toBe(first.id);
        expect(second.document).toEqual(first.document);
        expect(second.version).toBe(0);
        expect(second.sync_sequence).toBe(0);
        expect(second.database_revision).toBe(0);
        expect(second.status).toBe('active');
        expect(second.document.columns[0].id).toBe('column');
        expect(second.document.enums[0].id).toBe('enum/~');
        expect(second.document.columns[0].physical.type.original).toEqual(
          source.original.columns![0]!.physical.type,
        );
        expect(second.document.columns[0].physical.defaultValue.original).toBe(
          source.original.columns![0]!.physical.defaultExpression,
        );
        expect(second.document.enums[0].values).toEqual(source.original.enums![0]!.values);
        expect(second.document.layout).toEqual(source.original.layout);
        const firstAudit = await audit(source.id),
          secondAudit = await audit(second.id);
        expect(firstAudit.authority).toBe('server-v1-migration');
        expect(firstAudit.sourceDocument).toEqual(source.original);
        expect(secondAudit.authority).toBe('validated-v1-legacy-mask');
        expect(secondAudit.sourceDocument).toEqual(first.document);
        expect(firstAudit.sourceDocumentSha256).toBe(importJsonSha256(firstAudit.sourceDocument));
        expect(secondAudit.sourceDocumentSha256).toBe(importJsonSha256(secondAudit.sourceDocument));
        expect(secondAudit.transferSha256).toBe(importJsonSha256(file));
        expect(secondAudit.mappingPolicy).toBe('preserve-source-project-namespace');
        expect(secondAudit.targetProjectId).toBe(second.id);
        expect(secondAudit.trustedLegacyPaths).toContain('/columns/column/physical/type');
        const state = await projectState(second.id);
        expect(state.ledger).toEqual([]);
        expect(state.baselines).toEqual([]);
        expect(state.versions).toEqual([]);
        expect(state.tombstones).toEqual([]);
        expect(await row(source.id)).toEqual(first);
      },
    );

    it.each(kinds)(
      '%s keeps fresh remapping for legacy documents without immutable enum references',
      async (kind) => {
        const document = fixture();
        document.enums = [];
        document.columns![0]!.physical.type = { name: ' UNRESOLVED ', isArray: false };
        const response = await upload(transfer(document, kind));
        expect(response.status).toBe(201);
        const saved = await row(response.data.project.id);
        expect(saved.document.columns[0].id).not.toBe('column');
        expect(saved.document.tables[0].id).not.toBe('table');
        expect(saved.document.columns[0].physical.type.original).toEqual(
          document.columns![0]!.physical.type,
        );
        expect((await audit(saved.id)).mappingPolicy).toBe('fresh-project-object-ids');
        const roundtrip = await upload(await exported(saved.id));
        expect(roundtrip.status, JSON.stringify(roundtrip.data)).toBe(201);
        expect((await row(roundtrip.data.project.id)).document.columns[0].id).not.toBe(
          saved.document.columns[0].id,
        );
      },
    );

    it('does not copy private state, project counters/status or client coordinates into a new import', async () => {
      const source = await imported('mysql');
      await pool.query(
        'INSERT INTO project_personal_states (project_id,user_id,state) VALUES ($1,$2,$3::jsonb)',
        [
          source.id,
          owner.id,
          JSON.stringify({
            views: [],
            notes: [{ id: 'private-note', viewId: 'overview', text: 'PRIVATE_TOKEN' }],
            nodes: [],
            viewports: [],
            relations: [],
          }),
        ],
      );
      await pool.query(
        "UPDATE projects SET status='archived',version=7,sync_sequence=11,database_revision=3 WHERE id=$1",
        [source.id],
      );
      const file = await exported(source.id);
      expect(JSON.stringify(file)).not.toContain('PRIVATE_TOKEN');
      const result = await upload(file);
      expect(result.status).toBe(201);
      const saved = await row(result.data.project.id);
      expect(saved).toMatchObject({
        status: 'active',
        version: 0,
        sync_sequence: 0,
        database_revision: 0,
      });
      expect(
        (await pool.query('SELECT * FROM project_personal_states WHERE project_id=$1', [saved.id]))
          .rows,
      ).toEqual([]);
      const before = await counts();
      expect((await upload({ ...file, personalState: { notes: [] } })).status).toBe(400);
      expect(await counts()).toEqual(before);
    });

    it.each(kinds)(
      '%s validates a standalone ENUM after its last legacy reference becomes a verified primitive',
      async (kind) => {
        const source = await imported(kind),
          file = await exported(source.id),
          doc = file.sourceDocument;
        doc.columns[0].physical.type = {
          kind: 'builtin',
          database: kind,
          typeId:
            kind === 'postgresql'
              ? 'postgresql:integer'
              : kind === 'mysql'
                ? 'mysql:int'
                : 'sqlite:text',
          parameters: {},
        };
        const before = await counts(),
          input = transfer(doc, kind, 2),
          result = await upload(input);
        if (kind === 'postgresql') {
          expect(result.status, JSON.stringify(result.data)).toBe(201);
          const saved = await row(result.data.project.id),
            provenance = await audit(saved.id);
          expect(saved.document.enums[0].values).toEqual(doc.enums[0].values);
          expect(saved.document.columns[0].physical).toEqual(doc.columns[0].physical);
          expect(provenance.sourceDocument).toEqual(doc);
          expect(provenance.transferSha256).toBe(importJsonSha256(input));
          expect(provenance.trustedLegacyPaths).not.toContain(
            `/columns/${saved.document.columns[0].id}/physical/type`,
          );
          expect(await counts()).toEqual({
            projects: before.projects + 1,
            audits: before.audits + 1,
          });
          const measured = await counts(),
            invalid = structuredClone(doc);
          invalid.enums[0].values.push(invalid.enums[0].values[0]);
          const denied = await upload(transfer(invalid, kind, 2));
          expect(denied.status, JSON.stringify(denied.data)).toBe(422);
          expect(denied.data.issues).toContainEqual(
            expect.objectContaining({ code: 'enum.values-invalid' }),
          );
          expect(await counts()).toEqual(measured);
        } else {
          expect(result.status, JSON.stringify(result.data)).toBe(422);
          expect(result.data.issues).toContainEqual(
            expect.objectContaining({ code: 'legacy.enum-context-mismatch' }),
          );
          expect(await counts()).toEqual(before);
        }
      },
    );

    it.each(kinds)(
      '%s imports verified basic types beside unchanged legacy origins with exact source/audit',
      async (kind) => {
        const source = await imported(kind),
          file = await exported(source.id),
          doc = file.sourceDocument;
        const column = createNativeColumn(
          defaultDatabaseContext(kind),
          doc.tables[0],
          'native-column',
        );
        column.scope = 'both';
        column.logical.name = 'Verified primitive';
        column.physical.name = 'verified_primitive';
        column.physical.comment = ' native raw comment ';
        column.physical.type =
          kind === 'postgresql'
            ? {
                kind: 'builtin',
                database: 'postgresql',
                typeId: 'postgresql:integer',
                parameters: {},
              }
            : kind === 'mysql'
              ? { kind: 'builtin', database: 'mysql', typeId: 'mysql:int', parameters: {} }
              : { kind: 'builtin', database: 'sqlite', typeId: 'sqlite:text', parameters: {} };
        doc.columns.push(column);
        const input = transfer(doc, kind, 2),
          before = await counts(),
          original = await row(source.id);
        const result = await upload(input);
        expect(result.status, JSON.stringify(result.data)).toBe(201);
        const saved = await row(result.data.project.id),
          provenance = await audit(saved.id);
        expect(saved.id).not.toBe(source.id);
        expect(saved.document).toEqual(doc);
        expect(saved).toMatchObject({
          version: 0,
          sync_sequence: 0,
          database_revision: 0,
          status: 'active',
        });
        expect(saved.document.columns.find((item: any) => item.id === column.id)).toEqual(column);
        expect(provenance.sourceDocument).toEqual(doc);
        expect(provenance.sourceDocumentSha256).toBe(importJsonSha256(doc));
        expect(provenance.transferSha256).toBe(importJsonSha256(input));
        expect(provenance.mappingPolicy).toBe('preserve-source-project-namespace');
        expect(provenance.trustedLegacyPaths).toContain('/columns/column/physical/type');
        expect(provenance.trustedLegacyPaths).not.toContain('/columns/native-column/physical/type');
        expect(await counts()).toEqual({
          projects: before.projects + 1,
          audits: before.audits + 1,
        });
        expect(await row(source.id)).toEqual(original);
      },
    );

    it.each(kinds)(
      '%s imports verified defaults beside legacy but rejects invalid default combinations without trusting previous',
      async (kind) => {
        const source = await imported(kind),
          doc = (await exported(source.id)).sourceDocument;
        const column = createNativeColumn(
          defaultDatabaseContext(kind),
          doc.tables[0],
          'default-column',
        );
        column.scope = 'both';
        column.physical.name = 'verified_default';
        column.physical.type =
          kind === 'postgresql'
            ? {
                kind: 'builtin',
                database: 'postgresql',
                typeId: 'postgresql:integer',
                parameters: {},
              }
            : kind === 'mysql'
              ? { kind: 'builtin', database: 'mysql', typeId: 'mysql:int', parameters: {} }
              : { kind: 'builtin', database: 'sqlite', typeId: 'sqlite:integer', parameters: {} };
        column.physical.defaultValue = { kind: 'literal', literalType: 'number', value: '1' };
        doc.columns.push(column);
        const before = await counts(),
          input = transfer(doc, kind, 2),
          accepted = await upload(input);
        expect(accepted.status, JSON.stringify(accepted.data)).toBe(201);
        const saved = await row(accepted.data.project.id),
          provenance = await audit(saved.id);
        expect(saved.document).toEqual(doc);
        expect(provenance.sourceDocument).toEqual(doc);
        expect(provenance.sourceDocumentSha256).toBe(importJsonSha256(doc));
        expect(provenance.transferSha256).toBe(importJsonSha256(input));
        expect(provenance.trustedLegacyPaths).not.toContain(
          '/columns/default-column/physical/defaultValue',
        );
        expect(await counts()).toEqual({
          projects: before.projects + 1,
          audits: before.audits + 1,
        });
        const measured = await counts(),
          invalid = structuredClone(doc);
        invalid.columns.find((item: any) => item.id === column.id).physical.nullable = false;
        invalid.columns.find((item: any) => item.id === column.id).physical.defaultValue = {
          kind: 'null',
        };
        const denied = await upload(transfer(invalid, kind, 2));
        expect(denied.status, JSON.stringify(denied.data)).toBe(422);
        expect(denied.data.issues).toContainEqual(
          expect.objectContaining({ code: 'default.null-not-supported' }),
        );
        expect(await counts()).toEqual(measured);
      },
    );

    it.each(['index', 'check', 'key', 'generation', 'table-options', 'without-rowid'] as const)(
      'validates added native %s independently of legacy provenance',
      async (feature) => {
        const source = await imported('sqlite'),
          doc = (await exported(source.id)).sourceDocument;
        if (feature === 'index')
          doc.indexes = [
            {
              id: 'idx',
              tableId: 'table',
              name: 'idx',
              scope: 'both',
              unique: false,
              parts: [{ direction: 'asc', expression: { kind: 'column', columnId: 'column' } }],
              options: { database: 'sqlite' },
            },
          ];
        if (feature === 'check')
          doc.checks = [
            {
              id: 'check',
              tableId: 'table',
              name: 'check',
              scope: 'both',
              expression: { kind: 'literal', literalType: 'boolean', value: true },
            },
          ];
        if (feature === 'key')
          doc.keys = [
            {
              id: 'key',
              tableId: 'table',
              name: 'key',
              kind: 'unique',
              scope: 'both',
              columnIds: ['column'],
            },
          ];
        if (feature === 'generation')
          doc.columns[0].physical.generation = {
            kind: 'computed',
            database: 'sqlite',
            storage: 'stored',
            expression: { kind: 'literal', literalType: 'number', value: '1' },
          };
        if (feature === 'table-options')
          doc.tables[0].physical.options = {
            database: 'sqlite',
            strict: true,
            withoutRowid: false,
          };
        if (feature === 'without-rowid')
          doc.tables[0].physical.options = {
            database: 'sqlite',
            strict: false,
            withoutRowid: true,
          };
        if (feature === 'check') {
          const input = transfer(doc, 'sqlite', 2),
            accepted = await upload(input);
          expect(accepted.status, JSON.stringify(accepted.data)).toBe(201);
          const saved = await row(accepted.data.project.id),
            provenance = await audit(saved.id);
          expect(saved.document).toEqual(doc);
          expect(provenance.sourceDocument).toEqual(doc);
          expect(provenance.trustedLegacyPaths).not.toContain('/checks/check');
          doc.checks[0].expression = { kind: 'literal', literalType: 'number', value: '1' };
        }
        const before = await counts(),
          denied = await upload(transfer(doc, 'sqlite', 2));
        expect(denied.status, JSON.stringify(denied.data)).toBe(422);
        const expectedCodes = {
          index: ['expression.column-type-not-supported'],
          check: ['expression.boolean-required'],
          key: ['legacy.type-unresolved'],
          generation: ['generation.default-not-supported', 'expression.target-type-not-supported'],
          'table-options': ['type.strict-not-supported'],
          'without-rowid': ['table.primary-key-required'],
        }[feature];
        for (const code of expectedCodes)
          expect(denied.data.issues, JSON.stringify(denied.data)).toContainEqual(
            expect.objectContaining({ code }),
          );
        if (feature === 'key')
          expect(denied.data.issues).toContainEqual(
            expect.objectContaining({
              objectId: 'key',
              path: '/keys/key/columnIds',
              code: 'legacy.type-unresolved',
            }),
          );
        expect(await counts()).toEqual(before);
      },
    );

    it('rejects dangling and changed legacy references, mismatched preview, fake known-type origin and wrong DB', async () => {
      const source = await imported('postgresql'),
        file = await exported(source.id),
        before = await counts();
      const dangling = structuredClone(file.sourceDocument);
      dangling.columns[0].physical.type.original.enumId = 'absent';
      expect(await upload(transfer(dangling, 'postgresql', 2))).toMatchObject({
        status: 422,
        data: { code: 'project-transfer.graph-invalid' },
      });
      const altered = structuredClone(file);
      altered.native.document.columns[0].physical.type.original.enumId = 'absent';
      expect(await upload(altered)).toMatchObject({
        status: 422,
        data: { code: 'project-transfer.preview-mismatch' },
      });
      const tagged = structuredClone(file.sourceDocument);
      tagged.columns[0].physical.type.original = { name: 'integer', isArray: false };
      const origin = await upload(transfer(tagged, 'postgresql', 2));
      expect(origin.status).toBe(422);
      expect(
        origin.data.issues.some((issue: any) => issue.code === 'legacy.source-not-trusted'),
      ).toBe(true);
      const namespace = structuredClone(file.sourceDocument);
      namespace.tables[0].physical.namespace = {
        kind: 'legacyNamespace',
        source: 'document-v1',
        original: 'public',
      };
      expect((await upload(transfer(namespace, 'postgresql', 2))).status).toBe(422);
      expect((await upload(transfer(file.sourceDocument, 'mysql', 2))).status).toBe(400);
      const wrongType = structuredClone(file.sourceDocument);
      wrongType.columns[0].physical.type = {
        kind: 'builtin',
        database: 'mysql',
        typeId: 'mysql:int',
        parameters: {},
      };
      const wrong = await upload(transfer(wrongType, 'postgresql', 2));
      expect(wrong.status).toBe(422);
      expect(wrong.data.issues.some((issue: any) => issue.code === 'type.not-supported')).toBe(
        true,
      );
      expect(await counts()).toEqual(before);
    });

    it('client source coordinates and empty diagnostics never trust an arbitrary native candidate', async () => {
      const source = await imported('postgresql'),
        file = await exported(source.id);
      const type = {
        kind: 'builtin',
        database: 'postgresql',
        typeId: 'postgresql:txid_snapshot',
        parameters: {},
      };
      file.sourceDocument.columns[0].physical.type = type;
      file.native.document.columns[0].physical.type = structuredClone(type);
      file.source = { projectId: source.id, version: 999, sequence: 999, databaseRevision: 999 };
      file.native.issues = [];
      file.native.migrationIssues = [];
      const before = await counts(),
        result = await upload(file);
      expect(result.status, JSON.stringify(result.data)).toBe(422);
      expect(
        result.data.issues.some((issue: any) => issue.code === 'type.not-implemented'),
        JSON.stringify(result.data),
      ).toBe(true);
      expect((await upload({ ...file, previous: file.sourceDocument })).status).toBe(400);
      expect(await counts()).toEqual(before);
      // A verified primitive and valid standalone PG ENUM pass; client coordinates remain audit only.
      const valid = structuredClone(file);
      valid.sourceDocument.columns[0].physical.type = {
        kind: 'builtin',
        database: 'postgresql',
        typeId: 'postgresql:integer',
        parameters: {},
      };
      valid.native.document = structuredClone(valid.sourceDocument);
      const accepted = await upload(valid);
      expect(accepted.status, JSON.stringify(accepted.data)).toBe(201);
      const saved = await row(accepted.data.project.id),
        provenance = await audit(saved.id);
      expect(saved.id).not.toBe(source.id);
      expect(saved).toMatchObject({
        version: 0,
        sync_sequence: 0,
        database_revision: 0,
        status: 'active',
      });
      expect(saved.document.columns[0].physical.type).toEqual(
        valid.sourceDocument.columns[0].physical.type,
      );
      expect(saved.document.enums[0].values).toEqual(valid.sourceDocument.enums[0].values);
      expect(provenance.sourceDocument).toEqual(valid.sourceDocument);
      expect(provenance.sourceDocumentSha256).toBe(importJsonSha256(valid.sourceDocument));
      expect(provenance.transferSha256).toBe(importJsonSha256(valid));
      expect(provenance.trustedLegacyPaths).not.toContain(
        `/columns/${saved.document.columns[0].id}/physical/type`,
      );
      const recorded = (
        await pool.query(
          "SELECT details FROM workspace_audit_events WHERE workspace_id=$1 AND action='project.imported' AND details->>'projectId'=$2",
          [workspaceId, saved.id],
        )
      ).rows[0].details;
      expect(recorded.source).toEqual(file.source);
      const measured = await counts();
      expect(measured).toEqual({ projects: before.projects + 1, audits: before.audits + 1 });
      const defaultClaim = structuredClone(valid);
      defaultClaim.sourceDocument.columns[0].physical.nullable = false;
      defaultClaim.native.document.columns[0].physical.nullable = false;
      defaultClaim.sourceDocument.columns[0].physical.defaultValue = { kind: 'null' };
      defaultClaim.native.document.columns[0].physical.defaultValue = structuredClone(
        defaultClaim.sourceDocument.columns[0].physical.defaultValue,
      );
      const blocked = await upload(defaultClaim);
      expect(blocked.status, JSON.stringify(blocked.data)).toBe(422);
      expect(
        blocked.data.issues.some((issue: any) => issue.code === 'default.null-not-supported'),
        JSON.stringify(blocked.data),
      ).toBe(true);
      expect(await counts()).toEqual(measured);
    });

    it('keeps canonical/new-name errors rather than copying them into legacy previous authority', async () => {
      const source = await imported('postgresql'),
        doc = (await exported(source.id)).sourceDocument,
        before = await counts();
      doc.columns[0].id = ' column ';
      expect(await upload(transfer(doc, 'postgresql', 2))).toMatchObject({
        status: 422,
        data: { code: 'project-transfer.native-canonical-required' },
      });
      doc.columns[0].id = 'column';
      doc.tables[0].physical.comment = 'bad\0comment';
      const bad = await upload(transfer(doc, 'postgresql', 2));
      expect(bad.status).toBe(422);
      expect(bad.data.issues.some((issue: any) => issue.code === 'comment.invalid')).toBe(true);
      expect(await counts()).toEqual(before);
    });

    it('preserves raw UTF-8 document/transfer budgets and authorization before creating any project', async () => {
      const before = await counts(),
        oversized = fixture();
      oversized.notes = Array.from({ length: 60 }, (_, i) => ({
        id: `n${i}`,
        viewId: 'overview',
        text: '가'.repeat(10000),
      }));
      expect((await upload(transfer(oversized, 'mysql'))).status).toBe(400);
      const source = await imported('mysql'),
        file = await exported(source.id),
        measured = await counts();
      file.sourceDocument.notes = Array.from({ length: 105 }, (_, i) => ({
        id: `n${i}`,
        viewId: 'overview',
        text: 'x'.repeat(10000),
      }));
      file.native.document.notes = structuredClone(file.sourceDocument.notes);
      expect((await upload(file)).status).toBe(400);
      expect(await counts()).toEqual(measured);
      const small = transfer(fixture(), 'mysql');
      expect((await upload(small, null)).status).toBe(401);
      expect((await upload(small, viewer)).status).toBe(403);
      expect((await upload(small, outsider)).status).toBe(403);
      expect((await upload(small, editor)).status).toBe(201);
      expect((await counts()).projects).toBe(before.projects + 2);
    });

    it('rechecks archived workspace after waiting for its createProject lock', async () => {
      const client = await pool.connect(),
        before = await counts();
      let inFlight: Promise<Outcome> | undefined;
      try {
        await client.query('BEGIN');
        await client.query('SELECT workspace_id FROM workspace WHERE workspace_id=$1 FOR UPDATE', [
          workspaceId,
        ]);
        inFlight = upload(transfer(fixture(), 'mysql'));
        await vi.waitFor(async () => {
          const waits = await pool.query(
            "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%workspace%' AND query ILIKE '%for update%'",
          );
          expect(waits.rows[0].count).toBeGreaterThan(0);
        });
        await client.query("UPDATE workspace SET status='archived' WHERE workspace_id=$1", [
          workspaceId,
        ]);
        await client.query('COMMIT');
        expect((await inFlight).status).toBe(403);
        expect(await counts()).toEqual(before);
      } finally {
        await client.query('ROLLBACK');
        client.release();
        if (inFlight) await inFlight;
        await pool.query("UPDATE workspace SET status='active' WHERE workspace_id=$1", [
          workspaceId,
        ]);
      }
    });

    it('rolls back the newly imported project if provenance audit insertion fails', async () => {
      const before = await counts(),
        client = await pool.connect();
      try {
        await client.query(
          `CREATE FUNCTION reject_legacy_import_qa() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.workspace_id = '${workspaceId}'::uuid AND NEW.action = 'project.imported' THEN RAISE EXCEPTION 'isolated import audit failure'; END IF; RETURN NEW; END $$`,
        );
        await client.query(
          'CREATE TRIGGER reject_legacy_import_qa BEFORE INSERT ON workspace_audit_events FOR EACH ROW EXECUTE FUNCTION reject_legacy_import_qa()',
        );
        const failed = await upload(transfer(fixture(), 'sqlite'));
        expect(failed.status).toBe(503);
        expect(await counts()).toEqual(before);
      } finally {
        await client.query(
          'DROP TRIGGER IF EXISTS reject_legacy_import_qa ON workspace_audit_events',
        );
        await client.query('DROP FUNCTION IF EXISTS reject_legacy_import_qa()');
        client.release();
      }
    });

    it.each(kinds)(
      '%s history can restore a legacy column when its original ENUM is still live',
      async (kind) => {
        const source = await imported(kind),
          before = await row(source.id),
          operationId = await deleteLegacy(source.id, false),
          restored = await restore(source.id, operationId);
        expect(restored.result.status, JSON.stringify(restored.result.data)).toBe(201);
        const document = restored.result.data.result.document;
        expect(document.columns[0].id).not.toBe(before.document.columns[0].id);
        expect(document.enums).toEqual(before.document.enums);
        expect(document.columns[0].physical.type).toEqual(before.document.columns[0].physical.type);
        expect(document.columns[0].physical.defaultValue).toEqual(
          before.document.columns[0].physical.defaultValue,
        );
      },
    );
    it.each(kinds)(
      '%s history explicitly blocks restoring a deleted ENUM with immutable legacy origins',
      async (kind) => {
        const source = await imported(kind),
          operationId = await deleteLegacy(source.id, true),
          restored = await restore(source.id, operationId);
        expect(restored.result).toMatchObject({
          status: 422,
          data: { code: 'history.legacy-enum-origin-remap-required' },
        });
        expect(await projectState(source.id)).toEqual(restored.before);
      },
    );
  },
);
