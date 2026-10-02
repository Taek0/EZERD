import {
  createEmptyDocument,
  type Column,
  type DesignDocument,
  type Table,
  type TableKey,
  type TableRelation,
  type ModelScope,
} from '../document.js';
import type { DatabaseContext, DatabaseTypeId } from './definitions.js';
import { getDatabaseProfile } from './profiles.js';

type NoParameters = Readonly<Record<string, never>>;
type TypeSpec<Id extends DatabaseTypeId, Parameters> = { typeId: Id; parameters: Parameters };
type PgPlainName =
  | 'smallint'
  | 'integer'
  | 'bigint'
  | 'real'
  | 'double precision'
  | 'text'
  | 'bytea'
  | 'boolean'
  | 'date'
  | 'uuid'
  | 'json'
  | 'jsonb'
  | 'jsonpath'
  | 'xml'
  | 'money'
  | 'point'
  | 'line'
  | 'lseg'
  | 'box'
  | 'path'
  | 'polygon'
  | 'circle'
  | 'inet'
  | 'cidr'
  | 'macaddr'
  | 'macaddr8'
  | 'tsvector'
  | 'tsquery'
  | 'int4range'
  | 'int8range'
  | 'numrange'
  | 'tsrange'
  | 'tstzrange'
  | 'daterange'
  | 'int4multirange'
  | 'int8multirange'
  | 'nummultirange'
  | 'tsmultirange'
  | 'tstzmultirange'
  | 'datemultirange'
  | 'oid'
  | 'regclass'
  | 'regcollation'
  | 'regconfig'
  | 'regdictionary'
  | 'regnamespace'
  | 'regoper'
  | 'regoperator'
  | 'regproc'
  | 'regprocedure'
  | 'regrole'
  | 'regtype'
  | 'pg_lsn'
  | 'pg_snapshot'
  | 'txid_snapshot';
export type PostgresBuiltinSpec =
  | TypeSpec<`postgresql:${PgPlainName}`, NoParameters>
  | TypeSpec<'postgresql:numeric', { precision?: number; scale?: number }>
  | TypeSpec<'postgresql:char' | 'postgresql:varchar', { length?: number }>
  | TypeSpec<'postgresql:bit' | 'postgresql:bit varying', { bitLength?: number }>
  | TypeSpec<
      'postgresql:time' | 'postgresql:timetz' | 'postgresql:timestamp' | 'postgresql:timestamptz',
      { precision?: number }
    >
  | TypeSpec<'postgresql:interval', { fields?: string; precision?: number }>;
type MysqlPlainName =
  | 'float'
  | 'double'
  | 'date'
  | 'year'
  | 'tinytext'
  | 'text'
  | 'mediumtext'
  | 'longtext'
  | 'tinyblob'
  | 'blob'
  | 'mediumblob'
  | 'longblob'
  | 'json';
export type MysqlBuiltinSpec =
  | TypeSpec<`mysql:${MysqlPlainName}`, NoParameters>
  | TypeSpec<
      'mysql:tinyint' | 'mysql:smallint' | 'mysql:mediumint' | 'mysql:int' | 'mysql:bigint',
      { unsigned?: boolean }
    >
  | TypeSpec<'mysql:decimal', { precision?: number; scale?: number }>
  | TypeSpec<'mysql:char' | 'mysql:binary', { length?: number }>
  | TypeSpec<'mysql:varchar' | 'mysql:varbinary', { length: number }>
  | TypeSpec<'mysql:bit', { bitLength?: number }>
  | TypeSpec<'mysql:datetime' | 'mysql:timestamp' | 'mysql:time', { precision?: number }>
  | TypeSpec<
      | 'mysql:geometry'
      | 'mysql:point'
      | 'mysql:linestring'
      | 'mysql:polygon'
      | 'mysql:multipoint'
      | 'mysql:multilinestring'
      | 'mysql:multipolygon'
      | 'mysql:geometrycollection',
      { srid?: number }
    >;
export type SqliteBuiltinSpec = TypeSpec<
  `sqlite:${
    | 'integer'
    | 'real'
    | 'text'
    | 'blob'
    | 'numeric'
    | 'int'
    | 'bigint'
    | 'smallint'
    | 'tinyint'
    | 'mediumint'
    | 'double'
    | 'double precision'
    | 'float'
    | 'char'
    | 'varchar'
    | 'nchar'
    | 'nvarchar'
    | 'clob'
    | 'decimal'
    | 'boolean'
    | 'date'
    | 'datetime'
    | 'any'}`,
  NoParameters
