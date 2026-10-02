import { getDatabaseType } from './catalog.js';
import type { DatabaseContext } from './definitions.js';
import { getDatabaseProfile } from './profiles.js';
import {
  nativeBuiltinFunctionIds,
  nativeExpressionColumnIds,
  type NativeColumn,
  type NativeColumnType,
  type NativeDesignDocument,
  type NativeExpression,
  type NativeIndex,
  type NativeLiteral,
  type NativeTable,
} from './native-document.js';
import {
  inspectNativeDatabaseDocument,
  validateDatabaseDocument,
  type DatabaseIssue,
} from './validation.js';
import { requestFingerprint } from '../sync.js';

export interface NativeDDLResult {
  database: DatabaseContext;
  sql: string;
  issues: DatabaseIssue[];
  canExport: boolean;
}
const physical = (scope: string) => scope !== 'logical';
const numberToken = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const operators = new Set(['+', '-', '*', '/', '%', '=', '<>', '<', '<=', '>', '>=', 'AND', 'OR']);
const actions = new Set(['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT']);

/** Product exports always require the same completed-path policy as new writes. */
export function exportNativeDatabaseDDL(document: NativeDesignDocument): NativeDDLResult {
  const issues = validateDatabaseDocument(document, document.database, { mode: 'export' });
  if (issues.some((issue) => issue.severity === 'error'))
    return { database: { ...document.database }, sql: '', issues, canExport: false };
  return compileNativeDatabaseDDL(document);
}

