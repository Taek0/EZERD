import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Invoking this script explicitly opts into local DB writes and scoped cleanup.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const vitest = fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url));
const result = spawnSync(
  process.execPath,
  [
    vitest,
    'run',
    'apps/server/test/api.integration.test.ts',
    'apps/server/test/autosync.integration.test.ts',
  ],
  {
    cwd: root,
    env: { ...process.env, EZERD_DB_TEST: '1' },
    stdio: 'inherit',
  },
);
if (result.error) console.error('Could not launch the integration test runner.');
process.exitCode = result.status ?? 1;
