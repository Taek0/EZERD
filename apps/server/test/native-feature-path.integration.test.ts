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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deriveOperationChanges, type NativeDesignDocument } from '@ezerd/model';
import {
  nativeSyncOperationResultSchema,
  projectDDLExportSchema,
  projectDocumentStateSchema,
} from '@ezerd/contracts';
import {
  featurePathIds,
  featurePathComparable,
  nativeFeaturePathCases,
  nativeFeaturePathFixture,
  nativeFeaturePathCommands,
  nativeFeaturePathReadiness,
  type NativeFeaturePathFixture,
} from '../scripts/native-feature-path-fixtures.js';

describe.runIf(process.env.EZERD_DB_TEST === '1')(
  'actual native feature full project paths',
  () => {
    let app: NestExpressApplication,
      base: string,
      token: string,
      userId: string,
      workspaceId: string,
      pool: pg.Pool,
      mcp: Client;
    const oldPort = process.env.PORT,
      oldUrl = process.env.MCP_PUBLIC_URL;
    const requireAllPositive = process.env.EZERD_NATIVE_FEATURE_REQUIRE_ALL === '1';
    const requireCompiled = createRequire(import.meta.url),
      load = (path: string) => requireCompiled(resolve('apps/server/dist', path));
    const directory = resolve('.data/native-feature-path', randomUUID());
    const results: {
      key: string;
      kind: string;
      feature: string;
      status: string;
      files?: { channel: string; name: string; sqlSha256: string; documentSha256: string }[];
      missing?: string[];
      codes?: string[];
    }[] = [];
    const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
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
    async function state(id: string) {
      const response = await api(`/projects/${id}/document-state`);
      expect(response.status).toBe(200);
      return projectDocumentStateSchema.parse(response.data);
    }
    async function stored(id: string) {
      return (
        await pool.query(
          'SELECT document,version,sync_sequence,database_revision FROM projects WHERE id=$1',
          [id],
        )
      ).rows[0];
    }
    async function prepare(fixture: NativeFeaturePathFixture) {
      const created = await api('/projects', 'POST', {
        workspaceId,
        databaseKind: fixture.spec.kind,
        formatVersion: 2,
        name: 'Feature ' + fixture.spec.key,
      });
      expect(created.status, JSON.stringify(created.data)).toBe(201);
      const id: string = created.data.id;
      const request = {
        operationId: randomUUID(),
        groupId: randomUUID(),
        clientId: randomUUID(),
        expectedVersion: 0,
        expectedSequence: 0,
        expectedDatabaseRevision: 0,
        includeDocument: true,
        commands: [
          ...fixture.prepare.tables!.map((value) => ({ type: 'add_table', value })),
          ...fixture.prepare.columns!.map((value) => ({ type: 'add_column', value })),
        ],
      };
      const response = await api(`/projects/${id}/native-sync/commands`, 'POST', request);
      expect(response.status, JSON.stringify(response.data)).toBe(201);
      expect(
        nativeSyncOperationResultSchema.parse(response.data).status,
        JSON.stringify(response.data),
      ).toBe('accepted');
      const current = await state(id);
      expect(featurePathComparable(current.sourceDocument as NativeDesignDocument)).toEqual(
        featurePathComparable(fixture.prepare),
      );
      return { id, current };
    }
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        !url.pathname.startsWith('/ezerd_qa_')
      )
        throw Error('Disposable local isolated DB required');
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
      process.env.PORT = new URL(base).port;
      process.env.MCP_PUBLIC_URL = base + '/mcp';
      const user = await api('/users', 'POST', {
        username: 'feature-' + randomUUID().slice(0, 24),
        pin: '0024',
      });
      expect(user.status).toBe(201);
      userId = user.data.id;
      const session = await api('/sessions', 'POST', { userId, pin: '0024' });
      expect(session.status).toBe(201);
      token = session.data.token;
      const workspace = await api('/workspaces', 'POST', { name: 'Native feature path QA' });
      expect(workspace.status).toBe(201);
      workspaceId = workspace.data.id;
      const issued = await api('/mcp-tokens', 'POST', { name: 'Native feature paths' });
      expect(issued.status).toBe(201);
      mcp = new Client({ name: 'native-feature-path-qa', version: '1.0.0' });
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
          requestInit: { headers: { authorization: 'Bearer ' + issued.data.token } },
        }) as never,
      );
      mkdirSync(directory, { recursive: true });
    });
    afterAll(async () => {
      if (workspaceId) {
        const manifest = {
          formatVersion: 1,
          source: 'actual-rest-mcp',
          requireAllPositive,
          generatedAt: new Date().toISOString(),
          cases: results,
          expectedCases: nativeFeaturePathCases.map((spec) => spec.key),
        };
        writeFileSync(
          resolve(directory, 'manifest.json'),
          JSON.stringify(manifest, null, 2),
          'utf8',
        );
        console.log(
          JSON.stringify({
            nativeFeaturePath: resolve(directory, 'manifest.json'),
            accepted: results.filter((item) => item.status === 'accepted').length,
            blocked: results.filter((item) => item.status === 'blocked').length,
          }),
        );
      }
      await mcp?.close();
      await app?.close();
      if (oldPort === undefined) delete process.env.PORT;
      else process.env.PORT = oldPort;
      if (oldUrl === undefined) delete process.env.MCP_PUBLIC_URL;
      else process.env.MCP_PUBLIC_URL = oldUrl;
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
    it.each(nativeFeaturePathCases)(
      '$key: prepare → current baseline native write → authenticated MCP intro/patch/read/export',
      async (spec) => {
        const fixture = nativeFeaturePathFixture(spec),
          readiness = nativeFeaturePathReadiness(fixture);
        if (requireAllPositive)
          expect(
            readiness.ready,
            spec.key +
              ': ' +
              JSON.stringify({ missing: readiness.missing, errors: readiness.errors }),
          ).toBe(true);
        const prepared = await prepare(fixture),
          before = await stored(prepared.id),
          clientId = randomUUID();
        const baseline = await api(`/projects/${prepared.id}/native-sync/baseline`, 'POST', {
          clientId,
        });
        expect(baseline.status).toBe(201);
        const issued = baseline.data;
        expect(featurePathComparable(issued.document)).toEqual(
          featurePathComparable(fixture.prepare),
        );
        const input = {
          protocolVersion: 2,
          operationId: randomUUID(),
          groupId: randomUUID(),
          clientId,
          baselineId: issued.baselineId,
          baselineIssuedAt: issued.baselineIssuedAt,
          baseSequence: issued.sequence,
          database: issued.database,
          databaseRevision: issued.databaseRevision,
          kind: 'online',
          dependencyPaths: [],
          baselineDocument: issued.document,
          document: fixture.candidate,
          changes: deriveOperationChanges(issued.document, fixture.candidate),
        };
        const response = await api(
          `/projects/${prepared.id}/native-sync/operations`,
          'POST',
          input,
        );
        expect(response.status, JSON.stringify(response.data)).toBe(201);
        const restAck = nativeSyncOperationResultSchema.parse(response.data);
        expect(restAck.status, JSON.stringify(restAck)).toBe(
          readiness.ready ? 'accepted' : 'rejected',
        );
        expect(
          (await api(`/projects/${prepared.id}/native-sync/operations`, 'POST', input)).data,
        ).toEqual(response.data);
        const restFinal = await state(prepared.id);
        expect(restFinal.project.databaseRevision).toBe(0);
        expect(restFinal.sequence).toBe(before.sync_sequence + 1);
        expect(restFinal.project.version).toBe(before.version + (readiness.ready ? 1 : 0));
        expect(featurePathComparable(restFinal.sourceDocument as NativeDesignDocument)).toEqual(
          featurePathComparable(readiness.ready ? fixture.candidate : fixture.prepare),
        );
        const second = await prepare(fixture);
        const mcpInput = {
          projectId: second.id,
          operationId: randomUUID(),
          groupId: randomUUID(),
          clientId: randomUUID(),
          expectedVersion: second.current.project.version,
          expectedSequence: second.current.sequence,
          expectedDatabaseRevision: second.current.project.databaseRevision,
          includeDocument: true,
          commands: nativeFeaturePathCommands(fixture),
        };
        const introduced = await mcp.callTool({
          name: 'apply_native_project_changes',
          arguments: mcpInput,
        });
        expect(introduced.isError, JSON.stringify(introduced.content)).not.toBe(true);
        const mcpAck = nativeSyncOperationResultSchema.parse(introduced.structuredContent);
        expect(mcpAck.status, JSON.stringify(mcpAck)).toBe(restAck.status);
        expect(
          (await mcp.callTool({ name: 'apply_native_project_changes', arguments: mcpInput }))
            .structuredContent,
        ).toEqual(introduced.structuredContent);
        const mcpCurrent = await state(second.id);
        expect(featurePathComparable(mcpCurrent.sourceDocument as NativeDesignDocument)).toEqual(
          featurePathComparable(readiness.ready ? fixture.candidate : fixture.prepare),
        );
        const read = await mcp.callTool({
          name: 'get_project_document_state',
          arguments: { projectId: second.id },
        });
        expect(read.isError).not.toBe(true);
        expect(read.structuredContent).toEqual(mcpCurrent);
        if (!readiness.ready) {
          expect(
            restAck.issues?.some((issue) =>
              [
                'feature.not-implemented',
                'type.not-implemented',
                'default.not-ready',
                'column.on-update-not-ready',
              ].includes(issue.code),
            ),
            JSON.stringify(restAck),
          ).toBe(true);
          expect(
            mcpAck.issues?.some((issue) =>
              [
                'feature.not-implemented',
                'type.not-implemented',
                'default.not-ready',
                'column.on-update-not-ready',
              ].includes(issue.code),
            ),
            JSON.stringify(mcpAck),
          ).toBe(true);
          expect((await stored(prepared.id)).document).toEqual(before.document);
          const safeDDL = projectDDLExportSchema.parse(
            (await api(`/projects/${prepared.id}/ddl`)).data,
          );
          expect(safeDDL.canExport, JSON.stringify(safeDDL)).toBe(true);
          results.push({
            key: spec.key,
            kind: spec.kind,
            feature: spec.feature,
            status: 'blocked',
            missing: readiness.missing,
            codes: [...new Set(restAck.issues?.map((issue) => issue.code))],
          });
          return;
        }
        const patched = await mcp.callTool({
          name: 'apply_native_project_changes',
          arguments: {
            ...mcpInput,
            operationId: randomUUID(),
            groupId: randomUUID(),
            expectedVersion: mcpCurrent.project.version,
            expectedSequence: mcpCurrent.sequence,
            commands: [
              {
                type: 'patch_column',
                id: featurePathIds.id,
                patch: { logical: { definition: 'feature path ' + spec.key } },
              },
            ],
          },
        });
        expect(patched.isError, JSON.stringify(patched.content)).not.toBe(true);
        expect(nativeSyncOperationResultSchema.parse(patched.structuredContent).status).toBe(
          'accepted',
        );
        const final = await state(second.id),
          expected = structuredClone(fixture.candidate);
        expected.columns!.find((column) => column.id === featurePathIds.id)!.logical.definition =
          'feature path ' + spec.key;
        expect(featurePathComparable(final.sourceDocument as NativeDesignDocument)).toEqual(
          featurePathComparable(expected),
        );
        const files = [];
        for (const [channel, id, document] of [
          ['rest', prepared.id, restFinal.sourceDocument],
          ['mcp', second.id, final.sourceDocument],
        ] as const) {
          const dto = projectDDLExportSchema.parse((await api(`/projects/${id}/ddl`)).data);
          expect(dto.canExport, JSON.stringify(dto)).toBe(true);
          expect(dto.sql.length).toBeGreaterThan(0);
          const remote = await mcp.callTool({
            name: 'export_project_ddl',
            arguments: { projectId: id },
          });
          expect(remote.isError, JSON.stringify(remote.content)).not.toBe(true);
          expect(remote.structuredContent).toEqual(dto);
          const name = spec.key + '-' + channel + '.sql';
          writeFileSync(resolve(directory, name), dto.sql, 'utf8');
          const documentName = spec.key + '-' + channel + '.json';
          writeFileSync(resolve(directory, documentName), JSON.stringify(document), 'utf8');
          files.push({
            channel,
            name,
            sqlSha256: sha(dto.sql),
            documentSha256: sha(JSON.stringify(document)),
          });
        }
        results.push({
          key: spec.key,
          kind: spec.kind,
          feature: spec.feature,
          status: 'accepted',
          files,
        });
      },
    );
    it.each(['postgresql', 'mysql', 'sqlite'] as const)(
      '%s unsupported installed collation never gains authority from a valid fixture',
      async (kind) => {
        const fixture = nativeFeaturePathFixture(
          nativeFeaturePathCases.find((spec) => spec.kind === kind && spec.feature === 'column')!,
        );
        const prepared = await prepare(fixture),
          before = await stored(prepared.id),
          clientId = randomUUID(),
          issued = (
            await api(`/projects/${prepared.id}/native-sync/baseline`, 'POST', { clientId })
          ).data;
        const candidate = structuredClone(issued.document);
        candidate.columns.find(
          (column: any) => column.id === featurePathIds.text,
        ).physical.options = { database: kind, collation: 'qa_missing_collation' };
        const response = await api(`/projects/${prepared.id}/native-sync/operations`, 'POST', {
          protocolVersion: 2,
          operationId: randomUUID(),
          groupId: randomUUID(),
          clientId,
          baselineId: issued.baselineId,
          baselineIssuedAt: issued.baselineIssuedAt,
          baseSequence: issued.sequence,
          database: issued.database,
          databaseRevision: issued.databaseRevision,
          kind: 'online',
          dependencyPaths: [],
          baselineDocument: issued.document,
          document: candidate,
          changes: deriveOperationChanges(issued.document, candidate),
        });
        expect(
          response.status === 400 || response.data.status === 'rejected',
          JSON.stringify(response.data),
        ).toBe(true);
        if (response.status !== 400)
          expect(
            response.data.issues.some((issue: any) => issue.code.includes('collation')),
            JSON.stringify(response.data),
          ).toBe(true);
        const mcpResponse = await mcp.callTool({
          name: 'apply_native_project_changes',
          arguments: {
            projectId: prepared.id,
            operationId: randomUUID(),
            groupId: randomUUID(),
            clientId: randomUUID(),
            expectedVersion: before.version,
            expectedSequence: (await state(prepared.id)).sequence,
            expectedDatabaseRevision: before.database_revision,
            commands: [
              {
                type: 'patch_column',
                id: featurePathIds.text,
                patch: {
                  physical: { options: { database: kind, collation: 'qa_missing_collation' } },
                },
              },
            ],
          },
        });
        expect(
          mcpResponse.isError === true ||
            (mcpResponse.structuredContent as any)?.status === 'rejected',
          JSON.stringify(mcpResponse),
        ).toBe(true);
        expect((await stored(prepared.id)).document).toEqual(before.document);
        expect((await stored(prepared.id)).version).toBe(before.version);
      },
    );
    it.each(['postgresql', 'mysql', 'sqlite'] as const)(
      '%s rejects reserved unknown default functions at both REST/MCP boundaries',
      async (kind) => {
        const fixture = nativeFeaturePathFixture(
          nativeFeaturePathCases.find((spec) => spec.kind === kind && spec.feature === 'column')!,
        );
        const prepared = await prepare(fixture),
          before = await stored(prepared.id),
          clientId = randomUUID(),
          issued = (
            await api(`/projects/${prepared.id}/native-sync/baseline`, 'POST', { clientId })
          ).data;
        const value = {
          kind: 'expression',
          expression: { kind: 'call', functionId: `${kind}:qa_reserved_unknown`, args: [] },
        };
        const candidate = structuredClone(issued.document);
        candidate.columns.find(
          (column: any) => column.id === featurePathIds.amount,
        ).physical.defaultValue = value;
        const response = await api(`/projects/${prepared.id}/native-sync/operations`, 'POST', {
          protocolVersion: 2,
          operationId: randomUUID(),
          groupId: randomUUID(),
          clientId,
          baselineId: issued.baselineId,
          baselineIssuedAt: issued.baselineIssuedAt,
          baseSequence: issued.sequence,
          database: issued.database,
          databaseRevision: issued.databaseRevision,
          kind: 'online',
          dependencyPaths: [],
          baselineDocument: issued.document,
          document: candidate,
          changes: deriveOperationChanges(issued.document, candidate),
        });
        expect(response.status).toBe(400);
        const changed = await mcp.callTool({
          name: 'apply_native_project_changes',
          arguments: {
            projectId: prepared.id,
            operationId: randomUUID(),
            groupId: randomUUID(),
            clientId: randomUUID(),
            expectedVersion: before.version,
            expectedSequence: before.sync_sequence,
            expectedDatabaseRevision: before.database_revision,
            commands: [
              {
                type: 'patch_column',
                id: featurePathIds.amount,
                patch: { physical: { defaultValue: value } },
              },
            ],
          },
        });
        expect(changed.isError, JSON.stringify(changed)).toBe(true);
        expect(await stored(prepared.id)).toEqual(before);
      },
    );
  },
);