/** Engine compiler for execution fixtures. API/UI must use exportNativeDatabaseDDL. */
export function compileNativeDatabaseDDL(document: NativeDesignDocument): NativeDDLResult {
  const context = document.database;
  let issues: DatabaseIssue[];
  try {
    issues = inspectNativeDatabaseDocument(document, context);
  } catch {
    issues = [problem('ddl.invalid-document', null, '/')];
  }
  const fail = () => ({ database: { ...context }, sql: '', issues, canExport: false });
  if (issues.some((issue) => issue.severity === 'error')) return fail();
  try {
    const profile = getDatabaseProfile(context);
    const kind = context.kind;
    const tables = (document.tables ?? []).filter((table) => physical(table.scope));
    const tableMap = new Map(tables.map((table) => [table.id, table]));
    const columns = (document.columns ?? []).filter(
      (column) => physical(column.scope) && tableMap.has(column.tableId),
    );
    const columnMap = new Map(columns.map((column) => [column.id, column]));
    const keys = (document.keys ?? []).filter(
      (key) => physical(key.scope) && tableMap.has(key.tableId),
    );
    const relations = (document.tableRelations ?? []).filter(
      (relation) =>
        physical(relation.scope) &&
        tableMap.has(relation.sourceTableId) &&
        tableMap.has(relation.targetTableId),
    );
    const indexes = (document.indexes ?? []).filter(
      (index) => physical(index.scope) && tableMap.has(index.tableId),
    );
    const checks = (document.checks ?? []).filter(
      (check) => physical(check.scope) && tableMap.has(check.tableId),
    );
    const enums = new Map((document.enums ?? []).map((definition) => [definition.id, definition]));
    const quote = (name: string) => {
      if (name.includes('\0')) throw Error('identifier.invalid');
      const delimiter = kind === 'mysql' ? '`' : '"';
      return delimiter + name.replaceAll(delimiter, delimiter + delimiter) + delimiter;
    };
    const text = (value: string) => {
      if (value.includes('\0')) throw Error('literal.string-invalid');
      const escaped = value.replaceAll("'", "''");
      return kind === 'postgresql'
        ? "E'" + escaped.replaceAll('\\', '\\\\') + "'"
        : "'" + escaped + "'";
    };
    const schema = (table: NativeTable) =>
      table.physical.namespace.kind === 'postgresSchema'
        ? table.physical.namespace.name || 'public'
        : '';
    const tableName = (table: NativeTable) =>
      (kind === 'postgresql' ? quote(schema(table)) + '.' : '') + quote(table.physical.name);
    const columnName = (id: string) => {
      const column = columnMap.get(id);
      if (!column) throw Error('expression.column-not-found');
      return quote(column.physical.name);
    };
    const typeSQL = (type: NativeColumnType): string => {
      if (type.kind === 'legacy') throw Error('legacy.type-unresolved');
      if (type.kind === 'untyped') return '';
      if (type.kind === 'declared') {
        if (
          !type.name.trim() ||
          /[\0;]|--|\/\*/.test(type.name) ||
          type.numericArguments.length > 2 ||
          type.numericArguments.some((arg) => !/^[+-]?\d+(?:\.\d+)?$/.test(arg))
        )
          throw Error('type.declaration-invalid');
        return (
          quote(type.name) +
          (type.numericArguments.length ? `(${type.numericArguments.join(', ')})` : '')
        );
      }
      const array = 'array' in type && type.array ? '[]'.repeat(type.array.dimensions) : '';
      if (type.kind === 'projectEnum') {
        const definition = enums.get(type.enumId);
        if (!definition) throw Error('type.enum-not-found');
        return quote(definition.schema || 'public') + '.' + quote(definition.name) + array;
      }
      const definition = getDatabaseType(type.typeId);
      if (!definition) throw Error('type.not-supported');
      if (type.kind === 'valueList')
        return definition.sqlName.toUpperCase() + '(' + type.values.map(text).join(', ') + ')';
      const p = type.parameters;
      let name =
        type.database === 'mysql' && type.declarationAlias === 'boolean'
          ? 'BOOLEAN'
          : definition.sqlName.toUpperCase();
      const params =
        'length' in p && p.length !== undefined
          ? [p.length]
          : 'bitLength' in p && p.bitLength !== undefined
            ? [p.bitLength]
            : 'precision' in p && p.precision !== undefined
              ? [p.precision, ...('scale' in p && p.scale !== undefined ? [p.scale] : [])]
              : [];
      // PostgreSQL interval fields precede its fractional precision.
      if ('fields' in p && p.fields) name += ' ' + p.fields.toUpperCase();
      if (params.length) name += '(' + params.join(', ') + ')';
      if ('unsigned' in p && p.unsigned) name += ' UNSIGNED';
      return name + array;
    };
    const literal = (value: NativeLiteral, target?: NativeColumnType): string => {
      if (value.literalType === 'boolean') return value.value ? 'TRUE' : 'FALSE';
      if (value.literalType === 'number') {
        if (!numberToken.test(value.value)) throw Error('literal.number-invalid');
        return value.value;
      }
      if (value.literalType === 'binary') {
        if (!/^(?:[0-9a-f]{2})*$/i.test(value.value)) throw Error('literal.binary-invalid');
        return kind === 'postgresql' ? `decode('${value.value}', 'hex')` : `X'${value.value}'`;
      }
      if (value.literalType === 'json') {
        try {
          JSON.parse(value.value);
        } catch {
          throw Error('literal.json-invalid');
        }
        return kind === 'postgresql'
          ? `CAST(${text(value.value)} AS ${target ? typeSQL(target) : 'JSONB'})`
          : kind === 'mysql'
            ? `CAST(${text(value.value)} AS JSON)`
            : text(value.value);
      }
      if (value.literalType === 'typedText') {
        if (!target) throw Error('literal.target-type-required');
        return kind === 'postgresql'
          ? `CAST(${text(value.value)} AS ${typeSQL(target)})`
          : text(value.value);
      }
      return text(value.value);
    };
    const expression = (root: NativeExpression, target?: NativeColumnType): string => {
      nativeExpressionColumnIds(root);
      const show = (node: NativeExpression): string => {
        switch (node.kind) {
          case 'literal':
            return literal(node, target);
          case 'null':
            return 'NULL';
          case 'column':
            return columnName(node.columnId);
          case 'call': {
            if (
              !nativeBuiltinFunctionIds.includes(node.functionId) ||
              !node.functionId.startsWith(kind + ':')
            )
              throw Error('expression.function-not-supported');
            const name = node.functionId.split(':')[1]!.toUpperCase();
            if (
              kind === 'mysql' &&
              ['CURRENT_TIMESTAMP', 'CURRENT_TIME'].includes(name) &&
              target?.kind === 'builtin' &&
              'precision' in target.parameters &&
              target.parameters.precision !== undefined
            )
              return `${name}(${target.parameters.precision})`;
            return ['CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME'].includes(name)
              ? name
              : `${name}(${node.args.map(show).join(', ')})`;
          }
          case 'unary':
            if (!['NOT', '+', '-'].includes(node.operator))
              throw Error('expression.operator-invalid');
            return `(${node.operator} ${show(node.operand)})`;
          case 'binary':
            if (!operators.has(node.operator)) throw Error('expression.operator-invalid');
            return `(${show(node.left)} ${node.operator} ${show(node.right)})`;
          case 'isNull':
            return `(${show(node.operand)} IS ${node.negate ? 'NOT ' : ''}NULL)`;
          case 'in':
            if (!node.values.length) throw Error('expression.empty-in');
            return `(${show(node.operand)} ${node.negate ? 'NOT ' : ''}IN (${node.values.map(show).join(', ')}))`;
        }
      };
      return show(root);
    };
    const fallbackName = (prefix: string, id: string) =>
      `ezerd_${prefix}_${requestFingerprint(id).slice(0, 24)}`;
    const assigned = new Map<string, string>();
    const claim = (namespace: string, name: string, id: string, path: string) => {
      const folded = kind === 'postgresql' ? name : name.toLowerCase();
      const key = JSON.stringify([namespace, folded]);
      if (assigned.has(key)) issues.push(problem('ddl.object-name-collision', id, path));
      assigned.set(key, id);
    };
    for (const table of tables)
      claim(
        kind === 'mysql' ? 'tables' : schema(table),
        table.physical.name,
        table.id,
        '/tables/' + table.id + '/physical/name',
      );
    const keyNames = new Map<string, string>(),
      checkNames = new Map<string, string>(),
      fkNames = new Map<string, string>();
    for (const key of keys) {
      const table = tableMap.get(key.tableId)!;
      const name = key.name || fallbackName(key.kind === 'primary' ? 'pk' : 'uq', key.id);
      keyNames.set(key.id, name);
      claim(
        kind === 'postgresql' ? schema(table) : 'keys:' + table.id,
        name,
        key.id,
        '/keys/' + key.id + '/name',
      );
      if (kind === 'postgresql')
        claim('constraints:' + table.id, name, key.id, '/keys/' + key.id + '/name');
    }
    for (const index of indexes) {
      const table = tableMap.get(index.tableId)!;
      claim(
        kind === 'postgresql' ? schema(table) : kind === 'sqlite' ? '' : 'keys:' + table.id,
        index.name,
        index.id,
        '/indexes/' + index.id + '/name',
      );
    }
    for (const check of checks) {
      const name = check.name || fallbackName('ck', check.id);
      checkNames.set(check.id, name);
      claim(
        kind === 'mysql' ? 'checks' : 'constraints:' + check.tableId,
        name,
        check.id,
        '/checks/' + check.id + '/name',
      );
    }
    for (const relation of relations) {
      const name = relation.physical?.name || fallbackName('fk', relation.id);
      fkNames.set(relation.id, name);
      claim(
        kind === 'mysql' ? 'foreignKeys' : 'constraints:' + relation.sourceTableId,
        name,
        relation.id,
        '/tableRelations/' + relation.id + '/physical/name',
      );
    }
    const statements: string[] = [
      `-- EZERD ${kind} / ${profile.id}; creates the entire physical design.`,
    ];
    if (kind === 'mysql') {
      statements.push(
        'SET NAMES utf8mb4;',
        "SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION,NO_BACKSLASH_ESCAPES';",
      );
      issues.push(problem('ddl.mysql-session-settings', null, '/', 'warning', 'environment'));
    }
    if (kind === 'sqlite') statements.push('PRAGMA foreign_keys = ON;');
    if (kind === 'postgresql') {
      const schemas = new Set([
        ...tables.map(schema),
        ...[...enums.values()].map((item) => item.schema || 'public'),
      ]);
      for (const name of schemas) statements.push(`CREATE SCHEMA IF NOT EXISTS ${quote(name)};`);
      for (const definition of enums.values())
        statements.push(
          `CREATE TYPE ${quote(definition.schema || 'public')}.${quote(definition.name)} AS ENUM (${definition.values.map(text).join(', ')});`,
        );
    }
    const deferrable = (value?: { initially: 'immediate' | 'deferred' }) =>
      value ? ` DEFERRABLE INITIALLY ${value.initially.toUpperCase()}` : '';
    const foreignKey = (relation: (typeof relations)[number]) => {
      const fk = relation.physical;
      if (!fk || !actions.has(fk.onDelete) || !actions.has(fk.onUpdate))
        throw Error('foreign-key.invalid');
      return `CONSTRAINT ${quote(fkNames.get(relation.id)!)} FOREIGN KEY (${fk.sourceColumnIds.map(columnName).join(', ')}) REFERENCES ${tableName(tableMap.get(relation.targetTableId)!)} (${fk.targetColumnIds.map(columnName).join(', ')}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}${deferrable(relation.deferrable)}`;
    };
    const colSQL = (column: NativeColumn, inlinePrimary: string | undefined) => {
      const value = column.physical,
        generation = value.generation;
      let type = typeSQL(value.type);
      if (generation.kind === 'serial') {
        if (value.type.kind !== 'builtin') throw Error('generation.type-not-supported');
        const serialTypes: Partial<Record<string, string>> = {
          'postgresql:smallint': 'SMALLSERIAL',
          'postgresql:integer': 'SERIAL',
          'postgresql:bigint': 'BIGSERIAL',
        };
        const serial = serialTypes[value.type.typeId];
        if (!serial) throw Error('generation.type-not-supported');
        type = serial;
      }
      let sql = quote(value.name) + (type ? ' ' + type : '');
      const options = value.options;
      if (options.database === 'mysql' && options.charset)
        sql += ' CHARACTER SET ' + quote(options.charset);
      if (options.collation) sql += ' COLLATE ' + quote(options.collation);
      if (
        options.database === 'mysql' &&
        value.type.kind === 'builtin' &&
        'srid' in value.type.parameters &&
        value.type.parameters.srid !== undefined
      )
        sql += ' SRID ' + value.type.parameters.srid;
      if (inlinePrimary) sql += ` CONSTRAINT ${quote(inlinePrimary)} PRIMARY KEY`;
      if (generation.kind === 'autoIncrement')
        sql += kind === 'sqlite' ? ' AUTOINCREMENT' : ' AUTO_INCREMENT';
      if (!value.nullable && !(kind === 'mysql' && generation.kind === 'computed'))
        sql += ' NOT NULL';
      if (generation.kind === 'identity') {
        sql += ` GENERATED ${generation.mode === 'always' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY`;
        const sequence = generation.sequence;
        if (sequence) {
          const entries: string[] = [];
          for (const [key, keyword] of [
            ['start', 'START WITH'],
            ['increment', 'INCREMENT BY'],
            ['min', 'MINVALUE'],
            ['max', 'MAXVALUE'],
          ] as const) {
            const v = sequence[key];
            if (v !== undefined) {
              if (!/^[+-]?\d+$/.test(v)) throw Error('generation.sequence-invalid');
              entries.push(`${keyword} ${v}`);
            }
          }
          if (sequence.cache !== undefined) entries.push('CACHE ' + sequence.cache);
          if (sequence.cycle !== undefined) entries.push(sequence.cycle ? 'CYCLE' : 'NO CYCLE');
          if (entries.length) sql += ' (' + entries.join(' ') + ')';
        }
      }
      if (generation.kind === 'computed')
        sql += ` GENERATED ALWAYS AS (${expression(generation.expression)}) ${generation.storage.toUpperCase()}`;
      if (!value.nullable && kind === 'mysql' && generation.kind === 'computed') sql += ' NOT NULL';
      const d = value.defaultValue;
      if (d.kind === 'legacyExpression') throw Error('legacy.default-unresolved');
      if (d.kind !== 'none') {
        const rendered =
          d.kind === 'expression'
            ? expression(d.expression, value.type)
            : d.kind === 'null'
              ? 'NULL'
              : literal(d, value.type);
        const definition =
          value.type.kind === 'builtin' ? getDatabaseType(value.type.typeId) : undefined;
        const parentheses =
          kind === 'mysql'
            ? (d.kind === 'expression' &&
                !(
                  d.expression.kind === 'call' &&
                  d.expression.functionId === 'mysql:current_timestamp'
                )) ||
              ['json', 'binary'].includes(definition?.category ?? '') ||
              definition?.sqlName.endsWith('text') ||
              definition?.sqlName.endsWith('blob')
            : kind === 'sqlite' &&
              d.kind === 'expression' &&
              !(d.expression.kind === 'call' && d.expression.functionId.includes(':current_'));
        sql += ' DEFAULT ' + (parentheses ? '(' + rendered + ')' : rendered);
      }
      if (options.database === 'mysql' && options.onUpdate)
        sql += ' ON UPDATE ' + expression(options.onUpdate, value.type);
      if (kind === 'mysql' && value.comment) sql += ' COMMENT ' + text(value.comment);
      return sql;
    };
    for (const table of tables) {
      const tableColumns = columns.filter((column) => column.tableId === table.id);
      // MySQL generated expressions require preceding referenced columns; preserve other order.
      const ordered: NativeColumn[] = [],
        visited = new Set<string>(),
        visiting = new Set<string>();
      const order = (column: NativeColumn) => {
        if (visited.has(column.id)) return;
        if (visiting.has(column.id)) throw Error('generation.reference-cycle');
        visiting.add(column.id);
        if (kind === 'mysql' && column.physical.generation.kind === 'computed')
          for (const id of nativeExpressionColumnIds(column.physical.generation.expression)) {
            const dependency = columnMap.get(id);
            if (!dependency || dependency.tableId !== table.id)
              throw Error('expression.column-not-found');
            order(dependency);
          }
        visiting.delete(column.id);
        visited.add(column.id);
        ordered.push(column);
      };
      tableColumns.forEach(order);
      const inlineKey =
        kind === 'sqlite'
          ? keys.find(
              (key) =>
                key.tableId === table.id &&
                key.kind === 'primary' &&
                key.columnIds.length === 1 &&
                columnMap.get(key.columnIds[0]!)?.physical.generation.kind === 'autoIncrement',
            )
          : undefined;
      const body = ordered.map((column) =>
        colSQL(
          column,
          inlineKey?.columnIds[0] === column.id ? keyNames.get(inlineKey.id) : undefined,
        ),
      );
      for (const key of keys.filter((key) => key.tableId === table.id && key.id !== inlineKey?.id))
        body.push(
          `CONSTRAINT ${quote(keyNames.get(key.id)!)} ${key.kind === 'primary' ? 'PRIMARY KEY' : 'UNIQUE' + (key.nullsNotDistinct ? ' NULLS NOT DISTINCT' : '')} (${key.columnIds.map(columnName).join(', ')})${deferrable(key.deferrable)}`,
        );
      for (const check of checks.filter((check) => check.tableId === table.id))
        body.push(
          `CONSTRAINT ${quote(checkNames.get(check.id)!)} CHECK (${expression(check.expression)})`,
        );
      if (kind === 'sqlite')
        for (const relation of relations.filter((relation) => relation.sourceTableId === table.id))
          body.push(foreignKey(relation));
      let tail = '';
      const options = table.physical.options;
      if (options.database === 'mysql')
        tail =
          ' ENGINE=InnoDB' +
          (options.charset ? ' DEFAULT CHARACTER SET=' + quote(options.charset) : '') +
          (options.collation ? ' COLLATE=' + quote(options.collation) : '') +
          (table.physical.comment ? ' COMMENT=' + text(table.physical.comment) : '');
      if (options.database === 'sqlite')
        tail = [options.strict && 'STRICT', options.withoutRowid && 'WITHOUT ROWID']
          .filter(Boolean)
          .join(', ');
      statements.push(
        `CREATE TABLE ${tableName(table)} (\n  ${body.join(',\n  ')}\n)${tail ? ' ' + tail : ''};`,
      );
      if (kind === 'postgresql') {
        if (table.physical.comment)
          statements.push(
            `COMMENT ON TABLE ${tableName(table)} IS ${text(table.physical.comment)};`,
          );
        for (const column of tableColumns)
          if (column.physical.comment)
            statements.push(
              `COMMENT ON COLUMN ${tableName(table)}.${quote(column.physical.name)} IS ${text(column.physical.comment)};`,
            );
      }
      if (kind === 'sqlite') {
        const comments = [
          table.physical.comment,
          ...tableColumns.map((column) => column.physical.comment),
        ].filter(Boolean);
        if (comments.length) {
          statements.push(
            ...comments.map((comment) => '-- ' + comment.replace(/\r\n?|\n/g, '\n-- ')),
          );
          issues.push(
            problem(
              'ddl.comments-as-sql-comments',
              table.id,
              '/tables/' + table.id,
              'warning',
              'environment',
            ),
          );
        }
      }
    }
    const indexSQL = (index: NativeIndex) => {
      if (
        index.options.database === 'postgresql' &&
        !['btree', 'hash', 'gist', 'spgist', 'gin', 'brin'].includes(index.options.method)
      )
        throw Error('index.method-not-supported');
      const parts = index.parts.map((part) => {
        if (!['asc', 'desc'].includes(part.direction)) throw Error('index.direction-invalid');
        const simple = part.expression.kind === 'column';
        let sql = simple ? expression(part.expression) : '(' + expression(part.expression) + ')';
        if (part.prefixLength !== undefined) {
          if (!simple || !Number.isSafeInteger(part.prefixLength) || part.prefixLength < 1)
            throw Error('index.prefix-invalid');
          sql += '(' + part.prefixLength + ')';
        }
        if (index.options.database !== 'postgresql' || index.options.method === 'btree')
          sql += ' ' + part.direction.toUpperCase();
        return sql;
      });
      if (!parts.length) throw Error('index.parts-required');
      const option = index.options;
      const prefix =
        option.database === 'mysql' && option.kind !== 'btree'
          ? option.kind === 'fulltext'
            ? 'FULLTEXT '
            : 'SPATIAL '
          : index.unique
            ? 'UNIQUE '
            : '';
      let sql = `CREATE ${prefix}INDEX ${quote(index.name)} ON ${tableName(tableMap.get(index.tableId)!)}${option.database === 'postgresql' ? ' USING ' + option.method.toUpperCase() : ''} (${parts.join(', ')})`;
      if (option.database === 'postgresql') {
        if (option.includeColumnIds?.length)
          sql += ' INCLUDE (' + option.includeColumnIds.map(columnName).join(', ') + ')';
        if (option.nullsNotDistinct) sql += ' NULLS NOT DISTINCT';
      }
      if ('predicate' in option && option.predicate)
        sql += ' WHERE ' + expression(option.predicate);
      if (option.database === 'mysql' && option.invisible) sql += ' INVISIBLE';
      return sql + ';';
    };
    indexes.forEach((index) => statements.push(indexSQL(index)));
    if (kind !== 'sqlite')
      relations.forEach((relation) =>
        statements.push(
          `ALTER TABLE ${tableName(tableMap.get(relation.sourceTableId)!)} ADD ${foreignKey(relation)};`,
        ),
      );
    if (issues.some((issue) => issue.severity === 'error')) return fail();
    return {
      database: { ...context },
      sql: statements.join('\n\n') + '\n',
      issues,
      canExport: true,
    };
  } catch (error) {
    issues.push(
      problem(error instanceof Error ? error.message : 'ddl.invalid-document', null, '/'),
    );
    return fail();
  }
}
function problem(
  code: string,
  objectId: string | null,
  path: string,
  severity: DatabaseIssue['severity'] = 'error',
  category: DatabaseIssue['category'] = 'invalid',
): DatabaseIssue {
  return { code, objectId, path, severity, category, params: {} };
}
