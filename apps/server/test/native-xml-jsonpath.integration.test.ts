import 'reflect-metadata';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import pg from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  createNativeTable,
  createNativeColumn,
  defaultDatabaseContext,
  type NativeDefaultValue,
} from '@ezerd/model';
import { projectDDLExportSchema, nativeSyncOperationResultSchema } from '@ezerd/contracts';
import {
  postgresXmlJsonpathCases,
  postgresXmlJsonpathBlockedCases,
  postgresXmlJsonpathSchema,
} from '../scripts/postgres-xml-jsonpath-fixtures.js';

describe.runIf(process.env.EZERD_DB_TEST === '1')(
  'actual AppModule bounded XML/jsonpath typed defaults',
  () => {
    let app: NestExpressApplication,
      pool: pg.Pool,
      base: string,
      token: string,
      workspaceId: string,
      userId: string,
      mcp: Client;
    const oldPort = process.env.PORT,
      oldMcpUrl = process.env.MCP_PUBLIC_URL;
    const load = createRequire(import.meta.url),
      compiled = (file: string) => load(resolve('apps/server/dist', file));
    const directory = resolve('.data/native-xml-jsonpath', randomUUID()),
      files: {
        key: string;
        channel: string;
        name: string;
        sqlSha256: string;
        documentSha256: string;
      }[] = [];
    const sha = (value: string) => createHash('sha256').update(value).digest('hex');
    async function request(path: string, method = 'GET', body?: unknown) {
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
    const state = async (id: string) => (await request(`/projects/${id}/document-state`)).data;
    async function fresh(type: 'xml' | 'jsonpath') {
      const project = await request('/projects', 'POST', {
        workspaceId,
        databaseKind: 'postgresql',
        formatVersion: 2,
        name: 'Typed ' + type,
      });
      expect(project.status).toBe(201);
      const context = defaultDatabaseContext('postgresql'),
        table = createNativeTable(context, 'typed-table', null, 'both'),
        column = createNativeColumn(context, table, 'typed-column');
      table.physical.namespace = { kind: 'postgresSchema', name: postgresXmlJsonpathSchema };
      table.physical.name = 'typed_values';
      column.scope = 'both';
      column.physical.name = 'payload';
      column.physical.type = {
        kind: 'builtin',
        database: 'postgresql',
        typeId: `postgresql:${type}`,
        parameters: {},
      };
      const input = {
        operationId: randomUUID(),
        groupId: randomUUID(),
        clientId: randomUUID(),
        expectedVersion: 0,
        expectedSequence: 0,
        expectedDatabaseRevision: 0,
        commands: [
          { type: 'add_table', value: table },
          { type: 'add_column', value: column },
        ],
      };
      const prepared = await request(
        `/projects/${project.data.id}/native-sync/commands`,
        'POST',
        input,
      );
      expect(prepared.status, JSON.stringify(prepared.data)).toBe(201);
      expect(prepared.data.status, JSON.stringify(prepared.data)).toBe('accepted');
      return { id: project.data.id as string, current: await state(project.data.id) };
    }
    function patch(current: any, value: NativeDefaultValue) {
      return {
        operationId: randomUUID(),
        groupId: randomUUID(),
        clientId: randomUUID(),
        expectedVersion: current.project.version,
        expectedSequence: current.sequence,
        expectedDatabaseRevision: current.project.databaseRevision,
        includeDocument: true,
        commands: [
          {
            type: 'patch_column',
            id: 'typed-column',
            patch: { physical: { defaultValue: value } },
          },
        ],
      };
    }
    async function apply(channel: 'rest' | 'mcp', id: string, input: ReturnType<typeof patch>) {
      if (channel === 'rest') return request(`/projects/${id}/native-sync/commands`, 'POST', input);
      const result = await mcp.callTool({
        name: 'apply_native_project_changes',
        arguments: { projectId: id, ...input },
      });
      return {
        status: result.isError ? 422 : 201,
        data: result.structuredContent ?? result.content,
      };
    }
    beforeAll(async () => {
      const configured = new URL(process.env.DATABASE_URL!);
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname) ||
        !configured.pathname.startsWith('/ezerd_qa_')
      )
        throw Error('Disposable isolated DB required');
      pool = new pg.Pool({ connectionString: configured.toString() });
      app = await NestFactory.create<NestExpressApplication>(compiled('app.module.js').AppModule, {
        logger: false,
        bodyParser: false,
        abortOnError: false,
      });
      compiled('application.js').configureApplication(app);
      app.get(compiled('sync/sync.gateway.js').SyncGateway).attach(app.getHttpServer());
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      process.env.PORT = new URL(base).port;
      process.env.MCP_PUBLIC_URL = base + '/mcp';
      const actor = await request('/users', 'POST', {
        username: 'xml-path-' + randomUUID().slice(0, 20),
        pin: '0024',
      });
      expect(actor.status).toBe(201);
      userId = actor.data.id;
      const session = await request('/sessions', 'POST', { userId, pin: '0024' });
      expect(session.status).toBe(201);
      token = session.data.token;
      const workspace = await request('/workspaces', 'POST', { name: 'XML/jsonpath QA' });
      expect(workspace.status).toBe(201);
      workspaceId = workspace.data.id;
      const issued = await request('/mcp-tokens', 'POST', { name: 'XML/jsonpath' });
      expect(issued.status).toBe(201);
      mcp = new Client({ name: 'xml-jsonpath-qa', version: '1.0.0' });
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
          requestInit: { headers: { authorization: 'Bearer ' + issued.data.token } },
        }) as never,
      );
      mkdirSync(directory, { recursive: true });
    });
    afterAll(async () => {
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        resolve(directory, 'manifest.json'),
        JSON.stringify(
          { formatVersion: 1, source: 'actual-rest-mcp-xml-jsonpath', files },
          null,
          2,
        ),
      );
      console.log(
        JSON.stringify({
          xmlJsonpathManifest: resolve(directory, 'manifest.json'),
          actualSQL: files.length,
        }),
      );
      if (mcp) await mcp.close();
      if (app) await app.close();
      if (oldPort === undefined) delete process.env.PORT;
      else process.env.PORT = oldPort;
      if (oldMcpUrl === undefined) delete process.env.MCP_PUBLIC_URL;
      else process.env.MCP_PUBLIC_URL = oldMcpUrl;
      if (pool) {
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
      }
    });
    it.each(postgresXmlJsonpathCases)(
      '$key strict typed default → REST/MCP raw/replay/read → whole DDL',
      async (spec) => {
        for (const channel of ['rest', 'mcp'] as const) {
          const project = await fresh(spec.type),
            value: NativeDefaultValue = {
              kind: 'literal',
              literalType: 'typedText',
              value: spec.raw,
            },
            input = patch(project.current, value);
          const response = await apply(channel, project.id, input);
          expect(response.status, JSON.stringify(response.data)).toBe(201);
          expect(
            nativeSyncOperationResultSchema.parse(response.data).status,
            JSON.stringify(response.data),
          ).toBe('accepted');
          expect((await apply(channel, project.id, input)).data).toEqual(response.data);
          const current = await state(project.id);
          expect(current.sourceDocument.columns[0].physical.defaultValue).toEqual(value);
          expect(current.project.version).toBe(project.current.project.version + 1);
          expect(
            (
              await mcp.callTool({
                name: 'get_project_document_state',
                arguments: { projectId: project.id },
              })
            ).structuredContent,
          ).toEqual(current);
          const changed = structuredClone(input);
          changed.commands[0]!.patch.physical.defaultValue = { kind: 'none' };
          const conflict = await apply(channel, project.id, changed);
          expect(conflict.status).toBe(channel === 'rest' ? 409 : 422);
          // MCP deliberately exposes an opaque tool error; REST proves the fingerprint cause.
          const refusal =
            channel === 'rest'
              ? conflict
              : await request(`/projects/${project.id}/native-sync/commands`, 'POST', changed);
          expect(refusal.status).toBe(409);
          expect(refusal.data).toMatchObject({ code: 'sync.replay-mismatch' });
          expect(await state(project.id)).toEqual(current);
          const ddl = projectDDLExportSchema.parse(
            (await request(`/projects/${project.id}/ddl`)).data,
          );
          expect(ddl.canExport, JSON.stringify(ddl)).toBe(true);
          expect(ddl.sql).toContain(` AS ${spec.type.toUpperCase()})`);
          const remote = await mcp.callTool({
            name: 'export_project_ddl',
            arguments: { projectId: project.id },
          });
          expect(remote.isError).not.toBe(true);
          expect(remote.structuredContent).toEqual(ddl);
          const name = `${spec.key}-${channel}.sql`,
            raw = JSON.stringify(current.sourceDocument);
          writeFileSync(resolve(directory, name), ddl.sql);
          writeFileSync(resolve(directory, name.replace(/\.sql$/, '.json')), raw);
          files.push({
            key: spec.key,
            channel,
            name,
            sqlSha256: sha(ddl.sql),
            documentSha256: sha(raw),
          });
        }
      },
    );
    it.each(postgresXmlJsonpathBlockedCases)(
      '$type/$reason blocks excluded input through REST/MCP without changing source/version',
      async (spec) => {
        for (const channel of ['rest', 'mcp'] as const) {
          const project = await fresh(spec.type),
            input = patch(project.current, {
              kind: 'literal',
              literalType: 'typedText',
              value: spec.raw,
            });
          const response = await apply(channel, project.id, input);
          if (response.status === 201) {
            expect(response.data.status).toBe('rejected');
            expect(JSON.stringify(response.data.issues)).toContain('default.');
          } else {
            expect([400, 422]).toContain(response.status);
            expect(JSON.stringify(response.data)).toMatch(/default\.|literal\./);
          }
          const current = await state(project.id);
          expect(current.sourceDocument).toEqual(project.current.sourceDocument);
          expect(current.project.version).toBe(project.current.project.version);
        }
      },
    );
    it.each(['xml', 'jsonpath'] as const)(
      '%s rejects implicit string/default expression typedText and arbitrary native expression claims',
      async (type) => {
        const spec = postgresXmlJsonpathCases.find((item) => item.type === type)!;
        for (const channel of ['rest', 'mcp'] as const)
          for (const value of [
            { kind: 'literal', literalType: 'string', value: spec.raw },
            {
              kind: 'expression',
              expression: { kind: 'literal', literalType: 'typedText', value: spec.raw },
            },
          ] satisfies NativeDefaultValue[]) {
            const project = await fresh(type),
              response = await apply(channel, project.id, patch(project.current, value));
            if (response.status === 201) expect(response.data.status).toBe('rejected');
            else expect([400, 422]).toContain(response.status);
            expect(JSON.stringify(response.data)).toMatch(/default\.|literal\./);
            const current = await state(project.id);
            expect(current.sourceDocument).toEqual(project.current.sourceDocument);
            expect(current.project.version).toBe(project.current.project.version);
          }
      },
    );
  },
);
