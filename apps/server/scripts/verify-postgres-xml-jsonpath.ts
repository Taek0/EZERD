import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { compileNativeDatabaseDDL } from '@ezerd/model';
import { nativeStoredDesignDocumentSchema } from '@ezerd/contracts';
import { inspectPostgresXmlLiteral, inspectPostgresJsonpathLiteral } from '@ezerd/model';
import {
  postgresXmlJsonpathCases,
  postgresXmlJsonpathSchema,
} from './postgres-xml-jsonpath-fixtures.js';
import { readConfig } from '../src/config.js';
const configured = new URL(readConfig().DATABASE_URL);
assert(['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname), 'Local QA only');
const client = new pg.Client({ connectionString: configured.toString() });
const checked: unknown[] = [];
const manifestIndex = process.argv.indexOf('--manifest');
const directory =
  manifestIndex < 0
    ? resolve(
        fileURLToPath(new URL('../../../', import.meta.url)),
        '.data/postgres-xml-jsonpath-casts',
        randomUUID(),
      )
    : resolve(process.argv[manifestIndex + 1]!, '..');
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
await client.connect();
try {
  const environment = (
    await client.query(
      "SELECT current_setting('server_version_num') AS version, current_setting('server_encoding') AS server_encoding, current_setting('client_encoding') AS client_encoding",
    )
  ).rows[0];
  assert.equal(Math.floor(Number(environment.version) / 10000), 18, 'Exact PG18 family required');
  assert.equal(environment.server_encoding, 'UTF8');
  assert.equal(environment.client_encoding, 'UTF8');
  await client.query('BEGIN');
  try {
    for (const spec of postgresXmlJsonpathCases) {
      const decision =
        spec.type === 'xml'
          ? inspectPostgresXmlLiteral(spec.raw)
          : inspectPostgresJsonpathLiteral(spec.raw);
      assert(decision.allowed, spec.key);
      if (spec.type === 'xml') {
        for (const mode of ['document', 'content']) {
          await client.query(`SET LOCAL xmloption = ${mode}`);
          const value: { raw: string; valid: boolean } = (
            await client.query(
              'SELECT CAST($1 AS XML)::text AS raw, xml_is_well_formed_document($1::text) AS valid',
              [spec.raw],
            )
          ).rows[0];
          assert.equal(value.raw, spec.raw);
          assert.equal(value.valid, true);
        }
      } else {
        const value: { canonical: string; selected: unknown } = (
          await client.query(
            'SELECT CAST($1 AS JSONPATH)::text AS canonical, jsonb_path_query_first($2::jsonb, CAST($1 AS JSONPATH)) AS selected',
            [spec.raw, JSON.stringify(spec.input)],
          )
        ).rows[0];
        assert.deepEqual(value.selected, spec.expected);
        checked.push({ canonical: value.canonical, key: spec.key });
      }
      checked.push({ key: spec.key, cast: 'PASS', raw: spec.raw });
    }
    // Safe engine-valid grammars remain deliberately excluded by the product subset.
    for (const [type, raw] of [
      ['xml', '<r><!--comment--></r>'],
      ['xml', '<r><![CDATA[text]]></r>'],
      ['xml', '<r xmlns="urn:qa"/>'],
      ['jsonpath', '$.*'],
      ['jsonpath', 'strict $.a'],
      ['jsonpath', '$."a"'],
    ] as const) {
      const decision =
        type === 'xml' ? inspectPostgresXmlLiteral(raw) : inspectPostgresJsonpathLiteral(raw);
      assert(!decision.allowed);
      await client.query(`SELECT CAST($1 AS ${type === 'xml' ? 'XML' : 'JSONPATH'})`, [raw]);
      checked.push({ type, raw, engineAccepted: true, productAllowed: false });
    }
    for (const [type, raw] of [
      ['xml', '<a></b>'],
      ['jsonpath', '$.'],
    ] as const) {
      await client.query('SAVEPOINT invalid_cast');
      await assert.rejects(
        client.query(`SELECT CAST($1 AS ${type === 'xml' ? 'XML' : 'JSONPATH'})`, [raw]),
        (error: unknown) =>
          !!error &&
          typeof error === 'object' &&
          'code' in error &&
          (type === 'jsonpath' ? error.code === '42601' : String(error.code).startsWith('22')),
      );
      await client.query('ROLLBACK TO SAVEPOINT invalid_cast');
      checked.push({ type, raw, engineAccepted: false, productAllowed: false });
    }
  } finally {
    await client.query('ROLLBACK');
  }
  let actualSQL = 0;
  if (manifestIndex >= 0) {
    const manifest = JSON.parse(readFileSync(process.argv[manifestIndex + 1]!, 'utf8')) as {
      formatVersion: number;
      source: string;
      files: {
        key: string;
        channel: string;
        name: string;
        sqlSha256: string;
        documentSha256: string;
      }[];
    };
    assert.equal(manifest.formatVersion, 1);
    assert.equal(manifest.source, 'actual-rest-mcp-xml-jsonpath');
    assert.equal(manifest.files.length, postgresXmlJsonpathCases.length * 2);
    assert.equal(
      new Set(manifest.files.map((file) => file.key + '/' + file.channel)).size,
      manifest.files.length,
    );
    assert.equal(
      (
        await client.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [
          postgresXmlJsonpathSchema,
        ])
      ).rowCount,
      0,
      'Reserved QA schema must not preexist',
    );
    for (const file of manifest.files) {
      const spec = postgresXmlJsonpathCases.find((item) => item.key === file.key);
      assert(spec);
      assert(['rest', 'mcp'].includes(file.channel));
      assert.equal(file.name, `${spec.key}-${file.channel}.sql`);
      const sql = readFileSync(resolve(directory, file.name), 'utf8'),
        raw = readFileSync(resolve(directory, file.name.replace(/\.sql$/, '.json')), 'utf8');
      assert.equal(sha(sql), file.sqlSha256);
      assert.equal(sha(raw), file.documentSha256);
      const document = nativeStoredDesignDocumentSchema.parse(JSON.parse(raw));
      assert.equal(document.database.kind, 'postgresql');
      assert.equal(document.tables?.length, 1);
      assert.equal(document.columns?.length, 1);
      assert.deepEqual(document.tables![0]!.physical.namespace, {
        kind: 'postgresSchema',
        name: postgresXmlJsonpathSchema,
      });
      assert.equal(document.tables![0]!.physical.name, 'typed_values');
      assert.equal(document.columns![0]!.physical.name, 'payload');
      assert.deepEqual(document.columns![0]!.physical.type, {
        kind: 'builtin',
        database: 'postgresql',
        typeId: `postgresql:${spec.type}`,
        parameters: {},
      });
      assert.deepEqual(document.columns![0]!.physical.defaultValue, {
        kind: 'literal',
        literalType: 'typedText',
        value: spec.raw,
      });
      const ddl = compileNativeDatabaseDDL(document);
      assert(ddl.canExport);
      assert.equal(sql, ddl.sql);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        if (spec.type === 'xml')
          assert.equal(
            (
              await client.query(
                `INSERT INTO "${postgresXmlJsonpathSchema}".typed_values DEFAULT VALUES RETURNING payload::text AS raw`,
              )
            ).rows[0].raw,
            spec.raw,
          );
        else {
          await client.query(
            `INSERT INTO "${postgresXmlJsonpathSchema}".typed_values DEFAULT VALUES`,
          );
          assert.deepEqual(
            (
              await client.query(
                `SELECT jsonb_path_query_first($1::jsonb, payload) AS selected FROM "${postgresXmlJsonpathSchema}".typed_values`,
                [JSON.stringify(spec.input)],
              )
            ).rows[0].selected,
            spec.expected,
          );
        }
        actualSQL++;
        checked.push({ key: spec.key, channel: file.channel, ddl: 'PASS' });
      } finally {
        await client.query('ROLLBACK');
      }
    }
  }
  mkdirSync(directory, { recursive: true });
  const result = {
    result: 'PASS',
    source: actualSQL ? 'actual-rest-mcp-xml-jsonpath' : 'parameterized-cast-only',
    environment,
    libxmlCastVerified: true,
    castCases: postgresXmlJsonpathCases.length,
    excludedEngineValid: 6,
    invalidEngineCasts: 2,
    actualSQL,
    checked,
  };
  writeFileSync(resolve(directory, 'pg-result.json'), JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      result: result.result,
      castCases: result.castCases,
      actualSQL,
      artifact: resolve(directory, 'pg-result.json'),
    }),
  );
} finally {
  await client.end();
}
