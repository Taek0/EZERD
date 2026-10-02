import { getDatabaseType, validateDatabaseTypeParameters } from './catalog.js';
import type {
  NativeColumn,
  NativeColumnOptions,
  NativeDesignDocument,
  NativeTable,
  NativeTableOptions,
} from './native-document.js';

export type MysqlKnownCharset = 'utf8mb4' | 'utf8mb3' | 'ascii' | 'latin1' | 'binary';
export interface MysqlPhysicalIssue {
  code: string;
  objectId: string | null;
  path: string;
  cause: unknown;
  category: 'invalid' | 'unsupported' | 'environment';
  severity: 'error' | 'warning';
  params: Record<string, string | number | boolean>;
}
export interface MysqlPhysicalEnvironment {
  pageSize?: number;
  rowFormat?: string;
  lowerCaseTableNames?: number;
  installedCharsets?: readonly string[];
  installedCollations?: readonly string[];
  compileMachine?: string;
}
export interface MysqlCharacterDecision {
  engineSupported: boolean;
  usable: false;
  coverage: false;
  charset?: MysqlKnownCharset;
  collation?: string;
  maxBytesPerCharacter?: number;
  code?: string;
  category?: 'invalid' | 'unsupported' | 'environment';
}
const profile = {
  utf8mb4: {
    defaultCollation: 'utf8mb4_0900_ai_ci',
    maxBytes: 4,
    collations: ['utf8mb4_0900_ai_ci', 'utf8mb4_bin', 'utf8mb4_0900_bin'],
  },
  utf8mb3: {
    defaultCollation: 'utf8mb3_general_ci',
    maxBytes: 3,
    collations: ['utf8mb3_general_ci', 'utf8mb3_bin'],
  },
  ascii: {
    defaultCollation: 'ascii_general_ci',
    maxBytes: 1,
    collations: ['ascii_general_ci', 'ascii_bin'],
  },
  latin1: {
    defaultCollation: 'latin1_swedish_ci',
    maxBytes: 1,
    collations: ['latin1_swedish_ci', 'latin1_bin'],
  },
  binary: { defaultCollation: 'binary', maxBytes: 1, collations: ['binary'] },
} as const;
export const mysqlKnownCharsets = Object.freeze(Object.keys(profile) as MysqlKnownCharset[]);
/** Verified preset defaults; an emitter can explicitly pin the returned collation. */
export const mysqlCharacterPresets = profile;
const collationCharset = new Map<string, MysqlKnownCharset>(
  mysqlKnownCharsets.flatMap((charset) =>
    profile[charset].collations.map((name) => [name, charset] as const),
  ),
);
const rejected = (
  code: string,
  category: MysqlCharacterDecision['category'] = 'environment',
): MysqlCharacterDecision => ({
  engineSupported: false,
  usable: false,
  coverage: false,
  code,
  category,
});

/** Explicit COLLATE alone determines its charset; explicit CHARSET alone uses its own default. */
export function effectiveMysqlCharacters(
  table: NativeTableOptions,
  column?: NativeColumnOptions,
): MysqlCharacterDecision {
  if (table.database !== 'mysql' || (column && column.database !== 'mysql'))
    return rejected('mysql.character-context-invalid', 'invalid');
  const resolve = (
    charsetInput: string | undefined,
    collationInput: string | undefined,
    inherited?: MysqlCharacterDecision,
  ): MysqlCharacterDecision => {
    const specified = charsetInput?.toLowerCase(),
      coll = collationInput?.toLowerCase();
    if (specified && !Object.hasOwn(profile, specified))
      return rejected('mysql.charset-unverified');
    const fromColl = coll && collationCharset.get(coll);
    if (coll && !fromColl) return rejected('mysql.collation-unverified');
    if (specified && fromColl && specified !== fromColl)
      return rejected('mysql.collation-charset-mismatch', 'invalid');
    if (!specified && !coll && inherited) return inherited;
    const charset = (specified ?? fromColl ?? 'utf8mb4') as MysqlKnownCharset;
    return {
      engineSupported: true,
      usable: false,
      coverage: false,
      charset,
      collation: coll ?? profile[charset].defaultCollation,
      maxBytesPerCharacter: profile[charset].maxBytes,
    };
  };
  const inherited = resolve(table.charset, table.collation);
  if (!inherited.engineSupported || !column || column.database !== 'mysql') return inherited;
  return resolve(column.charset, column.collation, inherited);
}

