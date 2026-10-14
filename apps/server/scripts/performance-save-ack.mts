import { createNativeColumn, requestFingerprint } from '@ezerd/model';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { parse as parseEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { nativeSyncOperationResultSchema, projectDocumentStateSchema } from '@ezerd/contracts';
import { createNativePerformanceFixture } from '../../web/src/shared/performance/native-fixture.js';
import { nativeEntryAfterAck } from '../../web/src/features/projects/native-ack-entry.js';

if (process.env.EZERD_SAVE_BENCH !== '1') throw Error('Explicit EZERD_SAVE_BENCH=1 required');
if (process.env.EZERD_SAVE_BENCH_ENV)
  process.env.DATABASE_URL = parseEnv(readFileSync(process.env.EZERD_SAVE_BENCH_ENV)).DATABASE_URL;
const { readConfig } = await import('../dist/config.js');
const config = readConfig();
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(config.DATABASE_URL).hostname))
  throw Error('Local DB only');
const { AppModule } = await import('../dist/app.module.js');
const { configureApplication } = await import('../dist/application.js');
const { DatabaseService } = await import('../dist/db/database.service.js');
const { McpNativeDocumentService } = await import('../dist/mcp/mcp-native-document.service.js');
const { NativeSyncService } = await import('../dist/sync/native-sync.service.js');
const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
let measurement: any = null;
const db: any = app.get(DatabaseService);
db.pool.on('connect', (client: any) => {
  const query = client.query;
  client.query = function (...args: any[]) {
    const sample = measurement,
      start = performance.now();
    const value = query.apply(this, args);
    if (sample && value?.then)
      return value.finally(() => {
        sample.sqlMs += performance.now() - start;
        sample.sqlCount++;
      });
    return value;
  };
});
for (const [service, key] of [
  [app.get(McpNativeDocumentService), 'commandMs'],
  [app.get(NativeSyncService), 'syncMs'],
] as const) {
  const original = service.apply.bind(service);
  (service as any).apply = async (...args: any[]) => {
    const sample = measurement,
      start = performance.now();
    try {
      return await (original as any)(...args);
    } finally {
      if (sample) sample[key] = performance.now() - start;
    }
  };
}
configureApplication(app as any);
let userId: string | undefined,
  workspaceId: string | undefined,
  token = '';
