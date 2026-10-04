import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  compileNativeDatabaseDDL,
  createNativeColumn,
  databaseTypeCatalog,
  type NativeColumnType,
} from '@ezerd/model';
import { nativeDDLFixture } from '../../../packages/model/dist/database/ddl-fixtures.js';
const executable = fileURLToPath(
  new URL('../../../.data/native-sqlite-345/sqlite3.exe', import.meta.url),
);
function run(sql: string, rejected = false) {
  const result = spawnSync(executable, [':memory:'], {
    input: '.bail on\n' + sql,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (rejected) assert.notEqual(result.status, 0, 'Expected rejected SQL');
  else assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
const version = run('SELECT sqlite_version();');
assert.equal(version, '3.45.0');
const sourceId = run('SELECT sqlite_source_id();');
assert.equal(
  sourceId,
  '2024-01-15 17:01:13 1066602b2b1976fe58b5150777cced894af17c803e068f5918390d6915b46e1d',
);
for (const definition of databaseTypeCatalog.filter((entry) => entry.databaseKind === 'sqlite')) {
  const doc = nativeDDLFixture('sqlite');
  doc.tables = [doc.tables![0]!];
  doc.keys = [];
  doc.checks = [];
  doc.indexes = [];
  doc.tableRelations = [];
  const column = createNativeColumn(doc.database, doc.tables[0]!, 'value');
  column.physical.name = 'value';
  column.physical.type = {
    kind: 'builtin',
    database: 'sqlite',
    typeId: definition.id,
    parameters: {},
  } as NativeColumnType;
  doc.columns = [column];
  if (definition.id === 'sqlite:any')
    doc.tables[0]!.physical.options = { database: 'sqlite', strict: true, withoutRowid: false };
  const result = compileNativeDatabaseDDL(doc);
  assert.equal(result.canExport, true, JSON.stringify(result.issues));
  assert.equal(run(result.sql + "\nSELECT COUNT(*) FROM pragma_table_info('parent');"), '1');
}
const doc = nativeDDLFixture('sqlite');
const compiled = compileNativeDatabaseDDL(doc);
assert.equal(compiled.canExport, true, JSON.stringify(compiled.issues));
assert.equal(
  run(
    compiled.sql +
      '\nINSERT INTO parent DEFAULT VALUES; INSERT INTO child(parent_id) VALUES(1); SELECT id,hex(label) FROM parent;',
  ),
  '1|' + Buffer.from("quote' and slash\\ 한글").toString('hex').toUpperCase(),
);
run(compiled.sql + '\nINSERT INTO child(parent_id) VALUES(99);', true);
run(
  compiled.sql +
    '\nINSERT INTO parent DEFAULT VALUES; INSERT INTO child(parent_id,score) VALUES(1,0);',
  true,
);
assert.equal(
  run(
    compiled.sql +
      '\nINSERT INTO parent DEFAULT VALUES; INSERT INTO child(parent_id) VALUES(1); DELETE FROM parent WHERE id=1; SELECT COUNT(*) FROM child;',
  ),
  '0',
);
const advanced = nativeDDLFixture('sqlite');
advanced.tables = [advanced.tables![0]!];
advanced.tableRelations = [];
advanced.checks = [];
advanced.columns = advanced.columns!.filter((column) => column.tableId === 'parent');
advanced.tables[0]!.physical.options = { database: 'sqlite', strict: true, withoutRowid: true };
advanced.columns[0]!.physical.generation = { kind: 'none' };
const generated = createNativeColumn(advanced.database, advanced.tables[0]!, 'computed');
generated.physical.name = 'size';
generated.physical.type = {
  kind: 'builtin',
  database: 'sqlite',
  typeId: 'sqlite:integer',
  parameters: {},
};
generated.physical.generation = {
  kind: 'computed',
  database: 'sqlite',
  storage: 'stored',
  expression: {
    kind: 'call',
    functionId: 'sqlite:length',
    args: [{ kind: 'column', columnId: 'label' }],
  },
};
advanced.columns.push(generated);
advanced.indexes![0]!.parts[0]!.expression = {
  kind: 'call',
  functionId: 'sqlite:lower',
  args: [{ kind: 'column', columnId: 'label' }],
};
advanced.indexes![0]!.options = {
  database: 'sqlite',
  predicate: { kind: 'isNull', operand: { kind: 'column', columnId: 'label' }, negate: true },
};
const result = compileNativeDatabaseDDL(advanced);
assert.equal(result.canExport, true, JSON.stringify(result.issues));
assert.equal(
  run(result.sql + "\nINSERT INTO parent(id,label) VALUES(1,'hello'); SELECT size FROM parent;"),
  '5',
);
run(result.sql + "\nINSERT INTO parent(id) VALUES('bad');", true);
doc.tableRelations![0]!.deferrable = { initially: 'deferred' };
const deferred = compileNativeDatabaseDDL(doc);
assert.equal(deferred.canExport, true, JSON.stringify(deferred.issues));
assert.equal(
  run(
    deferred.sql +
      '\nBEGIN; INSERT INTO child(parent_id) VALUES(1); INSERT INTO parent DEFAULT VALUES; COMMIT; SELECT COUNT(*) FROM child;',
  ),
  '1',
);
run(deferred.sql + '\nBEGIN; INSERT INTO child(parent_id) VALUES(1); COMMIT;', true);
console.log(
  JSON.stringify({
    result: 'PASS',
    version,
    sourceId,
    declarations: 23,
    behavior: [
      'FK/CHECK rejection',
      'cascade',
      'UTF8 defaults',
      'generated',
      'expression/partial index',
      'STRICT/WITHOUT ROWID',
      'deferred FK',
    ],
  }),
);