>;
export type NativeColumnType =
  | ({
      kind: 'builtin';
      database: 'postgresql';
      array?: { dimensions: number };
    } & PostgresBuiltinSpec)
  | { kind: 'projectEnum'; database: 'postgresql'; enumId: string; array?: { dimensions: number } }
  | ({ kind: 'builtin'; database: 'mysql'; declarationAlias?: 'boolean' } & MysqlBuiltinSpec)
  | { kind: 'valueList'; database: 'mysql'; typeId: 'mysql:enum' | 'mysql:set'; values: string[] }
  | ({ kind: 'builtin'; database: 'sqlite' } & SqliteBuiltinSpec)
  | { kind: 'declared'; database: 'sqlite'; name: string; numericArguments: string[] }
  | { kind: 'untyped'; database: 'sqlite' }
  | { kind: 'legacy'; source: 'document-v1'; original: Column['physical']['type'] };

export type NativeLiteral =
  | {
      kind: 'literal';
      literalType: 'string' | 'number' | 'binary' | 'json' | 'typedText';
      value: string;
    }
  | { kind: 'literal'; literalType: 'boolean'; value: boolean };
export const nativeBuiltinFunctionIds = [
  'postgresql:current_timestamp',
  'postgresql:current_date',
  'postgresql:current_time',
  'postgresql:gen_random_uuid',
  'postgresql:lower',
  'postgresql:upper',
  'postgresql:length',
  'postgresql:abs',
  'postgresql:coalesce',
  'mysql:current_timestamp',
  'mysql:current_date',
  'mysql:current_time',
  'mysql:uuid',
  'mysql:lower',
  'mysql:upper',
  'mysql:length',
  'mysql:abs',
  'mysql:coalesce',
  'sqlite:current_timestamp',
  'sqlite:current_date',
  'sqlite:current_time',
  'sqlite:lower',
  'sqlite:upper',
  'sqlite:length',
  'sqlite:abs',
  'sqlite:coalesce',
] as const;
export type NativeBuiltinFunctionId = (typeof nativeBuiltinFunctionIds)[number];
export type NativeExpression =
  | NativeLiteral
  | { kind: 'null' }
  | { kind: 'column'; columnId: string }
  | { kind: 'call'; functionId: NativeBuiltinFunctionId; args: NativeExpression[] }
  | { kind: 'unary'; operator: 'NOT' | '+' | '-'; operand: NativeExpression }
  | {
      kind: 'binary';
      operator: '+' | '-' | '*' | '/' | '%' | '=' | '<>' | '<' | '<=' | '>' | '>=' | 'AND' | 'OR';
      left: NativeExpression;
      right: NativeExpression;
    }
  | { kind: 'isNull'; operand: NativeExpression; negate: boolean }
  | { kind: 'in'; operand: NativeExpression; values: NativeExpression[]; negate: boolean };
export type NativeDefaultValue =
  | { kind: 'none' }
  | { kind: 'null' }
  | NativeLiteral
  | { kind: 'expression'; expression: NativeExpression }
  | { kind: 'legacyExpression'; source: 'document-v1'; original: string };
export type NativeGeneration =
  | { kind: 'none' }
  | { kind: 'serial'; database: 'postgresql' }
  | {
      kind: 'identity';
      database: 'postgresql';
      mode: 'always' | 'byDefault';
      sequence?: {
        start?: string;
        increment?: string;
        min?: string;
        max?: string;
        cache?: number;
        cycle?: boolean;
      };
    }
  | { kind: 'autoIncrement'; database: 'mysql' | 'sqlite' }
  | {
      kind: 'computed';
      database: DatabaseContext['kind'];
      storage: 'stored' | 'virtual';
      expression: NativeExpression;
    };
export type NativeNamespace =
  | { kind: 'postgresSchema'; name: string }
  | { kind: 'mysqlCurrentDatabase' }
  | { kind: 'sqliteMain' }
  | { kind: 'legacyNamespace'; source: 'document-v1'; original: string };