const projectIds: string[] = [];
const records: any[] = [];
const compact = process.env.EZERD_ACK_MODE === 'delta';
const out = fileURLToPath(
  new URL(
    '../../../artifacts/performance/2026-10-14-async-final-' + (compact ? 'delta' : 'full') + '/',
    import.meta.url,
  ),
);
mkdirSync(out, { recursive: true });
try {
  await pool.query('select 1');
  try {
    await db.checkReady();
  } catch (error: any) {
    console.error(
      'DB preflight',
      error.cause?.code ?? error.code,
      error.cause?.message ?? 'readiness failed',
    );
    throw Error('DB readiness failed');
  }
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const request = async (path: string, method = 'GET', body?: unknown, allowed = 200) => {
    const start = performance.now();
    const response = await fetch(base + '/api' + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(compact ? { 'x-ezerd-native-ack': 'delta-v1' } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const headersMs = performance.now() - start;
    const raw = await response.text();
    const httpMs = performance.now() - start;
    const parseStart = performance.now();
    const data = JSON.parse(raw);
    const jsonMs = performance.now() - parseStart;
    if (response.status !== allowed)
      throw Error(
        `${method} ${path.replace(/[0-9a-f-]{36}/g, '<id>')}: ${response.status} ${JSON.stringify(data).slice(0, 250)}`,
      );
    return { data, headersMs, httpMs, jsonMs, bytes: Buffer.byteLength(raw) };
  };
  const user = (
    await request(
      '/users',
      'POST',
      { username: 'perf-ack-' + randomUUID().slice(0, 12), pin: '0012' },
      201,
    )
  ).data;
  userId = user.id;
  token = (await request('/sessions', 'POST', { userId, pin: '0012' }, 201)).data.token;
  workspaceId = (await request('/workspaces', 'POST', { name: 'perf-ack-' + randomUUID() }, 201))
    .data.id;
  for (const count of [10, 50, 100]) {
    const created = (
      await request(
        '/projects',
        'POST',
        { workspaceId, name: 'save-ack-' + count, databaseKind: 'postgresql' },
        201,
      )
    ).data;
    projectIds.push(created.id);
    const fixture = createNativePerformanceFixture(count, 10);
    await pool.query('UPDATE projects SET document=$2::jsonb WHERE id=$1', [
      created.id,
      JSON.stringify(fixture.document),
    ]);
    const snapshot = projectDocumentStateSchema.parse(
      (await request(`/projects/${created.id}/document-state`)).data,
    );
    if (snapshot.native.status !== 'available') throw Error('Native fixture unavailable');
    let entry: any = {
      kind: 'native',
      snapshot,
      document: snapshot.native.document,
      personalUnavailable: false,
    };
    for (let repetition = 0; repetition < 4; repetition++) {
      const addedColumn = createNativeColumn(
        entry.document.database,
        entry.document.tables[0],
        randomUUID(),
      );
      for (const action of ['rename', 'add-column', 'delete-column', 'batch-properties']) {
        const commands =
          action === 'batch-properties'
            ? entry.document.columns.slice(0, 10).map((column: any) => ({
                type: 'patch_column',
                id: column.id,
                patch: { physical: { comment: 'batch_' + repetition } },
              }))
            : action === 'rename'
              ? [
                  {
                    type: 'patch_table',
                    id: entry.document.tables[0].id,
                    patch: { physical: { name: 'bench_' + count + '_' + repetition } },
                  },
                ]
              : action === 'add-column'
                ? [{ type: 'add_column', value: addedColumn }]
                : [
                    {
                      type: 'delete_objects',
                      targets: [{ collection: 'columns', id: addedColumn.id }],
                      cascadeGeneratedColumns: false,
                    },
                  ];
        const operationId = randomUUID();
        const lookup = await request(
          `/projects/${created.id}/native-sync/operations/${operationId}`,
          'GET',
          undefined,
          404,
        );
        const sample: any = {
          action,
          count,
          repetition,
          warmup: repetition === 0,
          lookupMs: lookup.httpMs,
          sqlMs: 0,
          sqlCount: 0,
        };
        measurement = sample;
        const response = await request(
          `/projects/${created.id}/native-sync/commands`,
          'POST',
          {
            operationId,
            groupId: operationId,
            clientId: randomUUID(),
            expectedVersion: entry.snapshot.project.version,
            expectedSequence: entry.snapshot.sequence,
            expectedDatabaseRevision: entry.snapshot.project.databaseRevision,
            includeDocument: true,
            commands,
          },
          201,
        );
        measurement = null;
        const schemaStart = performance.now();
        const ack = nativeSyncOperationResultSchema.parse(response.data);
        const schemaMs = performance.now() - schemaStart;
        const ackStart = performance.now();
        const next = nativeEntryAfterAck(entry, ack);
        const applyAckMs = performance.now() - ackStart;
        if (
          ack.status !== 'accepted' ||
          !next ||
          next.document?.tables?.[0]?.physical.name !== `bench_${count}_${repetition}`
        )
          throw Error('ACK application mismatch');
        const added = next.document.columns.some((column: any) => column.id === addedColumn.id);
        if ((action === 'add-column' && !added) || (action === 'delete-column' && added))
          throw Error('Column ACK mismatch');
        if (compact) {
          if (!ack.delta || ack.document) throw Error('Compact negotiation failed');
          const replay = await request(
            `/projects/${created.id}/native-sync/operations/${operationId}`,
          );
          if (requestFingerprint(replay.data) !== requestFingerprint(response.data))
            throw Error('Compact lookup replay mismatch');
          const authoritative = projectDocumentStateSchema.parse(
            (await request(`/projects/${created.id}/document-state`)).data,
          );
          if (
            requestFingerprint(authoritative.sourceDocument) !==
            requestFingerprint(next.snapshot.sourceDocument)
          )
            throw Error('Compact/full state mismatch');
        }
        entry = next;
        records.push({
          ...sample,
          httpMs: response.httpMs,
          headersMs: response.headersMs,
          jsonMs: response.jsonMs,
          bytes: response.bytes,
          schemaMs,
          applyAckMs,
          accepted: true,
        });
      }
    }
  }
} finally {
  measurement = null;
  writeFileSync(out + 'samples.json', JSON.stringify({ node: process.version, records }, null, 2));
  if (projectIds.length)
    await pool.query('DELETE FROM projects WHERE id=ANY($1::uuid[])', [projectIds]);
  if (workspaceId) {
    for (const table of [
      'workspace_invitations',
      'user_workspaces',
      'workspace',
      'workspace_audit_events',
    ])
      await pool.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [workspaceId]);
  }
  if (userId) await pool.query('DELETE FROM users WHERE id=$1', [userId]);
  await pool.end();
  await app.close();
}
console.log(JSON.stringify(records));
