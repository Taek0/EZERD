import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import {
  databaseTypeCatalog,
  compileNativeDatabaseDDL,
  exportNativeDatabaseDDL,
  createNativeColumn,
  keyEligibility,
  literalDecision,
  type NativeColumnType,
  type NativeDefaultValue,
  type DatabaseKind,
  type DatabaseTypeDefinition,
} from '@ezerd/model';
import { nativeDDLFixture } from '../../../packages/model/dist/database/ddl-fixtures.js';
import { readConfig } from '../src/config.js';

const container = 'ezerd-native-ddl-qa-20261002';
const containerId = '032eb46e01d610cd0bfbad6127cff0ff47a3c3be648f0a67f3de101d3ecbc282';
const ownedAnonymousVolume = 'b64d418edfbd16b0ba710dfb9d9c65b4034dbf59b3da1967756602d88cbfb1d1';
interface Evidence {
  typeId: string;
  declaration: boolean;
  primary: boolean;
  unique: boolean;
  primaryError?: string;
  uniqueError?: string;
}
const evidence: Evidence[] = [];
const versions: Record<string, string> = {};
const roundtrips: string[] = [];
function fixture(
  kind: DatabaseKind,
  definition: DatabaseTypeDefinition,
  name: string,
  schema?: string,
) {
  const doc = nativeDDLFixture(kind);
  doc.tables = [doc.tables![0]!];
  doc.keys = [];
  doc.indexes = [];
  doc.checks = [];
  doc.tableRelations = [];
  doc.enums = [];
  const table = doc.tables[0]!;
  table.physical.name = name;
  table.physical.comment = '';
  if (schema) table.physical.namespace = { kind: 'postgresSchema', name: schema };
  const c = createNativeColumn(doc.database, table, 'value');
  c.physical.name = 'value';
  c.physical.nullable = false;
  // Fixture-only construction from trusted catalog IDs; production input never uses this cast.
  c.physical.type = (
    ['mysql:enum', 'mysql:set'].includes(definition.id)
      ? { kind: 'valueList', database: 'mysql', typeId: definition.id, values: ['a', 'b'] }
      : {
          kind: 'builtin',
          database: kind,
          typeId: definition.id,
          parameters:
            ['varchar', 'varbinary'].includes(definition.sqlName) && kind === 'mysql'
              ? { length: 12 }
              : {},
        }
  ) as NativeColumnType;
  doc.columns = [c];
  return doc;
}
function compiled(doc: ReturnType<typeof fixture>) {
  const result = compileNativeDatabaseDDL(doc);
  assert.equal(result.canExport, true, JSON.stringify(result.issues));
  assert.equal(exportNativeDatabaseDDL(doc).canExport, false, 'Product readiness must stay false');
  return result.sql;
}
const advanced: { id: string; value: string; expected: string; invalid: string }[] = [
  {
    id: 'uuid',
    value: '12345678-1234-5678-90ab-123456789abc',
    expected: '12345678-1234-5678-90ab-123456789abc',
    invalid: 'bad-uuid',
  },
  { id: 'date', value: '2024-02-29', expected: '2024-02-29', invalid: '2023-02-29' },
  {
    id: 'interval',
    value: '2 days 03:04:05.123456',
    expected: '2 days 03:04:05.123456',
    invalid: 'tomorrow',
  },
  { id: 'point', value: '(1.5,-2)', expected: '(1.5,-2)', invalid: '(1,wrong)' },
  { id: 'line', value: '{1,2,3}', expected: '{1,2,3}', invalid: '{0,0,1}' },
  { id: 'lseg', value: '[(1,2),(3,4)]', expected: '[(1,2),(3,4)]', invalid: '[(1,2)]' },
  { id: 'box', value: '(3,4),(1,2)', expected: '(3,4),(1,2)', invalid: 'bad' },
  { id: 'path', value: '[(1,2),(3,4)]', expected: '[(1,2),(3,4)]', invalid: 'bad' },
  { id: 'polygon', value: '((1,2),(3,4),(5,6))', expected: '((1,2),(3,4),(5,6))', invalid: 'bad' },
  { id: 'circle', value: '<(1,2),3>', expected: '<(1,2),3>', invalid: 'bad' },
  { id: 'inet', value: '2001:db8::1/64', expected: '2001:db8::1/64', invalid: '999.1.1.1' },
  { id: 'cidr', value: '192.168.0.0/24', expected: '192.168.0.0/24', invalid: '192.168.0.1/24' },
  { id: 'macaddr', value: '08:00:2b:01:02:03', expected: '08:00:2b:01:02:03', invalid: '08:wrong' },
  {
    id: 'macaddr8',
    value: '08:00:2b:01:02:03:04:05',
    expected: '08:00:2b:01:02:03:04:05',
    invalid: '08:wrong',
  },
  { id: 'int4range', value: '[1,4)', expected: '[1,4)', invalid: '[4,1)' },
  {
    id: 'int8range',
    value: '[9007199254740993,9007199254740995)',
    expected: '[9007199254740993,9007199254740995)',
    invalid: '[4,1)',
  },
  {
    id: 'daterange',
    value: '[2024-01-01,2024-02-01)',
    expected: '[2024-01-01,2024-02-01)',
    invalid: '[2024-02-30,2024-03-01)',
  },
  { id: 'oid', value: '4294967295', expected: '4294967295', invalid: '4294967296' },
  { id: 'pg_lsn', value: 'FFFFFFFF/FFFFFFFF', expected: 'FFFFFFFF/FFFFFFFF', invalid: 'bad' },
  { id: 'bit', value: '1', expected: '1', invalid: '2' },
];
async function postgres() {
  const url = new URL(readConfig().DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Local PostgreSQL only');
  const client = new pg.Client({ connectionString: url.toString() });
  const schema = 'ezerd_literal_' + randomUUID().replaceAll('-', '');
  await client.connect();
  try {
    versions.postgresql = (await client.query('SHOW server_version')).rows[0].server_version;
    assert.match(versions.postgresql!, /^18\.6(?:\s|$)/);
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(
      "SET LOCAL DateStyle='ISO, YMD'; SET LOCAL IntervalStyle='postgres'; SET LOCAL TIME ZONE 'UTC'",
    );
    const definitions = databaseTypeCatalog.filter((d) => d.databaseKind === 'postgresql');
    assert.equal(definitions.length, 65);
    for (const [i, d] of definitions.entries()) {
      const name = 'type_' + i,
        doc = fixture('postgresql', d, name, schema);
      await client.query(compiled(doc));
      const result: Evidence = { typeId: d.id, declaration: true, primary: false, unique: false };
      const policy = keyEligibility(doc.database, doc.columns![0]!.physical.type);
      for (const kind of ['primary', 'unique'] as const) {
        await client.query('SAVEPOINT key_probe');
        try {
          await client.query(
            `ALTER TABLE "${schema}"."${name}" ADD ${kind === 'primary' ? 'PRIMARY KEY' : 'UNIQUE'} (value)`,
          );
          result[kind] = true;
        } catch (error) {
          result[kind === 'primary' ? 'primaryError' : 'uniqueError'] = (
            error as { code: string }
          ).code;
        } finally {
          await client.query('ROLLBACK TO SAVEPOINT key_probe');
        }
        assert.equal(
          result[kind],
          kind === 'primary' ? policy.primaryAllowed : policy.uniqueAllowed,
          d.id + ' ' + kind,
        );
      }
      evidence.push(result);
    }
    for (const [i, test] of advanced.entries()) {
      const d = databaseTypeCatalog.find((d) => d.id === 'postgresql:' + test.id)!;
      const doc = fixture('postgresql', d, 'literal_' + i, schema),
        c = doc.columns![0]!;
      c.physical.defaultValue = { kind: 'literal', literalType: 'typedText', value: test.value };
      assert.equal(
        literalDecision(doc.database, c.physical.type, c.physical.defaultValue).allowed,
        true,
        test.id,
      );
      await client.query(compiled(doc));
      await client.query(`INSERT INTO "${schema}"."literal_${i}" DEFAULT VALUES`);
      assert.equal(
        (await client.query(`SELECT value::text AS value FROM "${schema}"."literal_${i}"`)).rows[0]
          .value,
        test.expected,
        test.id,
      );
      const invalid: NativeDefaultValue = {
        kind: 'literal',
        literalType: 'typedText',
        value: test.invalid,
      };
      assert.equal(literalDecision(doc.database, c.physical.type, invalid).allowed, false, test.id);
      c.physical.defaultValue = invalid;
      assert.equal(compileNativeDatabaseDDL(doc).sql, '', test.id);
      await client.query('SAVEPOINT invalid_literal');
      await assert.rejects(
        client.query(`INSERT INTO "${schema}"."literal_${i}"(value) VALUES($1)`, [test.invalid]),
      );
      await client.query('ROLLBACK TO SAVEPOINT invalid_literal');
      roundtrips.push('postgresql:' + test.id);
    }
    const precisionCases = [
      {
        name: 'numeric',
        parameters: { precision: 3, scale: 2 },
        good: '9.994',
        expected: '9.99',
        bad: '9.995',
      },
      {
        name: 'numeric',
        parameters: { precision: 2, scale: -3 },
        good: '99499',
        expected: '99000',
        bad: '99500',
      },
      {
        name: 'numeric',
        parameters: { precision: 2, scale: 4 },
        good: '0.00994',
        expected: '0.0099',
        bad: '0.00995',
      },
      { name: 'smallint', parameters: {}, good: '32767', expected: '32767', bad: '32768' },
    ];
    for (const [i, test] of precisionCases.entries()) {
      const d = definitions.find((d) => d.sqlName === test.name)!;
      const doc = fixture('postgresql', d, 'precision_' + i, schema),
        c = doc.columns![0]!;
      c.physical.type = {
        kind: 'builtin',
        database: 'postgresql',
        typeId: d.id,
        parameters: test.parameters,
      } as NativeColumnType;
      c.physical.defaultValue = { kind: 'literal', literalType: 'number', value: test.good };
      await client.query(compiled(doc));
      await client.query(`INSERT INTO "${schema}"."precision_${i}" DEFAULT VALUES`);
      assert.equal(
        (await client.query(`SELECT value::text AS value FROM "${schema}"."precision_${i}"`))
          .rows[0].value,
        test.expected,
      );
      c.physical.defaultValue = { kind: 'literal', literalType: 'number', value: test.bad };
      assert.equal(
        literalDecision(doc.database, c.physical.type, c.physical.defaultValue).allowed,
        false,
      );
      assert.equal(compileNativeDatabaseDDL(doc).sql, '');
      await client.query('SAVEPOINT precision_literal');
      await assert.rejects(
        client.query(`INSERT INTO "${schema}"."precision_${i}"(value) VALUES($1)`, [test.bad]),
      );
      await client.query('ROLLBACK TO SAVEPOINT precision_literal');
      roundtrips.push('postgresql:' + test.name + '-precision-' + i);
    }
    const jsonDoc = fixture(
        'postgresql',
        definitions.find((d) => d.sqlName === 'jsonb')!,
        'json_numbers',
        schema,
      ),
      jsonColumn = jsonDoc.columns![0]!;
    jsonColumn.physical.defaultValue = { kind: 'literal', literalType: 'json', value: '{"n":1e2}' };
    await client.query(compiled(jsonDoc));
    await client.query(`INSERT INTO "${schema}"."json_numbers" DEFAULT VALUES`);
    assert.equal(
      (await client.query(`SELECT value->>'n' AS value FROM "${schema}"."json_numbers"`)).rows[0]
        .value,
      '100',
    );
    jsonColumn.physical.defaultValue = {
      kind: 'literal',
      literalType: 'json',
      value: '{"n":1e-20000}',
    };
    assert.equal(
      literalDecision(jsonDoc.database, jsonColumn.physical.type, jsonColumn.physical.defaultValue)
        .allowed,
      false,
    );
    assert.equal(compileNativeDatabaseDDL(jsonDoc).sql, '');
    await client.query('SAVEPOINT json_literal');
    await assert.rejects(
      client.query(`INSERT INTO "${schema}"."json_numbers"(value) VALUES($1)`, ['{"n":1e-20000}']),
    );
    await client.query('ROLLBACK TO SAVEPOINT json_literal');
    roundtrips.push('postgresql:jsonb-numeric');
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}
function mysql() {
  const inspect = spawnSync('docker', ['inspect', '--format', '{{json .}}', container], {
    encoding: 'utf8',
  });
  assert.equal(inspect.status, 0, inspect.stderr);
  const info = JSON.parse(inspect.stdout);
  assert.equal(info.Id, containerId, 'Only the authorized task-owned container');
  assert.equal(info.State.Running, true);
  assert.equal(info.Config.Labels['ezerd.qa'], 'native-ddl-20261002');
  assert.equal(info.HostConfig.NetworkMode, 'none');
  assert.deepEqual(Object.keys(info.NetworkSettings.Networks), ['none']);
  assert.deepEqual(info.HostConfig.PortBindings, {});
  assert.deepEqual(info.NetworkSettings.Ports, {});
  assert.deepEqual(info.HostConfig.Binds ?? [], [], 'No user bind or named volume mounts');
  assert.deepEqual(info.HostConfig.VolumesFrom ?? [], [], 'No inherited mounts');
  assert.equal(info.Mounts.length, 1, 'Only the exact authorized anonymous MySQL datadir');
  const mount = info.Mounts[0];
  assert.equal(mount.Type, 'volume');
  assert.equal(mount.Name, ownedAnonymousVolume);
  assert.equal(mount.Destination, '/var/lib/mysql');
  assert.equal(mount.Driver, 'local');
  assert.equal(mount.RW, true);
  assert.match(info.Config.Image, /^(?:docker\.io\/library\/)?mysql:8\.4(?:\.11)?$/);
  assert.equal(
    info.ImageManifestDescriptor.annotations['org.opencontainers.image.version'],
    '8.4.11',
  );
  function execute(sql: string) {
    return spawnSync(
      'docker',
      [
        'exec',
        '-i',
        containerId,
        'mysql',
        '-uroot',
        '--batch',
        '--skip-column-names',
        '--default-character-set=utf8mb4',
      ],
      { input: sql, encoding: 'utf8' },
    );
  }
  const database = 'ezerd_literal_' + randomUUID().replaceAll('-', '');
  const checked = (sql: string) => {
    const r = execute(sql);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  versions.mysql = checked('SELECT VERSION();');
  assert.equal(versions.mysql, '8.4.11');
  assert.equal(checked('SELECT @@innodb_page_size;'), '16384');
  checked(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4;`);
  const use = (sql: string) =>
    `USE \`${database}\`; SET SESSION sql_mode='STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'; SET SESSION time_zone='+00:00'; ${sql}`;
  try {
    const definitions = databaseTypeCatalog.filter((d) => d.databaseKind === 'mysql');
    assert.equal(definitions.length, 37);
    for (const [i, d] of definitions.entries()) {
      const name = 'type_' + i,
        doc = fixture('mysql', d, name);
      checked(use(compiled(doc)));
      const result: Evidence = { typeId: d.id, declaration: true, primary: false, unique: false };
      const policy = keyEligibility(doc.database, doc.columns![0]!.physical.type);
      for (const kind of ['primary', 'unique'] as const) {
        const r = execute(
          use(
            `ALTER TABLE \`${name}\` ADD ${kind === 'primary' ? 'PRIMARY KEY' : 'UNIQUE KEY k'} (value);`,
          ),
        );
        result[kind] = r.status === 0;
        if (r.status === 0)
          checked(
            use(`ALTER TABLE \`${name}\` DROP ${kind === 'primary' ? 'PRIMARY KEY' : 'INDEX k'};`),
          );
        else
          result[kind === 'primary' ? 'primaryError' : 'uniqueError'] =
            r.stderr.match(/ERROR \d+/)?.[0] ?? 'ERROR';
        assert.equal(
          result[kind],
          kind === 'primary' ? policy.primaryAllowed : policy.uniqueAllowed,
          d.id + ' ' + kind,
        );
      }
      evidence.push(result);
    }
    for (const [name, good, bad] of [
      ['date', '2024-02-29', '2023-02-29'],
      ['datetime', '2024-02-29 12:34:56', '2023-02-29 12:34:56'],
      ['time', '838:59:59', '839:00:00'],
      ['year', '2155', '2156'],
    ] as const) {
      const d = definitions.find((d) => d.sqlName === name)!,
        doc = fixture('mysql', d, 'literal_' + name),
        c = doc.columns![0]!;
      c.physical.defaultValue = { kind: 'literal', literalType: 'typedText', value: good };
      assert.equal(
        literalDecision(doc.database, c.physical.type, c.physical.defaultValue).allowed,
        true,
      );
      checked(use(compiled(doc)));
      checked(use(`INSERT INTO literal_${name} () VALUES ();`));
      assert.equal(checked(use(`SELECT value FROM literal_${name};`)), good);
      c.physical.defaultValue = { kind: 'literal', literalType: 'typedText', value: bad };
      assert.equal(
        literalDecision(doc.database, c.physical.type, c.physical.defaultValue).allowed,
        false,
      );
      assert.equal(compileNativeDatabaseDDL(doc).sql, '');
      assert.notEqual(
        execute(use(`INSERT INTO literal_${name}(value) VALUES('${bad}');`)).status,
        0,
      );
      roundtrips.push('mysql:' + name);
    }
    const boundaryCases: {
      name: string;
      type: NativeColumnType;
      good: NativeDefaultValue;
      bad: NativeDefaultValue;
      selection: string;
      expected: string;
      invalidSQL: string;
    }[] = [
      {
        name: 'bigint',
        type: {
          kind: 'builtin',
          database: 'mysql',
          typeId: 'mysql:bigint',
          parameters: { unsigned: true },
        },
        good: { kind: 'literal', literalType: 'number', value: '18446744073709551615' },
        bad: { kind: 'literal', literalType: 'number', value: '18446744073709551616' },
        selection: 'value',
        expected: '18446744073709551615',
        invalidSQL: '18446744073709551616',
      },
      {
        name: 'decimal',
        type: {
          kind: 'builtin',
          database: 'mysql',
          typeId: 'mysql:decimal',
          parameters: { precision: 3, scale: 2 },
        },
        good: { kind: 'literal', literalType: 'number', value: '9.994' },
        bad: { kind: 'literal', literalType: 'number', value: '9.995' },
        selection: 'value',
        expected: '9.99',
        invalidSQL: '9.995',
      },
      {
        name: 'bit',
        type: {
          kind: 'builtin',
          database: 'mysql',
          typeId: 'mysql:bit',
          parameters: { bitLength: 2 },
        },
        good: { kind: 'literal', literalType: 'number', value: '3' },
        bad: { kind: 'literal', literalType: 'number', value: '4' },
        selection: 'CAST(value AS UNSIGNED)',
        expected: '3',
        invalidSQL: '4',
      },
      {
        name: 'varbinary',
        type: {
          kind: 'builtin',
          database: 'mysql',
          typeId: 'mysql:varbinary',
          parameters: { length: 2 },
        },
        good: { kind: 'literal', literalType: 'binary', value: '00ff' },
        bad: { kind: 'literal', literalType: 'binary', value: '0000ff' },
        selection: 'HEX(value)',
        expected: '00FF',
        invalidSQL: "X'0000ff'",
      },
      {
        name: 'set',
        type: { kind: 'valueList', database: 'mysql', typeId: 'mysql:set', values: ['a', 'b'] },
        good: { kind: 'literal', literalType: 'string', value: 'a,b' },
        bad: { kind: 'literal', literalType: 'string', value: 'a,c' },
        selection: 'value',
        expected: 'a,b',
        invalidSQL: "'a,c'",
      },
      {
        name: 'json',
        type: { kind: 'builtin', database: 'mysql', typeId: 'mysql:json', parameters: {} },
        good: { kind: 'literal', literalType: 'json', value: '{"x":"한글"}' },
        bad: { kind: 'literal', literalType: 'json', value: '{"x":}' },
        selection: "JSON_UNQUOTE(JSON_EXTRACT(value,'$.x'))",
        expected: '한글',
        invalidSQL: '\'{"x":}\'',
      },
      {
        name: 'tinytext',
        type: { kind: 'builtin', database: 'mysql', typeId: 'mysql:tinytext', parameters: {} },
        good: { kind: 'literal', literalType: 'string', value: '한'.repeat(85) },
        bad: { kind: 'literal', literalType: 'string', value: '한'.repeat(86) },
        selection: 'OCTET_LENGTH(value)',
        expected: '255',
        invalidSQL: `CONVERT(X'${Buffer.from('한'.repeat(86)).toString('hex')}' USING utf8mb4)`,
      },
    ];
    for (const [i, test] of boundaryCases.entries()) {
      const d = definitions.find((d) => d.sqlName === test.name)!,
        name = 'boundary_' + i,
        doc = fixture('mysql', d, name),
        c = doc.columns![0]!;
      c.physical.type = test.type;
      c.physical.defaultValue = test.good;
      assert.equal(
        literalDecision(doc.database, c.physical.type, test.good).allowed,
        true,
        test.name,
      );
      checked(use(compiled(doc)));
      checked(use(`INSERT INTO ${name} () VALUES ();`));
      assert.equal(
        checked(use(`SELECT ${test.selection} FROM ${name};`)),
        test.expected,
        test.name,
      );
      c.physical.defaultValue = test.bad;
      assert.equal(
        literalDecision(doc.database, c.physical.type, test.bad).allowed,
        false,
        test.name,
      );
      assert.equal(compileNativeDatabaseDDL(doc).sql, '');
      assert.notEqual(
        execute(use(`INSERT INTO ${name}(value) VALUES(${test.invalidSQL});`)).status,
        0,
        test.name,
      );
      roundtrips.push('mysql:' + test.name + '-boundary');
    }
  } finally {
    checked(`DROP DATABASE \`${database}\`;`);
  }
}
function sqlite() {
  const db = new DatabaseSync(':memory:');
  try {
    versions.sqlite = String(db.prepare('SELECT sqlite_version() AS version').get()!.version);
    assert.equal(versions.sqlite, '3.53.1');
    for (const [i, d] of databaseTypeCatalog.filter((d) => d.databaseKind === 'sqlite').entries()) {
      const doc = fixture('sqlite', d, 'type_' + i);
      db.exec(compiled(doc));
      for (const kind of ['primary', 'unique'] as const) {
        doc.tables![0]!.physical.name = 'type_' + i + '_' + kind;
        doc.keys = [
          {
            id: 'key',
            tableId: doc.tables![0]!.id,
            kind,
            name: '',
            scope: 'physical',
            columnIds: ['value'],
          },
        ];
        db.exec(compiled(doc));
      }
    }
    const d = databaseTypeCatalog.find((d) => d.id === 'sqlite:blob')!,
      doc = fixture('sqlite', d, 'binary_default');
    doc.tables![0]!.physical.options = { database: 'sqlite', strict: true, withoutRowid: false };
    doc.columns![0]!.physical.defaultValue = {
      kind: 'literal',
      literalType: 'binary',
      value: '00ff',
    };
    db.exec(compiled(doc));
    db.exec('INSERT INTO binary_default DEFAULT VALUES');
    assert.equal(db.prepare('SELECT hex(value) AS value FROM binary_default').get()!.value, '00FF');
    assert.throws(() => db.exec("INSERT INTO binary_default(value) VALUES('bad')"));
    roundtrips.push('sqlite:strict-blob');
  } finally {
    db.close();
  }
}
if (process.argv.includes('--postgresql')) await postgres();
if (process.argv.includes('--sqlite')) sqlite();
if (process.argv.includes('--mysql') || process.argv.includes('--mysql37')) mysql();
assert.ok(Object.keys(versions).length, 'Select --postgresql, --sqlite, or --mysql explicitly');
console.log(
  JSON.stringify(
    { result: 'PASS', versions, evidence, roundtrips, coverage: false, productExport: false },
    null,
    2,
  ),
);
