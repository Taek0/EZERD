import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { defaultDatabaseContext } from '@ezerd/model';
import { inspectPostgresBoundedTypedLiteral } from '../../../packages/model/src/database/postgres-typed-literal-helper.js';
import { readConfig } from '../src/config.js';
import {
  boundedLiteral,
  postgresBoundedLiteralCases,
} from '../test/native-postgres-bounded-literal-fixtures.js';

const configured = new URL(readConfig().DATABASE_URL);
assert(['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname), 'Local PostgreSQL only');
const client = new pg.Client({ connectionString: configured.toString() });
const schema = 'ezerd_bounded_literal_' + randomUUID().replaceAll('-', '');
const context = defaultDatabaseContext('postgresql');
const evidence: {
  key: string;
  input: string;
  output: string;
  defaultOutput?: string;
  classification: string;
  code?: string;
  cardinality?: number;
  dimensions?: number;
}[] = [];
let version = '',
  encoding = '',
  rolledBack = false;
await client.connect();
try {
  version = (await client.query('SHOW server_version')).rows[0].server_version;
  assert.match(version, /^18\.6(?:\s|$)/);
  encoding = (await client.query('SHOW server_encoding')).rows[0].server_encoding;
  assert.equal(encoding, 'UTF8');
  await client.query('BEGIN');
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query('SET LOCAL search_path=pg_catalog; SET LOCAL standard_conforming_strings=on');
  await client.query(`CREATE TYPE "${schema}".enum_state AS ENUM ('one','two')`);
  for (const [i, spec] of postgresBoundedLiteralCases.entries()) {
    assert.equal(
      inspectPostgresBoundedTypedLiteral(context, spec.type, boundedLiteral(spec.value))?.allowed,
      true,
      spec.key,
    );
    const sqlType = spec.projectEnum ? `"${schema}".enum_state[]` : spec.sqlType;
    const cast = (await client.query(`SELECT CAST($1 AS ${sqlType})::text AS value`, [spec.value]))
      .rows[0].value;
    assert.equal(cast, spec.expected, spec.key);
    // Values are parameters to quote_literal; output is a literal token, never arbitrary caller SQL.
    const quoted = (await client.query('SELECT quote_literal($1) AS literal', [spec.value])).rows[0]
      .literal;
    await client.query(
      `CREATE TABLE "${schema}"."value_${i}" (value ${sqlType} DEFAULT CAST(${quoted} AS ${sqlType}))`,
    );
    await client.query(`INSERT INTO "${schema}"."value_${i}" DEFAULT VALUES`);
    const defaultValue = (
      await client.query(`SELECT value::text AS value FROM "${schema}"."value_${i}"`)
    ).rows[0].value;
    assert.equal(defaultValue, spec.expected, spec.key);
    const item: (typeof evidence)[number] = {
      key: spec.key,
      input: spec.value,
      output: cast,
      defaultOutput: defaultValue,
      classification: 'supported-cast-and-default',
    };
    if (spec.array) {
      const shape = (
        await client.query(
          `SELECT cardinality(value) AS cardinality,array_ndims(value) AS dimensions FROM "${schema}"."value_${i}"`,
        )
      ).rows[0];
      assert.equal(shape.cardinality, 0);
      // PG empty arrays have ndim=0 internally; array_ndims reports NULL, not the declaration count.
      assert.equal(shape.dimensions, null);
      item.cardinality = shape.cardinality;
      item.dimensions = 0;
      if (!spec.projectEnum) {
        assert.equal(
          (
            await client.query(
              `SELECT CAST($1 AS ${spec.sqlType.replace(/\[\]$/, '[][][][][][]')})::text AS value`,
              ['{}'],
            )
          ).rows[0].value,
          '{}',
        );
      }
    }
    if (spec.key === 'pg_snapshot') {
      const counters = (
        await client.query(
          'SELECT pg_snapshot_xmin($1::pg_snapshot)::text AS xmin,pg_snapshot_xmax($1::pg_snapshot)::text AS xmax,ARRAY(SELECT x::text FROM pg_snapshot_xip($1::pg_snapshot) AS x) AS xip',
          [spec.value],
        )
      ).rows[0];
      assert.deepEqual(counters, { xmin: '10', xmax: '20', xip: ['10', '14', '15'] });
    }
    evidence.push(item);
    const decision = inspectPostgresBoundedTypedLiteral(
      context,
      spec.type,
      boundedLiteral(spec.blocked),
    );
    assert.equal(decision?.allowed, false, spec.key + ' out-of-subset');
    await client.query('SAVEPOINT blocked_cast');
    try {
      const output = (
        await client.query(`SELECT CAST($1 AS ${sqlType})::text AS value`, [spec.blocked])
      ).rows[0].value;
      evidence.push({
        key: spec.key,
        input: spec.blocked,
        output,
        classification: 'engine-valid-product-subset-blocked',
      });
    } catch (error) {
      evidence.push({
        key: spec.key,
        input: spec.blocked,
        output: '',
        classification: 'engine-invalid-product-blocked',
        code: (error as { code: string }).code,
      });
      assert.equal(
        spec.key,
        'pg_snapshot',
        'Unexpected rejection of known outside-subset engine-valid value',
      );
      assert.equal((error as { code: string }).code, '22P02');
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT blocked_cast');
    }
  }
  const snapshotType = postgresBoundedLiteralCases.find((s) => s.key === 'pg_snapshot')!;
  for (const value of [
    '1:1:',
    '9007199254740995:9007199254740998:9007199254740995,9007199254740996',
    '18446744073709551614:18446744073709551615:18446744073709551614',
    '18446744073709551615:18446744073709551615:',
  ]) {
    assert.equal(
      inspectPostgresBoundedTypedLiteral(context, snapshotType.type, boundedLiteral(value))
        ?.allowed,
      true,
    );
    const output = (await client.query('SELECT $1::pg_snapshot::text AS value', [value])).rows[0]
      .value;
    assert.equal(output, value);
    evidence.push({
      key: 'pg_snapshot-boundary',
      input: value,
      output,
      classification: 'supported-exact-counter-cast',
    });
  }
  for (const sqlType of ['TSVECTOR', 'TSQUERY'] as const) {
    const spec = postgresBoundedLiteralCases.find((s) => s.key === sqlType.toLowerCase())!;
    for (const value of ['a', 'A'.repeat(128)]) {
      assert.equal(
        inspectPostgresBoundedTypedLiteral(context, spec.type, boundedLiteral(value))?.allowed,
        true,
      );
      const output = (await client.query(`SELECT CAST($1 AS ${sqlType})::text AS value`, [value]))
        .rows[0].value;
      assert.equal(output, "'" + value + "'");
      evidence.push({
        key: spec.key + '-boundary',
        input: value,
        output,
        classification: 'supported-search-token-boundary',
      });
    }
  }
  const xips = Array.from({ length: 128 }, (_, i) => String(i + 1)).join(',');
  const snapshot128 = '1:200:' + xips;
  assert.equal(
    inspectPostgresBoundedTypedLiteral(context, snapshotType.type, boundedLiteral(snapshot128))
      ?.allowed,
    true,
  );
  const snapshot128Output = (
    await client.query('SELECT $1::pg_snapshot::text AS value', [snapshot128])
  ).rows[0].value;
  assert.equal(snapshot128Output, snapshot128);
  evidence.push({
    key: 'pg_snapshot-128-xips',
    input: snapshot128,
    output: snapshot128Output,
    classification: 'supported-xip-cardinality-boundary',
  });
  for (const [sqlType, value] of [
    ['PG_SNAPSHOT', '0:1:'],
    ['PG_SNAPSHOT', '20:10:'],
    ['PG_SNAPSHOT', '10:20:20'],
    ['PG_SNAPSHOT', '9007199254740995:9007199254740998:9007199254740996,9007199254740995'],
    ['TSQUERY', 'a &'],
    ['TSVECTOR', 'a:bad'],
    ['PG_SNAPSHOT', '9007199254740992:9007199254740995:'],
    ['PG_SNAPSHOT', '4294967295:4294967296:'],
  ] as const) {
    await client.query('SAVEPOINT invalid_cast');
    try {
      await client.query(`SELECT CAST($1 AS ${sqlType})`, [value]);
      assert.fail('Engine must reject known invalid cast: ' + sqlType);
    } catch (error) {
      assert.match((error as { code: string }).code, /^(22P02|42601)$/);
      evidence.push({
        key: sqlType.toLowerCase() + '-invalid',
        input: value!,
        output: '',
        classification: 'engine-invalid-cast',
        code: (error as { code: string }).code,
      });
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT invalid_cast');
    }
  }
} finally {
  await client.query('ROLLBACK');
  rolledBack = true;
  assert.equal(
    (await client.query('SELECT COUNT(*) AS count FROM pg_namespace WHERE nspname=$1', [schema]))
      .rows[0].count,
    '0',
  );
  await client.end();
}
assert(rolledBack);
const artifact = fileURLToPath(
  new URL(
    '../../../docs/work-log/assets/2026-10-03-Database-PostgresBoundedTypedLiterals.json',
    import.meta.url,
  ),
);
writeFileSync(
  artifact,
  JSON.stringify(
    {
      source: 'actual-PostgreSQL-cast-and-default-probe',
      version,
      encoding,
      productAdapter: 'separate-required',
      rolledBack,
      cases: postgresBoundedLiteralCases.length,
      evidence,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `PASS PostgreSQL ${version}: ${postgresBoundedLiteralCases.length} type defaults; ${evidence.length} cast/default observations; rollback verified`,
);
