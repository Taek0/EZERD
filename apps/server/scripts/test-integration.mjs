import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Invoking this script explicitly opts into local DB writes and scoped cleanup.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const vitest = fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url));
const mcpLogDir = mkdtempSync(join(tmpdir(), 'ezerd-mcp-integration-'));
const result = spawnSync(
  process.execPath,
  [
    vitest,
    'run',
    'apps/server/test/api.integration.test.ts',
    'apps/server/test/mcp.integration.test.ts',
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      EZERD_DB_TEST: '1',
      NODE_ENV: 'test',
      MCP_ENABLED: 'true',
      MCP_PUBLIC_URL: 'http://127.0.0.1:3001/mcp',
      MCP_LOG_DIR: mcpLogDir,
    },
    stdio: 'inherit',
  },
);
if (result.error) console.error('Could not launch the integration test runner.');
rmSync(mcpLogDir, { recursive: true, force: true });
process.exitCode = result.status ?? 1;
