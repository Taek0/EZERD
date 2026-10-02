import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createNativeTable,
  createNativeColumn,
  databaseTypeCatalog,
  defaultDatabaseContext,
  type DatabaseKind,
  type NativeColumnType,
} from '@ezerd/model';
import {
  nativeSyncOperationResultSchema,
  projectDDLExportSchema,
  projectDocumentStateSchema,
} from '@ezerd/contracts';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/application.js';
import { SyncGateway } from '../src/sync/sync.gateway.js';

describe.runIf(process.env.EZERD_DB_TEST === '1')(
  'native builtin catalog complete project paths',
  () => {
    let app: NestExpressApplication,
      base: string,
      token: string,
      workspaceId: string,
      userId: string,
      pool: pg.Pool,
      mcp: Client;
    const oldPort = process.env.PORT,
      oldUrl = process.env.MCP_PUBLIC_URL;
    async function api(path: string, method = 'GET', value?: unknown) {
      const response = await fetch(base + '/api' + path, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: 'Bearer ' + token } : {}),
        },
        ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      });
      return { status: response.status, data: (await response.json()) as any };
    }
    beforeAll(async () => {
      const configured = new URL(process.env.DATABASE_URL!);
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname) ||
        !configured.pathname.startsWith('/ezerd_qa_')
      )
        throw Error('Use isolated QA runner');
      pool = new pg.Pool({ connectionString: configured.toString() });
      app = await NestFactory.create<NestExpressApplication>(AppModule, {
        bodyParser: false,
        logger: false,
      });
      configureApplication(app);
      app.get(SyncGateway).attach(app.getHttpServer());
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      process.env.PORT = new URL(base).port;
      process.env.MCP_PUBLIC_URL = base + '/mcp';
      const user = await api('/users', 'POST', {
        username: 'catalog-' + randomUUID().slice(0, 24),
        pin: '0024',
      });
      expect(user.status).toBe(201);
      userId = user.data.id;
      token = (await api('/sessions', 'POST', { userId, pin: '0024' })).data.token;
      const workspace = await api('/workspaces', 'POST', { name: 'Native catalog path QA' });
      expect(workspace.status).toBe(201);
      workspaceId = workspace.data.id;
      const issued = await api('/mcp-tokens', 'POST', { name: 'Catalog paths' });
      expect(issued.status).toBe(201);
      mcp = new Client({ name: 'native-catalog-path-qa', version: '1.0.0' });
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
          requestInit: { headers: { authorization: 'Bearer ' + issued.data.token } },
        }) as never,
      );
    });
    afterAll(async () => {
      await mcp?.close();
      await app?.close();
      if (oldPort === undefined) delete process.env.PORT;
      else process.env.PORT = oldPort;
      if (oldUrl === undefined) delete process.env.MCP_PUBLIC_URL;
      else process.env.MCP_PUBLIC_URL = oldUrl;
      if (pool) {
        if (workspaceId) {
          await pool.query('DELETE FROM projects WHERE workspace_id=$1', [workspaceId]);
          await pool.query('DELETE FROM workspace_audit_events WHERE workspace_id=$1', [
            workspaceId,
          ]);
          await pool.query('DELETE FROM user_workspaces WHERE workspace_id=$1', [workspaceId]);
          await pool.query('DELETE FROM workspace WHERE workspace_id=$1', [workspaceId]);
        }
        if (userId) await pool.query('DELETE FROM users WHERE id=$1', [userId]);
        await pool.end();
      }
    });
    it.each(['postgresql', 'mysql', 'sqlite'] as const)(
      'persists every usable %s builtin unchanged through REST/MCP and whole physical DDL',
      async (kind: DatabaseKind) => {
        const created = await api('/projects', 'POST', {
          workspaceId,
          databaseKind: kind,
          formatVersion: 2,
          name: 'Catalog ' + kind,
        });
        expect(created.status).toBe(201);
        const id = created.data.id;
        const context = defaultDatabaseContext(kind),
          table = createNativeTable(context, randomUUID());
        table.physical.name = 'catalog_types';
        if (kind === 'postgresql')
          table.physical.namespace = {
            kind: 'postgresSchema',
            name: 'qa_native_catalog_' + randomUUID().replaceAll('-', ''),
          };
        const strict = createNativeTable(context, randomUUID());
        strict.physical.name = 'strict_types';
        if (kind === 'sqlite')
          strict.physical.options = { database: 'sqlite', strict: true, withoutRowid: false };
        const definitions = databaseTypeCatalog.filter(
          (type) => type.databaseKind === kind && !type.deprecated,
        );
        const columns = definitions.map((definition, i) => {
          const owner = definition.id === 'sqlite:any' ? strict : table;
          const column = createNativeColumn(context, owner, randomUUID());
          column.physical.name = 'value_' + i;
          column.physical.type =
            kind === 'mysql' && ['enum', 'set'].includes(definition.sqlName)
              ? {
                  kind: 'valueList',
                  database: 'mysql',
                  typeId: definition.id as 'mysql:enum' | 'mysql:set',
                  values: ['one', 'two'],
                }
              : ({
                  kind: 'builtin',
                  database: kind,
                  typeId: definition.id,
                  parameters:
                    kind === 'mysql' && ['varchar', 'varbinary'].includes(definition.sqlName)
                      ? { length: 12 }
                      : {},
                } as NativeColumnType);
          return column;
        });
        const tables = kind === 'sqlite' ? [table, strict] : [table];
        const input = {
          operationId: randomUUID(),
          groupId: randomUUID(),
          clientId: randomUUID(),
          expectedVersion: 0,
          expectedSequence: 0,
          expectedDatabaseRevision: 0,
          includeDocument: true,
          commands: [
            ...tables.map((value) => ({ type: 'add_table', value })),
            ...columns.map((value) => ({ type: 'add_column', value })),
          ],
        };
        const response = await api(`/projects/${id}/native-sync/commands`, 'POST', input);
        expect(response.status, JSON.stringify(response.data)).toBe(201);
        const ack = nativeSyncOperationResultSchema.parse(response.data);
        expect(ack.status, JSON.stringify(ack)).toBe('accepted');
        const state = projectDocumentStateSchema.parse(
          (await api(`/projects/${id}/document-state`)).data,
        );
        expect(state.sourceDocument.columns?.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual(
          columns.toSorted((a, b) => a.id.localeCompare(b.id)),
        );
        for (const table of tables)
          expect(
            state.sourceDocument.columns
              ?.filter((column) => column.tableId === table.id)
              .map((column) => column.id),
          ).toEqual(
            columns.filter((column) => column.tableId === table.id).map((column) => column.id),
          );
        expect(state.project.version).toBe(1);
        expect(state.sequence).toBe(1);
        expect((await api(`/projects/${id}/native-sync/commands`, 'POST', input)).data).toEqual(
          response.data,
        );
        const read = await mcp.callTool({
          name: 'get_project_document_state',
          arguments: { projectId: id },
        });
        expect(read.isError, JSON.stringify(read.content)).not.toBe(true);
        expect(read.structuredContent).toEqual(state);
        const changed = await mcp.callTool({
          name: 'apply_native_project_changes',
          arguments: {
            projectId: id,
            operationId: randomUUID(),
            groupId: randomUUID(),
            clientId: randomUUID(),
            expectedVersion: 1,
            expectedSequence: 1,
            expectedDatabaseRevision: 0,
            includeDocument: true,
            commands: [
              ...(kind !== 'sqlite'
                ? [
                    {
                      type: 'patch_table',
                      id: table.id,
                      patch: { physical: { comment: 'Native table comment' } },
                    },
                    {
                      type: 'patch_column',
                      id: columns[0]!.id,
                      patch: { physical: { comment: 'Native column comment' } },
                    },
                  ]
                : []),
              ...(kind === 'postgresql'
                ? ['varchar', 'text'].map((name, i) => ({
                    type: 'patch_column',
                    id: columns[definitions.findIndex((type) => type.sqlName === name)]!.id,
                    patch: {
                      physical: {
                        options: { database: 'postgresql', collation: i === 0 ? 'C' : 'POSIX' },
                      },
                    },
                  }))
                : []),
              ...(kind === 'mysql'
                ? [
                    {
                      type: 'patch_column',
                      id: columns[definitions.findIndex((type) => type.sqlName === 'varchar')]!.id,
                      patch: {
                        physical: {
                          options: {
                            database: 'mysql',
                            charset: 'latin1',
                            collation: 'latin1_bin',
                          },
                        },
                      },
                    },
                  ]
                : []),
              {
                type: 'patch_column',
                id: columns[0]!.id,
                patch: { logical: { definition: 'Catalog native API/MCP roundtrip' } },
              },
            ],
          },
        });
        expect(changed.isError, JSON.stringify(changed.content)).not.toBe(true);
        const unreadyDefault = await api(`/projects/${id}/native-sync/commands`, 'POST', {
          ...input,
          operationId: randomUUID(),
          expectedVersion: 2,
          expectedSequence: 2,
          commands: [
            {
              type: 'patch_column',
              id: columns[0]!.id,
              patch: {
                physical: { defaultValue: { kind: 'literal', literalType: 'number', value: '1' } },
              },
            },
          ],
        });
        expect(unreadyDefault.data.status).toBe('rejected');
        expect(unreadyDefault.data.issues).toContainEqual(
          expect.objectContaining({ code: 'default.not-ready' }),
        );
        const ddl = projectDDLExportSchema.parse((await api(`/projects/${id}/ddl`)).data);
        expect(ddl.canExport, JSON.stringify(ddl)).toBe(true);
        expect(ddl.sql).toContain('catalog_types');
        const directory = fileURLToPath(
          new URL('../../../.data/native-catalog-path/', import.meta.url),
        );
        mkdirSync(directory, { recursive: true });
        writeFileSync(directory + kind + '.sql', ddl.sql, 'utf8');
        const final = projectDocumentStateSchema.parse(
          (await api(`/projects/${id}/document-state`)).data,
        );
        expect(
          final.sourceDocument.columns
            ?.toSorted((a, b) => a.id.localeCompare(b.id))
            .map((c) => c.physical.type),
        ).toEqual(columns.toSorted((a, b) => a.id.localeCompare(b.id)).map((c) => c.physical.type));
        const caps = (await api(`/projects/${id}/database/capabilities`)).data;
        expect(caps.types.filter((type: any) => type.usable).map((type: any) => type.id)).toEqual(
          definitions.map((type) => type.id),
        );
      },
    );
  },
);
