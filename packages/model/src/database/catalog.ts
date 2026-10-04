import {
  specifiedDatabaseCoverage,
  hasDatabaseCoverage,
  type DatabaseContext,
  type DatabaseKind,
  type DatabaseParameterIssue,
  type DatabaseTypeCategory,
  type DatabaseTypeDefinition,
  type DatabaseTypeId,
  type DatabaseTypeParameterInput,
  type DatabaseTypeResolution,
  type TypeParameterName,
  type TypeParameterRule,
  type SqliteAffinity,
} from './definitions.js';
import { getDatabaseProfile } from './profiles.js';
import { nativeBuiltinCoverage } from './readiness.js';

const pg = 'https://www.postgresql.org/docs/18/datatype.html';
const my = 'https://dev.mysql.com/doc/refman/8.4/en/data-types.html';
const sq = 'https://www.sqlite.org/datatype3.html';
const integer = (min: number, max: number, required = false): TypeParameterRule =>
  Object.freeze({ kind: 'integer', min, max, ...(required ? { required } : {}) });
const booleanRule: TypeParameterRule = Object.freeze({ kind: 'boolean' });
const temporal = Object.freeze({ precision: integer(0, 6) });
const intervalFields = Object.freeze([
  'YEAR',
  'MONTH',
  'DAY',
  'HOUR',
  'MINUTE',
  'SECOND',
  'YEAR TO MONTH',
  'DAY TO HOUR',
  'DAY TO MINUTE',
  'DAY TO SECOND',
  'HOUR TO MINUTE',
  'HOUR TO SECOND',
  'MINUTE TO SECOND',
]);

function define(
  databaseKind: DatabaseKind,
  name: string,
  category: DatabaseTypeCategory,
  aliases: readonly string[] = [],
  parameters: DatabaseTypeDefinition['parameters'] = {},
  extras: Partial<
    Pick<DatabaseTypeDefinition, 'deprecated' | 'sqliteStrict' | 'sqliteAffinity'>
  > = {},
): DatabaseTypeDefinition {
  return Object.freeze({
    id: `${databaseKind}:${name}`,
    databaseKind,
    sqlName: name,
    category,
    aliases: Object.freeze([...aliases]),
    parameters: Object.freeze({ ...parameters }),
    array: databaseKind === 'postgresql',
    deprecated: false,
    sqliteStrict: false,
    ...extras,
    coverage: nativeBuiltinCoverage(databaseKind, name),
    sources: Object.freeze([
      databaseKind === 'postgresql' ? pg : databaseKind === 'mysql' ? my : sq,
    ]),
  });
}
const grouped = (
  databaseKind: DatabaseKind,
  names: readonly string[],
  category: DatabaseTypeCategory,
  parameters: DatabaseTypeDefinition['parameters'] = {},
) => names.map((name) => define(databaseKind, name, category, [], parameters));

const postgresTypes: DatabaseTypeDefinition[] = [
  define('postgresql', 'smallint', 'integer', ['int2']),
  define('postgresql', 'integer', 'integer', ['int', 'int4']),
  define('postgresql', 'bigint', 'integer', ['int8']),
  define('postgresql', 'numeric', 'decimal', ['decimal'], {
    precision: integer(1, 1000),
    scale: integer(-1000, 1000),
  }),
  define('postgresql', 'real', 'floating', ['float4']),
  define('postgresql', 'double precision', 'floating', ['float8', 'float']),
  define('postgresql', 'char', 'string', ['character'], { length: integer(1, 10485760) }),
  define('postgresql', 'varchar', 'string', ['character varying'], {
    length: integer(1, 10485760),
  }),
  define('postgresql', 'text', 'string'),
  define('postgresql', 'bytea', 'binary'),
  define('postgresql', 'boolean', 'boolean', ['bool']),
  define('postgresql', 'date', 'temporal'),
  define('postgresql', 'time', 'temporal', ['time without time zone'], temporal),
  define('postgresql', 'timetz', 'temporal', ['time with time zone'], temporal),
  define('postgresql', 'timestamp', 'temporal', ['timestamp without time zone'], temporal),
  define('postgresql', 'timestamptz', 'temporal', ['timestamp with time zone'], temporal),
  define('postgresql', 'interval', 'interval', [], {
    ...temporal,
    fields: Object.freeze({ kind: 'choice', values: intervalFields }),
  }),
  define('postgresql', 'uuid', 'uuid'),
  ...grouped('postgresql', ['json', 'jsonb', 'jsonpath'], 'json'),
  define('postgresql', 'xml', 'xml'),
  define('postgresql', 'bit', 'bit', [], { bitLength: integer(1, 10485760) }),
  define('postgresql', 'bit varying', 'bit', ['varbit'], { bitLength: integer(1, 10485760) }),
  define('postgresql', 'money', 'money'),
  ...grouped(
    'postgresql',
    ['point', 'line', 'lseg', 'box', 'path', 'polygon', 'circle'],
    'geometry',
  ),
  ...grouped('postgresql', ['inet', 'cidr', 'macaddr', 'macaddr8'], 'network'),
  ...grouped('postgresql', ['tsvector', 'tsquery'], 'search'),
  ...grouped(
    'postgresql',
    ['int4range', 'int8range', 'numrange', 'tsrange', 'tstzrange', 'daterange'],
    'range',
  ),
  ...grouped(
    'postgresql',
    [
      'int4multirange',
      'int8multirange',
      'nummultirange',
      'tsmultirange',
      'tstzmultirange',
      'datemultirange',
    ],
    'multirange',
  ),
  ...grouped(
    'postgresql',
    [
      'oid',
      'regclass',
      'regcollation',
      'regconfig',
      'regdictionary',
      'regnamespace',
      'regoper',
      'regoperator',
      'regproc',
      'regprocedure',
      'regrole',
      'regtype',
    ],
    'object-reference',
  ),
  ...grouped('postgresql', ['pg_lsn', 'pg_snapshot'], 'snapshot'),
  define('postgresql', 'txid_snapshot', 'snapshot', [], {}, { deprecated: true }),
];

