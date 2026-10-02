import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import {
  compileNativeDatabaseDDL,
  createNativeColumn,
  databaseTypeCatalog,
  type NativeColumnType,
} from '@ezerd/model';
import { nativeDDLFixture } from '../../../packages/model/dist/database/ddl-fixtures.js';

const container = 'ezerd-native-ddl-qa-20261002';
const inspect = spawnSync('docker', ['inspect', '--format', '{{json .Config.Labels}}', container], {
  encoding: 'utf8',
});
assert.equal(inspect.status, 0, inspect.stderr);
assert.equal(JSON.parse(inspect.stdout)['ezerd.qa'], 'native-ddl-20261002');
const database = 'ezerd_ddl_' + randomUUID().replaceAll('-', '');
function execute(sql: string, accepted = true) {
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
  if (accepted) assert.equal(result.status, 0, result.stderr);
  else assert.notEqual(result.status, 0, 'Expected DB to reject invalid data');
  return result;
}
function use(sql: string) {
  return `USE \`${database}\`;\n${sql}`;
}
let created = false;
try {
  execute(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4;`);
  created = true;
  const doc = nativeDDLFixture('mysql');
  const compiled = compileNativeDatabaseDDL(doc);
  assert.equal(compiled.canExport, true, JSON.stringify(compiled.issues));
  execute(use(compiled.sql));
  execute(use('INSERT INTO parent () VALUES (); INSERT INTO child(parent_id) VALUES(1);'));
  const actual = execute(use('SELECT HEX(label),id FROM parent;')).stdout.trim();
  assert.equal(
    actual,
    Buffer.from("quote' and slash\\ 한글").toString('hex').toUpperCase() + '\t1',
  );
  assert.match(execute(use('INSERT INTO child(parent_id) VALUES(99);'), false).stderr, /1452/);
  assert.match(
    execute(use('INSERT INTO child(parent_id,score) VALUES(1,0);'), false).stderr,
    /3819/,
  );
  assert.equal(
    execute(use('DELETE FROM parent WHERE id=1; SELECT COUNT(*) FROM child;')).stdout.trim(),
    '0',
  );
  const definitions = databaseTypeCatalog.filter((type) => type.databaseKind === 'mysql');
  for (const [i, definition] of definitions.entries()) {
    const typed = nativeDDLFixture('mysql');
    typed.tables = [typed.tables![0]!];
    typed.keys = [];
    typed.tableRelations = [];
    typed.indexes = [];
    typed.checks = [];
    const table = typed.tables[0]!;
    table.physical.name = 'type_' + i;
    const column = createNativeColumn(typed.database, table, 'value');
    column.physical.name = 'value';
    column.physical.type = ['enum', 'set'].includes(definition.sqlName)
      ? {
          kind: 'valueList',
          database: 'mysql',
          typeId: definition.id as 'mysql:enum' | 'mysql:set',
          values: ["quote'", '한글\\'],
        }
      : ({
          kind: 'builtin',
          database: 'mysql',
          typeId: definition.id,
          parameters: ['varchar', 'varbinary'].includes(definition.sqlName) ? { length: 12 } : {},
        } as NativeColumnType);
    typed.columns = [column];
    const result = compileNativeDatabaseDDL(typed);
    assert.equal(result.canExport, true, JSON.stringify(result.issues));
    execute(use(result.sql));
    const actual = execute(
      use(
        `SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='${database}' AND table_name='type_${i}' AND column_name='value';`,
      ),
    );
    assert.equal(actual.stdout.trim(), '1', definition.id);
    if (['enum', 'set'].includes(definition.sqlName)) {
      const value = '한글\\',
        hex = Buffer.from(value).toString('hex');
      assert.equal(
        execute(
          use(
            `INSERT INTO type_${i}(value) VALUES(CONVERT(X'${hex}' USING utf8mb4)); SELECT HEX(value) FROM type_${i};`,
          ),
        ).stdout.trim(),
        hex.toUpperCase(),
        definition.id,
      );
    }
  }
  assert.equal(definitions.length, 37);
  const advanced = nativeDDLFixture('mysql');
  const parent = advanced.tables![0]!;
  parent.physical.name = 'advanced';
  parent.physical.options = {
    database: 'mysql',
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collation: 'utf8mb4_0900_ai_ci',
  };
  advanced.tables = [parent];
  advanced.columns = advanced.columns!.filter((column) => column.tableId === parent.id);
  advanced.tableRelations = [];
  advanced.checks = [];
  advanced.indexes![0]!.parts[0]!.prefixLength = 16;
  advanced.indexes![0]!.options = { database: 'mysql', kind: 'btree', invisible: true };
  const binary = createNativeColumn(advanced.database, parent, 'binary');
  binary.physical.name = 'binary_value';
  binary.physical.type = {
    kind: 'builtin',
    database: 'mysql',
    typeId: 'mysql:blob',
    parameters: {},
  };
  binary.physical.defaultValue = { kind: 'literal', literalType: 'binary', value: '00ff' };
  const json = createNativeColumn(advanced.database, parent, 'json');
  json.physical.name = 'json_value';
  json.physical.type = { kind: 'builtin', database: 'mysql', typeId: 'mysql:json', parameters: {} };
  json.physical.defaultValue = { kind: 'literal', literalType: 'json', value: '{"value":"한글"}' };
  const stamp = createNativeColumn(advanced.database, parent, 'stamp');
  stamp.physical.name = 'stamp';
  stamp.physical.type = {
    kind: 'builtin',
    database: 'mysql',
    typeId: 'mysql:timestamp',
    parameters: { precision: 6 },
  };
  stamp.physical.defaultValue = {
    kind: 'expression',
    expression: { kind: 'call', functionId: 'mysql:current_timestamp', args: [] },
  };
  stamp.physical.options = {
    database: 'mysql',
    onUpdate: { kind: 'call', functionId: 'mysql:current_timestamp', args: [] },
  };
  const computed = createNativeColumn(advanced.database, parent, 'computed');
  computed.physical.name = 'label_length';
  computed.physical.type = {
    kind: 'builtin',
    database: 'mysql',
    typeId: 'mysql:int',
    parameters: {},
  };
  computed.physical.generation = {
    kind: 'computed',
    database: 'mysql',
    storage: 'stored',
    expression: {
      kind: 'call',
      functionId: 'mysql:length',
      args: [{ kind: 'column', columnId: 'label' }],
    },
  };
  advanced.columns.push(binary, json, stamp, computed);
  const result = compileNativeDatabaseDDL(advanced);
  assert.equal(result.canExport, true, JSON.stringify(result.issues));
  execute(use(result.sql));
  execute(use("INSERT INTO advanced(label) VALUES('hello');"));
  assert.equal(
    execute(
      use(
        "SELECT HEX(binary_value),JSON_UNQUOTE(JSON_EXTRACT(json_value,'$.value')),label_length FROM advanced;",
      ),
    ).stdout.trim(),
    '00FF\t한글\t5',
  );
  console.log(
    JSON.stringify({
      result: 'PASS',
      mysqlVersion: execute('SELECT VERSION();').stdout.trim(),
      declarations: definitions.length,
      behavior: [
        'autoIncrement',
        'quoted UTF8 default',
        'check rejection',
        'FK rejection',
        'cascade delete',
        'enum/set escaping',
      ],
    }),
  );
} finally {
  if (created) execute(`DROP DATABASE \`${database}\`;`);
}
