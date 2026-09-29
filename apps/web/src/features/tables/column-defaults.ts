import { canonicalPostgresTypeName } from '@ezerd/model';
import { translate } from '../../shared/i18n/index.js';
import './translations.js';
import type { Column, DesignDocument } from '@ezerd/model';

type Physical = Column['physical'];
export const autoIncrementDefault = '@auto';
const serialTypes: Record<string, string> = {
  integer: 'serial',
  bigint: 'bigserial',
  smallint: 'smallserial',
};
const integerTypes: Record<string, string> = {
  serial: 'integer',
  bigserial: 'bigint',
  smallserial: 'smallint',
};
export function isAutoIncrement(type: Physical['type']) {
  return !type.enumId && !type.isArray && !!integerTypes[canonicalPostgresTypeName(type.name)];
}
export function columnDefaultOptions(physical: Physical, enums: DesignDocument['enums'] = []) {
  const { type, nullable } = physical;
  const name = canonicalPostgresTypeName(type.name);
  const choices = [{ value: '', label: translate('기본값 없음') }];
  const add = (value: string, label = value) => choices.push({ value, label });
  if (isAutoIncrement(type)) {
    add(autoIncrementDefault, translate('자동 증가 (1부터)'));
    return choices;
  }
  if (nullable) add('NULL', 'NULL');
  if (type.isArray) return choices;
  if (type.enumId) {
    for (const value of enums?.find((e) => e.id === type.enumId)?.values ?? [])
      add("'" + value.replaceAll("'", "''") + "'", value);
    return choices;
  }
  if (serialTypes[name]) add(autoIncrementDefault, translate('자동 증가 (1부터)'));
  if (serialTypes[name] || ['numeric', 'real', 'double precision'].includes(name)) {
    add('0');
    if (name !== 'numeric' || type.precision === undefined || (type.scale ?? 0) < type.precision)
      add('1');
  }
  if (['timestamp', 'timestamptz'].includes(name)) {
    add('now()', translate('현재 시각 · now()'));
    add('CURRENT_TIMESTAMP');
  }
  if (name === 'date') add('CURRENT_DATE', translate('오늘 날짜 · CURRENT_DATE'));
  if (['time', 'timetz'].includes(name)) add('CURRENT_TIME', translate('현재 시간 · CURRENT_TIME'));
  if (name === 'boolean') {
    add('TRUE');
    add('FALSE');
  }
  if (['text', 'varchar', 'char'].includes(name)) add("''", translate('빈 문자열'));
  if (name === 'uuid') add('gen_random_uuid()', translate('UUID 자동 생성'));
  if (['json', 'jsonb'].includes(name)) {
    add("'{}'", translate('빈 객체 {}'));
    add("'[]'", translate('빈 배열 []'));
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
      type: {
        name: serialTypes[canonicalPostgresTypeName(physical.type.name)] ?? physical.type.name,
        isArray: false,
      },
      nullable: false,
      defaultExpression: null,
    };
  return {
    ...physical,
    ...(isAutoIncrement(physical.type)
      ? {
          type: {
            name: integerTypes[canonicalPostgresTypeName(physical.type.name)]!,
            isArray: false,
          },
        }
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
