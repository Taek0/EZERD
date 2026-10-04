import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { compileNativeDatabaseDDL, type DatabaseKind } from '@ezerd/model';
import { nativeStoredDesignDocumentSchema } from '@ezerd/contracts';
import { readConfig } from '../src/config.js';
import {
  nativeFeaturePathCases,
  nativeFeaturePathFixture,
  featurePathComparable,
  featurePathIds,
  featurePathSchema,
} from './native-feature-path-fixtures.js';

const args = process.argv.slice(2),
  prepared = args.includes('--prepared'),
  partial = args.includes('--partial');
const manifestIndex = args.indexOf('--manifest'),
  engineIndex = args.indexOf('--engine');
const engines: DatabaseKind[] =
  engineIndex < 0 ? ['postgresql', 'mysql', 'sqlite'] : [args[engineIndex + 1] as DatabaseKind];
assert(engines.every((kind) => ['postgresql', 'mysql', 'sqlite'].includes(kind)));
assert(
  prepared !== manifestIndex >= 0,
  'Use --prepared OR --manifest <actual REST/MCP manifest>; never silently substitute prepared SQL.',
);
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
type Artifact = { key: string; channel: string; kind: DatabaseKind; sql: string };
const artifacts: Artifact[] = [],
  missing: string[] = [];
