import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('../../../docs/work-log/assets/', import.meta.url));
const read = (name: string, hash: string) => {
  const raw = readFileSync(directory + name, 'utf8');
  assert.equal(
    createHash('sha256').update(raw, 'utf8').digest('hex'),
    hash,
    'Downloaded artifact changed',
  );
  return raw;
};
const mysqlSQL = read(
  '2026-10-03-Database-NativeMySQLBrowserQA.sql',
  '7c2b832e9cf26ca022220398832eae5fc7c8ce9bac1de329aee67f691375db77',
);
const sqliteSQL = read(
  '2026-10-03-Database-NativeSQLiteBrowserQA.sql',
  '58d59b8a891f4f73e058340072c60337355773268a68987bfdb2ddc39dac5531',
);
const container = 'ezerd-native-ddl-qa-20261002';
const info = spawnSync('docker', ['inspect', '--format', '{{json .Config.Labels}}', container], {
  encoding: 'utf8',
});
assert.equal(info.status, 0, info.stderr);
assert.equal(JSON.parse(info.stdout)['ezerd.qa'], 'native-ddl-20261002');
const runMysql = (sql: string) => {
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
    { input: sql, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.replaceAll('\r\n', '\n').trim();
};
const name = 'ezerd_browser_sql_' + randomUUID().replaceAll('-', '');
assert.match(name, /^ezerd_browser_sql_[a-f0-9]{32}$/);
let created = false;
try {
  runMysql(`CREATE DATABASE \`${name}\`;`);
  created = true;
  const output = runMysql(
    `USE \`${name}\`;\n` +
      mysqlSQL +
      `\nINSERT INTO items() VALUES(); SELECT item_id FROM items; SELECT column_type FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='items' AND column_name='item_id'; SELECT is_visible FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='items' AND index_name='items_hidden_ix';`,
  );
  assert.equal(output, '7\nint unsigned\nNO');
} finally {
  if (created) runMysql(`DROP DATABASE \`${name}\`;`);
}
const executable = fileURLToPath(
  new URL('../../../.data/native-sqlite-345/sqlite3.exe', import.meta.url),
);
const runSqlite = (input: string) => {
  const result = spawnSync(executable, [':memory:'], {
    input: '.bail on\n' + input,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.replaceAll('\r\n', '\n').trim();
};
assert.equal(runSqlite('SELECT sqlite_version();'), '3.45.0');
const sqliteOutput = runSqlite(
  sqliteSQL +
    "\nINSERT INTO strict_items(id) VALUES(7); SELECT id FROM strict_items; SELECT strict || ':' || wr FROM pragma_table_list WHERE name='strict_items';",
);
assert.equal(sqliteOutput, '7\n1:1');
console.log(
  JSON.stringify({
    result: 'PASS',
    source: 'actual downloaded browser SQL without substitution',
    mysql: 'UNSIGNED INT/default7/PK/INVISIBLE',
    sqlite: '3.45.0 INTEGER/PK/STRICT/WITHOUT ROWID',
  }),
);
