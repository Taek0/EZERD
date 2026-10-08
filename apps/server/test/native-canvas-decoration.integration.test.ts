import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import pg from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { nativeSyncOperationResultSchema } from '@ezerd/contracts';
import { createNativeColumn, createNativeTable, type DatabaseKind } from '@ezerd/model';
import { decorationFixture } from '../../web/src/features/projects/native-canvas-decoration-test-fixtures.js';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/application.js';
import { SyncGateway } from '../src/sync/sync.gateway.js';

describe.runIf(process.env.EZERD_DB_TEST === '1')(
  'actual native canvas decoration REST/MCP',
  () => {
    let app: NestExpressApplication,
      pool: pg.Pool,
      base: string,
      workspaceId: string,
      token: string,
      viewerToken: string,
      client: Client;
    const users: string[] = [],
      previousPort = process.env.PORT,
      previousUrl = process.env.MCP_PUBLIC_URL;
    async function request(
      path: string,
      method = 'GET',
      body?: unknown,
      auth: string | null = token,
    ) {
      const result = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(auth ? { authorization: `Bearer ${auth}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: result.status, data: (await result.json()) as any };
    }
    async function state(id: string) {
      return (await request(`/projects/${id}/document-state`)).data;
    }
    async function fresh(kind: DatabaseKind = 'postgresql') {
      const result = await request('/projects', 'POST', {
        workspaceId,
        databaseKind: kind,
        formatVersion: 2,
        name: 'Canvas decoration QA',
      });
      expect(result.status, JSON.stringify(result.data)).toBe(201);
      // Existing upgraded opaque metadata is fixture input, never created by an ordinary command.
      await pool.query('UPDATE projects SET document=$2::jsonb WHERE id=$1', [
        result.data.id,
        JSON.stringify(decorationFixture(kind)),
      ]);
      return result.data.id as string;
    }
    async function input(id: string, commands: unknown[]) {
      const current = await state(id),
        operationId = randomUUID();
      return {
        operationId,
        groupId: operationId,
        clientId: randomUUID(),
        expectedVersion: current.project.version,
        expectedSequence: current.sequence,
        expectedDatabaseRevision: current.project.databaseRevision,
        commands,
        includeDocument: true,
      };
    }
    async function save(id: string, commands: unknown[]) {
      return request(`/projects/${id}/native-sync/commands`, 'POST', await input(id, commands));
    }
    const relation = (id: string) => ({
      id,
      sourceDomainId: 'a',
      targetDomainId: 'b',
      name: 'New',
      description: '',
      direction: 'forward',
    });
    beforeAll(async () => {
      const configured = new URL(process.env.DATABASE_URL!);
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname) ||
        !/^\/ezerd_qa_/.test(configured.pathname)
      )
        throw Error('Use scripts/test-isolated.ts with a disposable local QA database');
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
      process.env.PORT = new URL(base).port;
      process.env.MCP_PUBLIC_URL = `${base}/mcp`;
      async function actor() {
        const user = await request(
          '/users',
          'POST',
          { username: 'decoration-' + randomUUID().slice(0, 21), pin: '0024' },
          null,
        );
        expect(user.status).toBe(201);
        users.push(user.data.id);
        const session = await request(
          '/sessions',
          'POST',
          { userId: user.data.id, pin: '0024' },
          null,
        );
        expect(session.status).toBe(201);
        return session.data.token as string;
      }
      token = await actor();
      viewerToken = await actor();
      const workspace = await request('/workspaces', 'POST', { name: 'Canvas decoration QA' });
      expect(workspace.status).toBe(201);
      workspaceId = workspace.data.id;
      await pool.query(
        "INSERT INTO user_workspaces (workspace_id,user_id,role) VALUES ($1,$2,'viewer')",
        [workspaceId, users[1]],
      );
      const access = await request('/mcp-tokens', 'POST', { name: 'Canvas decoration QA' });
      expect(access.status).toBe(201);
      client = new Client({ name: 'native-decoration-qa', version: '1.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
          requestInit: { headers: { authorization: `Bearer ${access.data.token}` } },
        }) as never,
      );
    });
    afterAll(async () => {
      await client?.close();
      await app?.close();
      if (previousPort === undefined) delete process.env.PORT;
      else process.env.PORT = previousPort;
      if (previousUrl === undefined) delete process.env.MCP_PUBLIC_URL;
      else process.env.MCP_PUBLIC_URL = previousUrl;
      if (!pool) return;
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
    it.each(['postgresql', 'mysql', 'sqlite'] as const)(
      'persists %s domain lifecycle and styles without rewriting legacy payload and replays ACK',
      async (kind) => {
        const id = await fresh(kind),
          before = (await state(id)).sourceDocument,
          body = await input(id, [
            { type: 'add_domain_relation', value: relation('fresh-relation') },
            { type: 'patch_domain_relation', id: 'r', patch: { name: 'Changed' } },
            {
              type: 'patch_canvas_style',
              target: { kind: 'table', id: 't' },
              patch: { color: '#aabbcc', canvasDisplay: { showNullable: false } },
            },
            {
              type: 'patch_canvas_style',
              target: { kind: 'domain', id: 'a' },
              patch: { color: null },
            },
            {
              type: 'patch_canvas_style',
              target: { kind: 'note', id: 'n' },
              patch: { color: null },
            },
          ]);
        const saved = await request(`/projects/${id}/native-sync/commands`, 'POST', body);
        expect(saved.status, JSON.stringify(saved.data)).toBe(201);
        expect(nativeSyncOperationResultSchema.parse(saved.data).status).toBe('accepted');
        const document = (await state(id)).sourceDocument;
        expect(document.columns).toEqual(before.columns);
        expect(document.tables[0].physical).toEqual(before.tables[0].physical);
        expect(document.domainRelations).toEqual([
          { ...before.domainRelations[0], name: 'Changed' },
          relation('fresh-relation'),
        ]);
        expect(document.tables[0]).toMatchObject({
          color: '#aabbcc',
          canvasDisplay: { showNullable: false },
        });
        expect(document.domains[0]).not.toHaveProperty('color');
        expect(document.notes[0]).not.toHaveProperty('color');
        expect((await request(`/projects/${id}/native-sync/commands`, 'POST', body)).data).toEqual(
          saved.data,
        );
        const deleted = await save(id, [{ type: 'delete_domain_relation', id: 'fresh-relation' }]);
        expect(deleted.data.status).toBe('accepted');
        expect((await state(id)).sourceDocument.domainRelations).toHaveLength(1);
        const reset = await save(id, [
          {
            type: 'patch_canvas_style',
            target: { kind: 'table', id: 't' },
            patch: { color: null, canvasDisplay: { showComment: false } },
          },
        ]);
        expect(reset.data.status).toBe('accepted');
        const table = (await state(id)).sourceDocument.tables[0];
        expect(table).not.toHaveProperty('color');
        expect(table.canvasDisplay).toEqual({ showNullable: false, showComment: false });
      },
    );
    it('rejects foreign endpoints, physical injections and relation batch/retired reuse without changing source', async () => {
      const id = await fresh(),
        before = await state(id);
      for (const commands of [
        [{ type: 'patch_domain_relation', id: 'r', patch: { targetDomainId: 'foreign' } }],
        [
          {
            type: 'patch_canvas_style',
            target: { kind: 'table', id: 't' },
            patch: { physical: { name: 'injected' } },
          },
        ],
        [
          { type: 'delete_domain_relation', id: 'r' },
          { type: 'add_domain_relation', value: before.sourceDocument.domainRelations[0] },
        ],
      ])
        expect((await save(id, commands)).status).toBe(400);
      expect((await state(id)).sourceDocument).toEqual(before.sourceDocument);
      expect((await save(id, [{ type: 'delete_domain_relation', id: 'r' }])).data.status).toBe(
        'accepted',
      );
      const retired = await save(id, [
        { type: 'add_domain_relation', value: before.sourceDocument.domainRelations[0] },
      ]);
      expect(retired.data.status).toBe('rejected');
      expect(retired.data.reasonCode).toBe('sync.identity-retired');
      expect((await state(id)).sourceDocument.domainRelations).toEqual([]);
    });
    it('keeps locked revision checks and viewer readonly permissions', async () => {
      const id = await fresh(),
        body = await input(id, [
          { type: 'patch_domain_relation', id: 'r', patch: { description: 'Revision-safe' } },
        ]);
      expect(
        (await request(`/projects/${id}/native-sync/commands`, 'POST', body, viewerToken)).status,
      ).toBe(403);
      const mismatch = await request(`/projects/${id}/native-sync/commands`, 'POST', {
        ...body,
        expectedDatabaseRevision: body.expectedDatabaseRevision + 1,
      });
      expect(mismatch.status).toBe(409);
      expect(mismatch.data.code).toBe('database.context-changed');
      expect((await state(id)).sourceDocument.domainRelations[0].description).toBe('Description');
    });
    it('merges commands from the same observed head and orders overlapping properties by server processing', async () => {
      const id = await fresh(),
        before = await state(id),
        first = await input(id, [
          { type: 'patch_domain_relation', id: 'r', patch: { name: 'First writer' } },
        ]),
        disjoint = await input(id, [
          { type: 'patch_domain_relation', id: 'r', patch: { description: 'Second property' } },
        ]),
        overlap = await input(id, [
          {
            type: 'patch_domain_relation',
            id: 'r',
            patch: { name: before.sourceDocument.domainRelations[0].name },
          },
        ]);
      const route = `/projects/${id}/native-sync/commands`;
      for (const body of [first, disjoint, overlap]) {
        const response = await request(route, 'POST', body);
        expect(response.status, JSON.stringify(response.data)).toBe(201);
        expect(response.data.status).toBe('accepted');
      }
      const current = await state(id);
      expect(current.sourceDocument.domainRelations[0]).toEqual({
        ...before.sourceDocument.domainRelations[0],
        description: 'Second property',
      });
      expect(current.sequence).toBe(before.sequence + 3);
      const replay = await request(route, 'POST', disjoint);
      expect(replay.data.status).toBe('accepted');
      expect(replay.data.sequence).toBe(before.sequence + 2);
      expect(await state(id)).toEqual(current);
    });
    it('keeps stale command bundles atomic and never recreates a deleted target', async () => {
      const id = await fresh(),
        invalid = await input(id, [
          { type: 'patch_domain_relation', id: 'r', patch: { description: 'Must roll back' } },
          { type: 'patch_domain_relation', id: 'missing', patch: { name: 'Missing' } },
        ]),
        deleted = await input(id, [
          { type: 'patch_domain_relation', id: 'r', patch: { name: 'Deleted edit' } },
        ]);
      expect(
        (await save(id, [{ type: 'patch_domain_relation', id: 'r', patch: { name: 'Current' } }]))
          .data.status,
      ).toBe('accepted');
      const beforeInvalid = await state(id);
      expect((await request(`/projects/${id}/native-sync/commands`, 'POST', invalid)).status).toBe(
        400,
      );
      expect(await state(id)).toEqual(beforeInvalid);
      expect((await save(id, [{ type: 'delete_domain_relation', id: 'r' }])).data.status).toBe(
        'accepted',
      );
      const beforeDeletedEdit = await state(id);
      expect((await request(`/projects/${id}/native-sync/commands`, 'POST', deleted)).status).toBe(
        400,
      );
      expect(await state(id)).toEqual(beforeDeletedEdit);
      expect(beforeDeletedEdit.sourceDocument.domainRelations).toEqual([]);
    });
    it('merges nested column and node patches against the current document for REST and MCP', async () => {
      const id = await fresh(),
        before = await state(id),
        logical = await input(id, [
          { type: 'patch_column', id: 'c', patch: { logical: { name: 'New label' } } },
        ]),
        physical = await input(id, [
          { type: 'patch_column', id: 'c', patch: { physical: { comment: 'New comment' } } },
        ]),
        horizontal = await input(id, [
          { type: 'update_node_layout', nodeId: 'nt', patch: { x: 500 } },
        ]),
        vertical = await input(id, [
          { type: 'update_node_layout', nodeId: 'nt', patch: { y: 600 } },
        ]);
      for (const body of [logical, horizontal, vertical])
        expect(
          (await request(`/projects/${id}/native-sync/commands`, 'POST', body)).data.status,
        ).toBe('accepted');
      const result = await client.callTool({
        name: 'apply_native_project_changes',
        arguments: { projectId: id, ...physical },
      });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      expect(nativeSyncOperationResultSchema.parse(result.structuredContent).status).toBe(
        'accepted',
      );
      const current = (await state(id)).sourceDocument;
      expect(current.columns[0]).toEqual({
        ...before.sourceDocument.columns[0],
        logical: { ...before.sourceDocument.columns[0].logical, name: 'New label' },
        physical: { ...before.sourceDocument.columns[0].physical, comment: 'New comment' },
      });
      expect(current.layout.nodes.find((node: { id: string }) => node.id === 'nt')).toEqual({
        ...before.sourceDocument.layout.nodes.find((node: { id: string }) => node.id === 'nt'),
        x: 500,
        y: 600,
      });
    });
    it('rejects future command heads and preserves the strict raw baseline expectation', async () => {
      const id = await fresh(),
        body = await input(id, [
          { type: 'patch_domain_relation', id: 'r', patch: { name: 'Future' } },
        ]),
        before = await state(id);
      for (const patch of [
        { expectedVersion: body.expectedVersion + 1 },
        { expectedSequence: body.expectedSequence + 1 },
      ])
        expect(
          await request(`/projects/${id}/native-sync/commands`, 'POST', { ...body, ...patch }),
        ).toMatchObject({ status: 409, data: { code: 'database.context-changed' } });
      expect(await state(id)).toEqual(before);
      expect(
        (await request(`/projects/${id}/native-sync/commands`, 'POST', body)).data.status,
      ).toBe('accepted');
      expect(
        await request(`/projects/${id}/native-sync/baseline`, 'POST', {
          clientId: body.clientId,
          expected: {
            version: body.expectedVersion,
            sequence: body.expectedSequence,
            databaseRevision: body.expectedDatabaseRevision,
          },
        }),
      ).toMatchObject({ status: 409, data: { code: 'database.context-changed' } });
    });
    it('reports invalid SQLite input then persists five tables with columns, keys, FK and placement beside legacy data', async () => {
      const id = await fresh('sqlite');
      const source = (await state(id)).sourceDocument;
      source.enums = [{ id: 'legacy-enum', name: 'State', schema: 'public', values: ['active'] }];
      source.columns[0].physical.type.original = {
        name: 'enum',
        enumId: 'legacy-enum',
        isArray: false,
      };
      await pool.query('UPDATE projects SET document=$2::jsonb WHERE id=$1', [
        id,
        JSON.stringify(source),
      ]);
      const before = await state(id);
      expect(before.native.issues.map((issue: { code: string }) => issue.code)).toEqual(
        expect.arrayContaining([
          'legacy.namespace-unresolved',
          'legacy.type-unresolved',
          'legacy.default-unresolved',
          'legacy.enum-context-mismatch',
        ]),
      );
      const tables = ['categories', 'products', 'customers', 'orders', 'order_items'].map(
        (name) => {
          const value = createNativeTable(source.database, randomUUID());
          value.logical.name = name;
          value.physical.name = name;
          return value;
        },
      );
      const bad = structuredClone(tables[0]!);
      bad.physical.namespace = { kind: 'none' } as never;
      const failed = await client.callTool({
        name: 'apply_native_project_changes',
        arguments: {
          projectId: id,
          ...(await input(id, [
            {
              type: 'add_table',
              value: bad,
              placement: { viewId: '__tables__', x: 1500, y: 180, width: 400, height: 260 },
            },
          ])),
        },
      });
      expect(failed.isError).toBe(true);
      const error = JSON.parse((failed.content as Array<{ text: string }>)[0]!.text);
      expect(error).toMatchObject({ status: 400, code: 'native.command-invalid' });
      expect(error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['commands', 0, 'value', 'physical', 'namespace'] }),
          expect.objectContaining({ path: ['commands', 0], keys: ['placement'] }),
        ]),
      );
      expect(await state(id)).toEqual(before);

      const columns = tables.map((table) => {
        const value = createNativeColumn(source.database, table, randomUUID());
        value.physical.name = 'id';
        value.physical.nullable = false;
        return value;
      });
      const commands = tables.flatMap((table, index) => [
        { type: 'add_table', value: table },
        { type: 'add_column', value: columns[index] },
        {
          type: 'add_key',
          value: {
            id: randomUUID(),
            tableId: table.id,
            scope: 'physical',
            kind: 'primary',
            name: `pk_${table.physical.name}`,
            columnIds: [columns[index]!.id],
          },
        },
        {
          type: 'add_table_reference',
          tableId: table.id,
          viewId: '__tables__',
          placement: { x: 1500 + index * 440, y: 180, width: 400, height: 260 },
        },
      ]);
      const args = {
        projectId: id,
        ...(await input(id, [
          ...commands,
          {
            type: 'add_foreign_key',
            value: {
              id: randomUUID(),
              sourceTableId: tables[1]!.id,
              targetTableId: tables[0]!.id,
              scope: 'physical',
              logical: { name: '', cardinality: 'one-to-many', required: false },
              physical: {
                name: 'fk_products_category',
                sourceColumnIds: [columns[1]!.id],
                targetColumnIds: [columns[0]!.id],
                onDelete: 'NO ACTION',
                onUpdate: 'NO ACTION',
              },
            },
          },
        ])),
      };
      const call = () => client.callTool({ name: 'apply_native_project_changes', arguments: args });
      const saved = await call();
      expect(saved.isError, JSON.stringify(saved.content)).not.toBe(true);
      expect(saved.structuredContent).toMatchObject({ status: 'accepted' });
      const current = await state(id);
      expect(current.sourceDocument.tables).toHaveLength(
        before.sourceDocument.tables.length + tables.length,
      );
      expect(current.sourceDocument.tables).toEqual(
        expect.arrayContaining([...before.sourceDocument.tables, ...tables]),
      );
      expect(current.sourceDocument.columns).toHaveLength(
        before.sourceDocument.columns.length + columns.length,
      );
      expect(current.sourceDocument.columns).toEqual(
        expect.arrayContaining([...before.sourceDocument.columns, ...columns]),
      );
      expect(current.sourceDocument.keys).toHaveLength(5);
      expect(current.sourceDocument.tableRelations).toHaveLength(1);
      expect(current.sourceDocument.enums).toEqual(before.sourceDocument.enums);
      for (const [index, table] of tables.entries())
        expect(
          current.sourceDocument.layout.nodes.find(
            (node: { objectId: string }) => node.objectId === table.id,
          ),
        ).toMatchObject({
          viewId: '__tables__',
          x: 1500 + index * 440,
          y: 180,
          width: 400,
          height: 260,
        });
      expect(current.native.issues).toEqual(before.native.issues);
      expect((await call()).structuredContent).toEqual(saved.structuredContent);
      expect(await state(id)).toEqual(current);
    });
    it('consumes both new command families through the registered MCP tool', async () => {
      const id = await fresh('mysql'),
        before = (await state(id)).sourceDocument;
      const result = await client.callTool({
        name: 'apply_native_project_changes',
        arguments: {
          projectId: id,
          ...(await input(id, [
            { type: 'add_domain_relation', value: relation('mcp-relation') },
            { type: 'patch_domain_relation', id: 'mcp-relation', patch: { direction: 'both' } },
            {
              type: 'patch_canvas_style',
              target: { kind: 'note', id: 'n' },
              patch: { color: '#112233' },
            },
          ])),
        },
      });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      expect(nativeSyncOperationResultSchema.parse(result.structuredContent).status).toBe(
        'accepted',
      );
      const persisted = (await state(id)).sourceDocument;
      expect(persisted.domainRelations[1]).toEqual({
        ...relation('mcp-relation'),
        direction: 'both',
      });
      expect(persisted.notes[0].color).toBe('#112233');
      expect(persisted.columns).toEqual(before.columns);
    });
  },
);