const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
let source: string, directory: string;
if (prepared) {
  source = 'engine-prepared';
  directory = resolve(workspaceRoot, '.data/native-feature-prepared', randomUUID());
  mkdirSync(directory, { recursive: true });
  for (const spec of nativeFeaturePathCases) {
    const fixture = nativeFeaturePathFixture(spec),
      result = compileNativeDatabaseDDL(fixture.candidate);
    assert(result.canExport, spec.key + ': ' + JSON.stringify(result.issues));
    writeFileSync(resolve(directory, spec.key + '.sql'), result.sql, 'utf8');
    writeFileSync(
      resolve(directory, spec.key + '.json'),
      JSON.stringify(fixture.candidate),
      'utf8',
    );
    artifacts.push({ key: spec.key, channel: 'prepared', kind: spec.kind, sql: result.sql });
  }
} else {
  source = 'actual-rest-mcp';
  const path = resolve(args[manifestIndex + 1]!);
  directory = dirname(path);
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
    formatVersion: number;
    source: string;
    expectedCases: string[];
    cases: {
      key: string;
      status: string;
      files?: { channel: string; name: string; sqlSha256: string; documentSha256: string }[];
    }[];
  };
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.source, source);
  assert.deepEqual(
    [...manifest.expectedCases].sort(),
    nativeFeaturePathCases.map((spec) => spec.key).sort(),
  );
  assert.equal(new Set(manifest.cases.map((item) => item.key)).size, manifest.cases.length);
  for (const spec of nativeFeaturePathCases) {
    const record = manifest.cases.find((item) => item.key === spec.key);
    if (!record || record.status !== 'accepted') {
      missing.push(spec.key);
      continue;
    }
    assert.deepEqual(record.files?.map((file) => file.channel).sort(), ['mcp', 'rest']);
    for (const file of record.files!) {
      assert.equal(file.name, `${spec.key}-${file.channel}.sql`);
      assert.equal(basename(file.name), file.name);
      const sql = readFileSync(resolve(directory, file.name), 'utf8');
      assert.equal(hash(sql), file.sqlSha256);
      const raw = readFileSync(resolve(directory, `${spec.key}-${file.channel}.json`), 'utf8');
      assert.equal(hash(raw), file.documentSha256);
      const document = nativeStoredDesignDocumentSchema.parse(JSON.parse(raw)),
        expected = nativeFeaturePathFixture(spec).candidate;
      if (file.channel === 'mcp')
        expected.columns!.find((column) => column.id === featurePathIds.id)!.logical.definition =
          'feature path ' + spec.key;
      assert.deepEqual(
        featurePathComparable(document),
        featurePathComparable(expected),
        spec.key + ': actual object values changed',
      );
      const compiled = compileNativeDatabaseDDL(document);
      assert(compiled.canExport, JSON.stringify(compiled.issues));
      assert.equal(
        sql,
        compiled.sql,
        'Execute only the exact compiler output for the verified source document.',
      );
      artifacts.push({ key: spec.key, channel: file.channel, kind: spec.kind, sql });
    }
  }
  assert(
    partial || missing.length === 0,
    'Full-path SQL missing or gate-blocked: ' +
      missing.join(', ') +
      '. --partial reports an incomplete actual subset.',
  );
}
assert(artifacts.length > 0, 'No verified SQL artifacts.');
const checked: string[] = [];
const verify = (artifact: Artifact, output: string) => {
  const fixture = nativeFeaturePathFixture(
    nativeFeaturePathCases.find((spec) => spec.key === artifact.key)!,
  );
  assert.equal(
    output.trim(),
    fixture.expectedOutput,
    `${artifact.key}/${artifact.channel}: ${output}`,
  );
  checked.push(artifact.key + '/' + artifact.channel);
};
if (engines.includes('postgresql')) {
  const configured = new URL(readConfig().DATABASE_URL);
  assert(
    ['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname),
    'Local PostgreSQL QA only.',
  );
  const client = new pg.Client({ connectionString: configured.toString() });
  await client.connect();
  try {
    assert(
      Number((await client.query('SHOW server_version_num')).rows[0].server_version_num) >= 180000,
      'PostgreSQL 18 floor required for virtual columns.',
    );
    for (const artifact of artifacts.filter((item) => item.kind === 'postgresql')) {
      const fixture = nativeFeaturePathFixture(
        nativeFeaturePathCases.find((spec) => spec.key === artifact.key)!,
      );
      await client.query('BEGIN');
      try {
        const collision = await client.query(
          'SELECT nspname FROM pg_namespace WHERE nspname=ANY($1::text[])',
          [[featurePathSchema, featurePathSchema + '_extra']],
        );
        assert.equal(
          collision.rowCount,
          0,
          'Reserved feature QA schema already exists; no existing schema is modified.',
        );
        await client.query(artifact.sql);
        const query = await client.query(fixture.smokeSql),
          result = Array.isArray(query) ? query.at(-1)! : query;
        verify(artifact, String(Object.values(result.rows[0] ?? {})[0]));
      } finally {
        await client.query('ROLLBACK');
      }
    }
  } finally {
    await client.end();
  }
}
if (engines.includes('sqlite')) {
  const executable = fileURLToPath(
    new URL('../../../.data/native-sqlite-345/sqlite3.exe', import.meta.url),
  );
  const run = (sql: string) => {
    const result = spawnSync(executable, [':memory:'], {
      input: '.bail on\n' + sql,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    return result.stdout.trim();
  };
  assert.equal(run('SELECT sqlite_version();'), '3.45.0');
  assert.equal(
    run('SELECT sqlite_source_id();'),
    '2024-01-15 17:01:13 1066602b2b1976fe58b5150777cced894af17c803e068f5918390d6915b46e1d',
  );
  for (const artifact of artifacts.filter((item) => item.kind === 'sqlite')) {
    const fixture = nativeFeaturePathFixture(
      nativeFeaturePathCases.find((spec) => spec.key === artifact.key)!,
    );
    verify(artifact, run(artifact.sql + '\n' + fixture.smokeSql));
  }
}
if (engines.includes('mysql')) {
  const container = 'ezerd-native-ddl-qa-20261002';
  const inspect = spawnSync(
    'docker',
    ['inspect', '--format', '{{json .Config.Labels}}', container],
    { encoding: 'utf8' },
  );
  assert.equal(inspect.status, 0, inspect.stderr || String(inspect.error));
  assert.equal(JSON.parse(inspect.stdout)['ezerd.qa'], 'native-ddl-20261002');
  const run = (sql: string) => {
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
    assert.equal(result.status, 0, result.stderr || String(result.error));
    return result.stdout.trim();
  };
  assert.match(run('SELECT VERSION();'), /^8\.4\./);
  for (const artifact of artifacts.filter((item) => item.kind === 'mysql')) {
    const fixture = nativeFeaturePathFixture(
      nativeFeaturePathCases.find((spec) => spec.key === artifact.key)!,
    );
    const name = 'ezerd_feature_' + randomUUID().replaceAll('-', '');
    assert.match(name, /^ezerd_feature_[a-f0-9]{32}$/);
    let created = false;
    try {
      run(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;`);
      created = true;
      verify(artifact, run(`USE \`${name}\`;\n` + artifact.sql + '\n' + fixture.smokeSql));
    } finally {
      if (created) run(`DROP DATABASE \`${name}\`;`);
    }
  }
}
const result = {
  result: 'PASS',
  source,
  partial: !!missing.length,
  checked,
  missing,
  engines,
  sqlArtifacts: directory,
};
writeFileSync(
  resolve(directory, 'engine-result-' + engines.join('-') + '.json'),
  JSON.stringify(result, null, 2),
  'utf8',
);
console.log(JSON.stringify(result));
