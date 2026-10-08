import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Both runners require localhost and create/drop their own disposable database.
// Workspace migration fixtures have a different safety prefix from Native suites.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const workspace = new Set([
  'project-gallery.integration.test.ts',
  'workspace-domain.integration.test.ts',
  'workspace.integration.test.ts',
]);
const files = readdirSync(new URL('../test/', import.meta.url))
  .filter((file) => file.endsWith('.integration.test.ts'))
  .sort();
for (const file of workspace)
  if (!files.includes(file)) throw new Error(`Missing workspace regression suite: ${file}`);

const groups = [
  {
    label: 'Native and API regression',
    command: [
      '--import',
      pathToFileURL(require.resolve('tsx')).href,
      fileURLToPath(new URL('test-isolated.ts', import.meta.url)),
    ],
    files: files.filter((file) => !workspace.has(file)),
  },
  {
    label: 'Workspace regression',
    command: [fileURLToPath(new URL('test-workspaces.mjs', import.meta.url))],
    files: files.filter((file) => workspace.has(file)),
  },
];
for (const group of groups) {
  console.log(`${group.label}: ${group.files.length} suites in a disposable local database.`);
  const result = spawnSync(
    process.execPath,
    [...group.command, ...group.files.map((file) => `apps/server/test/${file}`), '--maxWorkers=2'],
    { cwd: root, env: process.env, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