export type MysqlEffectiveColumnTextOptions =
  | {
      engineSupported: true;
      usable: false;
      coverage: false;
      charset: MysqlKnownCharset;
      collation: string;
      collationKnown: true;
      byteWidth: number;
    }
  | {
      engineSupported: false;
      usable: false;
      coverage: false;
      charset?: never;
      collation?: never;
      collationKnown: false;
      byteWidth?: never;
      code: string;
      category: 'invalid' | 'unsupported' | 'environment';
    };

/** Central table/column inheritance for FK, indexes, row budgets and literal facts.
 * Known means a verified preset, not proof of a remote server's configured default.
 * Emit charset/collation explicitly to pin that preset; unknown pairs never fall back.
 */
export function mysqlEffectiveColumnTextOptions(
  table: NativeTable | NativeTableOptions,
  column?: NativeColumn | NativeColumnOptions,
): MysqlEffectiveColumnTextOptions {
  const tableOptions = 'physical' in table ? table.physical.options : table;
  const columnOptions = column && ('physical' in column ? column.physical.options : column);
  const decision = effectiveMysqlCharacters(tableOptions, columnOptions);
  return decision.engineSupported
    ? {
        engineSupported: true,
        usable: false,
        coverage: false,
        charset: decision.charset!,
        collation: decision.collation!,
        collationKnown: true,
        byteWidth: decision.maxBytesPerCharacter!,
      }
    : {
        engineSupported: false,
        usable: false,
        coverage: false,
        collationKnown: false,
        code: decision.code!,
        category: decision.category!,
      };
}

// MySQL latin1 is cp1252, including its five explicitly mapped undefined C1 entries.
const cp1252 = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152,
  0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122,
  0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];
const latin1Extra = new Set(cp1252);
export interface MysqlStringMetrics {
  engineSupported: boolean;
  usable: false;
  coverage: false;
  characters: number;
  /** Encoded bytes, not UTF-16 code units. binary textual input is UTF-8 bytes. */
  encodedBytes: number | null;
  lengthUnits: number | null;
  code?: string;
  category?: 'invalid' | 'environment';
}
export function mysqlStringMetrics(value: string, charsetInput = 'utf8mb4'): MysqlStringMetrics {
  const charset = charsetInput.toLowerCase();
  const chars = [...value];
  const no = (
    code: string,
    category: 'invalid' | 'environment' = 'invalid',
  ): MysqlStringMetrics => ({
    engineSupported: false,
    usable: false,
    coverage: false,
    characters: chars.length,
    encodedBytes: null,
    lengthUnits: null,
    code,
    category,
  });
  if (!Object.hasOwn(profile, charset)) return no('default.charset-unverified', 'environment');
  let bytes = 0;
  for (const char of chars) {
    const cp = char.codePointAt(0)!;
    if (cp === 0 || (cp >= 0xd800 && cp <= 0xdfff)) return no('literal.string-invalid');
    if (
      (charset === 'ascii' && cp > 127) ||
      (charset === 'utf8mb3' && cp > 65535) ||
      (charset === 'latin1' && !(cp <= 127 || (cp >= 160 && cp <= 255) || latin1Extra.has(cp)))
    )
      return no('default.charset-value-invalid');
    bytes +=
      charset === 'latin1' || charset === 'ascii'
        ? 1
        : cp <= 127
          ? 1
          : cp <= 2047
            ? 2
            : cp <= 65535
              ? 3
              : 4;
  }
  return {
    engineSupported: true,
    usable: false,
    coverage: false,
    characters: chars.length,
    encodedBytes: bytes,
    lengthUnits: charset === 'binary' ? bytes : chars.length,
  };
}

