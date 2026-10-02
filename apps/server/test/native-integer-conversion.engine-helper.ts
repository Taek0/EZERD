import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { readConfig } from '../src/config.js';
import { nativeIntegerConversionRules } from '../../../packages/model/src/database/conversion-rules.js';
import { planNativeDatabaseConversion } from '../../../packages/model/src/database/conversion.js';
import { compileNativeDatabaseDDL } from '../../../packages/model/src/database/ddl.js';
import {
  createNativeColumn,
  createNativeTable,
} from '../../../packages/model/src/database/editing.js';
import {
  createEmptyNativeDocument,
  type NativeColumnType,
} from '../../../packages/model/src/database/native-document.js';
import { defaultDatabaseContext } from '../../../packages/model/src/database/profiles.js';

/** Reproducible exact-integer fixtures; creates/drops only fresh UUID-named QA databases. */
export async function verifyNativeIntegerEngines() {
  const container = '032eb46e01d610cd0bfbad6127cff0ff47a3c3be648f0a67f3de101d3ecbc282';
  const inspected = spawnSync('docker', ['inspect', '--format', '{{json .}}', container], {
    encoding: 'utf8',
  });
  assert.equal(inspected.status, 0, inspected.stderr);
  const info = JSON.parse(inspected.stdout);
  assert.equal(info.Id, container);
  assert.equal(info.State.Running, true);
  assert.equal(info.Config.Labels['ezerd.qa'], 'native-ddl-20261002');
  assert.equal(info.HostConfig.NetworkMode, 'none');
  assert.deepEqual(info.HostConfig.PortBindings, {});
  assert.deepEqual(info.HostConfig.Binds ?? [], []);
  assert.deepEqual(info.HostConfig.VolumesFrom ?? [], []);
  assert.equal(info.Mounts.length, 1);
  assert.equal(
    info.Mounts[0].Name,
    'b64d418edfbd16b0ba710dfb9d9c65b4034dbf59b3da1967756602d88cbfb1d1',
  );
  assert.equal(info.Mounts[0].Destination, '/var/lib/mysql');
  const mysql = (sql: string) =>
    spawnSync(
      'docker',
      ['exec', '-i', container, 'mysql', '-uroot', '--batch', '--skip-column-names'],
      { input: sql, encoding: 'utf8', maxBuffer: 1024 * 1024 },
    );
  const checked = (sql: string) => {
    const r = mysql(sql);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  assert.equal(checked('SELECT VERSION();'), '8.4.11');
  const configured = new URL(readConfig().DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname));
  const admin = new pg.Pool({
    connectionString: configured.toString(),
    connectionTimeoutMillis: 3000,
  });
  const dbName = 'ezerd_integer_' + randomUUID().replaceAll('-', '');
  assert.match(dbName, /^ezerd_integer_[a-f0-9]{32}$/);
  let postgresCreated = false,
    mysqlCreated = false;
  let pool: pg.Pool | undefined;
  const evidence: unknown[] = [];
  try {
    assert.match(
      (await admin.query('SHOW server_version')).rows[0].server_version,
      /^18\.6(?:\s|$)/,
    );
    await admin.query(`CREATE DATABASE "${dbName}"`);
    postgresCreated = true;
    configured.pathname = '/' + dbName;
    pool = new pg.Pool({ connectionString: configured.toString(), connectionTimeoutMillis: 3000 });
    checked(`CREATE DATABASE \`${dbName}\`;`);
    mysqlCreated = true;
    const inMysql = (sql: string) =>
      `USE \`${dbName}\`; SET SESSION sql_mode='STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION'; ${sql}`;
    for (const rule of nativeIntegerConversionRules) {
      const min = BigInt(rule.min),
        max = BigInt(rule.max);
      const values = [
        ...new Set([
          min,
          min + 1n,
          -1n,
          0n,
          1n,
          max - 1n,
          max,
          ...(rule.bits === 64 ? [9007199254740991n, 9007199254740992n, 9007199254740993n] : []),
        ]),
      ]
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .map(String);
      for (const name of ['from_pg', 'from_mysql']) {
        const context = defaultDatabaseContext('postgresql');
        const table = createNativeTable(context, 't');
        table.physical.name = name;
        table.physical.namespace = {
          kind: 'postgresSchema',
          name: name === 'from_pg' ? 'public' : '',
        };
        const columns = ['v', 'optional'].map((id) => {
          const c = createNativeColumn(context, table, id);
          c.physical.name = id;
          c.physical.nullable = id === 'optional';
          c.physical.type = {
            kind: 'builtin',
            database: 'postgresql',
            typeId: rule.postgresTypeId,
            parameters: {},
          } as NativeColumnType;
          return c;
        });
        const source = { ...createEmptyNativeDocument(context), tables: [table], columns };
        const plan = planNativeDatabaseConversion(source, context, defaultDatabaseContext('mysql'));
        assert.equal(plan.engineVerified, true, JSON.stringify(plan.issues));
        assert.equal(plan.canApply, false, 'Current product gate must stay blocked');
        assert.ok(plan.candidate);
        const origin = compileNativeDatabaseDDL(source),
          converted = compileNativeDatabaseDDL(plan.candidate);
        assert.equal(origin.canExport, true, JSON.stringify(origin.issues));
        assert.equal(converted.canExport, true, JSON.stringify(converted.issues));
        assert.ok(origin.sql);
        assert.ok(converted.sql);
        await pool.query(origin.sql);
        checked(inMysql(converted.sql));
        const reverse = planNativeDatabaseConversion(plan.candidate, plan.target, context);
        assert.ok(reverse.candidate);
        assert.deepEqual(
          reverse.candidate.columns?.map((c) => c.physical.type),
          columns.map((c) => c.physical.type),
        );
      }
      const pgMetadata: {
        table_schema: string;
        column_name: string;
        numeric_precision: number;
        is_nullable: string;
        column_default: string | null;
      }[] = (
        await pool.query(
          "SELECT table_schema,column_name,numeric_precision,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='from_pg' ORDER BY column_name",
        )
      ).rows;
      assert.deepEqual(
        pgMetadata.map((row) => [
          row.table_schema,
          row.column_name,
          row.numeric_precision,
          row.is_nullable,
          row.column_default,
        ]),
        [
          ['public', 'optional', rule.bits, 'YES', null],
          ['public', 'v', rule.bits, 'NO', null],
        ],
      );
      assert.equal(
        checked(
          inMysql(
            `SELECT DATABASE(),COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT IS NULL FROM information_schema.columns WHERE table_schema='${dbName}' AND table_name='from_pg' AND column_name='v';`,
          ),
        ),
        `${dbName}\t${rule.mysqlSql.toLowerCase()}\tNO\t1`,
      );
      const insertPg = async (name: string, data: string[]) => {
        for (const value of data)
          await pool!.query(`INSERT INTO public.${name}(v) VALUES ($1)`, [value]);
      };
      const insertMysql = (name: string, data: string[]) =>
        checked(
          inMysql(
            `INSERT INTO ${name}(v) VALUES ${data
              .map((value) => {
                assert.match(value, /^-?\d+$/);
                return `('${value}')`;
              })
              .join(',')};`,
          ),
        );
      const readPg = async (name: string) =>
        (
          await pool!.query(
            `SELECT v::text,optional IS NULL AS nullable FROM public.${name} ORDER BY ${name}.v`,
          )
        ).rows.map((row) => {
          assert.equal(row.nullable, true);
          return row.v as string;
        });
      const readMysql = (name: string) =>
        checked(inMysql(`SELECT CAST(v AS CHAR),optional IS NULL FROM ${name} ORDER BY v;`))
          .split('\n')
          .map((row) => {
            const fields = row.replace(/\r$/, '').split('\t');
            assert.equal(fields[1], '1');
            return fields[0]!;
          });
      await insertPg('from_pg', values);
      insertMysql('from_pg', await readPg('from_pg'));
      await insertPg('from_mysql', readMysql('from_pg'));
      insertMysql('from_mysql', await readPg('from_mysql'));
      assert.deepEqual(await readPg('from_pg'), values);
      assert.deepEqual(readMysql('from_mysql'), values);
      assert.equal(
        checked(
          inMysql(
            `SELECT engine FROM information_schema.tables WHERE table_schema='${dbName}' AND table_name='from_pg';`,
          ),
        ),
        'InnoDB',
      );
      for (const outside of [min - 1n, max + 1n]) {
        await assert.rejects(
          pool.query('INSERT INTO public.from_pg(v) VALUES($1)', [String(outside)]),
          (error: unknown) => (error as { code?: string }).code === '22003',
        );
        const rejected = mysql(inMysql(`INSERT INTO from_mysql(v) VALUES('${outside}');`));
        assert.notEqual(rejected.status, 0);
        assert.match(rejected.stderr, /ERROR 1264/);
      }
      assert.deepEqual(await readPg('from_pg'), values);
      assert.deepEqual(readMysql('from_mysql'), values);
      // Both directions use actual engine text output as the other engine's input, never Number.
      evidence.push({
        fixtureId: rule.fixtureId,
        postgres: '18.6',
        mysql: '8.4.11',
        strict: true,
        values,
        overflowRejected: 4,
        roundtrip: 'PG->MySQL->PG->MySQL',
        namespace: 'public/current',
        engine: 'InnoDB',
      });
      await pool.query('DROP TABLE public.from_pg, public.from_mysql');
      checked(inMysql('DROP TABLE from_pg,from_mysql;'));
    }
    return evidence;
  } finally {
    await pool?.end();
    if (postgresCreated) await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
    await admin.end();
    if (mysqlCreated) checked(`DROP DATABASE \`${dbName}\`;`);
  }
}
if (process.argv.includes('--verify-native-integers'))
  console.log(JSON.stringify(await verifyNativeIntegerEngines(), null, 2));
