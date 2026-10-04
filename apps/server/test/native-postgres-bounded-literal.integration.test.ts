import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import pg from 'pg';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createNativeColumn,
  createNativeTable,
  defaultDatabaseContext,
  literalDecision,
  type NativeDesignDocument,
} from '@ezerd/model';
import {
  nativeSyncOperationResultSchema,
  projectDDLExportSchema,
  projectDocumentStateSchema,
  type NativeEditorCommand,
  type ProjectDDLExport,
} from '@ezerd/contracts';
import {
  boundedLiteral,
  postgresBoundedLiteralCases,
} from './native-postgres-bounded-literal-fixtures.js';

describe.runIf(process.env.EZERD_DB_TEST === '1')(
  'bounded PostgreSQL defaults actual REST/MCP → exported DDL → values',
  () => {
    let app: NestExpressApplication,
      pool: pg.Pool,
      mcp: Client,
      base: string,
      token: string,
      userId: string,
      workspaceId: string;
    const oldPort = process.env.PORT,
      oldUrl = process.env.MCP_PUBLIC_URL;
    const context = defaultDatabaseContext('postgresql');
    const requireCompiled = createRequire(import.meta.url);
    const load = (file: string) => requireCompiled(resolve('apps/server/dist', file));
    async function api(path: string, method = 'GET', body?: unknown) {
      const response = await fetch(base + '/api' + path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: 'Bearer ' + token } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: (await response.json()) as any };
    }
    async function stored(id: string) {
      return (
        await pool.query(
          'SELECT document,version,sync_sequence,database_revision FROM projects WHERE id=$1',
          [id],
        )
      ).rows[0];
    }
    async function ledger(id: string) {
      return (
        await pool.query('SELECT * FROM sync_operations WHERE project_id=$1 ORDER BY sequence', [
          id,
        ])
      ).rows;
    }
    const input = (version: number, sequence: number, commands: NativeEditorCommand[]) => ({
      operationId: randomUUID(),
      groupId: randomUUID(),
      clientId: randomUUID(),
      expectedVersion: version,
      expectedSequence: sequence,
      expectedDatabaseRevision: 0,
      includeDocument: true,
      commands,
    });
    beforeAll(async () => {
      const configured = new URL(process.env.DATABASE_URL!);
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname) ||
        !/^\/ezerd_qa_[a-f0-9]{32}$/.test(configured.pathname)
      )
        throw Error('Normal test-isolated localhost UUID DB required');
      pool = new pg.Pool({ connectionString: configured.toString() });
      expect((await pool.query('SHOW server_version')).rows[0].server_version).toMatch(
        /^18\.6(?:\s|$)/,
      );
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
      const user = await api('/users', 'POST', {
        username: 'bounded-pg-' + randomUUID().slice(0, 20),
        pin: '0024',
      });
      expect(user.status).toBe(201);
      userId = user.data.id;
      const session = await api('/sessions', 'POST', { userId, pin: '0024' });
      expect(session.status).toBe(201);
      token = session.data.token;
      const workspace = await api('/workspaces', 'POST', { name: 'Bounded PG typed defaults' });
      expect(workspace.status).toBe(201);
      workspaceId = workspace.data.id;
      const issued = await api('/mcp-tokens', 'POST', { name: 'Bounded typed defaults QA' });
      expect(issued.status).toBe(201);
      mcp = new Client({ name: 'native-pg-bounded-literal-qa', version: '1.0.0' });
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
          requestInit: { headers: { authorization: 'Bearer ' + issued.data.token } },
        }) as never,
      );
    }, 15000);
    afterAll(async () => {
      await mcp?.close();
      await app?.close();
      if (oldPort === undefined) delete process.env.PORT;
      else process.env.PORT = oldPort;
      if (oldUrl === undefined) delete process.env.MCP_PUBLIC_URL;
      else process.env.MCP_PUBLIC_URL = oldUrl;
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
          if (userId) await pool.query('DELETE FROM users WHERE id=$1', [userId]);
        } finally {
          await pool.end();
        }
    });
    it.each(postgresBoundedLiteralCases)(
      '$key preserves typed default across both product paths and executes both exported SQL snapshots',
      async (spec) => {
        // No optional skip/coverage override: parent adapter + real product coverage must actually work.
        expect(
          literalDecision(context, spec.type, boundedLiteral(spec.value)),
          'Parent literals.ts adapter is required',
        ).toMatchObject({ allowed: true, usable: true });
        const created = await api('/projects', 'POST', {
          workspaceId,
          databaseKind: 'postgresql',
          formatVersion: 2,
          name: 'Bounded ' + spec.key,
        });
        expect(created.status).toBe(201);
        const id: string = created.data.id,
          schema = 'ezerd_typed_path_' + randomUUID().replaceAll('-', '');
        const table = createNativeTable(context, 'table');
        table.physical.name = 'typed_values';
        table.physical.namespace = { kind: 'postgresSchema', name: schema };
        const column = createNativeColumn(context, table, 'value');
        column.physical.name = 'value';
        column.physical.type = structuredClone(spec.type);
        column.physical.defaultValue = boundedLiteral(spec.value);
        const commands: NativeEditorCommand[] = [
          ...(spec.projectEnum
            ? [
                {
                  type: 'add_enum' as const,
                  value: { id: 'qa-enum', schema, name: 'enum_state', values: ['one', 'two'] },
                },
              ]
            : []),
          { type: 'add_table', value: table },
          { type: 'add_column', value: column },
        ];
        const route = `/projects/${id}/native-sync/commands`,
          request = input(0, 0, commands);
        const saved = await api(route, 'POST', request);
        expect(saved.status, JSON.stringify(saved.data)).toBe(201);
        expect(
          nativeSyncOperationResultSchema.parse(saved.data).status,
          JSON.stringify(saved.data),
        ).toBe('accepted');
        const first = await stored(id);
        expect(first).toMatchObject({ version: 1, sync_sequence: 1, database_revision: 0 });
        expect(first.document.columns[0].physical).toEqual(column.physical);
        const mcpInput = {
          projectId: id,
          ...input(1, 1, [
            {
              type: 'patch_column',
              id: column.id,
              patch: {
                physical: { defaultValue: boundedLiteral(spec.value) },
                logical: { definition: 'actual MCP typed default' },
              },
            },
          ]),
        };
        const changed = await mcp.callTool({
          name: 'apply_native_project_changes',
          arguments: mcpInput,
        });
        expect(changed.isError, JSON.stringify(changed.content)).not.toBe(true);
        const mcpAck = nativeSyncOperationResultSchema.parse(changed.structuredContent);
        expect(mcpAck.status).toBe('accepted');
        expect(mcpAck.document!.columns![0]!.physical.defaultValue).toEqual(
          boundedLiteral(spec.value),
        );
        const afterGood = await stored(id);
        expect(afterGood).toMatchObject({ version: 2, sync_sequence: 2, database_revision: 0 });
        const state = projectDocumentStateSchema.parse(
          (await api(`/projects/${id}/document-state`)).data,
        );
        const read = await mcp.callTool({
          name: 'get_project_document_state',
          arguments: { projectId: id },
        });
        expect(read.isError).not.toBe(true);
        expect(read.structuredContent).toEqual(state);
        expect(state.sourceDocument).toEqual(afterGood.document);
        const bad = input(2, 2, [
          {
            type: 'patch_column',
            id: column.id,
            patch: { physical: { defaultValue: boundedLiteral(spec.blocked) } },
          },
        ]);
        const invalid = await api(route, 'POST', bad);
        expect(invalid.status).toBe(201);
        const invalidAck = nativeSyncOperationResultSchema.parse(invalid.data);
        expect(invalidAck.status).toBe('rejected');
        expect(invalidAck.issues).toContainEqual(
          expect.objectContaining({
            objectId: column.id,
            path: '/columns/value/physical/defaultValue',
          }),
        );
        expect(await stored(id)).toMatchObject({
          document: afterGood.document,
          version: 2,
          sync_sequence: 3,
        });
        const badMcpInput = { projectId: id, ...input(2, 3, bad.commands) };
        const invalidMcp = await mcp.callTool({
          name: 'apply_native_project_changes',
          arguments: badMcpInput,
        });
        expect(invalidMcp.isError, JSON.stringify(invalidMcp.content)).not.toBe(true);
        const invalidMcpAck = nativeSyncOperationResultSchema.parse(invalidMcp.structuredContent);
        expect(invalidMcpAck.status).toBe('rejected');
        expect(invalidMcpAck.issues).toEqual(invalidAck.issues);
        const beforeReplay = await stored(id),
          beforeLedger = await ledger(id);
        expect(beforeReplay).toMatchObject({
          document: afterGood.document,
          version: 2,
          sync_sequence: 4,
          database_revision: 0,
        });
        expect((await api(route, 'POST', request)).data).toEqual(saved.data);
        expect(
          (await mcp.callTool({ name: 'apply_native_project_changes', arguments: mcpInput }))
            .structuredContent,
        ).toEqual(changed.structuredContent);
        expect((await api(route, 'POST', bad)).data).toEqual(invalid.data);
        expect(
          (await mcp.callTool({ name: 'apply_native_project_changes', arguments: badMcpInput }))
            .structuredContent,
        ).toEqual(invalidMcp.structuredContent);
        expect(await stored(id)).toEqual(beforeReplay);
        expect(await ledger(id)).toEqual(beforeLedger);
        const restDDL = projectDDLExportSchema.parse((await api(`/projects/${id}/ddl`)).data);
        const exported = await mcp.callTool({
          name: 'export_project_ddl',
          arguments: { projectId: id },
        });
        expect(exported.isError).not.toBe(true);
        const mcpDDL = projectDDLExportSchema.parse(exported.structuredContent);
        expect(mcpDDL).toEqual(restDDL);
        expect(restDDL).toMatchObject({
          canExport: true,
          version: 2,
          sequence: 4,
          database: { ...context, revision: 0 },
        });
        async function execute(ddl: ProjectDDLExport) {
          const connection = await pool.connect();
          try {
            await connection.query('BEGIN');
            await connection.query(ddl.sql);
            await connection.query(`INSERT INTO "${schema}".typed_values DEFAULT VALUES`);
            expect(
              (await connection.query(`SELECT value::text AS value FROM "${schema}".typed_values`))
                .rows,
            ).toEqual([{ value: spec.expected }]);
            if (spec.array)
              expect(
                (
                  await connection.query(
                    `SELECT cardinality(value) AS size,array_ndims(value) AS dimensions FROM "${schema}".typed_values`,
                  )
                ).rows,
              ).toEqual([{ size: 0, dimensions: null }]);
            if (spec.key === 'pg_snapshot')
              expect(
                (
                  await connection.query(
                    `SELECT pg_snapshot_xmin(value)::text AS xmin,pg_snapshot_xmax(value)::text AS xmax FROM "${schema}".typed_values`,
                  )
                ).rows,
              ).toEqual([{ xmin: '10', xmax: '20' }]);
            const document = state.sourceDocument as NativeDesignDocument;
            expect(document.columns![0]!.physical.type).toEqual(spec.type);
          } finally {
            try {
              await connection.query('ROLLBACK');
            } finally {
              connection.release();
            }
          }
          expect(
            (
              await pool.query('SELECT COUNT(*) AS count FROM pg_namespace WHERE nspname=$1', [
                schema,
              ])
            ).rows[0].count,
          ).toBe('0');
        }
        await execute(restDDL);
        await execute(mcpDDL);
      },
      15000,
    );
  },
);
