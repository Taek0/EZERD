import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readConfig } from '../src/config.js';
const directory = fileURLToPath(new URL('../../../.data/native-catalog-path/', import.meta.url));
const sql = (kind: string) => readFileSync(directory + kind + '.sql', 'utf8');
const configured = new URL(readConfig().DATABASE_URL);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(configured.hostname))
  throw Error('Local execution QA only');
const client = new pg.Client({ connectionString: configured.toString() });
await client.connect();
try {
  await client.query('BEGIN');
  const schema = /qa_native_catalog_[a-f0-9]{32}/.exec(sql('postgresql'))?.[0];
  assert.ok(schema);
  await client.query(sql('postgresql'));
  const count = await client.query(
    "SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema=$1 AND table_name='catalog_types'",
    [schema],
  );
  assert.equal(count.rows[0].count, '64');
} finally {
  await client.query('ROLLBACK');
  await client.end();
}
const executable = fileURLToPath(
  new URL('../../../.data/native-sqlite-345/sqlite3.exe', import.meta.url),
);
const sqlite = spawnSync(executable, [':memory:'], {
  input:
    '.bail on\n' +
    sql('sqlite') +
    "\nSELECT (SELECT COUNT(*) FROM pragma_table_info('catalog_types'))+(SELECT COUNT(*) FROM pragma_table_info('strict_types'));",
  encoding: 'utf8',
});
assert.equal(sqlite.status, 0, sqlite.stderr);
assert.equal(sqlite.stdout.trim(), '23');
const container = 'ezerd-native-ddl-qa-20261002';
const inspect = spawnSync('docker', ['inspect', '--format', '{{json .Config.Labels}}', container], {
  encoding: 'utf8',
});
assert.equal(inspect.status, 0, inspect.stderr);
assert.equal(JSON.parse(inspect.stdout)['ezerd.qa'], 'native-ddl-20261002');
const name = 'ezerd_catalog_' + randomUUID().replaceAll('-', '');
const mysql = (input: string) => {
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      container,
      'mysql',
      '-uroot',
      '--batch',
      '--skip-column-names',
      '--default-character-set=utf8mb4',
    ],
    { input, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
let created = false;
try {
  mysql(`CREATE DATABASE \`${name}\`;`);
  created = true;
  mysql(`USE \`${name}\`;\n` + sql('mysql'));
  assert.equal(
    mysql(
      `SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='${name}' AND table_name='catalog_types';`,
    ),
    '37',
  );
} finally {
  if (created) mysql(`DROP DATABASE \`${name}\`;`);
}
console.log(
  JSON.stringify({
    result: 'PASS',
    source: 'actual native REST/MCP whole physical project export',
    declarations: { postgresql: 64, mysql: 37, sqlite: 23 },
  }),
);