export type NativeTableOptions =
  | { database: 'postgresql' }
  | { database: 'mysql'; engine: 'InnoDB'; charset?: string; collation?: string }
  | { database: 'sqlite'; strict: boolean; withoutRowid: boolean };
export type NativeColumnOptions =
  | { database: 'postgresql'; collation?: string }
  | { database: 'mysql'; charset?: string; collation?: string; onUpdate?: NativeExpression }
  | { database: 'sqlite'; collation?: 'BINARY' | 'NOCASE' | 'RTRIM' };
export interface NativeTable extends Omit<Table, 'physical'> {
  physical: {
    name: string;
    namespace: NativeNamespace;
    comment: string;
    options: NativeTableOptions;
  };
}
export interface NativeColumn extends Omit<Column, 'physical'> {
  physical: {
    name: string;
    type: NativeColumnType;
    nullable: boolean;
    comment: string;
    generation: NativeGeneration;
    defaultValue: NativeDefaultValue;
    options: NativeColumnOptions;
  };
}
export interface NativeIndex {
  id: string;
  tableId: string;
  name: string;
  scope: ModelScope;
  unique: boolean;
  parts: { expression: NativeExpression; direction: 'asc' | 'desc'; prefixLength?: number }[];
  options:
    | {
        database: 'postgresql';
        method: 'btree' | 'hash' | 'gist' | 'spgist' | 'gin' | 'brin';
        predicate?: NativeExpression;
        includeColumnIds?: string[];
        nullsNotDistinct?: boolean;
      }
    | { database: 'mysql'; kind: 'btree' | 'fulltext' | 'spatial'; invisible?: boolean }
    | { database: 'sqlite'; predicate?: NativeExpression };
}
export interface NativeCheck {
  id: string;
  tableId: string;
  name: string;
  scope: ModelScope;
  expression: NativeExpression;
}
export interface NativeTableKey extends TableKey {
  deferrable?: { initially: 'immediate' | 'deferred' };
  nullsNotDistinct?: boolean;
}
export interface NativeTableRelation extends TableRelation {
  deferrable?: { initially: 'immediate' | 'deferred' };
}
export interface NativeDesignDocument extends Omit<
  DesignDocument,
  'schemaVersion' | 'tables' | 'columns' | 'keys' | 'tableRelations'
> {
  schemaVersion: 2;
  database: DatabaseContext;
  tables?: NativeTable[] | undefined;
  columns?: NativeColumn[] | undefined;
  keys?: NativeTableKey[] | undefined;
  tableRelations?: NativeTableRelation[] | undefined;
  indexes?: NativeIndex[] | undefined;
  checks?: NativeCheck[] | undefined;
}

export function createEmptyNativeDocument(database: DatabaseContext): NativeDesignDocument {
  getDatabaseProfile(database);
  const {
    tables: _tables,
    columns: _columns,
    keys: _keys,
    tableRelations: _relations,
    ...empty
  } = createEmptyDocument();
  return { ...empty, schemaVersion: 2, database: { ...database } };
}

/** Remapping column references is shared by copy/paste, restore and future migrations. */
export function mapNativeExpressionColumns(
  expression: NativeExpression,
  map: (id: string) => string,
): NativeExpression {
  return walkExpression(expression, map, 0, { nodes: 0 });
}
function walkExpression(
  expression: NativeExpression,
  map: (id: string) => string,
  depth: number,
  budget: { nodes: number },
): NativeExpression {
  if (depth > 32 || ++budget.nodes > 2048) throw new Error('expression.complexity-limit');
  const child = (value: NativeExpression) => walkExpression(value, map, depth + 1, budget);
  switch (expression.kind) {
    case 'column':
      return { ...expression, columnId: map(expression.columnId) };
    case 'call':
      return { ...expression, args: expression.args.map(child) };
    case 'unary':
    case 'isNull':
      return { ...expression, operand: child(expression.operand) };
    case 'binary':
      return { ...expression, left: child(expression.left), right: child(expression.right) };
    case 'in':
      return {
        ...expression,
        operand: child(expression.operand),
        values: expression.values.map(child),
      };
    default:
      return { ...expression };
  }
}
export function nativeExpressionColumnIds(expression: NativeExpression): string[] {
  const ids = new Set<string>();
  mapNativeExpressionColumns(expression, (id) => {
    ids.add(id);
    return id;
  });
  return [...ids];
}
