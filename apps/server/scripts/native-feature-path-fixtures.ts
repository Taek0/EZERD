import {
  createEmptyNativeDocument,
  createNativeTable,
  createNativeColumn,
  databaseFeatureCatalog,
  hasDatabaseCoverage,
  validateDatabaseDocument,
  nativeReferenceProblems,
  type DatabaseKind,
  type DatabaseFeatureId,
  type NativeDesignDocument,
  type NativeColumnType,
  type NativeExpression,
  type NativeIndex,
  type NativeTableRelation,
} from '@ezerd/model';
import { defaultDatabaseContext } from '@ezerd/model';
import { nativeEditorCommandSchema, type NativeEditorCommand } from '@ezerd/contracts';
import { requestFingerprint } from '@ezerd/model';

/** All producers use the same project-local IDs; each case runs in a new project/engine namespace. */
export const featurePathIds = Object.freeze({
  parent: 'fp-parent',
  child: 'fp-child',
  id: 'fp-id',
  text: 'fp-text',
  amount: 'fp-amount',
  ref: 'fp-ref',
  childId: 'fp-child-id',
  extra: 'fp-extra',
  enum: 'fp-enum',
  key: 'fp-key',
  unique: 'fp-unique',
  relation: 'fp-relation',
  index: 'fp-index',
  check: 'fp-check',
});
export const featurePathSchema = 'qa_native_feature_path';
export type FeaturePathFeature = DatabaseFeatureId | 'default' | 'onUpdate' | 'invisibleIndex';
export interface NativeFeaturePathCase {
  key: string;
  kind: DatabaseKind;
  feature: FeaturePathFeature;
  variant?: string;
  requiredFeatures: DatabaseFeatureId[];
}
export interface NativeFeaturePathFixture {
  spec: NativeFeaturePathCase;
  prepare: NativeDesignDocument;
  candidate: NativeDesignDocument;
  /** Executes only after the exported schema; assertions inspect actual engine results. */
  smokeSql: string;
  expectedOutput: string;
}
const ref = (columnId: string): NativeExpression => ({ kind: 'column', columnId });
const numeric = (value: string): NativeExpression => ({
  kind: 'literal',
  literalType: 'number',
  value,
});
export function featurePathPrimitive(kind: DatabaseKind): NativeColumnType {
  return kind === 'postgresql'
    ? { kind: 'builtin', database: kind, typeId: 'postgresql:integer', parameters: {} }
    : kind === 'mysql'
      ? { kind: 'builtin', database: kind, typeId: 'mysql:int', parameters: {} }
      : { kind: 'builtin', database: kind, typeId: 'sqlite:integer', parameters: {} };
}
function textType(kind: DatabaseKind): NativeColumnType {
  return kind === 'postgresql'
    ? { kind: 'builtin', database: kind, typeId: 'postgresql:text', parameters: {} }
    : kind === 'mysql'
      ? { kind: 'builtin', database: kind, typeId: 'mysql:varchar', parameters: { length: 64 } }
      : { kind: 'builtin', database: kind, typeId: 'sqlite:text', parameters: {} };
}
export function featurePathPrepare(kind: DatabaseKind): NativeDesignDocument {
  const db = defaultDatabaseContext(kind),
    p = featurePathIds;
  const parent = createNativeTable(db, p.parent, null, 'physical'),
    child = createNativeTable(db, p.child, null, 'physical');
  parent.physical.name = 'feature_parent';
  child.physical.name = 'feature_child';
  if (kind === 'postgresql') {
    parent.physical.namespace = { kind: 'postgresSchema', name: featurePathSchema };
    child.physical.namespace = { kind: 'postgresSchema', name: featurePathSchema };
  }
  const columns = [
    [p.id, parent, 'id'],
    [p.text, parent, 'payload'],
    [p.amount, parent, 'amount'],
    [p.ref, child, 'parent_id'],
    [p.childId, child, 'child_id'],
  ] as const;
  return {
    ...createEmptyNativeDocument(db),
    enums: [],
    keys: [],
    indexes: [],
    checks: [],
    tableRelations: [],
    layout: { nodes: [], relations: [], viewports: [] },
    tables: [parent, child],
    columns: columns.map(([id, owner, name]) => {
      const column = createNativeColumn(db, owner, id);
      column.scope = 'physical';
      column.physical.name = name;
      column.physical.nullable = true;
      column.physical.type = id === p.text ? textType(kind) : featurePathPrimitive(kind);
      return column;
    }),
  };
}
function dependencies(feature: FeaturePathFeature, kind: DatabaseKind): DatabaseFeatureId[] {
  const result: DatabaseFeatureId[] =
    feature === 'default' || feature === 'onUpdate'
      ? []
      : feature === 'invisibleIndex'
        ? ['index']
        : [feature];
  if (
    [
      'partialIndex',
      'expressionIndex',
      'includedIndexColumns',
      'nullsNotDistinct',
      'fullTextIndex',
      'spatialIndex',
      'indexMethod',
    ].includes(feature)
  )
    result.push('index');
  if (
    ['foreignKey', 'deferrableForeignKey', 'rowid', 'withoutRowid', 'autoIncrement'].includes(
      feature,
    )
  )
    result.push('primaryKey');
  if (feature === 'deferrableForeignKey') result.push('foreignKey');
  if (feature === 'index' && kind === 'postgresql') result.push('indexMethod');
  return [...new Set(result)];
}
export const nativeFeaturePathCases: readonly NativeFeaturePathCase[] = [
  ...databaseFeatureCatalog.flatMap((feature) =>
    feature.databases.flatMap((kind) => {
      const variants =
        feature.id === 'indexMethod' && kind === 'postgresql'
          ? ['btree', 'hash', 'gist', 'spgist', 'gin', 'brin']
          : [undefined];
      return variants.map((variant) => ({
        key: `${kind}-${feature.id}${variant ? '-' + variant : ''}`,
        kind,
        feature: feature.id,
        ...(variant ? { variant } : {}),
        requiredFeatures: dependencies(feature.id, kind),
      }));
    }),
  ),
  ...(['postgresql', 'mysql', 'sqlite'] as const).flatMap((kind) =>
    ['literal-number', 'literal-string', 'clock'].map((variant) => ({
      key: `${kind}-default-${variant}`,
      kind,
      feature: 'default' as const,
      variant,
      requiredFeatures: [],
    })),
  ),
  { key: 'mysql-onUpdate', kind: 'mysql', feature: 'onUpdate', requiredFeatures: [] },
  {
    key: 'mysql-invisibleIndex',
    kind: 'mysql',
    feature: 'invisibleIndex',
    requiredFeatures: ['index'],
  },
];

