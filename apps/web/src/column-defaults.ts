import type { Column, DesignDocument } from '@ezerd/model';

type Physical = Column['physical'];
export const autoIncrementDefault = '@auto';
const serialTypes: Record<string, string> = {
  integer: 'serial',
  int: 'serial',
  int4: 'serial',
  bigint: 'bigserial',
  int8: 'bigserial',
  smallint: 'smallserial',
  int2: 'smallserial',
};
const integerTypes: Record<string, string> = {
  serial: 'integer',
  bigserial: 'bigint',
  smallserial: 'smallint',
};
export function isAutoIncrement(type: Physical['type']) {
  return !type.enumId && !type.isArray && !!integerTypes[type.name];
}
export function columnDefaultOptions(physical: Physical, enums: DesignDocument['enums'] = []) {
  const { type, nullable } = physical;
  const choices = [{ value: '', label: '기본값 없음' }];
  const add = (value: string, label = value) => choices.push({ value, label });
  if (isAutoIncrement(type)) {
    add(autoIncrementDefault, '자동 증가 (1부터)');
    return choices;
  }
  if (nullable) add('NULL', 'NULL');
  if (type.isArray) return choices;
  if (type.enumId) {
    for (const value of enums?.find((e) => e.id === type.enumId)?.values ?? [])
      add("'" + value.replaceAll("'", "''") + "'", value);
    return choices;
  }
  if (serialTypes[type.name]) add(autoIncrementDefault, '자동 증가 (1부터)');
  if (
    serialTypes[type.name] ||
    ['numeric', 'decimal', 'real', 'double precision', 'float4', 'float8'].includes(type.name)
  ) {
    add('0');
    if (
      !['numeric', 'decimal'].includes(type.name) ||
      type.precision === undefined ||
      (type.scale ?? 0) < type.precision
    )
      add('1');
  }
  if (
    [
      'timestamp',
      'timestamptz',
      'timestamp with time zone',
      'timestamp without time zone',
    ].includes(type.name)
  ) {
    add('now()', '현재 시각 · now()');
    add('CURRENT_TIMESTAMP');
  }
  if (type.name === 'date') add('CURRENT_DATE', '오늘 날짜 · CURRENT_DATE');
  if (['time', 'timetz', 'time with time zone', 'time without time zone'].includes(type.name))
    add('CURRENT_TIME', '현재 시간 · CURRENT_TIME');
  if (['boolean', 'bool'].includes(type.name)) {
    add('TRUE');
    add('FALSE');
  }
  if (['text', 'varchar', 'char', 'character varying', 'character'].includes(type.name))
    add("''", '빈 문자열');
  if (type.name === 'uuid') add('gen_random_uuid()', 'UUID 자동 생성');
  if (['json', 'jsonb'].includes(type.name)) {
    add("'{}'", '빈 객체 {}');
    add("'[]'", '빈 배열 []');
  }
  return choices;
}
export function applyColumnDefault(
  physical: Physical,
  value: string,
  enums: DesignDocument['enums'] = [],
): Physical {
  if (!columnDefaultOptions(physical, enums).some((item) => item.value === value)) return physical;
  if (value === autoIncrementDefault)
    return {
      ...physical,
      type: { name: serialTypes[physical.type.name] ?? physical.type.name, isArray: false },
      nullable: false,
      defaultExpression: null,
    };
  return {
    ...physical,
    ...(isAutoIncrement(physical.type)
      ? { type: { name: integerTypes[physical.type.name]!, isArray: false } }
      : {}),
    defaultExpression: value || null,
  };
}
export function patchColumnPhysical(physical: Physical, patch: Partial<Physical>): Physical {
  return {
    ...physical,
    ...patch,
    ...(patch.type && JSON.stringify(patch.type) !== JSON.stringify(physical.type)
      ? { defaultExpression: null }
      : {}),
    ...(patch.nullable === false && /^null$/i.test(physical.defaultExpression?.trim() ?? '')
      ? { defaultExpression: null }
      : {}),
  };
}
