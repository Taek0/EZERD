import type { Column, DesignDocument } from './document.js';

export type PhysicalType = Column['physical']['type'];
export interface PhysicalTypeIssue {
  path: 'length' | 'precision' | 'scale' | 'isArray';
  message: string;
}

export const postgresTypeNames = [
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
];
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
/** Canonicalize built-in names while preserving unknown user-defined type names. */
export function canonicalPostgresTypeName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ');
  const canonical = Object.hasOwn(aliases, normalized) ? aliases[normalized]! : normalized;
  return postgresTypeNames.includes(canonical) ? canonical : name;
}

/** Preserve user-defined ENUM names and never mutate the caller's value. */
export function normalizePhysicalType<T extends PhysicalType>(value: T): T {
  return {
    ...value,
    name: value.enumId !== undefined ? value.name : canonicalPostgresTypeName(value.name),
  };
}

/** Normalize stored documents without rejecting legacy parameters that users need to repair. */
export function normalizeDocumentPhysicalTypes<T extends Pick<DesignDocument, 'columns'>>(
  document: T,
): T {
  if (!document.columns) return { ...document };
  return {
    ...document,
    columns: document.columns.map((column) => ({
      ...column,
      physical: { ...column.physical, type: normalizePhysicalType(column.physical.type) },
    })),
  };
}

/** PostgreSQL modifier rules shared by writes and DDL. Unknown names remain editable drafts. */
export function validatePhysicalType(input: PhysicalType): PhysicalTypeIssue[] {
  const value = normalizePhysicalType(input);
  const issues: PhysicalTypeIssue[] = [];
  const add = (path: PhysicalTypeIssue['path'], message: string) => issues.push({ path, message });
  if (value.enumId !== undefined) {
    for (const key of ['length', 'precision', 'scale'] as const) {
      if (value[key] !== undefined)
        add(key, 'ENUM에는 길이, 정밀도, 소수 자릿수를 지정할 수 없습니다.');
    }
    return issues;
  }
  if (value.isArray && ['serial', 'bigserial', 'smallserial'].includes(value.name)) {
    add('isArray', 'serial 계열 타입에는 배열을 지정할 수 없습니다.');
  }
  if (
    value.length !== undefined &&
    (!['varchar', 'char'].includes(value.name) ||
      !Number.isInteger(value.length) ||
      value.length < 1 ||
      value.length > 10485760)
  ) {
    add('length', '길이는 varchar/char 타입에만 1~10485760의 정수로 지정할 수 있습니다.');
  }
  const temporal = ['time', 'timetz', 'timestamp', 'timestamptz'].includes(value.name);
  if (
    value.precision !== undefined &&
    (!(value.name === 'numeric' || temporal) ||
      !Number.isInteger(value.precision) ||
      value.precision < (value.name === 'numeric' ? 1 : 0) ||
      value.precision > (value.name === 'numeric' ? 1000 : 6))
  ) {
    add('precision', '정밀도는 numeric에서 1~1000, 시간 타입에서 0~6의 정수로 지정할 수 있습니다.');
  }
  if (
    value.scale !== undefined &&
    (value.name !== 'numeric' ||
      value.precision === undefined ||
      !Number.isInteger(value.scale) ||
      value.scale < -1000 ||
      value.scale > 1000)
  ) {
    add(
      'scale',
      '소수 자릿수는 정밀도가 지정된 numeric 타입에만 -1000~1000의 정수로 지정할 수 있습니다.',
    );
  }
  return issues;
}
