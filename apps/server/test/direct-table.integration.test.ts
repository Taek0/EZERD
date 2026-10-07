import { seedLegacyProject } from './legacy-project-fixture.js';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  TABLES_VIEW_ID,
  addDomain,
  addTable,
  addColumn,
  addNote,
  deriveOperationChanges,
  diagnoseDocument,
  exportPostgres,
  sharedDocument,
  updateTable,
  upsertKey,
  upsertTableRelation,
  addTableReference,
  updateNodeLayout,
  upsertRelationLayout,
  type DesignDocument,
  type Table,
  type Column,
} from '@ezerd/model';
import { readConfig } from '../src/config.js';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/application.js';

// Each run creates and removes only its own database; the configured database is read-only.
describe.runIf(process.env.EZERD_DIRECT_TABLE_DB_TEST === '1')(
  'direct table HTTP/PostgreSQL workflow',
  () => {
    const databaseName = `ezerd_direct_table_test_${randomUUID().replaceAll('-', '')}`;
    let app: NestExpressApplication | undefined;
    let admin: pg.Pool | undefined;
    let migrationPool: pg.Pool | undefined;
    let created = false;
    let base = '';
    let ownerToken = '';
    let viewerToken = '';
    let workspaceId = '';
    let projectId = '';
    let previousDatabaseUrl: string | undefined;

    async function request(path: string, method = 'GET', body?: unknown, token = ownerToken) {
      const response = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const raw = await response.text();
      return {
        status: response.status,
        data: response.headers.get('content-type')?.includes('json') ? JSON.parse(raw) : raw,
      };
    }

    beforeAll(async () => {
      const url = new URL(readConfig().DATABASE_URL);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
        throw new Error('A local verification database is required.');
      admin = new pg.Pool({ connectionString: url.toString(), connectionTimeoutMillis: 2000 });
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      created = true;
      url.pathname = `/${databaseName}`;
      previousDatabaseUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = url.toString();
      migrationPool = new pg.Pool({ connectionString: url.toString() });
      await migrate(drizzle(migrationPool), {
        migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
      });
      await migrationPool.end();
      migrationPool = undefined;
      app = await NestFactory.create<NestExpressApplication>(AppModule, {
        logger: false,
        bodyParser: false,
      });
      configureApplication(app);
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      const users = [];
      for (const role of ['owner', 'viewer']) {
        const username = `direct-${role}-${randomUUID().slice(0, 8)}`;
        const user = await request('/users', 'POST', { username, pin: '0012' }, '');
        expect(user.status).toBe(201);
        const session = await request(
          '/sessions',
          'POST',
          { userId: user.data.id, pin: '0012' },
          '',
        );
        expect(session.status).toBe(201);
        users.push({ username, token: session.data.token });
      }
      ownerToken = users[0]!.token;
      viewerToken = users[1]!.token;
      const workspace = await request('/workspaces', 'POST', { name: 'Direct table verification' });
      expect(workspace.status).toBe(201);
      workspaceId = workspace.data.id;
      const invitation = await request(`/workspaces/${workspaceId}/invitations`, 'POST', {
        username: users[1]!.username,
        role: 'viewer',
      });
      expect(invitation.status).toBe(201);
      expect(
        (
          await request(
            `/workspace-invitations/${invitation.data.id}/accept`,
            'POST',
            {},
            viewerToken,
          )
        ).status,
      ).toBe(201);
      const project = await request('/projects', 'POST', { workspaceId, name: 'Tables first' });
      expect(project.status).toBe(201);
      const fixturePool = new pg.Pool({ connectionString: url.toString() });
      try {
        await seedLegacyProject(fixturePool, project.data.id);
      } finally {
        await fixturePool.end();
      }
      projectId = project.data.id;
    }, 30000);

    afterAll(async () => {
      await app?.close();
      await migrationPool?.end();
      if (previousDatabaseUrl !== undefined) process.env.DATABASE_URL = previousDatabaseUrl;
      if (created) {
        if (!/^ezerd_direct_table_test_[a-f0-9]{32}$/.test(databaseName))
          throw new Error('Invalid verification database name.');
        await admin!.query(`DROP DATABASE "${databaseName}"`);
      }
      await admin?.end();
    });

    async function operation(
      change: (document: DesignDocument) => DesignDocument,
      token = ownerToken,
    ) {
      const clientId = randomUUID();
      const response = await request(
        `/projects/${projectId}/sync-baseline`,
        'POST',
        { clientId },
        token,
      );
      expect(response.status).toBe(201);
      const baseline = response.data;
      const baselineDocument = sharedDocument(baseline.document);
      const document = change(baselineDocument);
      return request(
        `/projects/${projectId}/operations`,
        'POST',
        {
          operationId: randomUUID(),
          groupId: randomUUID(),
          clientId,
          baselineId: baseline.baselineId,
          baseSequence: baseline.sequence,
          baselineIssuedAt: baseline.baselineIssuedAt,
          kind: 'online',
          dependencyPaths: [],
          changes: deriveOperationChanges(baselineDocument, document),
          baselineDocument,
          document,
        },
        token,
      );
    }

    it('persists zero-domain tables, FK, color and shared notes, protects viewer writes and round-trips files', async () => {
      const table = (id: string): Table => ({
        id,
        domainId: null,
        scope: 'physical',
        color: '#465fff',
        logical: { name: id, definition: '' },
        physical: { name: id, schema: 'direct_verification', comment: '' },
        customProperties: { common: {}, logical: {}, physical: {} },
      });
      const column = (id: string, tableId: string): Column => ({
        id,
        tableId,
        scope: 'physical',
        logical: { name: id, definition: '', semanticType: '', required: true },
        physical: {
          name: id,
          type: { name: 'integer', isArray: false },
          nullable: false,
          defaultExpression: null,
          comment: '',
        },
        customProperties: { common: {}, logical: {}, physical: {} },
      });
      const result = await operation((doc) => {
        let next = addTable(doc, table('users'), { x: 10, y: 20 });
        next = addTable(next, table('orders'), { x: 500, y: 20 });
        next = addColumn(addColumn(next, column('id', 'users')), column('user_id', 'orders'));
        next = upsertKey(next, {
          id: 'pk',
          tableId: 'users',
          kind: 'primary',
          name: 'users_pk',
          scope: 'physical',
          columnIds: ['id'],
        });
        next = upsertTableRelation(next, {
          id: 'fk',
          sourceTableId: 'orders',
          targetTableId: 'users',
          scope: 'physical',
          logical: { name: '', cardinality: 'one-to-many', required: true },
          physical: {
            name: 'orders_user_fk',
            sourceColumnIds: ['user_id'],
            targetColumnIds: ['id'],
            onDelete: 'NO ACTION',
            onUpdate: 'NO ACTION',
          },
        });
        return addNote(
          next,
          { id: 'note', viewId: TABLES_VIEW_ID, text: 'Shared note' },
          { x: 10, y: 400 },
        );
      });
      expect(result.status).toBe(201);
      expect(result.data.status, result.data.reason).toBe('accepted');
      const reloaded = await request(`/projects/${projectId}`, 'GET', undefined, viewerToken);
      expect(reloaded.status).toBe(200);
      const doc = reloaded.data.document as DesignDocument;
      expect(doc.domains).toEqual([]);
      expect(doc.tables!.map((item) => item.color)).toEqual(['#465fff', '#465fff']);
      expect(doc.notes[0]!.text).toBe('Shared note');
      expect(diagnoseDocument(doc)).toEqual([]);
      const ddl = exportPostgres(doc);
      expect(ddl.diagnostics).toEqual([]);
      expect(ddl.sql).toContain('FOREIGN KEY');
      // Execute generated SQL in this disposable database too.
      const url = new URL(readConfig().DATABASE_URL);
      const ddlPool = new pg.Pool({ connectionString: url.toString() });
      try {
        await ddlPool.query(ddl.sql);
      } finally {
        await ddlPool.end();
      }
      const denied = await operation(
        (current) => updateTable(current, 'users', { color: '#12b76a' }),
        viewerToken,
      );
      expect(denied.status).toBe(403);
      const exported = await request(`/projects/${projectId}/export`);
      expect(exported.status).toBe(200);
      const imported = await request('/projects/import', 'POST', {
        workspaceId,
        transfer: exported.data,
      });
      expect(imported.status).toBe(201);
      const importedDoc = (await request(`/projects/${imported.data.id}`)).data.document;
      expect(importedDoc.tables).toEqual(doc.tables);
      expect(importedDoc.tableRelations).toEqual(doc.tableRelations);
    }, 20000);

    it('keeps global layouts and FK identities across ownership changes and stores viewer viewport privately', async () => {
      const before = (await request(`/projects/${projectId}`)).data.document as DesignDocument;
      const global = before.layout.nodes.find(
        (node) => node.objectId === 'users' && node.viewId === TABLES_VIEW_ID,
      )!;
      const assigned = await operation((doc) =>
        updateTable(
          addDomain(
            doc,
            { id: 'sales', name: 'Sales', description: '', color: '#12b76a' },
            { x: 0, y: 0 },
          ),
          'users',
          { domainId: 'sales' },
        ),
      );
      expect(assigned.data.status, assigned.data.reason).toBe('accepted');
      const unassigned = await operation((doc) =>
        updateTable(doc, 'users', { domainId: null, color: undefined }),
      );
      expect(unassigned.data.status, unassigned.data.reason).toBe('accepted');
      const after = (await request(`/projects/${projectId}`)).data.document as DesignDocument;
      expect(after.layout.nodes.find((node) => node.id === global.id)).toEqual(global);
      expect(after.tables!.find((item) => item.id === 'users')!.domainId).toBeNull();
      expect(after.tables!.find((item) => item.id === 'users')).not.toHaveProperty('color');
      expect(after.columns).toEqual(before.columns);
      expect(after.keys).toEqual(before.keys);
      expect(after.tableRelations).toEqual(before.tableRelations);
      const personal = (
        await request(`/projects/${projectId}/personal-state`, 'GET', undefined, viewerToken)
      ).data;
      const viewport = { viewId: TABLES_VIEW_ID, x: 12, y: 34, zoom: 2 };
      const saved = await request(
        `/projects/${projectId}/personal-state`,
        'PUT',
        { expectedVersion: personal.version, state: { ...personal.state, viewports: [viewport] } },
        viewerToken,
      );
      expect(saved.status).toBe(200);
      expect(saved.data.state.viewports).toEqual([viewport]);
      const owner = (await request(`/projects/${projectId}/personal-state`)).data;
      expect(owner.state.viewports).not.toEqual([viewport]);
      expect((await request(`/projects/${projectId}`)).data.document.layout.viewports).toEqual(
        before.layout.viewports,
      );
    }, 20000);
    it('shares legacy domain annotations and canonical geometry with another member', async () => {
      const response = await operation((doc) => {
        let next = updateTable(doc, 'users', { domainId: 'sales' });
        const owner = next.layout.nodes.find(
          (node) => node.objectId === 'users' && node.viewId === 'sales',
        )!;
        next = updateNodeLayout(next, owner.id, { x: 900, y: 800 });
        next = addTableReference(next, 'orders', 'sales', { x: 1300, y: 800 });
        next = addNote(
          next,
          { id: 'domain-note', viewId: 'sales', text: 'Shared domain note' },
          { x: 910, y: 820 },
        );
        return upsertRelationLayout(next, {
          relationId: 'fk',
          viewId: 'sales',
          offset: 12,
          bend: { x: 1000, y: 1000 },
        });
      });
      expect(response.status).toBe(201);
      expect(response.data.status, response.data.reason).toBe('accepted');
      const snapshot = (await request(`/projects/${projectId}`, 'GET', undefined, viewerToken)).data
        .document as DesignDocument;
      expect(snapshot.notes.find((note) => note.id === 'domain-note')).toMatchObject({
        viewId: TABLES_VIEW_ID,
        text: 'Shared domain note',
      });
      expect(snapshot.layout.nodes.find((node) => node.objectId === 'domain-note')).toMatchObject({
        viewId: TABLES_VIEW_ID,
        x: 20,
        y: 40,
      });
      expect(snapshot.layout.relations!.find((route) => route.relationId === 'fk')).toMatchObject({
        viewId: TABLES_VIEW_ID,
        offset: 12,
        bend: { x: 110, y: 220 },
      });
      expect(snapshot.layout.relations!.some((route) => route.viewId === 'sales')).toBe(false);
      expect(diagnoseDocument(snapshot)).toEqual([]);
    }, 20000);
  },
);
