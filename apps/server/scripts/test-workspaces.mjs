import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { prepareWorkspaceMigration } from './prepare-workspace-migration.mjs';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const root = fileURLToPath(new URL('../../../', import.meta.url));
const configuredUrl = new URL(process.env.DATABASE_URL);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(configuredUrl.hostname))
  throw new Error('Isolated integration setup requires a local PostgreSQL server.');
const databaseName = `ezerd_workspace_test_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: configuredUrl.toString() });
let created = false;
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  configuredUrl.pathname = `/${databaseName}`;
  const testUrl = configuredUrl.toString();
  const pool = new pg.Pool({ connectionString: testUrl });
  try {
    await prepareWorkspaceMigration(drizzle(pool));
    await migrate(drizzle(pool), {
      migrationsFolder: fileURLToPath(new URL('../drizzle/', import.meta.url)),
    });
    await pool.query('ALTER TABLE projects ALTER COLUMN workspace_id SET NOT NULL');
  } finally {
    await pool.end();
  }
  console.log('Running workspace integration tests in a newly created isolated database.');
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url)),
      'run',
      ...(process.argv.slice(2).length
        ? process.argv.slice(2)
        : [
            'apps/server/test/api.integration.test.ts',
            'apps/server/test/mcp.integration.test.ts',
            'apps/server/test/workspace.integration.test.ts',
            'apps/server/test/workspace-domain.integration.test.ts',
          ]),
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: testUrl,
        EZERD_DB_TEST: '1',
        EZERD_WORKSPACE_DB_TEST: '1',
        NODE_ENV: 'test',
        MCP_ENABLED: 'true',
        MCP_PUBLIC_URL: 'http://127.0.0.1:3001/mcp',
        MCP_LOG_DIR: '.data/logs/workspace-test',
      },
      stdio: 'inherit',
    },
  );
  if (result.error) console.error('Could not start isolated test runner.');
  process.exitCode = result.status ?? 1;
} finally {
  // This name is generated here and can never name the configured development DB.
  if (created && /^ezerd_workspace_test_[a-f0-9]{32}$/.test(databaseName))
    await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
}