/** Contains supported-engine combinations only. No stored previous or coverage is fabricated. */
export function nativeFeaturePathFixture(spec: NativeFeaturePathCase): NativeFeaturePathFixture {
  const prepare = featurePathPrepare(spec.kind),
    doc = structuredClone(prepare),
    p = featurePathIds,
    kind = spec.kind;
  const parent = doc.tables![0]!,
    child = doc.tables![1]!;
  const column = (id: string) => doc.columns!.find((c) => c.id === id)!;
  const primary = () => {
    column(p.id).physical.nullable = false;
    doc.keys = [
      {
        id: p.key,
        tableId: p.parent,
        name: 'feature_pk',
        kind: 'primary',
        scope: 'physical',
        columnIds: [p.id],
      },
    ];
  };
  const foreign = () => {
    primary();
    const relation: NativeTableRelation = {
      id: p.relation,
      sourceTableId: p.child,
      targetTableId: p.parent,
      scope: 'physical',
      logical: { name: 'Parent', required: false, cardinality: 'one-to-many' },
      physical: {
        name: 'feature_fk',
        sourceColumnIds: [p.ref],
        targetColumnIds: [p.id],
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
      },
    };
    doc.tableRelations = [relation];
  };
  const index = () => {
    const value: NativeIndex = {
      id: p.index,
      tableId: p.parent,
      name: 'feature_idx',
      scope: 'physical',
      unique: false,
      parts: [{ expression: ref(p.text), direction: 'asc' }],
      options:
        kind === 'postgresql'
          ? { database: kind, method: 'btree' }
          : kind === 'mysql'
            ? { database: kind, kind: 'btree' }
            : { database: kind },
    };
    doc.indexes = [value];
    return value;
  };
  let smokeSql = '',
    expectedOutput = '';
  const parentSql =
    kind === 'postgresql' ? `"${featurePathSchema}"."feature_parent"` : 'feature_parent';
  const childSql =
    kind === 'postgresql' ? `"${featurePathSchema}"."feature_child"` : 'feature_child';
  switch (spec.feature) {
    case 'table':
      parent.physical.name = 'feature_parent_target';
      break;
    case 'column': {
      const extra = createNativeColumn(doc.database, parent, p.extra);
      extra.scope = 'physical';
      extra.physical.name = 'extra';
      extra.physical.type = featurePathPrimitive(kind);
      doc.columns!.push(extra);
      break;
    }
    case 'primaryKey':
      primary();
      break;
    case 'unique':
      doc.keys = [
        {
          id: p.unique,
          tableId: p.parent,
          name: 'feature_unique',
          kind: 'unique',
          scope: 'physical',
          columnIds: [p.text],
        },
      ];
      break;
    case 'foreignKey':
    case 'deferrableForeignKey': {
      foreign();
      if (spec.feature === 'deferrableForeignKey')
        doc.tableRelations![0]!.deferrable = { initially: 'deferred' };
      smokeSql = `INSERT INTO ${parentSql}(id) VALUES(7); INSERT INTO ${childSql}(parent_id) VALUES(7); DELETE FROM ${parentSql} WHERE id=7; SELECT COUNT(*) FROM ${childSql};`;
      expectedOutput = '0';
      break;
    }
    case 'array':
      column(p.amount).physical.type = {
        kind: 'builtin',
        database: 'postgresql',
        typeId: 'postgresql:integer',
        parameters: {},
        array: { dimensions: 2 },
      };
      break;
    case 'serial':
    case 'identity': {
      column(p.id).physical.nullable = false;
      column(p.id).physical.generation =
        spec.feature === 'serial'
          ? { kind: 'serial', database: 'postgresql' }
          : {
              kind: 'identity',
              database: 'postgresql',
              mode: 'byDefault',
              sequence: { start: '7', increment: '2', cache: 1, cycle: false },
            };
      smokeSql = `INSERT INTO ${parentSql}(amount) VALUES(4); SELECT id FROM ${parentSql};`;
      expectedOutput = spec.feature === 'serial' ? '1' : '7';
      break;
    }
    case 'autoIncrement':
    case 'rowid': {
      primary();
      if (spec.feature === 'autoIncrement')
        column(p.id).physical.generation = {
          kind: 'autoIncrement',
          database: kind === 'mysql' ? 'mysql' : 'sqlite',
        };
      smokeSql = `INSERT INTO ${parentSql}(amount) VALUES(4); SELECT id FROM ${parentSql};`;
      expectedOutput = '1';
      break;
    }
    case 'enumType': {
      doc.enums = [
        {
          id: p.enum,
          name: 'feature_status',
          schema: featurePathSchema,
          values: ['one', "한글'\\two"],
        },
      ];
      column(p.text).physical.type = {
        kind: 'projectEnum',
        database: 'postgresql',
        enumId: p.enum,
      };
      break;
    }
    case 'enumColumn':
    case 'setColumn': {
      column(p.text).physical.type = {
        kind: 'valueList',
        database: 'mysql',
        typeId: spec.feature === 'enumColumn' ? 'mysql:enum' : 'mysql:set',
        values: ['one', "한글'\\two"],
      };
      column(p.text).physical.options = {
        database: 'mysql',
        charset: 'utf8mb4',
        collation: 'utf8mb4_bin',
      };
      break;
    }
    case 'schema':
      parent.physical.namespace = { kind: 'postgresSchema', name: featurePathSchema + '_extra' };
      break;
    case 'tableComment':
      parent.physical.comment = " raw table comment ' 한글 ";
      break;
    case 'columnComment':
      column(p.text).physical.comment = " raw column comment ' 한글 ";
      break;
    case 'index':
      index();
      break;
    case 'partialIndex': {
      const value = index();
      if (value.options.database !== 'mysql')
        value.options.predicate = { kind: 'isNull', operand: ref(p.text), negate: true };
      break;
    }
    case 'expressionIndex': {
      const value = index();
      value.parts = [
        {
          expression: { kind: 'binary', operator: '+', left: ref(p.amount), right: numeric('1') },
          direction: 'asc',
        },
      ];
      break;
    }
    case 'includedIndexColumns': {
      const value = index();
      if (value.options.database === 'postgresql') value.options.includeColumnIds = [p.amount];
      break;
    }
    case 'nullsNotDistinct': {
      const value = index();
      value.unique = true;
      if (value.options.database === 'postgresql') value.options.nullsNotDistinct = true;
      break;
    }
    case 'fullTextIndex': {
      const value = index();
      value.options = { database: 'mysql', kind: 'fulltext' };
      break;
    }
    case 'spatialIndex': {
      column(p.text).physical.type = {
        kind: 'builtin',
        database: 'mysql',
        typeId: 'mysql:point',
        parameters: { srid: 4326 },
      };
      column(p.text).physical.nullable = false;
      const value = index();
      value.options = { database: 'mysql', kind: 'spatial' };
      break;
    }
    case 'indexMethod': {
      const value = index();
      if (kind === 'postgresql' && value.options.database === 'postgresql') {
        value.options.method = (spec.variant ?? 'btree') as
          'btree' | 'hash' | 'gist' | 'spgist' | 'gin' | 'brin';
        if (value.options.method === 'gist' || value.options.method === 'spgist')
          column(p.text).physical.type = {
            kind: 'builtin',
            database: 'postgresql',
            typeId: 'postgresql:point',
            parameters: {},
          };
        if (value.options.method === 'gin')
          column(p.text).physical.type = {
            kind: 'builtin',
            database: 'postgresql',
            typeId: 'postgresql:jsonb',
            parameters: {},
          };
      }
      break;
    }
    case 'invisibleIndex': {
      const value = index();
      value.options = { database: 'mysql', kind: 'btree', invisible: true };
      break;
    }
    case 'check':
      doc.checks = [
        {
          id: p.check,
          tableId: p.parent,
          name: 'feature_check',
          scope: 'physical',
          expression: { kind: 'binary', operator: '>', left: ref(p.amount), right: numeric('0') },
        },
      ];
      break;
    case 'generatedStored':
    case 'generatedVirtual': {
      const extra = createNativeColumn(doc.database, parent, p.extra);
      extra.scope = 'physical';
      extra.physical.name = 'computed_amount';
      extra.physical.type = featurePathPrimitive(kind);
      extra.physical.generation = {
        kind: 'computed',
        database: kind,
        storage: spec.feature === 'generatedStored' ? 'stored' : 'virtual',
        expression: { kind: 'binary', operator: '+', left: ref(p.amount), right: numeric('1') },
      };
      doc.columns!.push(extra);
      smokeSql = `INSERT INTO ${parentSql}(amount) VALUES(6); SELECT computed_amount FROM ${parentSql};`;
      expectedOutput = '7';
      break;
    }
    case 'charset':
      parent.physical.options = {
        database: 'mysql',
        engine: 'InnoDB',
        charset: 'latin1',
        collation: 'latin1_bin',
      };
      break;
    case 'collation':
      column(p.text).physical.options =
        kind === 'postgresql'
          ? { database: kind, collation: 'C' }
          : kind === 'mysql'
            ? { database: kind, charset: 'utf8mb4', collation: 'utf8mb4_bin' }
            : { database: kind, collation: 'NOCASE' };
      break;
    case 'srid':
      column(p.text).physical.type = {
        kind: 'builtin',
        database: 'mysql',
        typeId: 'mysql:point',
        parameters: { srid: 4326 },
      };
      break;
    case 'strictTable':
      parent.physical.options = { database: 'sqlite', strict: true, withoutRowid: false };
      break;
    case 'withoutRowid':
      primary();
      parent.physical.options = { database: 'sqlite', strict: false, withoutRowid: true };
      break;
    case 'default': {
      const target = spec.variant === 'literal-string' ? column(p.text) : column(p.amount);
      if (spec.variant === 'clock') {
        target.physical.type =
          kind === 'postgresql'
            ? { kind: 'builtin', database: kind, typeId: 'postgresql:timestamp', parameters: {} }
            : kind === 'mysql'
              ? { kind: 'builtin', database: kind, typeId: 'mysql:timestamp', parameters: {} }
              : textType(kind);
        target.physical.defaultValue = {
          kind: 'expression',
          expression: { kind: 'call', functionId: `${kind}:current_timestamp`, args: [] },
        };
      } else
        target.physical.defaultValue = {
          kind: 'literal',
          literalType: spec.variant === 'literal-string' ? 'string' : 'number',
          value: spec.variant === 'literal-string' ? "quote'\\한글" : '7',
        };
      if (spec.variant === 'literal-number') {
        smokeSql = `INSERT INTO ${parentSql}(id) VALUES(1); SELECT amount FROM ${parentSql};`;
        expectedOutput = '7';
      }
      break;
    }
    case 'onUpdate':
      column(p.amount).physical.type = {
        kind: 'builtin',
        database: 'mysql',
        typeId: 'mysql:timestamp',
        parameters: {},
      };
      column(p.amount).physical.options = {
        database: 'mysql',
        onUpdate: { kind: 'call', functionId: 'mysql:current_timestamp', args: [] },
      };
      smokeSql = `INSERT INTO ${parentSql}(id,amount) VALUES(1,'2000-01-01 00:00:00'); UPDATE ${parentSql} SET id=2; SELECT YEAR(amount)>2000 FROM ${parentSql};`;
      expectedOutput = '1';
      break;
  }
  if (!smokeSql) {
    const owner = spec.feature === 'table' ? 'feature_parent_target' : 'feature_parent';
    const schema = spec.feature === 'schema' ? featurePathSchema + '_extra' : featurePathSchema;
    smokeSql =
      kind === 'postgresql'
        ? `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${schema}' AND table_name='${owner}';`
        : kind === 'mysql'
          ? `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='${owner}';`
          : `SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='${owner}';`;
    expectedOutput = '1';
  }
  const enumValue = "한글'\\two",
    hex = Buffer.from(enumValue, 'utf8').toString('hex');
  if (spec.feature === 'array') {
    smokeSql = `INSERT INTO ${parentSql}(amount) VALUES('{{1,2},{3,4}}'); SELECT array_dims(amount) FROM ${parentSql};`;
    expectedOutput = '[1:2][1:2]';
  }
  if (spec.feature === 'enumType') {
    smokeSql = `INSERT INTO ${parentSql}(payload) VALUES('${enumValue.replaceAll("'", "''")}'); SELECT encode(convert_to(payload::text,'UTF8'),'hex') FROM ${parentSql};`;
    expectedOutput = hex;
  }
  if (spec.feature === 'enumColumn' || spec.feature === 'setColumn') {
    smokeSql = `INSERT INTO ${parentSql}(payload) VALUES(CONVERT(X'${hex}' USING utf8mb4)); SELECT HEX(payload) FROM ${parentSql};`;
    expectedOutput = hex.toUpperCase();
  }
  if (spec.feature === 'primaryKey' || spec.feature === 'unique') {
    smokeSql =
      kind === 'postgresql'
        ? `SELECT COUNT(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='${featurePathSchema}' AND c.conname='${spec.feature === 'primaryKey' ? 'feature_pk' : 'feature_unique'}' AND c.contype='${spec.feature === 'primaryKey' ? 'p' : 'u'}';`
        : kind === 'mysql'
          ? `SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema=DATABASE() AND table_name='feature_parent' AND constraint_type='${spec.feature === 'primaryKey' ? 'PRIMARY KEY' : 'UNIQUE'}';`
          : spec.feature === 'primaryKey'
            ? "SELECT COUNT(*) FROM pragma_table_info('feature_parent') WHERE pk=1;"
            : "SELECT COUNT(*) FROM pragma_index_list('feature_parent') WHERE origin='u';";
    expectedOutput = '1';
  }
  if (
    [
      'index',
      'partialIndex',
      'expressionIndex',
      'includedIndexColumns',
      'nullsNotDistinct',
      'indexMethod',
      'fullTextIndex',
      'spatialIndex',
      'invisibleIndex',
    ].includes(spec.feature)
  ) {
    if (kind === 'postgresql') {
      const condition =
        spec.feature === 'partialIndex'
          ? ' AND i.indpred IS NOT NULL'
          : spec.feature === 'expressionIndex'
            ? ' AND i.indexprs IS NOT NULL'
            : spec.feature === 'includedIndexColumns'
              ? ' AND i.indnatts>i.indnkeyatts'
              : spec.feature === 'nullsNotDistinct'
                ? ' AND i.indnullsnotdistinct'
                : '';
      smokeSql = `SELECT COUNT(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_am a ON a.oid=c.relam WHERE n.nspname='${featurePathSchema}' AND c.relname='feature_idx' AND a.amname='${spec.variant ?? 'btree'}'${condition};`;
    } else if (kind === 'mysql') {
      const method =
        spec.feature === 'fullTextIndex'
          ? 'FULLTEXT'
          : spec.feature === 'spatialIndex'
            ? 'SPATIAL'
            : 'BTREE';
      const condition =
        spec.feature === 'invisibleIndex'
          ? " AND is_visible='NO'"
          : spec.feature === 'expressionIndex'
            ? ' AND expression IS NOT NULL'
            : '';
      smokeSql = `SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='feature_parent' AND index_name='feature_idx' AND index_type='${method}'${condition};`;
    } else
      smokeSql =
        spec.feature === 'expressionIndex'
          ? "SELECT COUNT(*) FROM pragma_index_xinfo('feature_idx') WHERE cid=-2 AND key=1;"
          : `SELECT COUNT(*) FROM pragma_index_list('feature_parent') WHERE name='feature_idx'${spec.feature === 'partialIndex' ? ' AND partial=1' : ''};`;
    expectedOutput = '1';
  }
  if (spec.feature === 'check') {
    smokeSql =
      kind === 'postgresql'
        ? `SELECT COUNT(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='${featurePathSchema}' AND c.conname='feature_check' AND c.contype='c';`
        : kind === 'mysql'
          ? "SELECT COUNT(*) FROM information_schema.check_constraints WHERE constraint_schema=DATABASE() AND constraint_name='feature_check';"
          : "SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='feature_parent' AND sql LIKE '%feature_check%';";
    expectedOutput = '1';
  }
  if (spec.feature === 'strictTable' || spec.feature === 'withoutRowid') {
    smokeSql = `SELECT ${spec.feature === 'strictTable' ? 'strict' : 'wr'} FROM pragma_table_list WHERE name='feature_parent';`;
    expectedOutput = '1';
  }
  if (spec.feature === 'charset') {
    smokeSql =
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='feature_parent' AND table_collation='latin1_bin';";
    expectedOutput = '1';
  }
  if (spec.feature === 'srid') {
    smokeSql =
      "SELECT COUNT(*) FROM information_schema.st_geometry_columns WHERE table_schema=DATABASE() AND table_name='feature_parent' AND column_name='payload' AND srs_id=4326;";
    expectedOutput = '1';
  }
  if (spec.feature === 'collation') {
    smokeSql =
      kind === 'postgresql'
        ? `SELECT COUNT(*) FROM pg_attribute a JOIN pg_class t ON t.oid=a.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_collation c ON c.oid=a.attcollation WHERE n.nspname='${featurePathSchema}' AND t.relname='feature_parent' AND a.attname='payload' AND c.collname='C';`
        : kind === 'mysql'
          ? "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='feature_parent' AND column_name='payload' AND collation_name='utf8mb4_bin';"
          : "INSERT INTO feature_parent(payload) VALUES('a'); SELECT payload='A' FROM feature_parent;";
    expectedOutput = '1';
  }
  if (spec.feature === 'default' && spec.variant === 'clock') {
    smokeSql = `INSERT INTO ${parentSql}(id) VALUES(1); SELECT COUNT(*) FROM ${parentSql} WHERE amount IS NOT NULL;`;
    expectedOutput = '1';
  }
  if (spec.feature === 'default' && spec.variant === 'literal-string') {
    const literalHex = Buffer.from("quote'\\한글", 'utf8').toString('hex');
    smokeSql = `INSERT INTO ${parentSql}(id) VALUES(1); SELECT ${kind === 'postgresql' ? "encode(convert_to(payload,'UTF8'),'hex')" : 'HEX(payload)'} FROM ${parentSql};`;
    expectedOutput = kind === 'postgresql' ? literalHex : literalHex.toUpperCase();
  }
  return { spec, prepare, candidate: doc, smokeSql, expectedOutput };
}
export function nativeFeaturePathReadiness(fixture: NativeFeaturePathFixture) {
  const errors = validateDatabaseDocument(fixture.candidate, fixture.candidate.database, {
    mode: 'write',
  }).filter((issue) => issue.severity === 'error');
  const missing = fixture.spec.requiredFeatures.filter(
    (id) =>
      !hasDatabaseCoverage(databaseFeatureCatalog.find((feature) => feature.id === id)!.coverage),
  );
  return {
    ready: !missing.length && !errors.length,
    missing,
    errors,
    graph: nativeReferenceProblems(fixture.candidate),
  };
}
/** The MCP candidate uses the same objects and a valid final graph, not direct DB seeding. */
export function nativeFeaturePathCommands(
  fixture: NativeFeaturePathFixture,
): NativeEditorCommand[] {
  const before = fixture.prepare,
    after = fixture.candidate,
    commands: unknown[] = [];
  for (const value of after.enums ?? []) commands.push({ type: 'add_enum', value });
  for (const value of after.tables ?? []) {
    const old = before.tables?.find((item) => item.id === value.id);
    if (!old) commands.push({ type: 'add_table', value });
    else if (requestFingerprint(old) !== requestFingerprint(value))
      commands.push({ type: 'patch_table', id: value.id, patch: { physical: value.physical } });
  }
  for (const value of after.columns ?? []) {
    const old = before.columns?.find((item) => item.id === value.id);
    if (!old) commands.push({ type: 'add_column', value });
    else if (requestFingerprint(old) !== requestFingerprint(value))
      commands.push({ type: 'patch_column', id: value.id, patch: { physical: value.physical } });
  }
  for (const value of after.keys ?? []) commands.push({ type: 'add_key', value });
  for (const value of after.indexes ?? []) commands.push({ type: 'add_index', value });
  for (const value of after.checks ?? []) commands.push({ type: 'add_check', value });
  for (const value of after.tableRelations ?? []) commands.push({ type: 'add_foreign_key', value });
  return commands.map((command) => nativeEditorCommandSchema.parse(command));
}
/** Normalize only collection ordering for comparison; AST/parts/labels/raw field text keep their order. */
export function featurePathComparable(document: NativeDesignDocument) {
  const result = structuredClone(document);
  for (const collection of [
    'tables',
    'columns',
    'keys',
    'enums',
    'indexes',
    'checks',
    'tableRelations',
  ] as const)
    if (result[collection])
      (result as unknown as Record<string, unknown>)[collection] = [...result[collection]!].sort(
        (a, b) => a.id.localeCompare(b.id),
      );
  return result;
}