export interface MysqlDeclaredBytes {
  min: number;
  max: number | null;
  /** SQL layer declaration budget only; never actual InnoDB disk row bytes. */
  exact: boolean;
  formula: string;
  fixedInlineMin: number;
}
const fixed: Record<string, number> = {
  tinyint: 1,
  smallint: 2,
  mediumint: 3,
  int: 4,
  bigint: 8,
  float: 4,
  double: 8,
  date: 3,
  year: 1,
};
export function mysqlDecimalStorageBytes(precision = 10, scale = 0): number | null {
  if (
    !Number.isInteger(precision) ||
    precision < 1 ||
    precision > 65 ||
    !Number.isInteger(scale) ||
    scale < 0 ||
    scale > 30 ||
    scale > precision
  )
    return null;
  const remainder = [0, 1, 1, 2, 2, 3, 3, 4, 4];
  const digits = (n: number) => Math.floor(n / 9) * 4 + remainder[n % 9]!;
  return digits(precision - scale) + digits(scale);
}
function mysqlTypeDeclarationBytes(
  column: NativeColumn,
  characters: MysqlCharacterDecision,
): MysqlDeclaredBytes {
  const type = column.physical.type;
  const unknown = (formula: string): MysqlDeclaredBytes => ({
    min: 0,
    max: null,
    exact: false,
    formula,
    fixedInlineMin: 0,
  });
  if (type.kind === 'valueList' && type.database === 'mysql') {
    const count = type.values.length;
    if (
      count < 1 ||
      (type.typeId === 'mysql:enum' && count > 65535) ||
      (type.typeId === 'mysql:set' && count > 64)
    )
      return unknown('invalid-value-list');
    const bytes =
      type.typeId === 'mysql:enum'
        ? count <= 255
          ? 1
          : 2
        : count <= 32
          ? Math.ceil(count / 8)
          : 8;
    return {
      min: bytes,
      max: bytes,
      exact: true,
      formula: type.typeId === 'mysql:enum' ? 'enum-index-1-or-2' : 'set-bitmap-1-2-3-4-or-8',
      fixedInlineMin: bytes,
    };
  }
  if (type.kind !== 'builtin' || type.database !== 'mysql') return unknown('unresolved-type');
  const definition = getDatabaseType(type.typeId);
  if (!definition || validateDatabaseTypeParameters(definition, type.parameters).length)
    return unknown('invalid-type-parameters');
  const name = definition.sqlName,
    p = type.parameters;
  const exact = (bytes: number, formula: string, inline = bytes): MysqlDeclaredBytes => ({
    min: bytes,
    max: bytes,
    exact: true,
    formula,
    fixedInlineMin: inline,
  });
  if (Object.hasOwn(fixed, name)) return exact(fixed[name]!, 'fixed-scalar');
  if (name === 'decimal') {
    const bytes = mysqlDecimalStorageBytes(
      'precision' in p ? p.precision : undefined,
      'scale' in p ? p.scale : undefined,
    );
    return bytes === null ? unknown('invalid-decimal') : exact(bytes, 'decimal-packed-9-digits');
  }
  if (['time', 'datetime', 'timestamp'].includes(name))
    return exact(
      (name === 'time' ? 3 : name === 'datetime' ? 5 : 4) +
        Math.ceil(('precision' in p ? (p.precision ?? 0) : 0) / 2),
      'temporal-base-plus-fsp',
    );
  if (name === 'bit')
    return exact(Math.ceil(('bitLength' in p ? (p.bitLength ?? 1) : 1) / 8), 'bit-ceiling-8');
  if (['char', 'varchar', 'binary', 'varbinary'].includes(name)) {
    const length = 'length' in p ? (p.length ?? 1) : 1;
    const width = ['binary', 'varbinary'].includes(name) ? 1 : characters.maxBytesPerCharacter;
    if (!width) return unknown('charset-budget-unverified');
    const bytes = length * width,
      variable = ['varchar', 'varbinary'].includes(name);
    return exact(
      bytes + (variable ? (bytes <= 255 ? 1 : 2) : 0),
      variable ? 'declared-max-plus-length-prefix' : 'declared-fixed-max',
      variable || (name === 'char' && width > 1) ? 0 : bytes,
    );
  }
  const refs: Record<string, number> = {
    tinytext: 9,
    tinyblob: 9,
    text: 10,
    blob: 10,
    mediumtext: 11,
    mediumblob: 11,
    longtext: 12,
    longblob: 12,
    json: 12,
    geometry: 12,
    point: 12,
    linestring: 12,
    polygon: 12,
    multipoint: 12,
    multilinestring: 12,
    multipolygon: 12,
    geometrycollection: 12,
  };
  if (Object.hasOwn(refs, name))
    return {
      min: refs[name]!,
      max: refs[name]!,
      exact: true,
      formula: 'sql-reference-64bit',
      fixedInlineMin: 0,
    };
  return unknown('type-budget-unverified');
}

