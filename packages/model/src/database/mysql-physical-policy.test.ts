import { describe, expect, it } from 'vitest';
import { createEmptyNativeDocument } from './native-document.js';
import type { NativeColumnType, NativeColumnOptions } from './native-document.js';
import { createNativeTable, createNativeColumn } from './editing.js';
import { defaultDatabaseContext } from './profiles.js';
import {
  effectiveMysqlCharacters,
  mysqlEffectiveColumnTextOptions,
  mysqlCharacterPresets,
  inspectMysqlPhysicalDocument,
  mysqlDeclaredColumnBytes,
  mysqlDecimalStorageBytes,
  mysqlStringMetrics,
  type MysqlPhysicalEnvironment,
} from './mysql-physical-policy.js';

const env: MysqlPhysicalEnvironment = {
  pageSize: 16384,
  rowFormat: 'dynamic',
  lowerCaseTableNames: 0,
  compileMachine: 'x86_64',
};
function fixture(
  type: NativeColumnType = {
    kind: 'builtin',
    database: 'mysql',
    typeId: 'mysql:varchar',
    parameters: { length: 12 },
  },
) {
  const database = defaultDatabaseContext('mysql'),
    table = createNativeTable(database, 't'),
    column = createNativeColumn(database, table, 'c');
  table.physical.name = 'test';
  column.physical.name = 'value';
  column.physical.type = type;
  column.physical.nullable = false;
  return { ...createEmptyNativeDocument(database), tables: [table], columns: [column] };
}
describe('MySQL effective charset/collation without product coverage promotion', () => {
  it.each([
    ['utf8mb4', 'utf8mb4_0900_ai_ci', 4],
    ['utf8mb3', 'utf8mb3_general_ci', 3],
    ['ascii', 'ascii_general_ci', 1],
    ['latin1', 'latin1_swedish_ci', 1],
    ['binary', 'binary', 1],
  ] as const)(
    'central API resolves verified %s preset for CHARSET-only columns',
    (charset, collation, byteWidth) => {
      const doc = fixture();
      doc.tables[0]!.physical.options = {
        database: 'mysql',
        engine: 'InnoDB',
        charset: 'utf8mb4',
        collation: 'utf8mb4_bin',
      };
      doc.columns[0]!.physical.options = { database: 'mysql', charset };
      expect(mysqlEffectiveColumnTextOptions(doc.tables[0]!, doc.columns[0]!)).toEqual({
        engineSupported: true,
        usable: false,
        coverage: false,
        charset,
        collation,
        collationKnown: true,
        byteWidth,
      });
      expect(mysqlCharacterPresets[charset].defaultCollation).toBe(collation);
    },
  );
  it('central API keeps explicit COLLATE inference, full inheritance and unknown blockers', () => {
    const table = {
      database: 'mysql' as const,
      engine: 'InnoDB' as const,
      charset: 'utf8mb4',
      collation: 'utf8mb4_bin',
    };
    expect(mysqlEffectiveColumnTextOptions(table, { database: 'mysql' })).toMatchObject({
      charset: 'utf8mb4',
      collation: 'utf8mb4_bin',
      collationKnown: true,
      byteWidth: 4,
    });
    expect(
      mysqlEffectiveColumnTextOptions(table, { database: 'mysql', collation: 'latin1_bin' }),
    ).toMatchObject({
      charset: 'latin1',
      collation: 'latin1_bin',
      collationKnown: true,
      byteWidth: 1,
    });
    expect(
      mysqlEffectiveColumnTextOptions({
        database: 'mysql',
        engine: 'InnoDB',
        collation: 'latin1_bin',
      }),
    ).toMatchObject({ charset: 'latin1', collation: 'latin1_bin' });
    expect(mysqlEffectiveColumnTextOptions(table, { database: 'mysql', charset: 'gbk' })).toEqual({
      engineSupported: false,
      usable: false,
      coverage: false,
      collationKnown: false,
      code: 'mysql.charset-unverified',
      category: 'environment',
    });
    expect(
      mysqlEffectiveColumnTextOptions(table, {
        database: 'mysql',
        charset: 'utf8mb4',
        collation: 'latin1_bin',
      }).engineSupported,
    ).toBe(false);
  });
  it('applies table inheritance, collation-only inference and charset-only defaults independently', () => {
    const table = {
      database: 'mysql' as const,
      engine: 'InnoDB' as const,
      charset: 'utf8mb4',
      collation: 'utf8mb4_bin',
    };
    expect(effectiveMysqlCharacters(table, { database: 'mysql' })).toMatchObject({
      charset: 'utf8mb4',
      collation: 'utf8mb4_bin',
      usable: false,
      coverage: false,
    });
    expect(
      effectiveMysqlCharacters(table, { database: 'mysql', charset: 'utf8mb4' }).collation,
    ).toBe('utf8mb4_0900_ai_ci');
    expect(
      effectiveMysqlCharacters(table, { database: 'mysql', collation: 'latin1_bin' }),
    ).toMatchObject({ charset: 'latin1', collation: 'latin1_bin', maxBytesPerCharacter: 1 });
    expect(
      effectiveMysqlCharacters({ database: 'mysql', engine: 'InnoDB', collation: 'ascii_bin' })
        .charset,
    ).toBe('ascii');
  });
  it('does not guess an installed or unrelated charset/collation', () => {
    const table = { database: 'mysql' as const, engine: 'InnoDB' as const };
    expect(
      effectiveMysqlCharacters(table, {
        database: 'mysql',
        charset: 'utf8mb4',
        collation: 'latin1_bin',
      }).code,
    ).toBe('mysql.collation-charset-mismatch');
    expect(effectiveMysqlCharacters(table, { database: 'mysql', charset: 'gbk' }).category).toBe(
      'environment',
    );
    expect(
      effectiveMysqlCharacters(table, { database: 'mysql', collation: 'utf8mb4_unverified_ci' })
        .engineSupported,
    ).toBe(false);
  });
  it.each([
    ['utf8mb4', '😀', true, 4, 1],
    ['utf8mb3', '한', true, 3, 1],
    ['utf8mb3', '😀', false, null, null],
    ['ascii', 'a', true, 1, 1],
    ['ascii', 'é', false, null, null],
    ['latin1', 'é€', true, 2, 2],
    ['latin1', '한', false, null, null],
    ['latin1', '\u0080', false, null, null],
    ['latin1', '\u0081', true, 1, 1],
    ['binary', 'é', true, 2, 2],
    ['binary', '😀', true, 4, 4],
  ])(
    '%s %s reports actual encoded bytes versus declaration units',
    (charset, value, allowed, bytes, units) => {
      expect(mysqlStringMetrics(value, charset)).toMatchObject({
        engineSupported: allowed,
        encodedBytes: bytes,
        lengthUnits: units,
        usable: false,
        coverage: false,
      });
    },
  );
  it('rejects NUL/surrogate and marks unverified encodings explicitly', () => {
    expect(mysqlStringMetrics('\0').code).toBe('literal.string-invalid');
    expect(mysqlStringMetrics('\uD800').engineSupported).toBe(false);
    expect(mysqlStringMetrics('a', 'gbk').category).toBe('environment');
  });
});
describe('SQL-layer declaration budget and metadata comments', () => {
  it.each([
    [1, 0, 1],
    [9, 0, 4],
    [10, 0, 5],
    [9, 9, 4],
    [10, 2, 5],
    [65, 30, 30],
  ])('decimal(%i,%i) packs verified nine-digit groups', (p, s, bytes) => {
    expect(mysqlDecimalStorageBytes(p, s)).toBe(bytes);
  });
  it('keeps a declared upper bound for basic virtual fields while rejecting invalid decimal', () => {
    expect(mysqlDecimalStorageBytes(2, 3)).toBeNull();
    const doc = fixture({
        kind: 'builtin',
        database: 'mysql',
        typeId: 'mysql:int',
        parameters: {},
      }),
      c = doc.columns[0]!;
    c.physical.generation = {
      kind: 'computed',
      database: 'mysql',
      storage: 'virtual',
      expression: { kind: 'literal', literalType: 'number', value: '1' },
    };
    expect(
      mysqlDeclaredColumnBytes(c, effectiveMysqlCharacters(doc.tables[0]!.physical.options)),
    ).toMatchObject({ min: 0, max: 4, exact: false, fixedInlineMin: 0 });
    expect(inspectMysqlPhysicalDocument(doc, env).engineSupported).toBe(true);
  });
  it('rejects utf8mb4 VARCHAR declaration despite a short default or absent data', () => {
    const doc = fixture({
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: 65535 },
    });
    const result = inspectMysqlPhysicalDocument(doc, env);
    expect(result.engineSupported).toBe(false);
    expect(result.usable).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('mysql.varchar-byte-length-exceeded');
    expect(
      result.issues.find((i) => i.code === 'mysql.varchar-byte-length-exceeded'),
    ).toMatchObject({
      objectId: 'c',
      path: '/columns/c/physical/type/parameters/length',
      category: 'invalid',
    });
  });
  it('counts NULL bitmap and forced PK non-nullability at the 65535 boundary', () => {
    const doc = fixture({
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: 65533 },
    });
    doc.tables[0]!.physical.options = { database: 'mysql', engine: 'InnoDB', charset: 'latin1' };
    expect(inspectMysqlPhysicalDocument(doc, env).budgets[0]).toMatchObject({
      minBytes: 65535,
      maxBytes: 65535,
      nullableBytes: 0,
    });
    doc.columns[0]!.physical.nullable = true;
    expect(inspectMysqlPhysicalDocument(doc, env).issues.map((i) => i.code)).toContain(
      'mysql.row-byte-limit-exceeded',
    );
    doc.keys = [
      { id: 'pk', tableId: 't', kind: 'primary', scope: 'physical', name: '', columnIds: ['c'] },
    ];
    expect(inspectMysqlPhysicalDocument(doc, env).budgets[0]!.nullableBytes).toBe(0);
  });
  it('counts varchar prefix from encoded maximum bytes and aggregate row columns', () => {
    const doc = fixture({
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: 85 },
    });
    doc.tables[0]!.physical.options = { database: 'mysql', engine: 'InnoDB', charset: 'utf8mb3' };
    expect(inspectMysqlPhysicalDocument(doc, env).budgets[0]!.minBytes).toBe(256);
    doc.columns[0]!.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: 86 },
    };
    expect(inspectMysqlPhysicalDocument(doc, env).budgets[0]!.minBytes).toBe(260);
    doc.columns[0]!.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: 12000 },
    };
    const other = { ...structuredClone(doc.columns[0]!), id: 'second' };
    doc.columns.push(other);
    expect(inspectMysqlPhysicalDocument(doc, env).issues.map((i) => i.code)).toContain(
      'mysql.row-byte-limit-exceeded',
    );
  });
  it('separates fixed InnoDB records from off-page variable max declarations', () => {
    const doc = fixture({
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:char',
      parameters: { length: 255 },
    });
    doc.tables[0]!.physical.options = { database: 'mysql', engine: 'InnoDB', charset: 'latin1' };
    doc.columns = Array.from({ length: 32 }, (_, i) => ({
      ...structuredClone(doc.columns[0]!),
      id: 'c' + i,
    }));
    expect(inspectMysqlPhysicalDocument(doc, env).issues.map((i) => i.code)).toContain(
      'mysql.innodb-fixed-row-too-large',
    );
    const variable = fixture({
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: 16000 },
    });
    expect(inspectMysqlPhysicalDocument(variable, env).issues.map((i) => i.code)).not.toContain(
      'mysql.innodb-fixed-row-too-large',
    );
  });
  it('enforces byte-aware value-list label lengths and Unicode representation', () => {
    const doc = fixture({
      kind: 'valueList',
      database: 'mysql',
      typeId: 'mysql:enum',
      values: ['😀'],
    });
    doc.columns[0]!.physical.options = { database: 'mysql', charset: 'utf8mb3' };
    expect(inspectMysqlPhysicalDocument(doc, env).issues.map((i) => i.code)).toContain(
      'mysql.value-list-unrepresentable',
    );
    doc.columns[0]!.physical.options = { database: 'mysql', charset: 'binary' };
    doc.columns[0]!.physical.type = {
      kind: 'valueList',
      database: 'mysql',
      typeId: 'mysql:enum',
      values: ['é'.repeat(128)],
    };
    expect(inspectMysqlPhysicalDocument(doc, env).issues.map((i) => i.code)).toContain(
      'mysql.value-list-label-too-long',
    );
  });
  it('does not equate Unicode collation equivalence with JavaScript equality', () => {
    const doc = fixture({
      kind: 'valueList',
      database: 'mysql',
      typeId: 'mysql:enum',
      values: ['a', 'A'],
    });
    expect(inspectMysqlPhysicalDocument(doc, env).issues.map((i) => i.code)).toContain(
      'mysql.value-list-collation-duplicate',
    );
    doc.columns[0]!.physical.options = { database: 'mysql', collation: 'utf8mb4_bin' };
    expect(inspectMysqlPhysicalDocument(doc, env).engineSupported).toBe(true);
    doc.columns[0]!.physical.type = {
      kind: 'valueList',
      database: 'mysql',
      typeId: 'mysql:enum',
      values: ['é', 'e'],
    };
    doc.columns[0]!.physical.options = { database: 'mysql' };
    expect(inspectMysqlPhysicalDocument(doc, env).issues.map((i) => i.code)).toContain(
      'mysql.value-list-collation-unverified',
    );
    doc.columns[0]!.physical.options = { database: 'mysql', collation: 'utf8mb4_bin' };
    expect(inspectMysqlPhysicalDocument(doc, env).engineSupported).toBe(true);
    doc.columns[0]!.physical.type = {
      kind: 'valueList',
      database: 'mysql',
      typeId: 'mysql:set',
      values: ['a '],
    };
    expect(inspectMysqlPhysicalDocument(doc, env).issues.map((i) => i.code)).toContain(
      'mysql.value-list-trailing-space',
    );
  });
  it.each([
    ['mysql:enum', 255, 1],
    ['mysql:enum', 256, 2],
    ['mysql:set', 8, 1],
    ['mysql:set', 9, 2],
    ['mysql:set', 24, 3],
    ['mysql:set', 32, 4],
    ['mysql:set', 33, 8],
    ['mysql:set', 64, 8],
  ] as const)(
    '%s with %i labels budgets %i bytes independent of label length',
    (typeId, count, expected) => {
      const doc = fixture({
        kind: 'valueList',
        database: 'mysql',
        typeId,
        values: Array.from({ length: count }, (_, i) => 'value' + i),
      });
      expect(inspectMysqlPhysicalDocument(doc, env).budgets[0]!.maxBytes).toBe(expected);
      doc.columns[0]!.physical.generation = {
        kind: 'computed',
        database: 'mysql',
        storage: 'virtual',
        expression: { kind: 'literal', literalType: 'string', value: 'value0' },
      };
      expect(inspectMysqlPhysicalDocument(doc, env).budgets[0]).toMatchObject({
        maxBytes: expected,
        exact: false,
        fixedInlineMin: 0,
      });
    },
  );
  it('uses per-column BIT budgets and crosses the ninth nullable bitmap bit', () => {
    const doc = fixture({
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:bit',
      parameters: { bitLength: 1 },
    });
    doc.columns = Array.from({ length: 9 }, (_, i) => ({
      ...structuredClone(doc.columns[0]!),
      id: 'b' + i,
    }));
    expect(inspectMysqlPhysicalDocument(doc, env).budgets[0]!.maxBytes).toBe(9);
    for (const column of doc.columns) column.physical.nullable = true;
    expect(inspectMysqlPhysicalDocument(doc, env).budgets[0]).toMatchObject({
      nullableBytes: 2,
      maxBytes: 11,
    });
  });
  it.each([
    [64, 64, false, true],
    [32765, 32766, false, true],
    [32766, 32766, false, false],
    [40000, 40000, false, false],
    [32765, 32766, true, false],
  ])(
    'bounds stored+virtual VARCHAR(%i,%i), nullable=%s without blanket rejection',
    (a, b, nullable, allowed) => {
      const doc = fixture({
        kind: 'builtin',
        database: 'mysql',
        typeId: 'mysql:varchar',
        parameters: { length: a },
      });
      doc.tables[0]!.physical.options = { database: 'mysql', engine: 'InnoDB', charset: 'latin1' };
      const virtual = createNativeColumn(doc.database, doc.tables[0]!, 'v');
      virtual.physical.type = {
        kind: 'builtin',
        database: 'mysql',
        typeId: 'mysql:varchar',
        parameters: { length: b },
      };
      virtual.physical.nullable = nullable;
      virtual.physical.generation = {
        kind: 'computed',
        database: 'mysql',
        storage: 'virtual',
        expression: { kind: 'literal', literalType: 'string', value: 'x' },
      };
      doc.columns.push(virtual);
      const decision = inspectMysqlPhysicalDocument(doc, env);
      expect(decision.engineSupported).toBe(allowed);
      expect(decision.budgets[0]).toMatchObject({
        exact: false,
        virtualColumns: 1,
        nullableBytes: nullable ? 1 : 0,
        fixedInlineMin: 0,
      });
      if (!allowed)
        expect(decision.issues.map((i) => i.code)).toContain('mysql.row-byte-upper-bound-exceeded');
    },
  );
  it('counts SQL null bits of virtual declarations and excludes them from stored fixed rows', () => {
    const doc = fixture({
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:char',
      parameters: { length: 255 },
    });
    doc.tables[0]!.physical.options = { database: 'mysql', engine: 'InnoDB', charset: 'latin1' };
    doc.columns = Array.from({ length: 33 }, (_, i) => ({
      ...structuredClone(doc.columns[0]!),
      id: 'v' + i,
    }));
    for (const c of doc.columns) {
      c.physical.nullable = true;
      c.physical.generation = {
        kind: 'computed',
        database: 'mysql',
        storage: 'virtual',
        expression: { kind: 'literal', literalType: 'string', value: 'x' },
      };
    }
    const decision = inspectMysqlPhysicalDocument(doc, env);
    expect(decision.engineSupported).toBe(true);
    expect(decision.budgets[0]).toMatchObject({
      maxBytes: 33 * 255 + 5,
      nullableBytes: 5,
      fixedInlineMin: 0,
    });
  });
  it.each([
    [1017, 0, true],
    [1018, 0, false],
    [1016, 1, true],
    [1017, 1, false],
    [1015, 2, true],
    [1016, 2, false],
  ] as const)(
    'counts %i declarations plus %i functional hidden columns at InnoDB1017',
    (count, hidden, allowed) => {
      const doc = fixture({
        kind: 'builtin',
        database: 'mysql',
        typeId: 'mysql:tinyint',
        parameters: {},
      });
      doc.columns = Array.from({ length: count }, (_, i) => ({
        ...structuredClone(doc.columns[0]!),
        id: 'c' + i,
      }));
      if (hidden)
        doc.indexes = [
          {
            id: 'fx',
            tableId: 't',
            name: 'fx',
            scope: 'physical',
            unique: false,
            options: { database: 'mysql', kind: 'btree' },
            parts: Array.from({ length: hidden }, (_, i) => ({
              direction: 'asc',
              expression: {
                kind: 'binary',
                operator: '+',
                left: { kind: 'column', columnId: 'c' + i },
                right: { kind: 'literal', literalType: 'number', value: '1' },
              },
            })),
          },
        ];
      const decision = inspectMysqlPhysicalDocument(doc, env);
      expect(decision.engineSupported).toBe(allowed);
      expect(decision.budgets[0]).toMatchObject({
        declaredColumns: count,
        functionalHiddenColumns: hidden,
        totalColumns: count + hidden,
      });
      expect(decision.issues.some((i) => i.code === 'mysql.column-count-exceeded')).toBe(!allowed);
      if (hidden) expect(decision.budgets[0]!.exact).toBe(false);
    },
  );
  it('keeps legal functional-index rows under a conservative key-width budget and blocks uncertain oversized ones', () => {
    const doc = fixture({
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: 62457 },
    });
    doc.tables[0]!.physical.options = { database: 'mysql', engine: 'InnoDB', charset: 'latin1' };
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
              args: [{ kind: 'column', columnId: 'c' }],
            },
          },
        ],
      },
    ];
    expect(inspectMysqlPhysicalDocument(doc, env).engineSupported).toBe(true);
    doc.columns[0]!.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: 65533 },
    };
    const decision = inspectMysqlPhysicalDocument(doc, env);
    expect(decision.engineSupported).toBe(false);
    expect(decision.issues.map((i) => i.code)).toContain('mysql.row-byte-upper-bound-exceeded');
    expect(decision.budgets[0]!.functionalHiddenMaxBytes).toBe(3074);
  });
  it('preserves COMMENT character limits while rejecting silent supplementary replacement', () => {
    const doc = fixture();
    doc.columns[0]!.physical.comment = '한'.repeat(1024);
    doc.tables[0]!.physical.comment = '한'.repeat(2048);
    expect(
      inspectMysqlPhysicalDocument(doc, env).issues.filter((i) =>
        i.code.startsWith('mysql.comment'),
      ),
    ).toEqual([]);
    doc.columns[0]!.physical.comment = 'x'.repeat(1025);
    doc.tables[0]!.physical.comment = '😀';
    expect(inspectMysqlPhysicalDocument(doc, env).issues.map((i) => i.code)).toContain(
      'mysql.comment-length-exceeded',
    );
    expect(inspectMysqlPhysicalDocument(doc, env).issues.map((i) => i.code)).toContain(
      'mysql.comment-unrepresentable',
    );
  });
  it('reports environment prerequisites rather than equating unknown installation with profile evidence', () => {
    const doc = fixture();
    expect(
      inspectMysqlPhysicalDocument(doc, { pageSize: 4096, rowFormat: 'compact' }).engineSupported,
    ).toBe(false);
    expect(
      inspectMysqlPhysicalDocument(doc, { ...env, installedCharsets: ['ascii'] }).issues.map(
        (i) => i.code,
      ),
    ).toContain('mysql.charset-not-installed');
    expect(
      inspectMysqlPhysicalDocument(doc, { ...env, lowerCaseTableNames: 1 }).issues.find(
        (i) => i.code === 'mysql.identifier-case-environment',
      )?.severity,
    ).toBe('warning');
    expect(
      inspectMysqlPhysicalDocument(doc).issues.find(
        (i) => i.code === 'mysql.environment-profile-assumed',
      )?.severity,
    ).toBe('warning');
  });
  it('keeps old invalid row causes stable through unrelated comment/name/on-update edits', () => {
    const doc = fixture({
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: 65535 },
    });
    const before = inspectMysqlPhysicalDocument(doc, env).issues.find(
      (i) => i.code === 'mysql.row-byte-limit-exceeded',
    )!;
    doc.tables[0]!.physical.name = 'renamed';
    doc.tables[0]!.physical.comment = 'preserved old physical budget';
    doc.columns[0]!.physical.comment = 'unrelated';
    doc.columns[0]!.physical.options = {
      database: 'mysql',
      onUpdate: { kind: 'call', functionId: 'mysql:current_timestamp', args: [] },
    };
    expect(
      inspectMysqlPhysicalDocument(doc, env).issues.find((i) => i.code === before.code)?.cause,
    ).toEqual(before.cause);
    doc.columns[0]!.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:varchar',
      parameters: { length: 65534 },
    };
    expect(
      inspectMysqlPhysicalDocument(doc, env).issues.find((i) => i.code === before.code)?.cause,
    ).not.toEqual(before.cause);
  });
});