const mysqlTypes: DatabaseTypeDefinition[] = [
  ...grouped('mysql', ['tinyint', 'smallint', 'mediumint'], 'integer', { unsigned: booleanRule }),
  define('mysql', 'int', 'integer', ['integer'], { unsigned: booleanRule }),
  define('mysql', 'bigint', 'integer', [], { unsigned: booleanRule }),
  define('mysql', 'decimal', 'decimal', ['numeric', 'dec', 'fixed'], {
    precision: integer(1, 65),
    scale: integer(0, 30),
  }),
  define('mysql', 'float', 'floating'),
  define('mysql', 'double', 'floating', ['double precision', 'real']),
  define('mysql', 'bit', 'bit', [], { bitLength: integer(1, 64) }),
  define('mysql', 'date', 'temporal'),
  ...grouped('mysql', ['datetime', 'timestamp', 'time'], 'temporal', temporal),
  define('mysql', 'year', 'temporal'),
  define('mysql', 'char', 'string', ['character'], { length: integer(0, 255) }),
  define('mysql', 'varchar', 'string', ['character varying'], { length: integer(0, 65535, true) }),
  define('mysql', 'binary', 'binary', [], { length: integer(0, 255) }),
  define('mysql', 'varbinary', 'binary', [], { length: integer(0, 65535, true) }),
  ...grouped('mysql', ['tinytext', 'text', 'mediumtext', 'longtext'], 'string'),
  ...grouped('mysql', ['tinyblob', 'blob', 'mediumblob', 'longblob'], 'binary'),
  ...grouped('mysql', ['enum', 'set'], 'value-list'),
  define('mysql', 'json', 'json'),
  ...grouped(
    'mysql',
    [
      'geometry',
      'point',
      'linestring',
      'polygon',
      'multipoint',
      'multilinestring',
      'multipolygon',
      'geometrycollection',
    ],
    'geometry',
    { srid: integer(0, 4294967295) },
  ),
];

/** SQLite affinity examines substrings in this exact priority order. */
export function sqliteTypeAffinity(declaration: string): SqliteAffinity {
  const value = declaration.toUpperCase();
  if (value.includes('INT')) return 'integer';
  if (['CHAR', 'CLOB', 'TEXT'].some((part) => value.includes(part))) return 'text';
  if (!value || value.includes('BLOB')) return 'blob';
  if (['REAL', 'FLOA', 'DOUB'].some((part) => value.includes(part))) return 'real';
  return 'numeric';
}
const sqliteStrictNames = new Set(['int', 'integer', 'real', 'text', 'blob', 'any']);
const sqliteTypes = [
  'integer',
  'real',
  'text',
  'blob',
  'numeric',
  'int',
  'bigint',
  'smallint',
  'tinyint',
  'mediumint',
  'double',
  'double precision',
  'float',
  'char',
  'varchar',
  'nchar',
  'nvarchar',
  'clob',
  'decimal',
  'boolean',
  'date',
  'datetime',
  'any',
].map((name) =>
  define(
    'sqlite',
    name,
    'dynamic',
    [],
    {},
    {
      sqliteStrict: sqliteStrictNames.has(name),
      sqliteAffinity: sqliteTypeAffinity(name),
    },
  ),
);

export const databaseTypeCatalog: readonly DatabaseTypeDefinition[] = Object.freeze([
  ...postgresTypes,
  ...mysqlTypes,
  ...sqliteTypes,
]);
const byId = new Map(databaseTypeCatalog.map((item) => [item.id, item]));
const byName = new Map<string, DatabaseTypeDefinition>();
for (const definition of databaseTypeCatalog) {
  for (const name of [definition.sqlName, ...definition.aliases]) {
    const key = `${definition.databaseKind}:${name}`;
    if (byName.has(key)) throw new Error(`Duplicate database type alias: ${key}`);
    byName.set(key, definition);
  }
}
export function getDatabaseType(id: DatabaseTypeId): DatabaseTypeDefinition | undefined {
  return byId.get(id);
}

