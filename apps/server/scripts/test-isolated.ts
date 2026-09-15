import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  configured.pathname = '/' + name;
  const env = { ...process.env, DATABASE_URL: configured.toString(), EZERD_DB_TEST: '1' };
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
      'apps/server/test/api.integration.test.ts',
      'apps/server/test/autosync.integration.test.ts',
    ],
    { cwd: root, env, stdio: 'inherit' },
  );
  if (result.status !== 0) throw new Error('Isolated integration tests failed.');
  console.log('PASS isolated migrations and API/WS QA');
} finally {
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
