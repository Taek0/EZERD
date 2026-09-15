import type { Column, DesignDocument, Table, TableKey, ProjectEnum } from './document.js';

export interface PostgresDiagnostic {
  code: string;
  objectId: string;
  message: string;
}
export interface PostgresExport {
  sql: string;
  diagnostics: PostgresDiagnostic[];
  canExport: boolean;
}
const supported = new Set([
  'uuid',
  'integer',
  'bigint',
  'smallint',
  'serial',
  'bigserial',
  'smallserial',
  'boolean',
  'text',
  'varchar',
  'char',
  'numeric',
  'real',
  'double precision',
  'date',
  'time',
  'timetz',
  'timestamp',
  'timestamptz',
  'json',
  'jsonb',
  'bytea',
]);
const aliases: Record<string, string> = {
  int: 'integer',
  int4: 'integer',
  int8: 'bigint',
  int2: 'smallint',
  bool: 'boolean',
  decimal: 'numeric',
  'character varying': 'varchar',
  character: 'char',
  float4: 'real',
  float8: 'double precision',
  'timestamp with time zone': 'timestamptz',
  'timestamp without time zone': 'timestamp',
  'time with time zone': 'timetz',
  'time without time zone': 'time',
};
const canonical = (name: string) => {
  const value = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return aliases[value] ?? value;
};
const serials = new Set(['serial', 'bigserial', 'smallserial']);
const integers = new Set(['integer', 'bigint', 'smallint', 'serial', 'bigserial', 'smallserial']);
const numeric = new Set([...integers, 'numeric', 'real', 'double precision']);
const temporal = new Set(['time', 'timetz', 'timestamp', 'timestamptz']);
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const literal = (value: string) =>
  "E'" + value.replaceAll('\\', '\\\\').replaceAll("'", "''") + "'";