/** Resolves documented names, not a SQL fragment; interpretation stays inside one DB. */
export function resolveDatabaseType(
  context: DatabaseContext,
  name: string,
  parameters: DatabaseTypeParameterInput = {},
): DatabaseTypeResolution | undefined {
  getDatabaseProfile(context);
  const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ');
  const serials: Record<string, string> = {
    smallserial: 'smallint',
    serial2: 'smallint',
    serial: 'integer',
    serial4: 'integer',
    bigserial: 'bigint',
    serial8: 'bigint',
  };
  if (context.kind === 'postgresql' && Object.hasOwn(serials, normalized)) {
    return {
      definition: byName.get(`postgresql:${serials[normalized]}`)!,
      parameters,
      impliedGeneration: 'serial',
    };
  }
  if (context.kind === 'mysql' && ['bool', 'boolean'].includes(normalized)) {
    return { definition: byName.get('mysql:tinyint')!, parameters, declarationAlias: 'boolean' };
  }
  if (context.kind === 'mysql' && normalized === 'serial') {
    if (parameters.unsigned === false) return undefined;
    return {
      definition: byName.get('mysql:bigint')!,
      parameters: { ...parameters, unsigned: true },
      impliedGeneration: 'autoIncrement',
      impliedColumnOptions: { nullable: false, unique: true },
    };
  }
  if (normalized === 'float' && parameters.precision !== undefined && context.kind !== 'sqlite') {
    const precision = parameters.precision;
    if (
      typeof precision !== 'number' ||
      !Number.isInteger(precision) ||
      precision < 1 ||
      precision > 53
    )
      return undefined;
    const definition = byName.get(
      `${context.kind}:${
        context.kind === 'postgresql'
          ? precision <= 24
            ? 'real'
            : 'double precision'
          : precision <= 24
            ? 'float'
            : 'double'
      }`,
    )!;
    const { precision: _precision, ...rest } = parameters;
    return { definition, parameters: rest };
  }
  const definition = byName.get(`${context.kind}:${normalized}`);
  return definition ? { definition, parameters } : undefined;
}

export function listDatabaseTypes(
  context: DatabaseContext,
  options: { strict?: boolean; includeSpecified?: boolean } = {},
): readonly DatabaseTypeDefinition[] {
  getDatabaseProfile(context);
  if (options.strict && context.kind !== 'sqlite') throw new Error('table.mode-not-supported');
  return databaseTypeCatalog.filter(
    (definition) =>
      definition.databaseKind === context.kind &&
      (!options.strict || definition.sqliteStrict) &&
      (options.includeSpecified ||
        (!definition.deprecated && hasDatabaseCoverage(definition.coverage))),
  );
}

/** Checks native parameter rules; product availability is checked separately. */
export function validateDatabaseTypeParameters(
  definition: DatabaseTypeDefinition,
  input: DatabaseTypeParameterInput,
): DatabaseParameterIssue[] {
  const issues: DatabaseParameterIssue[] = [];
  const issue = (
    code: DatabaseParameterIssue['code'],
    parameter: string,
    params: DatabaseParameterIssue['params'] = {},
  ) => issues.push({ code, parameter, params });
  for (const [parameter, value] of Object.entries(input)) {
    const rule = Object.hasOwn(definition.parameters, parameter)
      ? definition.parameters[parameter as TypeParameterName]
      : undefined;
    if (!rule) {
      issue('type.option-not-supported', parameter);
      continue;
    }
    if (
      rule.kind === 'integer' &&
      (typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < rule.min ||
        value > rule.max)
    )
      issue('type.parameter-out-of-range', parameter, { min: rule.min, max: rule.max });
    if (rule.kind === 'boolean' && typeof value !== 'boolean')
      issue('type.parameter-out-of-range', parameter);
    if (rule.kind === 'choice' && (typeof value !== 'string' || !rule.values.includes(value)))
      issue('type.parameter-out-of-range', parameter);
  }
  for (const [parameter, rule] of Object.entries(definition.parameters)) {
    if (
      rule.kind === 'integer' &&
      rule.required &&
      input[parameter as TypeParameterName] === undefined
    )
      issue('type.parameter-required', parameter);
  }
  if (input.scale !== undefined && definition.category === 'decimal') {
    const precision = input.precision;
    if (definition.databaseKind === 'postgresql' && precision === undefined)
      issue('type.parameter-required', 'precision');
    if (
      definition.databaseKind === 'mysql' &&
      typeof input.scale === 'number' &&
      input.scale > (typeof precision === 'number' ? precision : 10)
    )
      issue('type.parameter-out-of-range', 'scale', {
        max: typeof precision === 'number' ? precision : 10,
      });
  }
  if (
    definition.id === 'postgresql:interval' &&
    input.precision !== undefined &&
    typeof input.fields === 'string' &&
    !input.fields.includes('SECOND')
  )
    issue('type.option-not-supported', 'precision');
  return issues;
}
