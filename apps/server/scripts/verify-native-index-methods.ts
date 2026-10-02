import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import {
  compileNativeDatabaseDDL,
  createEmptyNativeDocument,
  createNativeColumn,
  createNativeTable,
  databaseTypeCatalog,
  defaultDatabaseContext,
  nativePostgresIndexMethodDecision,
  type NativeColumnType,
} from '@ezerd/model';
import { readConfig } from '../src/config.js';
const configured = new URL(readConfig().DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname))
  throw Error('Local DB QA only');
const client = new pg.Client({ connectionString: configured.toString() });
await client.connect();
const schema = 'ezerd_index_' + randomUUID().replaceAll('-', ''),
  context = defaultDatabaseContext('postgresql');
const evidence: Record<string, string[]> = {};
try {
  await client.query('BEGIN');
  const definitions = databaseTypeCatalog.filter((type) => type.databaseKind === 'postgresql');
  for (const [index, definition] of definitions.entries()) {
    const doc = createEmptyNativeDocument(context),
      table = createNativeTable(context, 't'),
      column = createNativeColumn(context, table, 'c');
    table.physical.name = 't_' + index;
    table.physical.namespace = { kind: 'postgresSchema', name: schema };
    column.physical.name = 'value';
    column.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: definition.id,
      parameters: {},
    } as NativeColumnType;
    doc.tables = [table];
    doc.columns = [column];
    const ddl = compileNativeDatabaseDDL(doc);
    assert.equal(ddl.canExport, true, JSON.stringify(ddl.issues));
    await client.query(ddl.sql);
    const allowed: string[] = [];
    for (const method of ['btree', 'hash', 'gist', 'spgist', 'gin', 'brin']) {
      await client.query('SAVEPOINT method');
      try {
        await client.query(
          `CREATE INDEX i_${index}_${method} ON "${schema}"."${table.physical.name}" USING ${method}(value)`,
        );
        allowed.push(method);
      } catch (cause) {
        if ((cause as { code?: string }).code !== '42704') throw cause;
        await client.query('ROLLBACK TO SAVEPOINT method');
      }
      await client.query('RELEASE SAVEPOINT method');
    }
    evidence[definition.id] = allowed;
    for (const method of ['btree', 'hash', 'gist', 'spgist', 'gin', 'brin'] as const)
      assert.equal(
        nativePostgresIndexMethodDecision(context, method, column.physical.type).allowed,
        allowed.includes(method),
        definition.id + '/' + method,
      );
  }
  await client.query(`CREATE TYPE "${schema}".enum_value AS ENUM ('a','b')`);
  for (const [index, sample] of [
    ['enum', `"${schema}".enum_value`, "'a'"],
    ['integer_array', 'integer[]', 'ARRAY[1,2]'],
    ['xml_array', 'xml[]', "ARRAY['<a/>'::xml,'<b/>'::xml]"],
  ].entries()) {
    const [name, declaration, input] = sample;
    await client.query(`CREATE TABLE "${schema}"."${name}" (value ${declaration})`);
    const allowed: string[] = [];
    for (const method of ['btree', 'hash', 'gist', 'spgist', 'gin', 'brin']) {
      await client.query('SAVEPOINT method');
      try {
        await client.query(
          `CREATE INDEX special_${index}_${method} ON "${schema}"."${name}" USING ${method}(value)`,
        );
        await client.query(`INSERT INTO "${schema}"."${name}" VALUES (${input}),(${input})`);
        allowed.push(method);
      } catch (cause) {
        if (!['42704', '42883'].includes((cause as { code?: string }).code ?? '')) throw cause;
      }
      await client.query('ROLLBACK TO SAVEPOINT method');
      await client.query('RELEASE SAVEPOINT method');
    }
    evidence['postgresql:' + name] = allowed;
  }
  for (const [method, declaration, values, predicate] of [
    ['btree', 'integer', '(1),(2)', 'value=1'],
    ['hash', 'integer', '(1),(2)', 'value=1'],
    ['gist', 'point', "('(1,1)'),('(30,30)')", "value <@ box '(0,0),(10,10)'"],
    ['spgist', 'text', "('prefix-a'),('other')", "value ^@ 'prefix'"],
    ['gin', 'jsonb', '(\'{"a":1}\'),(\'{"b":2}\')', 'value @> \'{"a":1}\'::jsonb'],
    ['brin', 'integer', '(1),(2)', 'value=1'],
  ] as const) {
    await client.query(`CREATE TABLE "${schema}".populated_${method} (value ${declaration})`);
    await client.query(`INSERT INTO "${schema}".populated_${method} VALUES ${values}`);
    await client.query(
      `CREATE INDEX populated_${method}_ix ON "${schema}".populated_${method} USING ${method}(value)`,
    );
    assert.equal(
      (
        await client.query(
          `SELECT count(*)::int AS n FROM "${schema}".populated_${method} WHERE ${predicate}`,
        )
      ).rows[0].n,
      1,
      method + ' populated index',
    );
  }
  console.log(
    JSON.stringify({
      postgresVersion: (await client.query('SHOW server_version')).rows[0].server_version,
      evidence,
    }),
  );
} finally {
  await client.query('ROLLBACK');
  await client.end();
}
