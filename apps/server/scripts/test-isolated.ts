import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { readConfig } from '../src/config.js';

const configured = new URL(readConfig().DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname)) {
  throw new Error('Isolated QA requires a local PostgreSQL server.');
}
const name = 'ezerd_qa_' + randomUUID().replaceAll('-', '');
const admin = new pg.Pool({
  connectionString: configured.toString(),
  connectionTimeoutMillis: 3000,
});
const root = fileURLToPath(new URL('../../../', import.meta.url));
let created = false;
const mcpLogDir = mkdtempSync(join(tmpdir(), 'ezerd-mcp-integration-'));
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  configured.pathname = '/' + name;
  const env = {
    ...process.env,
    DATABASE_URL: configured.toString(),
    EZERD_DB_TEST: '1',
    NODE_ENV: 'test',
    MCP_ENABLED: 'true',
    MCP_PUBLIC_URL: 'http://127.0.0.1:3001/mcp',
    MCP_LOG_DIR: mcpLogDir,
  };
  const migrate = spawnSync('pnpm', ['--filter', '@ezerd/server', 'db:migrate'], {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (migrate.status !== 0) throw new Error('Isolated migration failed.');
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url)),
      'run',
      ...(process.argv.length > 2
        ? process.argv.slice(2)
        : ['apps/server/test/api.integration.test.ts', 'apps/server/test/mcp.integration.test.ts']),
    ],
    { cwd: root, env, stdio: 'inherit' },
  );
  if (result.status !== 0) throw new Error('Isolated integration tests failed.');
  console.log('PASS isolated migrations and API/WS QA');
} finally {
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
  rmSync(mcpLogDir, { recursive: true, force: true });
}