export function mysqlDeclaredColumnBytes(
  column: NativeColumn,
  characters: MysqlCharacterDecision,
): MysqlDeclaredBytes {
  const bytes = mysqlTypeDeclarationBytes(column, characters);
  // VIRTUAL declarations participate in the SQL logical-row limit, not the stored record.
  // Use the validated type declaration as an upper bound without claiming all combinations exact.
  return column.physical.generation.kind === 'computed' &&
    column.physical.generation.storage === 'virtual'
    ? {
        ...bytes,
        min: 0,
        exact: false,
        formula: 'virtual-declared-upper-bound:' + bytes.formula,
        fixedInlineMin: 0,
      }
    : bytes;
}

export interface MysqlTableBudget {
  tableId: string;
  minBytes: number;
  maxBytes: number | null;
  exact: boolean;
  nullableBytes: number;
  fixedInlineMin: number;
  declaredColumns: number;
  virtualColumns: number;
  functionalHiddenColumns: number;
  totalColumns: number;
  /** Legal full-length functional btree parts cannot exceed this profile's 3072-byte key limit. */
  functionalHiddenMaxBytes: number;
  columns: { columnId: string; bytes: MysqlDeclaredBytes }[];
}
export interface MysqlPhysicalDecision {
  engineSupported: boolean;
  usable: false;
  coverage: false;
  issues: MysqlPhysicalIssue[];
  budgets: MysqlTableBudget[];
}
const segment = (s: string) => s.replaceAll('~', '~0').replaceAll('/', '~1');
const characterCause = (options: NativeColumnOptions | NativeTableOptions) =>
  options.database === 'mysql'
    ? { database: options.database, charset: options.charset, collation: options.collation }
    : options;
