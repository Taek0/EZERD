import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  createEmptyNativeDocument,
  createNativeColumn,
  createNativeTable,
  defaultDatabaseContext,
  compileNativeDatabaseDDL,
  databaseTypeCatalog,
  literalDecision,
  type NativeColumnType,
} from '@ezerd/model';
import {
  effectiveMysqlCharacters,
  mysqlEffectiveColumnTextOptions,
  inspectMysqlPhysicalDocument,
  mysqlDeclaredColumnBytes,
  mysqlStringMetrics,
} from '../../../packages/model/dist/database/mysql-physical-policy.js';

const container = 'ezerd-native-ddl-qa-20261002';
const containerId = '032eb46e01d610cd0bfbad6127cff0ff47a3c3be648f0a67f3de101d3ecbc282';
const volume = 'b64d418edfbd16b0ba710dfb9d9c65b4034dbf59b3da1967756602d88cbfb1d1';
const inspect = spawnSync('docker', ['inspect', '--format', '{{json .}}', container], {
  encoding: 'utf8',
});
assert.equal(inspect.status, 0, inspect.stderr);
const info = JSON.parse(inspect.stdout);
assert.equal(info.Id, containerId);
assert.equal(info.State.Running, true);
assert.equal(info.Config.Labels['ezerd.qa'], 'native-ddl-20261002');
assert.equal(info.HostConfig.NetworkMode, 'none');
assert.deepEqual(Object.keys(info.NetworkSettings.Networks), ['none']);
assert.deepEqual(info.HostConfig.PortBindings, {});
assert.deepEqual(info.NetworkSettings.Ports, {});
assert.deepEqual(info.HostConfig.Binds ?? [], []);
assert.deepEqual(info.HostConfig.VolumesFrom ?? [], []);
assert.equal(info.Mounts.length, 1);
assert.equal(info.Mounts[0].Type, 'volume');
assert.equal(info.Mounts[0].Name, volume);
assert.equal(info.Mounts[0].Destination, '/var/lib/mysql');
assert.equal(info.Mounts[0].Driver, 'local');
assert.equal(info.Mounts[0].RW, true);
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
    { input: sql, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 60000 },
  );
}
function checked(sql: string) {
  const r = execute(sql);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
const metadata = JSON.parse(
  checked(
    "SELECT JSON_OBJECT('version',VERSION(),'pageSize',@@innodb_page_size,'rowFormat',@@innodb_default_row_format,'strictMode',@@innodb_strict_mode,'sqlMode',@@sql_mode,'lowerCaseTableNames',@@lower_case_table_names,'serverCharset',@@character_set_server,'serverCollation',@@collation_server,'compileMachine',@@version_compile_machine);",
  ),
);
assert.equal(metadata.version, '8.4.11');
const installed = JSON.parse(
  checked(
    "SELECT JSON_ARRAYAGG(JSON_OBJECT('charset',CHARACTER_SET_NAME,'collation',DEFAULT_COLLATE_NAME,'maxBytes',MAXLEN)) FROM information_schema.character_sets WHERE CHARACTER_SET_NAME IN ('utf8mb4','utf8mb3','ascii','latin1','binary');",
  ),
);
const collations = JSON.parse(
  checked(
    "SELECT JSON_ARRAYAGG(JSON_OBJECT('name',COLLATION_NAME,'charset',CHARACTER_SET_NAME,'isDefault',IS_DEFAULT,'padAttribute',PAD_ATTRIBUTE)) FROM information_schema.collations WHERE COLLATION_NAME IN ('utf8mb4_0900_ai_ci','utf8mb4_bin','utf8mb4_0900_bin','utf8mb3_general_ci','utf8mb3_bin','ascii_general_ci','ascii_bin','latin1_swedish_ci','latin1_bin','binary');",
  ),
);
const database = 'ezerd_constraints_' + randomUUID().replaceAll('-', '');
const use = (sql: string) =>
  `USE \`${database}\`; SET SESSION sql_mode='STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION,NO_BACKSLASH_ESCAPES'; SET SESSION innodb_strict_mode=ON; SET NAMES utf8mb4; ${sql}`;
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const cases: { name: string; columns: string; options?: string; select?: string }[] = [
  ...[16383, 16384, 65535].map((n) => ({
    name: 'varchar_utf8mb4_' + n,
    columns: `v VARCHAR(${n}) NOT NULL`,
    options: 'DEFAULT CHARSET=utf8mb4',
  })),
  ...[65532, 65533, 65534, 65535].map((n) => ({
    name: 'varchar_latin_notnull_' + n,
    columns: `v VARCHAR(${n}) NOT NULL`,
    options: 'DEFAULT CHARSET=latin1',
  })),
  ...[65531, 65532, 65533].map((n) => ({
    name: 'varchar_latin_null_' + n,
    columns: `v VARCHAR(${n}) NULL`,
    options: 'DEFAULT CHARSET=latin1',
  })),
  {
    name: 'two_varchar_exact',
    columns: 'a VARCHAR(32765) NOT NULL,b VARCHAR(32766) NOT NULL',
    options: 'DEFAULT CHARSET=latin1',
  },
  {
    name: 'two_varchar_null',
    columns: 'a VARCHAR(32765) NULL,b VARCHAR(32766) NULL',
    options: 'DEFAULT CHARSET=latin1',
  },
  ...[31, 32, 33].map((n) => ({
    name: 'fixed_char_' + n,
    columns: Array.from({ length: n }, (_, i) => `c${i} CHAR(255) NOT NULL`).join(','),
    options: 'DEFAULT CHARSET=latin1',
  })),
  ...[1, 8, 9].map((n) => ({
    name: 'bits_' + n,
    columns:
      `v VARCHAR(65532) NOT NULL,` +
      Array.from({ length: n }, (_, i) => `b${i} BIT(1) NOT NULL`).join(','),
    options: 'DEFAULT CHARSET=latin1',
  })),
  ...[
    'TINYTEXT',
    'TEXT',
    'MEDIUMTEXT',
    'LONGTEXT',
    'TINYBLOB',
    'BLOB',
    'MEDIUMBLOB',
    'LONGBLOB',
    'JSON',
    'GEOMETRY',
  ].flatMap((type) =>
    [65520, 65521, 65522].map((n) => ({
      name: 'ref_' + type + '_' + n,
      columns: `v VARCHAR(${n}) NOT NULL,r ${type} NOT NULL`,
      options: 'DEFAULT CHARSET=latin1',
    })),
  ),
  ...(['column', 'table'] as const).flatMap((kind) =>
    [1024, 1025, 2048, 2049].flatMap((n) =>
      ['x', '한', '😀'].map((char) => ({
        name: `comment_${kind}_${char.codePointAt(0)}_${n}`,
        columns: kind === 'column' ? `v INT COMMENT ${quote(char.repeat(n))}` : 'v INT',
        options: kind === 'table' ? `COMMENT=${quote(char.repeat(n))}` : '',
        select:
          kind === 'column'
            ? `SELECT CHAR_LENGTH(column_comment),OCTET_LENGTH(column_comment),HEX(LEFT(column_comment,1)) FROM information_schema.columns WHERE table_schema='${database}' AND table_name='$TABLE' AND column_name='v';`
            : `SELECT CHAR_LENGTH(table_comment),OCTET_LENGTH(table_comment),HEX(LEFT(table_comment,1)) FROM information_schema.tables WHERE table_schema='${database}' AND table_name='$TABLE';`,
      })),
    ),
  ),
];
const charsetEvidence: unknown[] = [];
const evidence: { name: string; accepted: boolean; error: string | null; metadata?: string }[] = [];
const charsetOnly = process.argv.includes('--charset-only');
const generatedOnly = process.argv.includes('--generated-only');
const generatedEvidence: {
  name: string;
  accepted: boolean;
  error: string | null;
  metadata?: string;
}[] = [];
checked(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;`);
try {
  const env = {
    pageSize: metadata.pageSize,
    rowFormat: metadata.rowFormat,
    lowerCaseTableNames: metadata.lowerCaseTableNames,
    compileMachine: metadata.compileMachine,
    installedCharsets: installed.map((c: { charset: string }) => c.charset),
    installedCollations: collations.map((c: { name: string }) => c.name),
  };
  for (const [i, c] of (charsetOnly || generatedOnly ? [] : cases).entries()) {
    const table = 'probe_' + i;
    const r = execute(
      use(`CREATE TABLE \`${table}\`(${c.columns}) ENGINE=InnoDB ${c.options ?? ''};`),
    );
    const item: { name: string; accepted: boolean; error: string | null; metadata?: string } = {
      name: c.name,
      accepted: r.status === 0,
      error: r.status === 0 ? null : (r.stderr.match(/ERROR \d+[^\n]*/)?.[0] ?? r.stderr),
    };
    if (item.accepted && c.select)
      item.metadata = checked(use(c.select.replaceAll('$TABLE', table)));
    if (c.name.startsWith('comment_')) {
      const [, kind, cpText, nText] = c.name.split('_'),
        cp = Number(cpText),
        n = Number(nText),
        limit = kind === 'column' ? 1024 : 2048;
      assert.equal(item.accepted, n <= limit, c.name);
      if (item.accepted)
        assert.equal(
          item.metadata,
          `${n}\t${n * (cp === 54620 ? 3 : 1)}\t${cp === 120 ? '78' : cp === 54620 ? 'ED959C' : '3F'}`,
          c.name,
        );
      const doc = native(
        { kind: 'builtin', database: 'mysql', typeId: 'mysql:int', parameters: {} },
        'comment_policy',
      );
      if (kind === 'column') doc.columns[0]!.physical.comment = String.fromCodePoint(cp).repeat(n);
      else doc.tables[0]!.physical.comment = String.fromCodePoint(cp).repeat(n);
      const decision = inspectMysqlPhysicalDocument(doc, env);
      assert.equal(
        decision.engineSupported,
        n <= limit && cp <= 65535,
        c.name + ' policy lossless',
      );
    } else {
      const n = Number(c.name.split('_').at(-1));
      const expected = c.name.startsWith('varchar_utf8mb4_')
        ? n <= 16383
        : c.name.startsWith('varchar_latin_notnull_')
          ? n <= 65533
          : c.name.startsWith('varchar_latin_null_')
            ? n <= 65532
            : c.name === 'two_varchar_exact'
              ? true
              : c.name === 'two_varchar_null'
                ? false
                : c.name.startsWith('fixed_char_')
                  ? n <= 31
                  : c.name.startsWith('bits_')
                    ? n === 1
                    : n +
                        2 +
                        (c.name.includes('TINY')
                          ? 9
                          : c.name.includes('MEDIUM')
                            ? 11
                            : /ref_(TEXT|BLOB)_/.test(c.name)
                              ? 10
                              : 12) <=
                      65535;
      assert.equal(item.accepted, expected, c.name + ': ' + r.stderr);
    }
    evidence.push(item);
  }

  function native(type: NativeColumnType, name: string, charset = 'utf8mb4') {
    const database = defaultDatabaseContext('mysql'),
      table = createNativeTable(database, 't'),
      column = createNativeColumn(database, table, 'value');
    table.physical.name = name;
    table.physical.options = { database: 'mysql', engine: 'InnoDB', charset };
    column.physical.name = 'value';
    column.physical.type = type;
    column.physical.nullable = false;
    return { ...createEmptyNativeDocument(database), tables: [table], columns: [column] };
  }
  const budgetTypes: { label: string; type: NativeColumnType; charset?: string }[] =
    databaseTypeCatalog
      .filter((d) => d.databaseKind === 'mysql')
      .map((d) => ({
        label: d.id,
        type: (['enum', 'set'].includes(d.sqlName)
          ? { kind: 'valueList', database: 'mysql', typeId: d.id, values: ['a', 'b'] }
          : {
              kind: 'builtin',
              database: 'mysql',
              typeId: d.id,
              parameters: ['varchar', 'varbinary'].includes(d.sqlName) ? { length: 12 } : {},
            }) as NativeColumnType,
      }));
  for (const [p, s] of [
    [1, 0],
    [9, 0],
    [10, 2],
    [65, 30],
  ] as const)
    budgetTypes.push({
      label: `decimal-${p}-${s}`,
      type: {
        kind: 'builtin',
        database: 'mysql',
        typeId: 'mysql:decimal',
        parameters: { precision: p, scale: s },
      },
    });
  for (const name of ['time', 'datetime', 'timestamp'] as const)
    for (const precision of [1, 2, 3, 4, 5, 6])
      budgetTypes.push({
        label: `${name}-fsp-${precision}`,
        type: {
          kind: 'builtin',
          database: 'mysql',
          typeId: `mysql:${name}`,
          parameters: { precision },
        },
      });
  for (const bitLength of [7, 8, 9, 63, 64])
    budgetTypes.push({
      label: `bit-${bitLength}`,
      type: { kind: 'builtin', database: 'mysql', typeId: 'mysql:bit', parameters: { bitLength } },
    });
  for (const count of [255, 256])
    budgetTypes.push({
      label: `enum-${count}`,
      type: {
        kind: 'valueList',
        database: 'mysql',
        typeId: 'mysql:enum',
        values: Array.from({ length: count }, (_, i) => 'v' + i),
      },
    });
  for (const count of [8, 9, 24, 32, 33, 64])
    budgetTypes.push({
      label: `set-${count}`,
      type: {
        kind: 'valueList',
        database: 'mysql',
        typeId: 'mysql:set',
        values: Array.from({ length: count }, (_, i) => 'v' + i),
      },
    });
  for (const [charset, lengths] of [
    ['utf8mb4', [63, 64, 255]],
    ['utf8mb3', [85, 86]],
    ['ascii', [255]],
    ['binary', [255]],
  ] as const)
    for (const name of ['char', 'varchar'] as const)
      for (const length of lengths)
        budgetTypes.push({
          label: `${name}-${charset}-${length}`,
          charset,
          type: {
            kind: 'builtin',
            database: 'mysql',
            typeId: `mysql:${name}`,
            parameters: { length },
          },
        });
  for (const [i, test] of (charsetOnly || generatedOnly ? [] : budgetTypes).entries()) {
    const type = test.type,
      label = test.label;
    const doc = native(type, 'budget_' + i, 'latin1'),
      column = doc.columns[0]!;
    if (test.charset) column.physical.options = { database: 'mysql', charset: test.charset };
    const char = effectiveMysqlCharacters(doc.tables[0]!.physical.options, column.physical.options),
      bytes = mysqlDeclaredColumnBytes(column, char);
    assert.notEqual(bytes.max, null, label);
    const padding = createNativeColumn(doc.database, doc.tables[0]!, 'padding');
    padding.physical.name = 'padding';
    padding.physical.nullable = false;
    for (const delta of [0, 1]) {
      padding.physical.type = {
        kind: 'builtin',
        database: 'mysql',
        typeId: 'mysql:varchar',
        parameters: { length: 65533 - bytes.max! + delta },
      };
      doc.tables[0]!.physical.name = 'budget_' + i;
      doc.columns = [column, padding];
      let sql: string;
      if (delta === 0) {
        const compiled = compileNativeDatabaseDDL(doc);
        assert.equal(compiled.canExport, true, JSON.stringify(compiled.issues));
        sql = compiled.sql;
      } else {
        // Invalid fixture is a controlled ALTER, never compiler text substitution or user SQL.
        sql = `ALTER TABLE budget_${i} MODIFY COLUMN padding VARCHAR(${65534 - bytes.max!}) NOT NULL;`;
      }
      const policy = inspectMysqlPhysicalDocument(doc, env),
        r = execute(use(sql));
      assert.equal(r.status === 0, delta === 0, label + ' ' + delta + ' ' + r.stderr);
      if (delta === 1) assert.match(r.stderr, /ERROR 1118 /, label + ' byte-limit error');
      assert.equal(policy.engineSupported, delta === 0, label + ' policy ' + delta);
      evidence.push({
        name: label + '-byte-boundary-' + delta,
        accepted: r.status === 0,
        error: r.status === 0 ? null : (r.stderr.match(/ERROR \d+/)?.[0] ?? r.stderr),
      });
    }
  }
  if (!generatedOnly) {
    const optionCases = [
      { options: {}, sql: '', charset: 'utf8mb4', collation: 'utf8mb4_bin' },
      {
        options: { charset: 'utf8mb4' },
        sql: 'CHARACTER SET utf8mb4',
        charset: 'utf8mb4',
        collation: 'utf8mb4_0900_ai_ci',
      },
      {
        options: { collation: 'latin1_bin' },
        sql: 'COLLATE latin1_bin',
        charset: 'latin1',
        collation: 'latin1_bin',
      },
      {
        options: { charset: 'ascii' },
        sql: 'CHARACTER SET ascii',
        charset: 'ascii',
        collation: 'ascii_general_ci',
      },
      {
        options: { charset: 'utf8mb3' },
        sql: 'CHARACTER SET utf8mb3',
        charset: 'utf8mb3',
        collation: 'utf8mb3_general_ci',
      },
      {
        options: { charset: 'latin1' },
        sql: 'CHARACTER SET latin1',
        charset: 'latin1',
        collation: 'latin1_swedish_ci',
      },
      {
        options: { charset: 'binary' },
        sql: 'CHARACTER SET binary',
        charset: 'binary',
        collation: 'binary',
      },
      {
        options: { charset: 'utf8mb4', collation: 'latin1_bin' },
        sql: 'CHARACTER SET utf8mb4 COLLATE latin1_bin',
        charset: null,
        collation: null,
      },
    ];
    for (const [i, test] of optionCases.entries()) {
      const tableOptions = {
        database: 'mysql' as const,
        engine: 'InnoDB' as const,
        charset: 'utf8mb4',
        collation: 'utf8mb4_bin',
      };
      const decision = mysqlEffectiveColumnTextOptions(tableOptions, {
        database: 'mysql',
        ...test.options,
      });
      const r = execute(
        use(
          `CREATE TABLE options_${i}(value VARCHAR(10) ${test.sql}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;`,
        ),
      );
      assert.equal(r.status === 0, test.charset !== null, r.stderr);
      assert.equal(decision.engineSupported, r.status === 0);
      const actual =
        r.status === 0
          ? checked(
              use(
                `SELECT CHARACTER_SET_NAME,COLLATION_NAME FROM information_schema.columns WHERE table_schema='${database}' AND table_name='options_${i}' AND column_name='value';`,
              ),
            )
          : null;
      if (test.charset) {
        assert.equal(
          actual,
          test.charset === 'binary' ? 'NULL\tNULL' : `${test.charset}\t${test.collation}`,
        );
        assert.equal(decision.charset, test.charset);
        assert.equal(decision.collation, test.collation);
        assert.equal(decision.collationKnown, true);
        assert.equal(
          decision.byteWidth,
          installed.find((c: { charset: string }) => c.charset === test.charset).maxBytes,
        );
      }
      charsetEvidence.push({
        name: 'effective-options-' + i,
        actual,
        engineSupported: decision.engineSupported,
      });
    }
    for (const [charset, collation] of [
      ['ascii', 'ascii_general_ci'],
      ['latin1', 'latin1_swedish_ci'],
      ['utf8mb3', 'utf8mb3_general_ci'],
      ['utf8mb4', 'utf8mb4_0900_ai_ci'],
    ] as const) {
      const query = Array.from({ length: 95 }, (_, i) => {
        const cp = i + 32;
        return `SELECT ${cp},HEX(WEIGHT_STRING(CONVERT(X'${cp.toString(16)}' USING ${charset}) COLLATE ${collation}))`;
      }).join(' UNION ALL ');
      const groups = new Map<string, string>();
      for (const line of checked(query).split('\n')) {
        const [cp, weight] = line.split('\t');
        const label = String.fromCodePoint(Number(cp)).toLowerCase();
        if (groups.has(weight!))
          assert.equal(groups.get(weight!), label, collation + ' ASCII equivalence');
        groups.set(weight!, label);
      }
      assert.equal(groups.size, 69, collation);
      charsetEvidence.push({
        name: 'printable-ASCII-collation-weights',
        collation,
        characters: 95,
        equivalenceClasses: groups.size,
      });
    }
    const labelCases = [
      { charset: 'utf8mb4', values: ['한'.repeat(255)], accepted: true, lossless: true },
      { charset: 'utf8mb4', values: ['한'.repeat(256)], accepted: false, lossless: false },
      { charset: 'utf8mb4', values: ['😀'.repeat(255)], accepted: true, lossless: true },
      { charset: 'utf8mb3', values: ['😀'], accepted: true, lossless: false },
      { charset: 'ascii', values: ['é'], accepted: true, lossless: false },
      { charset: 'latin1', values: ['€'], accepted: true, lossless: true },
      { charset: 'binary', values: ['a'.repeat(255)], accepted: true, lossless: true },
      { charset: 'binary', values: ['é'.repeat(128)], accepted: false, lossless: false },
      { charset: 'utf8mb4', values: ['a', 'A'], accepted: false, lossless: false },
      {
        charset: 'utf8mb4',
        collation: 'utf8mb4_bin',
        values: ['a', 'A'],
        accepted: true,
        lossless: true,
      },
      { charset: 'utf8mb4', values: ['e', 'é'], accepted: false, lossless: false },
      {
        charset: 'utf8mb4',
        collation: 'utf8mb4_bin',
        values: ['e', 'é'],
        accepted: true,
        lossless: true,
      },
      { charset: 'utf8mb4', values: ['a '], accepted: true, lossless: false },
    ];
    for (const kind of ['enum', 'set'] as const) {
      for (const [i, test] of labelCases.entries()) {
        const doc = native(
          { kind: 'valueList', database: 'mysql', typeId: `mysql:${kind}`, values: test.values },
          `labels_${kind}_${i}`,
          test.charset,
        );
        doc.columns[0]!.physical.options = {
          database: 'mysql',
          charset: test.charset,
          ...(test.collation ? { collation: test.collation } : {}),
        };
        const policy = inspectMysqlPhysicalDocument(doc, env);
        const r = execute(
          use(
            `CREATE TABLE labels_${kind}_${i}(value ${kind.toUpperCase()}(${test.values.map(quote).join(',')}) CHARACTER SET ${test.charset} ${test.collation ? 'COLLATE ' + test.collation : ''} NOT NULL) ENGINE=InnoDB;`,
          ),
        );
        assert.equal(r.status === 0, test.accepted, kind + ' label ' + i + ': ' + r.stderr);
        assert.equal(policy.engineSupported, test.lossless, kind + ' label policy ' + i);
        let storedHex: string | null = null;
        if (test.accepted) {
          const defaultValue = {
            kind: 'literal' as const,
            literalType: 'string' as const,
            value: test.values[0]!,
          };
          const metrics = mysqlStringMetrics(defaultValue.value, test.charset);
          checked(
            use(`INSERT INTO labels_${kind}_${i}(value) VALUES (${quote(defaultValue.value)});`),
          );
          const stored = checked(use(`SELECT HEX(value) FROM labels_${kind}_${i};`));
          storedHex = stored;
          if (test.lossless) {
            assert.equal(
              literalDecision(doc.database, doc.columns[0]!.physical.type, defaultValue, {
                charset: test.charset,
              }).allowed,
              true,
            );
            assert.equal(
              stored,
              test.charset === 'latin1'
                ? '80'
                : Buffer.from(defaultValue.value).toString('hex').toUpperCase(),
            );
            assert.equal(stored.length / 2, metrics.encodedBytes);
          } else if (metrics.engineSupported) assert.equal(stored, '61');
          else assert.equal(stored, '3F');
        }
        charsetEvidence.push({
          name: `labels-${kind}-${i}`,
          charset: test.charset,
          accepted: test.accepted,
          lossless: test.lossless,
          storedBytes: storedHex === null ? null : storedHex.length / 2,
          storedFirstBytesHex: storedHex?.slice(0, 8) ?? null,
          issues: policy.issues.map((i) => i.code),
        });
      }
    }
    for (const length of [1, 2]) {
      const doc = native(
        { kind: 'builtin', database: 'mysql', typeId: 'mysql:varchar', parameters: { length } },
        `binary_length_${length}`,
        'binary',
      );
      const value = { kind: 'literal' as const, literalType: 'string' as const, value: 'é' };
      const r = execute(
        use(
          `CREATE TABLE binary_length_${length}(value VARCHAR(${length}) CHARACTER SET binary NOT NULL DEFAULT ${quote(value.value)}) ENGINE=InnoDB;`,
        ),
      );
      assert.equal(r.status === 0, length === 2, r.stderr);
      assert.equal(
        literalDecision(doc.database, doc.columns[0]!.physical.type, value, { charset: 'binary' })
          .allowed,
        length === 2,
      );
      charsetEvidence.push({ name: 'binary-default-length-' + length, accepted: r.status === 0 });
    }
    for (const [i, test] of [
      { name: 'char', charset: 'utf8mb4', value: '😀', length: 1, valid: true },
      { name: 'char', charset: 'utf8mb4', value: 'é'.repeat(255), length: 255, valid: true },
      { name: 'char', charset: 'utf8mb4', value: 'é'.repeat(256), length: 255, valid: false },
      { name: 'char', charset: 'ascii', value: 'é', length: 1, valid: false },
      { name: 'char', charset: 'binary', value: 'é', length: 1, valid: false },
      { name: 'char', charset: 'binary', value: 'é', length: 2, valid: true },
      { name: 'tinytext', charset: 'latin1', value: 'é'.repeat(255), valid: true },
      { name: 'tinytext', charset: 'latin1', value: 'é'.repeat(256), valid: false },
      { name: 'tinytext', charset: 'utf8mb4', value: '한'.repeat(85), valid: true },
      { name: 'tinytext', charset: 'utf8mb4', value: '한'.repeat(86), valid: false },
      { name: 'tinytext', charset: 'utf8mb3', value: '😀', valid: false },
    ].entries()) {
      const type = {
        kind: 'builtin',
        database: 'mysql',
        typeId: `mysql:${test.name}`,
        parameters: test.name === 'char' ? { length: test.length } : {},
      } as NativeColumnType;
      const doc = native(type, 'other_defaults_' + i, test.charset);
      const literal = {
        kind: 'literal' as const,
        literalType: 'string' as const,
        value: test.value,
      };
      assert.equal(
        literalDecision(doc.database, type, literal, { charset: test.charset }).allowed,
        test.valid,
        'literal boundary ' + i,
      );
      const r = execute(
        use(
          `CREATE TABLE other_defaults_${i}(value ${test.name.toUpperCase()}${test.name === 'char' ? '(' + test.length + ')' : ''} CHARACTER SET ${test.charset} NOT NULL DEFAULT ${test.name === 'tinytext' ? '(' + quote(test.value) + ')' : quote(test.value)}) ENGINE=InnoDB;`,
        ),
      );
      const inserted =
        r.status === 0 ? execute(use(`INSERT INTO other_defaults_${i} () VALUES ();`)) : null;
      assert.equal(
        r.status === 0 && inserted?.status === 0,
        test.valid,
        'other default ' + i + ': ' + r.stderr + (inserted?.stderr ?? ''),
      );
      let storedBytes: number | null = null;
      if (test.valid) {
        const stored = checked(use(`SELECT HEX(value) FROM other_defaults_${i};`));
        assert.equal(
          stored,
          test.charset === 'latin1'
            ? 'E9'.repeat(test.value.length)
            : Buffer.from(test.value).toString('hex').toUpperCase(),
        );
        storedBytes = stored.length / 2;
        if (test.charset === 'binary')
          assert.equal(
            checked(
              use(
                `SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema='${database}' AND table_name='other_defaults_${i}' AND column_name='value';`,
              ),
            ),
            'binary',
          );
      }
      charsetEvidence.push({
        name: 'other-default-' + i,
        type: test.name,
        charset: test.charset,
        characters: [...test.value].length,
        valid: test.valid,
        declarationAccepted: r.status === 0,
        insertionAccepted: inserted?.status === 0,
        storedBytes,
        error: (r.stderr + (inserted?.stderr ?? '')).match(/ERROR \d+/)?.[0] ?? null,
      });
    }
    for (const [i, [charset, value, expectedHex, accepted]] of (
      [
        ['ascii', 'a', '61', true],
        ['ascii', 'é', '', false],
        ['utf8mb3', '한', 'ED959C', true],
        ['utf8mb3', '😀', '', false],
        ['utf8mb4', '😀', 'F09F9880', true],
        ['latin1', 'é', 'E9', true],
        ['latin1', '€', '80', true],
        ['latin1', '한', '', false],
        ['latin1', '\u0080', '', false],
        ['binary', 'é', 'C3A9', true],
      ] as const
    ).entries()) {
      const doc = native(
          {
            kind: 'builtin',
            database: 'mysql',
            typeId: 'mysql:varchar',
            parameters: { length: 2 },
          },
          'string_' + i,
          charset,
        ),
        c = doc.columns[0]!;
      c.physical.defaultValue = { kind: 'literal', literalType: 'string', value };
      assert.equal(
        literalDecision(doc.database, c.physical.type, c.physical.defaultValue, { charset })
          .allowed,
        accepted,
        charset + value,
      );
      const sql = `CREATE TABLE string_${i}(value VARCHAR(2) CHARACTER SET ${charset} NOT NULL DEFAULT ${quote(value)}) ENGINE=InnoDB;`;
      const r = execute(use(sql));
      assert.equal(r.status === 0, accepted, charset + ': ' + r.stderr);
      if (accepted) {
        checked(use(`INSERT INTO string_${i} () VALUES ();`));
        assert.equal(checked(use(`SELECT HEX(value) FROM string_${i}`)), expectedHex);
      }
      charsetEvidence.push({
        charset,
        value,
        accepted,
        bytes: mysqlStringMetrics(value, charset).encodedBytes,
        error: r.status === 0 ? null : r.stderr.match(/ERROR \d+/)?.[0],
      });
    }
    const cp1252 = [
      0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039,
      0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc,
      0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
    ];
    const codepoints = Array.from({ length: 255 }, (_, i) => i + 1).map((byte) =>
      byte >= 128 && byte <= 159 ? cp1252[byte - 128]! : byte,
    );
    const value = String.fromCodePoint(...codepoints),
      hex = Buffer.from(value).toString('hex');
    const actual = checked(`SELECT HEX(CONVERT(CONVERT(X'${hex}' USING utf8mb4) USING latin1));`);
    assert.equal(
      actual,
      Array.from({ length: 255 }, (_, i) => (i + 1).toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase(),
    );
    assert.equal(mysqlStringMetrics(value, 'latin1').encodedBytes, 255);
    charsetEvidence.push({
      charset: 'latin1',
      mapping: 'all 255 non-NUL cp1252 bytes verified',
      bytes: 255,
    });
  }
  if (!charsetOnly) {
    const generatedCases = [
      {
        name: 'virtual-small',
        columns: "a VARCHAR(64) NOT NULL,v VARCHAR(64) GENERATED ALWAYS AS ('x') VIRTUAL NOT NULL",
        charset: 'latin1',
      },
      {
        name: 'virtual-both-large',
        columns:
          "a VARCHAR(40000) NOT NULL,v VARCHAR(40000) GENERATED ALWAYS AS ('x') VIRTUAL NOT NULL",
        charset: 'latin1',
      },
      {
        name: 'virtual-only-exact',
        columns: "v VARCHAR(65533) GENERATED ALWAYS AS ('x') VIRTUAL NOT NULL",
        charset: 'latin1',
      },
      {
        name: 'virtual-only-over',
        columns: "v VARCHAR(65534) GENERATED ALWAYS AS ('x') VIRTUAL NOT NULL",
        charset: 'latin1',
      },
      {
        name: 'virtual-nullable-exact',
        columns: "v VARCHAR(65532) GENERATED ALWAYS AS ('x') VIRTUAL",
        charset: 'latin1',
      },
      {
        name: 'virtual-nullable-over',
        columns: "v VARCHAR(65533) GENERATED ALWAYS AS ('x') VIRTUAL",
        charset: 'latin1',
      },
      {
        name: 'virtual-pair-exact',
        columns:
          "a VARCHAR(32765) NOT NULL,v VARCHAR(32766) GENERATED ALWAYS AS ('x') VIRTUAL NOT NULL",
        charset: 'latin1',
      },
      {
        name: 'virtual-pair-over',
        columns:
          "a VARCHAR(32766) NOT NULL,v VARCHAR(32766) GENERATED ALWAYS AS ('x') VIRTUAL NOT NULL",
        charset: 'latin1',
      },
      {
        name: 'virtual-two-exact',
        columns:
          "a VARCHAR(32765) GENERATED ALWAYS AS ('x') VIRTUAL NOT NULL,v VARCHAR(32766) GENERATED ALWAYS AS ('x') VIRTUAL NOT NULL",
        charset: 'latin1',
      },
      {
        name: 'virtual-two-over',
        columns:
          "a VARCHAR(32766) GENERATED ALWAYS AS ('x') VIRTUAL NOT NULL,v VARCHAR(32766) GENERATED ALWAYS AS ('x') VIRTUAL NOT NULL",
        charset: 'latin1',
      },
      {
        name: 'virtual-utf8-column-limit',
        columns: "v VARCHAR(16384) GENERATED ALWAYS AS ('x') VIRTUAL",
        charset: 'utf8mb4',
      },
      {
        name: 'virtual-utf8-pair-small',
        columns: "a VARCHAR(64) NOT NULL,v VARCHAR(64) GENERATED ALWAYS AS ('x') VIRTUAL NOT NULL",
        charset: 'utf8mb4',
      },
      {
        name: 'virtual-utf8-pair-large',
        columns:
          "a VARCHAR(12000) NOT NULL,v VARCHAR(12000) GENERATED ALWAYS AS ('x') VIRTUAL NOT NULL",
        charset: 'utf8mb4',
      },
      {
        name: 'virtual-fixed-not-stored',
        columns:
          'a INT NOT NULL,' +
          Array.from(
            { length: 33 },
            (_, i) => `c${i} CHAR(255) GENERATED ALWAYS AS ('x') VIRTUAL NOT NULL`,
          ).join(','),
        charset: 'latin1',
      },
      ...[1017, 1018].map((n) => ({
        name: 'count-normal-' + n,
        columns: Array.from({ length: n }, (_, i) => `c${i} TINYINT NOT NULL`).join(','),
        charset: 'latin1',
      })),
      ...[1017, 1018].map((n) => ({
        name: 'count-virtual-' + n,
        columns:
          'c0 TINYINT NOT NULL,' +
          Array.from(
            { length: n - 1 },
            (_, i) => `c${i + 1} TINYINT GENERATED ALWAYS AS (c0+1) VIRTUAL`,
          ).join(','),
        charset: 'latin1',
      })),
      ...[1016, 1017].map((n) => ({
        name: 'count-functional-' + n,
        columns:
          Array.from({ length: n }, (_, i) => `c${i} TINYINT NOT NULL`).join(',') +
          ',INDEX fx ((c0+1))',
        charset: 'latin1',
      })),
      ...[1015, 1016].map((n) => ({
        name: 'count-functional-two-' + n,
        columns:
          Array.from({ length: n }, (_, i) => `c${i} TINYINT NOT NULL`).join(',') +
          ',INDEX fx ((c0+1),(c1+1))',
        charset: 'latin1',
      })),
      {
        name: 'key-width-max',
        columns: 'v VARCHAR(768) NOT NULL, INDEX fx (v)',
        charset: 'utf8mb4',
      },
      {
        name: 'key-width-over',
        columns: 'v VARCHAR(769) NOT NULL, INDEX fx (v)',
        charset: 'utf8mb4',
      },
      {
        name: 'functional-row-safe',
        columns: 'v VARCHAR(62457) NOT NULL, INDEX fx ((LENGTH(v)))',
        charset: 'latin1',
      },
      {
        name: 'functional-row-full',
        columns: 'v VARCHAR(65533) NOT NULL, INDEX fx ((LENGTH(v)))',
        charset: 'latin1',
      },
    ];
    function virtualModel(
      specs: { length?: number; virtual: boolean; nullable?: boolean; fixed?: boolean }[],
      charset: string,
    ) {
      const doc = native(
        { kind: 'builtin', database: 'mysql', typeId: 'mysql:int', parameters: {} },
        'virtual_model',
        charset,
      );
      doc.columns = specs.map((spec, i) => {
        const c = createNativeColumn(doc.database, doc.tables[0]!, 'c' + i);
        c.physical.name = 'c' + i;
        c.physical.nullable = spec.nullable ?? false;
        c.physical.type =
          spec.length === undefined
            ? { kind: 'builtin', database: 'mysql', typeId: 'mysql:int', parameters: {} }
            : {
                kind: 'builtin',
                database: 'mysql',
                typeId: spec.fixed ? 'mysql:char' : 'mysql:varchar',
                parameters: { length: spec.length },
              };
        if (spec.virtual)
          c.physical.generation = {
            kind: 'computed',
            database: 'mysql',
            storage: 'virtual',
            expression: { kind: 'literal', literalType: 'string', value: 'x' },
          };
        return c;
      });
      return doc;
    }
    const virtualModels = [
      virtualModel(
        [
          { length: 64, virtual: false },
          { length: 64, virtual: true },
        ],
        'latin1',
      ),
      virtualModel(
        [
          { length: 40000, virtual: false },
          { length: 40000, virtual: true },
        ],
        'latin1',
      ),
      virtualModel([{ length: 65533, virtual: true }], 'latin1'),
      virtualModel([{ length: 65534, virtual: true }], 'latin1'),
      virtualModel([{ length: 65532, virtual: true, nullable: true }], 'latin1'),
      virtualModel([{ length: 65533, virtual: true, nullable: true }], 'latin1'),
      virtualModel(
        [
          { length: 32765, virtual: false },
          { length: 32766, virtual: true },
        ],
        'latin1',
      ),
      virtualModel(
        [
          { length: 32766, virtual: false },
          { length: 32766, virtual: true },
        ],
        'latin1',
      ),
      virtualModel(
        [
          { length: 32765, virtual: true },
          { length: 32766, virtual: true },
        ],
        'latin1',
      ),
      virtualModel(
        [
          { length: 32766, virtual: true },
          { length: 32766, virtual: true },
        ],
        'latin1',
      ),
      virtualModel([{ length: 16384, virtual: true, nullable: true }], 'utf8mb4'),
      virtualModel(
        [
          { length: 64, virtual: false },
          { length: 64, virtual: true },
        ],
        'utf8mb4',
      ),
      virtualModel(
        [
          { length: 12000, virtual: false },
          { length: 12000, virtual: true },
        ],
        'utf8mb4',
      ),
      virtualModel(
        [
          { virtual: false },
          ...Array.from({ length: 33 }, () => ({ length: 255, virtual: true, fixed: true })),
        ],
        'latin1',
      ),
    ];
    for (const [i, test] of generatedCases.entries()) {
      const name = 'generated_' + i;
      const r = execute(
        use(`CREATE TABLE ${name}(${test.columns}) ENGINE=InnoDB DEFAULT CHARSET=${test.charset};`),
      );
      const expected = [
        'virtual-small',
        'virtual-only-exact',
        'virtual-nullable-exact',
        'virtual-pair-exact',
        'virtual-two-exact',
        'virtual-utf8-pair-small',
        'virtual-fixed-not-stored',
        'count-normal-1017',
        'count-virtual-1017',
        'count-functional-1016',
        'count-functional-two-1015',
        'key-width-max',
        'functional-row-safe',
      ].includes(test.name);
      assert.equal(r.status === 0, expected, test.name + ': ' + r.stderr);
      if (!expected)
        assert.match(
          r.stderr,
          new RegExp(
            'ERROR ' +
              (test.name.startsWith('count-')
                ? 1117
                : test.name === 'virtual-utf8-column-limit'
                  ? 1074
                  : test.name === 'key-width-over'
                    ? 1071
                    : 1118) +
              ' ',
          ),
          test.name,
        );
      let doc = virtualModels[i];
      if (test.name.startsWith('functional-row-')) {
        doc = virtualModel(
          [{ length: test.name.endsWith('-safe') ? 62457 : 65533, virtual: false }],
          'latin1',
        );
        doc.indexes = [
          {
            id: 'fx',
            tableId: 't',
            name: 'fx',
            scope: 'physical',
            unique: false,
            options: { database: 'mysql', kind: 'btree' },
            parts: [
              {
                direction: 'asc',
                expression: {
                  kind: 'call',
                  functionId: 'mysql:length',
                  args: [{ kind: 'column', columnId: 'c0' }],
                },
              },
            ],
          },
        ];
      }
      if (test.name.startsWith('count-')) {
        const count = Number(test.name.split('-').at(-1));
        const model = native(
          { kind: 'builtin', database: 'mysql', typeId: 'mysql:tinyint', parameters: {} },
          'count_model',
          'latin1',
        );
        model.columns = Array.from({ length: count }, (_, j) => {
          const c = createNativeColumn(model.database, model.tables[0]!, 'c' + j);
          c.physical.name = 'c' + j;
          c.physical.type = {
            kind: 'builtin',
            database: 'mysql',
            typeId: 'mysql:tinyint',
            parameters: {},
          };
          c.physical.nullable = test.name.startsWith('count-virtual-') && j > 0;
          if (c.physical.nullable)
            c.physical.generation = {
              kind: 'computed',
              database: 'mysql',
              storage: 'virtual',
              expression: {
                kind: 'binary',
                operator: '+',
                left: { kind: 'column', columnId: 'c0' },
                right: { kind: 'literal', literalType: 'number', value: '1' },
              },
            };
          return c;
        });
        if (test.name.startsWith('count-functional-'))
          model.indexes = [
            {
              id: 'fx',
              tableId: 't',
              name: 'fx',
              scope: 'physical',
              unique: false,
              options: { database: 'mysql', kind: 'btree' },
              parts: Array.from({ length: test.name.includes('-two-') ? 2 : 1 }, (_, j) => ({
                direction: 'asc',
                expression: {
                  kind: 'binary',
                  operator: '+',
                  left: { kind: 'column', columnId: 'c' + j },
                  right: { kind: 'literal', literalType: 'number', value: '1' },
                },
              })),
            },
          ];
        doc = model;
      }
      // Key width itself remains main's index validator responsibility.
      if (doc) {
        const policy = inspectMysqlPhysicalDocument(doc, env);
        assert.equal(
          policy.engineSupported,
          expected,
          test.name + ' policy ' + JSON.stringify(policy.issues),
        );
        if (i === 0 || test.name === 'virtual-utf8-pair-small') {
          doc.tables[0]!.physical.name = 'compiled_' + i;
          const compiled = compileNativeDatabaseDDL(doc);
          assert.equal(compiled.canExport, true, JSON.stringify(compiled.issues));
          checked(use(compiled.sql));
          checked(use(`INSERT INTO compiled_${i}(c0) VALUES ('s');`));
          assert.equal(checked(use(`SELECT HEX(c1) FROM compiled_${i};`)), '78');
        }
      }
      let saved: string | undefined;
      if (expected && test.name.startsWith('virtual-')) {
        const insert =
          test.name.includes('only-') ||
          test.name.includes('nullable-') ||
          test.name.includes('two-')
            ? `INSERT INTO ${name} () VALUES ();`
            : test.name === 'virtual-fixed-not-stored'
              ? `INSERT INTO ${name}(a) VALUES (1);`
              : `INSERT INTO ${name}(a) VALUES ('s');`;
        checked(use(insert));
        saved = checked(
          use(`SELECT HEX(${test.name === 'virtual-fixed-not-stored' ? 'c0' : 'v'}) FROM ${name};`),
        );
        assert.equal(saved, '78', test.name + ' generated roundtrip');
      }
      generatedEvidence.push({
        name: test.name,
        accepted: r.status === 0,
        error: r.status === 0 ? null : (r.stderr.match(/ERROR \d+[^\n]*/)?.[0] ?? r.stderr),
        ...(saved ? { metadata: 'HEX(generated)=' + saved } : {}),
      });
    }
  }
  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        scope: charsetOnly ? 'charset' : generatedOnly ? 'generated' : 'all',
        metadata,
        installed,
        collations,
        evidence,
        charsetEvidence,
        generatedEvidence,
      },
      null,
      2,
    ),
  );
} finally {
  checked(`DROP DATABASE \`${database}\`;`);
}
