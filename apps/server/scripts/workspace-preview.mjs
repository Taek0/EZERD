import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { NestFactory } from '@nestjs/core';
import { createEmptyDocument, addDomain, deriveOperationChanges } from '@ezerd/model';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const url = new URL(process.env.DATABASE_URL);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  throw new Error('Preview requires local PostgreSQL.');
const name = `ezerd_workspace_preview_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: url.toString() });
await admin.query(`CREATE DATABASE "${name}"`);
url.pathname = `/${name}`;
process.env.DATABASE_URL = url.toString();
process.env.NODE_ENV = 'test';
process.env.MCP_ENABLED = 'false';
const pool = new pg.Pool({ connectionString: url.toString() });
let app;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (app) await app.close();
  await pool.end();
  if (/^ezerd_workspace_preview_[a-f0-9]{32}$/.test(name))
    await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
  process.exit(0);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
try {
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL('../drizzle/', import.meta.url)),
  });
  await pool.query('ALTER TABLE projects ALTER COLUMN workspace_id SET NOT NULL');
  const { AppModule } = await import('../dist/app.module.js');
  const { configureApplication } = await import('../dist/application.js');
  const { SyncGateway } = await import('../dist/sync/sync.gateway.js');
  app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
  configureApplication(app);
  await app.listen(3401, '127.0.0.1');
  app.get(SyncGateway).attach(app.getHttpServer());
  const api = async (path, method = 'GET', body, token) => {
    const response = await fetch(`http://127.0.0.1:3401/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`Preview fixture failed: ${path}, ${response.status}`);
    return response.json();
  };
  const owner = await api('/users', 'POST', { username: 'workspace-qa-owner', pin: '0424' });
  const viewer = await api('/users', 'POST', { username: 'workspace-qa-viewer', pin: '0424' });
  const ownerSession = await api('/sessions', 'POST', { userId: owner.id, pin: '0424' });
  const viewerSession = await api('/sessions', 'POST', { userId: viewer.id, pin: '0424' });
  const space = await api('/workspaces', 'POST', { name: 'QA workspace' }, ownerSession.token);
  const invite = await api(
    `/workspaces/${space.id}/invitations`,
    'POST',
    { username: viewer.username, role: 'viewer' },
    ownerSession.token,
  );
  await api(`/workspace-invitations/${invite.id}/accept`, 'POST', {}, viewerSession.token);
  const project = await api(
    '/projects',
    'POST',
    { workspaceId: space.id, name: 'Workspace role verification' },
    ownerSession.token,
  );
  const clientId = randomUUID();
  const baseline = await api(
    `/projects/${project.id}/sync-baseline`,
    'POST',
    { clientId },
    ownerSession.token,
  );
  const document = addDomain(
    createEmptyDocument(),
    { id: 'qa-domain', name: 'Sample domain', description: 'Viewer can review this design.' },
    { x: 100, y: 100 },
  );
  await api(
    `/projects/${project.id}/operations`,
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
      changes: deriveOperationChanges(baseline.document, document),
      baselineDocument: baseline.document,
      document,
    },
    ownerSession.token,
  );
  console.log('Isolated workspace preview ready: http://127.0.0.1:3401');
  console.log('Disposable QA accounts: workspace-qa-owner / workspace-qa-viewer; PIN 0424.');
} catch {
  console.error('Could not start isolated workspace preview.');
  await stop();
}
