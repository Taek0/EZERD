import { describe, expect, it } from 'vitest';
import {
  nativeIntegerConversionRules,
  nativeIntegerConversionDecision,
} from './conversion-rules.js';
import { planNativeDatabaseConversion } from './conversion.js';
import {
  createEmptyNativeDocument,
  type NativeColumnType,
  type NativeDesignDocument,
} from './native-document.js';
import { createNativeColumn, createNativeTable } from './editing.js';
import { defaultDatabaseContext } from './profiles.js';
import { validateDatabaseDocument } from './validation.js';
import { type DatabaseKind } from './definitions.js';

const pg = defaultDatabaseContext('postgresql'),
  mysql = defaultDatabaseContext('mysql');
function fixture(
  kind: 'postgresql' | 'mysql' = 'postgresql',
  type?: NativeColumnType,
): NativeDesignDocument {
  const context = defaultDatabaseContext(kind),
    table = createNativeTable(context, 'table/a~b');
  table.physical.name = 'records';
  table.physical.comment = '原文 표';
  table.physical.options =
    kind === 'mysql' ? { database: 'mysql', engine: 'InnoDB' } : { database: 'postgresql' };
  table.logical = { name: ' Raw logical ', definition: 'integer SQL text stays' };
  table.customProperties.common = { raw: ' SMALLINT INTEGER BIGINT ' };
  const column = createNativeColumn(context, table, 'column/a~b');
  column.physical.name = 'value';
  column.physical.comment = '原文 컬럼';
  column.physical.type =
    type ??
    (kind === 'postgresql'
      ? { kind: 'builtin', database: 'postgresql', typeId: 'postgresql:integer', parameters: {} }
      : { kind: 'builtin', database: 'mysql', typeId: 'mysql:int', parameters: {} });
  return {
    ...createEmptyNativeDocument(context),
    tables: [table],
    columns: [column],
    notes: [{ id: 'note', viewId: 'overview', text: 'CREATE INTEGER public.uuid' }],
    layout: {
      nodes: [
        {
          id: 'node',
          objectId: table.id,
          viewId: '__tables__',
          x: 20,
          y: 30,
          width: 320,
          height: 200,
        },
      ],
      viewports: [],
    },
  };
}
describe('bounded execution-verified signed integer conversion', () => {
  it('has only three immutable exact-width rules with real-engine fixture references', () => {
    expect(nativeIntegerConversionRules).toHaveLength(3);
    expect(Object.isFrozen(nativeIntegerConversionRules)).toBe(true);
    for (const rule of nativeIntegerConversionRules) {
      expect(Object.isFrozen(rule)).toBe(true);
      expect(rule.engineVerified).toBe(true);
      expect(rule.fixtureId).toContain('pg18.6-mysql8.4.11');
      expect(BigInt(rule.min)).toBe(-(1n << BigInt(rule.bits - 1)));
      expect(BigInt(rule.max)).toBe((1n << BigInt(rule.bits - 1)) - 1n);
    }
  });
  it.each(nativeIntegerConversionRules)(
    'applies $id in both directions with current readiness and preserves raw metadata',
    (rule) => {
      for (const kind of ['postgresql', 'mysql'] as const) {
        const source = defaultDatabaseContext(kind),
          target = kind === 'postgresql' ? mysql : pg;
        const type = {
          kind: 'builtin',
          database: kind,
          typeId: kind === 'postgresql' ? rule.postgresTypeId : rule.mysqlTypeId,
          parameters: {},
        } as NativeColumnType;
        const decision = nativeIntegerConversionDecision(type, source, target);
        expect(decision).toMatchObject({ engineVerified: true, usable: true, rule });
        const doc = fixture(kind, type),
          before = structuredClone(doc);
        const plan = planNativeDatabaseConversion(doc, source, target);
        expect(plan.engineVerified).toBe(true);
        expect(plan.canApply).toBe(true);
        expect(plan.document).toEqual(plan.candidate);
        expect(plan.candidate?.columns?.[0]?.physical.type).toEqual(decision.targetType);
        expect(plan.issues).toEqual([
          expect.objectContaining({
            code: 'mysql.environment-profile-assumed',
            severity: 'warning',
          }),
        ]);
        expect(
          validateDatabaseDocument(plan.document!, target, { mode: 'write' }).filter(
            (issue) => issue.severity === 'error',
          ),
        ).toEqual([]);
        expect(plan.sourceMap).toContainEqual(
          expect.objectContaining({
            path: '/columns/column~1a~0b/physical/type',
            source: type,
            target: decision.targetType,
            fixtureId: rule.fixtureId,
          }),
        );
        expect(plan.changedPaths).toContain('/database');
        const stable = (value: NativeDesignDocument) => ({
          ...value,
          database: null,
          tables: value.tables?.map((t) => ({
            ...t,
            physical: { ...t.physical, namespace: null, options: null },
          })),
          columns: value.columns?.map((c) => ({
            ...c,
            physical: { ...c.physical, type: null, options: null },
          })),
        });
        expect(stable(plan.candidate!)).toEqual(stable(before));
        expect(doc).toEqual(before);
        const roundtrip = planNativeDatabaseConversion(plan.candidate!, target, source);
        expect(roundtrip.canApply).toBe(true);
        expect(roundtrip.document).toEqual(roundtrip.candidate);
        expect(roundtrip.candidate?.columns?.[0]?.physical.type).toEqual(type);
        expect(stable(roundtrip.candidate!)).toEqual(stable(before));
      }
    },
  );
  it('accepts explicit signed false, rejects unsigned true, aliases, unknown parameters and mismatched profiles', () => {
    const type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:int',
      parameters: { unsigned: false },
    } as const;
    expect(nativeIntegerConversionDecision(type, mysql, pg).engineVerified).toBe(true);
    expect(
      nativeIntegerConversionDecision({ ...type, parameters: { unsigned: true } }, mysql, pg)
        .engineVerified,
    ).toBe(false);
    expect(
      nativeIntegerConversionDecision(
        { ...type, declarationAlias: 'boolean' } as NativeColumnType,
        mysql,
        pg,
      ).engineVerified,
    ).toBe(false);
    expect(
      nativeIntegerConversionDecision(type, { kind: 'mysql', profileId: pg.profileId }, pg)
        .engineVerified,
    ).toBe(false);
    expect(
      nativeIntegerConversionDecision(
        { ...type, parameters: { precision: 20 } } as unknown as NativeColumnType,
        mysql,
        pg,
      ).engineVerified,
    ).toBe(false);
  });
  it.each(['', 'public'])(
    'maps PG namespace %j explicitly and preserves its original in the source-map',
    (name) => {
      const doc = fixture();
      doc.tables![0]!.physical.namespace = { kind: 'postgresSchema', name };
      const plan = planNativeDatabaseConversion(doc, pg, mysql);
      expect(plan.candidate?.tables?.[0]?.physical).toMatchObject({
        namespace: { kind: 'mysqlCurrentDatabase' },
        options: { database: 'mysql', engine: 'InnoDB' },
      });
      expect(plan.sourceMap).toContainEqual(
        expect.objectContaining({
          source: { kind: 'postgresSchema', name },
          path: '/tables/table~1a~0b/physical/namespace',
        }),
      );
    },
  );
  it.each([
    [
      'generation',
      (d: NativeDesignDocument) => {
        d.columns![0]!.physical.generation = {
          kind: 'identity',
          database: 'postgresql',
          mode: 'always',
        };
      },
      'database.conversion-generation-unverified',
      'column/a~b',
    ],
    [
      'null default',
      (d: NativeDesignDocument) => {
        d.columns![0]!.physical.defaultValue = { kind: 'null' };
      },
      'database.conversion-default-unverified',
      'column/a~b',
    ],
    [
      'collation',
      (d: NativeDesignDocument) => {
        d.columns![0]!.physical.options = { database: 'postgresql', collation: 'installed' };
      },
      'database.conversion-environment-unverified',
      'column/a~b',
    ],
    [
      'namespace',
      (d: NativeDesignDocument) => {
        d.tables![0]!.physical.namespace = { kind: 'postgresSchema', name: 'application' };
      },
      'database.conversion-namespace-unverified',
      'table/a~b',
    ],
    [
      'array',
      (d: NativeDesignDocument) => {
        d.columns![0]!.physical.type = {
          kind: 'builtin',
          database: 'postgresql',
          typeId: 'postgresql:integer',
          parameters: {},
          array: { dimensions: 1 },
        };
      },
      'database.conversion-array-unverified',
      'column/a~b',
    ],
    [
      'physical primary',
      (d: NativeDesignDocument) => {
        d.keys = [
          {
            id: 'key',
            tableId: 'table/a~b',
            scope: 'physical',
            name: 'pk',
            kind: 'primary',
            columnIds: ['column/a~b'],
          },
        ];
      },
      'database.conversion-constraint-unverified',
      'key',
    ],
    [
      'physical unique',
      (d: NativeDesignDocument) => {
        d.keys = [
          {
            id: 'key',
            tableId: 'table/a~b',
            scope: 'physical',
            name: 'uq',
            kind: 'unique',
            columnIds: ['column/a~b'],
          },
        ];
      },
      'database.conversion-constraint-unverified',
      'key',
    ],
    [
      'dormant deferrability',
      (d: NativeDesignDocument) => {
        d.keys = [
          {
            id: 'key',
            tableId: 'table/a~b',
            scope: 'logical',
            name: 'pk',
            kind: 'primary',
            columnIds: ['column/a~b'],
            deferrable: { initially: 'immediate' },
          },
        ];
      },
      'database.conversion-constraint-unverified',
      'key',
    ],
    [
      'logical FK',
      (d: NativeDesignDocument) => {
        d.tableRelations = [
          {
            id: 'fk',
            sourceTableId: 'table/a~b',
            targetTableId: 'table/a~b',
            scope: 'logical',
            logical: { name: 'relationship', cardinality: 'one-to-one', required: false },
            physical: null,
          },
        ];
      },
      'database.conversion-constraint-unverified',
      'fk',
    ],
    [
      'deprecated',
      (d: NativeDesignDocument) => {
        d.columns![0]!.physical.type = {
          kind: 'builtin',
          database: 'postgresql',
          typeId: 'postgresql:txid_snapshot',
          parameters: {},
        };
      },
      'database.conversion-deprecated-unverified',
      'column/a~b',
    ],
    [
      'logical check',
      (d: NativeDesignDocument) => {
        d.checks = [
          {
            id: 'check',
            tableId: 'table/a~b',
            scope: 'logical',
            name: 'ck',
            expression: { kind: 'column', columnId: 'column/a~b' },
          },
        ];
      },
      'database.conversion-expression-unverified',
      'check',
    ],
  ] as const)(
    'blocks %s at the affected object without a partial candidate',
    (_name, mutate, code, objectId) => {
      const doc = fixture();
      mutate(doc);
      const before = structuredClone(doc);
      const plan = planNativeDatabaseConversion(doc, pg, mysql);
      expect(plan.candidate).toBeUndefined();
      expect(plan.canApply).toBe(false);
      expect(plan.issues).toContainEqual(expect.objectContaining({ code, objectId }));
      expect(doc).toEqual(before);
    },
  );
  it('does not erase or skip unsupported physical payloads on logical-only objects', () => {
    const doc = fixture();
    doc.tables![0]!.scope = 'logical';
    doc.columns![0]!.scope = 'logical';
    const supported = planNativeDatabaseConversion(doc, pg, mysql);
    expect(supported.candidate).toBeDefined();
    expect(supported.canApply).toBe(true);
    expect(supported.document).toEqual(supported.candidate);
    doc.columns![0]!.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:uuid',
      parameters: {},
    };
    expect(planNativeDatabaseConversion(doc, pg, mysql).candidate).toBeUndefined();
    expect(doc.columns![0]!.physical.type.typeId).toBe('postgresql:uuid');
  });
  it('checks actual table feature readiness even for a dormant table with no columns', () => {
    const doc = fixture();
    doc.tables![0]!.scope = 'logical';
    doc.columns = [];
    const plan = planNativeDatabaseConversion(doc, pg, mysql);
    expect(plan.hasPhysicalDesign).toBe(false);
    expect(plan.engineVerified).toBe(true);
    expect(plan.candidate?.tables?.[0]?.physical.options).toEqual({
      database: 'mysql',
      engine: 'InnoDB',
    });
    expect(plan.canApply).toBe(true);
    expect(plan.issues).toEqual([
      expect.objectContaining({ code: 'mysql.environment-profile-assumed', severity: 'warning' }),
    ]);
    expect(plan.document).toEqual(plan.candidate);
  });
  it('blocks explicit MySQL table charset and on-update expressions without erasing their values', () => {
    const doc = fixture('mysql'),
      before = structuredClone(doc);
    doc.tables![0]!.physical.options = { database: 'mysql', engine: 'InnoDB', charset: 'utf8mb4' };
    doc.columns![0]!.physical.options = {
      database: 'mysql',
      onUpdate: { kind: 'call', functionId: 'mysql:current_timestamp', args: [] },
    };
    const plan = planNativeDatabaseConversion(doc, mysql, pg);
    expect(plan.candidate).toBeUndefined();
    expect(plan.issues).toContainEqual(
      expect.objectContaining({
        code: 'database.conversion-environment-unverified',
        objectId: before.tables![0]!.id,
      }),
    );
    expect(plan.issues).toContainEqual(
      expect.objectContaining({
        code: 'database.conversion-expression-unverified',
        objectId: before.columns![0]!.id,
      }),
    );
    expect(doc.columns![0]!.physical.options).toMatchObject({ onUpdate: { kind: 'call' } });
  });
  it.each(['column', 'table'] as const)(
    'enforces MySQL %s comment limits without truncation',
    (object) => {
      const doc = fixture();
      const item = object === 'column' ? doc.columns![0]! : doc.tables![0]!;
      item.physical.comment = 'x'.repeat(object === 'column' ? 1025 : 2049);
      const plan = planNativeDatabaseConversion(doc, pg, mysql);
      expect(plan.issues).toContainEqual(
        expect.objectContaining({ code: 'mysql.comment-length-exceeded', objectId: item.id }),
      );
      expect(plan.candidate).toBeUndefined();
      expect(item.physical.comment).toHaveLength(object === 'column' ? 1025 : 2049);
      item.physical.comment = '😀';
      expect(planNativeDatabaseConversion(doc, pg, mysql).issues).toContainEqual(
        expect.objectContaining({ code: 'mysql.comment-unrepresentable', objectId: item.id }),
      );
    },
  );
  it.each(['postgresql', 'mysql'] satisfies DatabaseKind[])(
    'never maps %s into SQLite affinity semantics',
    (kind) => {
      const doc = fixture(kind as 'postgresql' | 'mysql');
      expect(
        planNativeDatabaseConversion(doc, doc.database, defaultDatabaseContext('sqlite')).candidate,
      ).toBeUndefined();
    },
  );
});
