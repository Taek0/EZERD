import { getDatabaseType } from './catalog.js';
import { hasDatabaseCoverage, type DatabaseContext, type DatabaseTypeId } from './definitions.js';
import type { NativeColumnType } from './native-document.js';

export interface NativeIntegerConversionRule {
  readonly id: string;
  readonly postgresTypeId: DatabaseTypeId;
  readonly mysqlTypeId: DatabaseTypeId;
  readonly postgresSql: 'SMALLINT' | 'INTEGER' | 'BIGINT';
  readonly mysqlSql: 'SMALLINT' | 'INT' | 'BIGINT';
  readonly bits: 16 | 32 | 64;
  readonly min: string;
  readonly max: string;
  readonly engineVerified: boolean;
  readonly fixtureId: string;
  readonly valueDomain: 'exact-signed-integer';
}
/** Execution evidence is separate from catalog/product coverage. Never caller-configurable. */
export const nativeIntegerConversionRules: readonly NativeIntegerConversionRule[] = Object.freeze(
  [
    {
      id: 'pg-mysql-signed-int16-v1',
      postgresTypeId: 'postgresql:smallint',
      mysqlTypeId: 'mysql:smallint',
      postgresSql: 'SMALLINT',
      mysqlSql: 'SMALLINT',
      bits: 16,
      min: '-32768',
      max: '32767',
      engineVerified: true,
      fixtureId: 'native-integer-int16-pg18.6-mysql8.4.11',
      valueDomain: 'exact-signed-integer',
    },
    {
      id: 'pg-mysql-signed-int32-v1',
      postgresTypeId: 'postgresql:integer',
      mysqlTypeId: 'mysql:int',
      postgresSql: 'INTEGER',
      mysqlSql: 'INT',
      bits: 32,
      min: '-2147483648',
      max: '2147483647',
      engineVerified: true,
      fixtureId: 'native-integer-int32-pg18.6-mysql8.4.11',
      valueDomain: 'exact-signed-integer',
    },
    {
      id: 'pg-mysql-signed-int64-v1',
      postgresTypeId: 'postgresql:bigint',
      mysqlTypeId: 'mysql:bigint',
      postgresSql: 'BIGINT',
      mysqlSql: 'BIGINT',
      bits: 64,
      min: '-9223372036854775808',
      max: '9223372036854775807',
      engineVerified: true,
      fixtureId: 'native-integer-int64-pg18.6-mysql8.4.11',
      valueDomain: 'exact-signed-integer',
    },
  ].map((rule) => Object.freeze(rule)) as NativeIntegerConversionRule[],
);

export interface NativeIntegerConversionDecision {
  engineVerified: boolean;
  usable: boolean;
  rule?: NativeIntegerConversionRule;
  targetType?: NativeColumnType;
  code?: string;
}
export function nativeIntegerConversionDecision(
  type: NativeColumnType,
  source: DatabaseContext,
  target: DatabaseContext,
): NativeIntegerConversionDecision {
  const no = (code: string): NativeIntegerConversionDecision => ({
    engineVerified: false,
    usable: false,
    code,
  });
  if (source.kind === 'sqlite' || target.kind === 'sqlite')
    return no('database.conversion-dynamic-semantics-unverified');
  if (!(
    (source.kind === 'postgresql' &&
      target.kind === 'mysql' &&
      source.profileId === 'postgresql-18-v1' &&
      target.profileId === 'mysql-8.4-innodb-v1') ||
    (source.kind === 'mysql' &&
      target.kind === 'postgresql' &&
      source.profileId === 'mysql-8.4-innodb-v1' &&
      target.profileId === 'postgresql-18-v1')
  ))
    return no('database.conversion-mapping-unverified');
  if (type.kind === 'legacy') return no('database.conversion-legacy-unresolved');
  if (type.kind !== 'builtin') return no('database.conversion-enum-unverified');
  if (type.database !== source.kind) return no('database.context-changed');
  if ('array' in type) return no('database.conversion-array-unverified');
  const definition = getDatabaseType(type.typeId);
  if (definition?.deprecated) return no('database.conversion-deprecated-unverified');
  if (Object.keys(type).some((key) => !['kind', 'database', 'typeId', 'parameters'].includes(key)))
    return no('database.conversion-mapping-unverified');
  const params = type.parameters;
  if (
    type.database === 'postgresql'
      ? Object.keys(params).length !== 0
      : Object.keys(params).some((key) => key !== 'unsigned') ||
        ('unsigned' in params && params.unsigned !== false)
  )
    return no('database.conversion-mapping-unverified');
  const rule = nativeIntegerConversionRules.find(
    (item) =>
      (source.kind === 'postgresql' ? item.postgresTypeId : item.mysqlTypeId) === type.typeId,
  );
  if (!rule || !rule.engineVerified) return no('database.conversion-mapping-unverified');
  const targetId = target.kind === 'postgresql' ? rule.postgresTypeId : rule.mysqlTypeId;
  const destination = getDatabaseType(targetId);
  const usable =
    !!definition &&
    !!destination &&
    !destination.deprecated &&
    hasDatabaseCoverage(definition.coverage) &&
    hasDatabaseCoverage(destination.coverage);
  const targetType: NativeColumnType =
    target.kind === 'postgresql'
      ? {
          kind: 'builtin',
          database: 'postgresql',
          typeId: rule.postgresTypeId as
            'postgresql:smallint' | 'postgresql:integer' | 'postgresql:bigint',
          parameters: {},
        }
      : {
          kind: 'builtin',
          database: 'mysql',
          typeId: rule.mysqlTypeId as 'mysql:smallint' | 'mysql:int' | 'mysql:bigint',
          parameters: {},
        };
  return { engineVerified: true, usable, rule, targetType };
}