function bytes(value: string) {
  let count = 0;
  for (const c of value) {
    const cp = c.codePointAt(0)!;
    count += cp <= 127 ? 1 : cp <= 2047 ? 2 : cp <= 65535 ? 3 : 4;
  }
  return count;
}
function typeSql(column: Column, enums: Map<string, ProjectEnum>): string | null {
  const value = column.physical.type,
    name = canonical(value.name);
  if (value.enumId !== undefined) {
    const definition = enums.get(value.enumId);
    if (
      !definition ||
      value.length !== undefined ||
      value.precision !== undefined ||
      value.scale !== undefined
    )
      return null;
    return (
      quote(definition.schema || 'public') +
      '.' +
      quote(definition.name) +
      (value.isArray ? '[]' : '')
    );
  }
  if (!supported.has(name)) return null;
  if (value.isArray && serials.has(name)) return null;
  if (
    value.length !== undefined &&
    (!['varchar', 'char'].includes(name) ||
      !Number.isInteger(value.length) ||
      value.length < 1 ||
      value.length > 10485760)
  )
    return null;
  if (
    value.precision !== undefined &&
    (!['numeric', ...temporal].includes(name) ||
      !Number.isInteger(value.precision) ||
      value.precision < (name === 'numeric' ? 1 : 0) ||
      value.precision > (name === 'numeric' ? 1000 : 6))
  )
    return null;
  if (
    value.scale !== undefined &&
    (name !== 'numeric' ||
      value.precision === undefined ||
      !Number.isInteger(value.scale) ||
      value.scale < -1000 ||
      value.scale > 1000)
  )
    return null;
  let parameters = '';
  if (value.length !== undefined) parameters = `(${value.length})`;
  if (value.precision !== undefined)
    parameters = `(${value.precision}${value.scale !== undefined ? `, ${value.scale}` : ''})`;
  return name + parameters + (value.isArray ? '[]' : '');
}
function numericFits(value: string, precision: number, scale: number): boolean {
  const [mantissa = '', exponent = '0'] = value.replace(/^[+-]/, '').toLowerCase().split('e');
  const [whole = '', fraction = ''] = mantissa.split('.');
  const digits = (whole + fraction).replace(/^0+/, '') || '0';
  if (digits === '0') return true;
  const shift = Number(exponent) - fraction.length + scale;
  if (shift >= 0) return digits.length + shift <= precision;
  const divisorPower = -shift;
  if (divisorPower > digits.length) return true;
  const divisor = 10n ** BigInt(divisorPower);
  const number = BigInt(digits);
  const rounded = number / divisor + ((number % divisor) * 2n >= divisor ? 1n : 0n);
  return rounded < 10n ** BigInt(precision);
}
function defaultSql(column: Column, enums: Map<string, ProjectEnum>): string | null | undefined {
  const raw = column.physical.defaultExpression;
  if (raw === null || !raw.trim()) return undefined;
  const value = raw.trim(),
    name = canonical(column.physical.type.name);
  if (column.physical.type.enumId !== undefined) {
    const definition = enums.get(column.physical.type.enumId);
    if (!definition) return null;
    if (/^null$/i.test(value)) return 'NULL';
    if (column.physical.type.isArray || !/^'(?:[^'\0]|'')*'$/su.test(value)) return null;
    const label = value.slice(1, -1).replaceAll("''", "'");
    return definition.values.includes(label) ? literal(label) : null;
  }
  if (serials.has(name)) return null;
  if (/^null$/i.test(value)) return 'NULL';
  if (column.physical.type.isArray) return null;
  if (name === 'boolean' && /^(true|false)$/i.test(value)) return value.toUpperCase();
  if (['timestamp', 'timestamptz'].includes(name) && /^(now\(\)|current_timestamp)$/i.test(value))
    return value.toUpperCase();
  if (name === 'date' && /^current_date$/i.test(value)) return 'CURRENT_DATE';
  if (name === 'uuid' && /^gen_random_uuid\(\)$/i.test(value)) return 'gen_random_uuid()';
  if (numeric.has(name) && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
    if (!Number.isFinite(Number(value))) return null;
    if (integers.has(name)) {
      if (!/^[+-]?\d+$/.test(value)) return null;
      const n = BigInt(value),
        limit =
          name === 'bigint' ? 9223372036854775807n : name === 'smallint' ? 32767n : 2147483647n;
      if (n > limit || n < -limit - 1n) return null;
    }
    if (
      name === 'numeric' &&
      column.physical.type.precision !== undefined &&
      !numericFits(value, column.physical.type.precision, column.physical.type.scale ?? 0)
    )
      return null;
    const nonzeroMantissa = /[1-9]/.test(value.toLowerCase().split('e')[0]!);
    if (
      ['real', 'double precision'].includes(name) &&
      nonzeroMantissa &&
      (Number(value) === 0 || (name === 'real' && Math.fround(Number(value)) === 0))
    )
      return null;
    if (name === 'real' && Math.abs(Number(value)) > 3.402823466e38) return null;
    return value;
  }
  if (!/^'(?:[^'\\\0]|'')*'$/su.test(value)) return null;
  const text = value.slice(1, -1).replaceAll("''", "'");
  if (['text', 'varchar', 'char'].includes(name)) {
    if (column.physical.type.length !== undefined && [...text].length > column.physical.type.length)
      return null;
    return literal(text);
  }
  if (
    name === 'uuid' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
  )
    return literal(text);
  if (['json', 'jsonb'].includes(name)) {
    try {
      JSON.parse(text);
      if (/\\u0000/i.test(text)) return null;
      return literal(text);
    } catch {
      return null;
    }
  }
  if (name === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsed = new Date(text + 'T00:00:00Z');
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text)
      return literal(text);
  }
  return null;
}
function compatible(left: Column, right: Column): boolean {
  if (left.physical.type.isArray !== right.physical.type.isArray) return false;
  if (left.physical.type.enumId !== undefined || right.physical.type.enumId !== undefined)
    return (
      left.physical.type.enumId !== undefined &&
      left.physical.type.enumId === right.physical.type.enumId
    );
  const family = (value: string) => {
    const name = canonical(value);
    if (integers.has(name)) return 'integer';
    if (['char', 'varchar', 'text'].includes(name)) return 'text';
    return name;
  };
  return family(left.physical.type.name) === family(right.physical.type.name);
}