/** These rules are evidence-bound to the documented profile; caller retains legacy causes. */
export function inspectMysqlPhysicalDocument(
  document: NativeDesignDocument,
  environment: MysqlPhysicalEnvironment = {},
): MysqlPhysicalDecision {
  const issues: MysqlPhysicalIssue[] = [],
    budgets: MysqlTableBudget[] = [];
  const add = (
    code: string,
    objectId: string | null,
    path: string,
    cause: unknown,
    category: MysqlPhysicalIssue['category'] = 'invalid',
    params: MysqlPhysicalIssue['params'] = {},
    severity: MysqlPhysicalIssue['severity'] = 'error',
  ) => {
    issues.push({ code, objectId, path, cause, category, params, severity });
  };
  if (document.database.kind !== 'mysql' || document.database.profileId !== 'mysql-8.4-innodb-v1') {
    add('mysql.profile-not-supported', null, '/database', document.database, 'unsupported');
    return { engineSupported: false, usable: false, coverage: false, issues, budgets };
  }
  if (
    environment.pageSize === undefined ||
    environment.rowFormat === undefined ||
    environment.compileMachine === undefined
  )
    add(
      'mysql.environment-profile-assumed',
      null,
      '/database',
      environment,
      'environment',
      {},
      'warning',
    );
  if (
    (environment.pageSize !== undefined && environment.pageSize !== 16384) ||
    (environment.rowFormat !== undefined && environment.rowFormat.toLowerCase() !== 'dynamic')
  )
    add('mysql.innodb-environment-unverified', null, '/database', environment, 'environment');
  if (environment.compileMachine !== undefined && environment.compileMachine !== 'x86_64')
    add(
      'mysql.reference-layout-unverified',
      null,
      '/database',
      environment.compileMachine,
      'environment',
    );
  if (environment.lowerCaseTableNames !== undefined && environment.lowerCaseTableNames !== 0)
    add(
      'mysql.identifier-case-environment',
      null,
      '/database',
      environment.lowerCaseTableNames,
      'environment',
      {},
      'warning',
    );
  const checkCharacters = (
    decision: MysqlCharacterDecision,
    id: string,
    path: string,
    cause: unknown,
  ) => {
    if (!decision.engineSupported) add(decision.code!, id, path, cause, decision.category);
    else {
      if (
        environment.installedCharsets &&
        !environment.installedCharsets.includes(decision.charset!)
      )
        add('mysql.charset-not-installed', id, path, [cause, decision.charset], 'environment');
      if (
        environment.installedCollations &&
        !environment.installedCollations.includes(decision.collation!)
      )
        add('mysql.collation-not-installed', id, path, [cause, decision.collation], 'environment');
    }
  };
  const comment = (value: string, id: string, path: string, limit: number) => {
    if ([...value].length > limit)
      add('mysql.comment-length-exceeded', id, path, value, 'invalid', { max: limit });
    if (!mysqlStringMetrics(value, 'utf8mb3').engineSupported)
      add('mysql.comment-unrepresentable', id, path, value, 'unsupported');
  };
  for (const table of document.tables ?? []) {
    if (table.scope === 'logical') continue;
    const options = table.physical.options,
      path = `/tables/${segment(table.id)}/physical`;
    const tableCharacters = effectiveMysqlCharacters(options);
    checkCharacters(tableCharacters, table.id, `${path}/options`, characterCause(options));
    comment(table.physical.comment, table.id, `${path}/comment`, 2048);
    const columns = (document.columns ?? []).filter(
      (column) => column.tableId === table.id && column.scope !== 'logical',
    );
    const functionalParts = (document.indexes ?? [])
      .filter(
        (index) =>
          index.tableId === table.id &&
          index.scope !== 'logical' &&
          index.options.database === 'mysql',
      )
      .flatMap((index) =>
        index.parts.flatMap((part, ordinal) =>
          part.expression.kind === 'column' ? [] : [{ indexId: index.id, ordinal }],
        ),
      );
    const functionalHiddenColumns = functionalParts.length;
    const totalColumns = columns.length + functionalHiddenColumns;
    if (totalColumns > 1017)
      add(
        'mysql.column-count-exceeded',
        table.id,
        path,
        [[...columns].map((c) => c.id).sort(), functionalParts],
        'invalid',
        { declaredColumns: columns.length, functionalHiddenColumns, totalColumns, max: 1017 },
      );
    const primary = new Set(
      (document.keys ?? [])
        .filter(
          (key) => key.tableId === table.id && key.scope !== 'logical' && key.kind === 'primary',
        )
        .flatMap((key) => key.columnIds),
    );
    const parts: MysqlTableBudget['columns'] = [];
    for (const column of columns) {
      const cp = `/columns/${segment(column.id)}/physical`,
        type = column.physical.type;
      const characters = effectiveMysqlCharacters(options, column.physical.options);
      comment(column.physical.comment, column.id, `${cp}/comment`, 1024);
      const definition = type.kind === 'builtin' ? getDatabaseType(type.typeId) : undefined;
      const textual = type.kind === 'valueList' || definition?.category === 'string';
      if (textual)
        checkCharacters(characters, column.id, `${cp}/options`, [
          characterCause(options),
          characterCause(column.physical.options),
        ]);
      if (
        characters.charset === 'binary' &&
        definition &&
        (['char', 'varchar'].includes(definition.sqlName) || definition.sqlName.endsWith('text'))
      )
        add(
          'mysql.binary-character-declaration-alias',
          column.id,
          `${cp}/type`,
          [type, characters],
          'environment',
          {},
          'warning',
        );
      if (type.kind === 'valueList' && type.database === 'mysql' && characters.engineSupported)
        for (const [i, label] of type.values.entries()) {
          const metrics = mysqlStringMetrics(label, characters.charset);
          if (!metrics.engineSupported)
            add(
              'mysql.value-list-unrepresentable',
              column.id,
              `${cp}/type/values/${i}`,
              [label, characters],
              'invalid',
            );
          if (metrics.lengthUnits !== null && metrics.lengthUnits > 255)
            add(
              'mysql.value-list-label-too-long',
              column.id,
              `${cp}/type/values/${i}`,
              [label, characters],
              'invalid',
              { max: 255 },
            );
          if (label.endsWith(' '))
            add(
              'mysql.value-list-trailing-space',
              column.id,
              `${cp}/type/values/${i}`,
              label,
              'unsupported',
            );
        }
      if (type.kind === 'valueList' && type.database === 'mysql' && characters.engineSupported) {
        const insensitive = characters.collation!.endsWith('_ci');
        if (
          insensitive &&
          type.values.length > 1 &&
          type.values.some((value) =>
            [...value].some((c) => c.codePointAt(0)! < 32 || c.codePointAt(0)! > 126),
          )
        )
          add(
            'mysql.value-list-collation-unverified',
            column.id,
            `${cp}/type/values`,
            [type.values, characters],
            'unsupported',
          );
        const labels = type.values.map((value) => (insensitive ? value.toLowerCase() : value));
        if (new Set(labels).size !== labels.length)
          add('mysql.value-list-collation-duplicate', column.id, `${cp}/type/values`, [
            type.values,
            characters,
          ]);
      }
      const bytes = mysqlDeclaredColumnBytes(column, characters);
      parts.push({ columnId: column.id, bytes });
      if (bytes.max === null)
        add(
          'mysql.column-byte-budget-unverified',
          column.id,
          `${cp}/type`,
          [type, column.physical.generation, characters],
          'unsupported',
        );
      if (
        type.kind === 'builtin' &&
        type.database === 'mysql' &&
        type.typeId === 'mysql:varchar' &&
        'length' in type.parameters &&
        characters.maxBytesPerCharacter &&
        type.parameters.length! * characters.maxBytesPerCharacter > 65535
      )
        add(
          'mysql.varchar-byte-length-exceeded',
          column.id,
          `${cp}/type/parameters/length`,
          [type, characters],
          'invalid',
          { maxBytes: 65535 },
        );
    }
    // The SQL logical-row bitmap counts declared VIRTUAL fields too. Hidden parts are
    // conservatively nullable; their inferred result layout is not a stored-row claim.
    const declaredNullable = columns.filter(
      (c) => c.physical.nullable && !primary.has(c.id),
    ).length;
    const nullableBytes = Math.ceil((declaredNullable + functionalHiddenColumns) / 8);
    const functionalHiddenMaxBytes = functionalHiddenColumns * (3072 + 2);
    const minBytes = parts.reduce(
      (sum, part) => sum + part.bytes.min,
      Math.ceil(declaredNullable / 8),
    );
    const maxBytes = parts.some((part) => part.bytes.max === null)
      ? null
      : parts.reduce(
          (sum, part) => sum + part.bytes.max!,
          nullableBytes + functionalHiddenMaxBytes,
        );
    const fixedInlineMin = parts.reduce((sum, part) => sum + part.bytes.fixedInlineMin, 0);
    const budget = {
      tableId: table.id,
      minBytes,
      maxBytes,
      exact: functionalHiddenColumns === 0 && parts.every((part) => part.bytes.exact),
      nullableBytes,
      fixedInlineMin,
      declaredColumns: columns.length,
      virtualColumns: columns.filter(
        (c) =>
          c.physical.generation.kind === 'computed' && c.physical.generation.storage === 'virtual',
      ).length,
      functionalHiddenColumns,
      totalColumns,
      functionalHiddenMaxBytes,
      columns: parts,
    };
    budgets.push(budget);
    const cause = [...columns]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((c) => [
        c.id,
        c.physical.type,
        c.physical.nullable,
        primary.has(c.id),
        c.physical.generation.kind === 'computed'
          ? { kind: 'computed', storage: c.physical.generation.storage }
          : c.physical.generation.kind,
        characterCause(c.physical.options),
        characterCause(options),
      ]);
    if (minBytes > 65535)
      add('mysql.row-byte-limit-exceeded', table.id, path, cause, 'invalid', {
        bytes: minBytes,
        max: 65535,
      });
    else if (maxBytes !== null && maxBytes > 65535)
      add(
        'mysql.row-byte-upper-bound-exceeded',
        table.id,
        path,
        [cause, functionalParts],
        'unsupported',
        {
          maximumBytes: maxBytes,
          max: 65535,
        },
      );
    // Engine records include hidden MVCC/row-id/record headers. Do not claim these are SQL bytes.
    if (fixedInlineMin > 8126)
      add('mysql.innodb-fixed-row-too-large', table.id, path, cause, 'invalid', {
        minimumBytes: fixedInlineMin,
        profileRecordLimit: 8126,
      });
    else if (fixedInlineMin > 7900)
      add(
        'mysql.innodb-inline-layout-unverified',
        table.id,
        path,
        cause,
        'environment',
        {},
        'warning',
      );
  }
  return {
    engineSupported: !issues.some((issue) => issue.severity === 'error'),
    usable: false,
    coverage: false,
    issues,
    budgets,
  };
}