/** Generate only the explicitly supported physical subset. Any error blocks SQL output. */
export function exportPostgres(doc: DesignDocument): PostgresExport {
  const diagnostics: PostgresDiagnostic[] = [];
  const error = (code: string, objectId: string, message: string) => {
    diagnostics.push({ code, objectId, message });
  };
  const identifier = (name: string, id: string, label: string) => {
    if (!name.trim() || name.includes('\0') || bytes(name) > 63)
      error(
        'invalid-identifier',
        id,
        `${label}: 비어 있거나 UTF-8 63바이트를 초과하는 이름입니다.`,
      );
    return quote(name);
  };
  const enumDefinitions = doc.enums ?? [];
  const enums = new Map(enumDefinitions.map((item) => [item.id, item]));
  const tables = (doc.tables ?? []).filter((t) => t.scope !== 'logical');
  const allColumns = doc.columns ?? [],
    allKeys = doc.keys ?? [];
  const tableMap = new Map(tables.map((t) => [t.id, t]));
  const columnMap = new Map(allColumns.map((c) => [c.id, c]));
  const schemaOf = (table: Table) => table.physical.schema || 'public';
  const qualified = (table: Table) => quote(schemaOf(table)) + '.' + quote(table.physical.name);
  const tableNames = new Set<string>(),
    indexNames = new Set<string>(),
    constraints = new Map<string, Set<string>>();
  const sql: string[] = [],
    comments: string[] = [],
    foreignKeys: string[] = [];
  const keysByTable = new Map<string, TableKey[]>();
  const physicalColumn = (id: string, tableId: string) => {
    const c = columnMap.get(id);
    return c?.tableId === tableId && c.scope !== 'logical' ? c : undefined;
  };
  for (const item of [...allColumns, ...allKeys])
    if (item.scope !== 'logical' && !(doc.tables ?? []).some((t) => t.id === item.tableId))
      error('missing-owner-table', item.id, '물리 컬럼 또는 키의 소유 테이블을 찾을 수 없습니다.');
  if (!tables.length) error('empty-model', 'document', '내보낼 물리 테이블이 없습니다.');
  for (const table of tables) {
    identifier(schemaOf(table), table.id, '스키마');
    identifier(table.physical.name, table.id, '테이블');
    const key = JSON.stringify([schemaOf(table), table.physical.name]);
    if (tableNames.has(key))
      error('duplicate-table', table.id, '같은 스키마에 물리 테이블 이름이 중복됩니다.');
    tableNames.add(key);
    constraints.set(table.id, new Set());
    if (!doc.domains.some((d) => d.id === table.domainId))
      error('missing-domain', table.id, '소유 도메인이 없습니다.');
    keysByTable.set(
      table.id,
      allKeys.filter((k) => k.tableId === table.id && k.scope !== 'logical'),
    );
  }
  const enumNames = new Set<string>();
  const enumIds = new Set<string>();
  for (const definition of enumDefinitions) {
    identifier(definition.schema || 'public', definition.id, 'ENUM 스키마');
    identifier(definition.name, definition.id, 'ENUM');
    const key = JSON.stringify([definition.schema || 'public', definition.name]);
    if (enumNames.has(key) || tableNames.has(key))
      error(
        'duplicate-enum-type',
        definition.id,
        'ENUM 이름이 같은 스키마의 타입 또는 테이블 이름과 충돌합니다.',
      );
    if (enumIds.has(definition.id))
      error('duplicate-enum-id', definition.id, 'ENUM ID가 중복됩니다.');
    enumNames.add(key);
    enumIds.add(definition.id);
    if (
      !definition.values.length ||
      new Set(definition.values).size !== definition.values.length ||
      definition.values.some((value) => value.includes('\0') || bytes(value) > 63)
    )
      error(
        'invalid-enum-values',
        definition.id,
        'ENUM 값은 중복과 NULL 문자 없이 UTF-8 63바이트 이하여야 하며 하나 이상 필요합니다.',
      );
  }
  let generated = 0;
  const constraintName = (table: Table, name: string, id: string, index: boolean) => {
    const actual = name.trim() ? name : `ezerd_${index ? 'key' : 'fk'}_${++generated}`;
    identifier(actual, id, '제약 이름');
    const used = constraints.get(table.id)!;
    if (used.has(actual)) error('duplicate-constraint', id, '테이블의 제약 이름이 중복됩니다.');
    used.add(actual);
    if (index) {
      const key = JSON.stringify([schemaOf(table), actual]);
      if (indexNames.has(key) || tableNames.has(key))
        error(
          'duplicate-index',
          id,
          '키의 인덱스 이름이 같은 스키마의 테이블·키 이름과 충돌합니다.',
        );
      indexNames.add(key);
    }
    return quote(actual);
  };
  for (const schema of new Set([
    ...tables.map(schemaOf),
    ...enumDefinitions.map((item) => item.schema || 'public'),
  ]))
    if (schema !== 'public') sql.push(`CREATE SCHEMA IF NOT EXISTS ${quote(schema)};`);
  for (const definition of enumDefinitions)
    sql.push(
      `CREATE TYPE ${quote(definition.schema || 'public')}.${quote(definition.name)} AS ENUM (${definition.values.map(literal).join(', ')});`,
    );
  for (const table of tables) {
    const columns = allColumns.filter((c) => c.tableId === table.id && c.scope !== 'logical');
    const keys = keysByTable.get(table.id)!;
    if (!columns.length) error('empty-table', table.id, '물리 컬럼이 없는 테이블입니다.');
    if (keys.filter((k) => k.kind === 'primary').length > 1)
      error('multiple-primary-keys', table.id, '테이블에는 기본 키 하나만 둘 수 있습니다.');
    const names = new Set<string>(),
      parts: string[] = [];
    for (const column of columns) {
      const name = identifier(column.physical.name, column.id, '컬럼');
      if (names.has(column.physical.name))
        error('duplicate-column', column.id, '물리 컬럼 이름이 중복됩니다.');
      names.add(column.physical.name);
      if (table.scope === 'physical' && column.scope !== 'physical')
        error('scope-mismatch', column.id, '컬럼 범위가 물리 전용 테이블 범위를 넘어섭니다.');
      const type = typeSql(column, enums);
      if (!type)
        error(
          'unsupported-type',
          column.id,
          `지원하지 않거나 매개변수가 잘못된 타입: ${column.physical.type.name}`,
        );
      const defaultExpression = defaultSql(column, enums);
      if (defaultExpression === null)
        error('unsupported-default', column.id, '지원하지 않거나 타입과 맞지 않는 기본값입니다.');
      const primary = keys.some((k) => k.kind === 'primary' && k.columnIds.includes(column.id));
      parts.push(
        `  ${name} ${type ?? 'text'}${!column.physical.nullable || primary ? ' NOT NULL' : ''}${defaultExpression ? ` DEFAULT ${defaultExpression}` : ''}`,
      );
      if (column.physical.comment.includes('\0'))
        error('invalid-comment', column.id, '설명에 NULL 문자를 포함할 수 없습니다.');
      if (column.physical.comment)
        comments.push(
          `COMMENT ON COLUMN ${qualified(table)}.${name} IS ${literal(column.physical.comment)};`,
        );
    }
    for (const key of keys) {
      const constraint = constraintName(table, key.name, key.id, true);
      if (!key.columnIds.length || new Set(key.columnIds).size !== key.columnIds.length)
        error('invalid-key', key.id, '키 컬럼은 하나 이상이며 중복이 없어야 합니다.');
      const columnsForKey = key.columnIds.map((id) => physicalColumn(id, table.id));
      if (columnsForKey.some((c) => !c))
        error('missing-key-column', key.id, '키의 컬럼이 없거나 물리 범위에 포함되지 않습니다.');
      if (
        columnsForKey.some(
          (c) =>
            c && c.physical.type.enumId === undefined && canonical(c.physical.type.name) === 'json',
        )
      )
        error(
          'unsupported-key-type',
          key.id,
          'json 타입은 기본 키/UNIQUE를 지원하지 않습니다. jsonb를 검토하세요.',
        );
      parts.push(
        `  CONSTRAINT ${constraint} ${key.kind === 'primary' ? 'PRIMARY KEY' : 'UNIQUE'} (${columnsForKey.map((c) => quote(c?.physical.name ?? '')).join(', ')})`,
      );
    }
    sql.push(`CREATE TABLE ${qualified(table)} (\n${parts.join(',\n')}\n);`);
    if (table.physical.comment.includes('\0'))
      error('invalid-comment', table.id, '설명에 NULL 문자를 포함할 수 없습니다.');
    if (table.physical.comment)
      comments.push(`COMMENT ON TABLE ${qualified(table)} IS ${literal(table.physical.comment)};`);
  }
  for (const relation of doc.tableRelations ?? []) {
    if (relation.scope === 'logical' || !relation.physical) continue;
    const source = tableMap.get(relation.sourceTableId),
      target = tableMap.get(relation.targetTableId),
      fk = relation.physical;
    if (!source || !target) {
      error('missing-fk-table', relation.id, 'FK 테이블이 없거나 물리 범위에 포함되지 않습니다.');
      continue;
    }
    const name = constraintName(source, fk.name, relation.id, false);
    const sourceColumns = fk.sourceColumnIds.map((id) => physicalColumn(id, source.id));
    const targetColumns = fk.targetColumnIds.map((id) => physicalColumn(id, target.id));
    if (
      !sourceColumns.length ||
      sourceColumns.length !== targetColumns.length ||
      sourceColumns.some((c) => !c) ||
      targetColumns.some((c) => !c) ||
      new Set(fk.sourceColumnIds).size !== sourceColumns.length ||
      new Set(fk.targetColumnIds).size !== targetColumns.length
    ) {
      error('invalid-fk-columns', relation.id, 'FK의 컬럼 개수·순서·대상을 확인하세요.');
      continue;
    }
    if (
      !keysByTable
        .get(target.id)!
        .some(
          (k) =>
            k.columnIds.length === fk.targetColumnIds.length &&
            k.columnIds.every((id, i) => id === fk.targetColumnIds[i]),
        )
    )
      error(
        'missing-referenced-key',
        relation.id,
        'FK 대상 컬럼은 같은 순서의 PK 또는 UNIQUE 키여야 합니다.',
      );
    if (sourceColumns.some((c, i) => !compatible(c!, targetColumns[i]!)))
      error('fk-type-mismatch', relation.id, 'FK 양쪽 컬럼 타입이 호환되지 않습니다.');
    const actions = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'];
    if (!actions.includes(fk.onDelete) || !actions.includes(fk.onUpdate))
      error('invalid-fk-action', relation.id, '지원하지 않는 FK 동작입니다.');
    const notNull = sourceColumns.some(
      (c) =>
        !c!.physical.nullable ||
        keysByTable
          .get(source.id)!
          .some((k) => k.kind === 'primary' && k.columnIds.includes(c!.id)),
    );
    if (notNull && [fk.onDelete, fk.onUpdate].includes('SET NULL'))
      error(
        'invalid-set-null',
        relation.id,
        'NOT NULL 또는 PK 컬럼에 SET NULL을 적용할 수 없습니다.',
      );
    if (
      [fk.onDelete, fk.onUpdate].includes('SET DEFAULT') &&
      sourceColumns.some(
        (c) =>
          (!c!.physical.nullable ||
            keysByTable
              .get(source.id)!
              .some((k) => k.kind === 'primary' && k.columnIds.includes(c!.id))) &&
          (!c!.physical.defaultExpression?.trim() ||
            /^null$/i.test(c!.physical.defaultExpression.trim())),
      )
    )
      error(
        'missing-fk-default',
        relation.id,
        'SET DEFAULT에는 기본값 또는 NULL 허용이 필요합니다.',
      );
    foreignKeys.push(
      `ALTER TABLE ${qualified(source)} ADD CONSTRAINT ${name} FOREIGN KEY (${sourceColumns.map((c) => quote(c!.physical.name)).join(', ')}) REFERENCES ${qualified(target)} (${targetColumns.map((c) => quote(c!.physical.name)).join(', ')}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate};`,
    );
  }
  const canExport = diagnostics.length === 0;
  return {
    canExport,
    diagnostics,
    sql: canExport
      ? ['-- EZERD PostgreSQL creation DDL', ...sql, ...foreignKeys, ...comments, ''].join('\n\n')
      : '',
  };
}
