import { requestFingerprint } from '../sync.js';
import { getDatabaseType, validateDatabaseTypeParameters } from './catalog.js';
import { hasDatabaseCoverage, type DatabaseContext } from './definitions.js';
import {
  checkDatabaseFeature,
  type DatabaseFeatureId,
  type DatabaseFeatureFacts,
} from './features.js';
import { getDatabaseProfile } from './profiles.js';
import {
  nativeExpressionColumnIds,
  type NativeColumn,
  type NativeColumnType,
  type NativeDesignDocument,
  type NativeExpression,
  type NativeTable,
} from './native-document.js';

export interface DatabaseIssue {
  code: string;
  category: 'unsupported' | 'invalid' | 'incomplete' | 'environment';
  severity: 'error' | 'warning';
  objectId: string | null;
  path: string;
  params: Record<string, string | number | boolean>;
}
interface CollectedIssue extends DatabaseIssue {
  cause: string;
}
export interface DatabaseValidationOptions {
  mode: 'read' | 'write' | 'export';
  previous?: NativeDesignDocument;
}
const segment = (id: string) => id.replaceAll('~', '~0').replaceAll('/', '~1');
const physical = (scope: string) => scope !== 'logical';
const scalarType = (type: NativeColumnType) =>
  type.kind === 'builtin' ? getDatabaseType(type.typeId) : undefined;
const isArray = (type: NativeColumnType) =>
  type.kind !== 'legacy' && 'array' in type && !!type.array;
const none = (column: NativeColumn) => column.physical.defaultValue.kind === 'none';
const utf8Bytes = (value: string) =>
  [...value].reduce((sum, c) => {
    const cp = c.codePointAt(0)!;
    return sum + (cp <= 127 ? 1 : cp <= 2047 ? 2 : cp <= 65535 ? 3 : 4);
  }, 0);

/** Engine rules, independent of whether the full product path is already enabled. */
export function inspectNativeDatabaseDocument(
  document: NativeDesignDocument,
  context: DatabaseContext,
): DatabaseIssue[] {
  return collect(document, context, false).map(({ cause: _cause, ...issue }) => issue);
}

/** The trusted previous document must come from storage, never from a client baseline. */
export function validateDatabaseDocument(
  document: NativeDesignDocument,
  context: DatabaseContext,
  options: DatabaseValidationOptions,
): DatabaseIssue[] {
  const current = collect(document, context, options.mode !== 'read');
  if (options.mode !== 'write') return current.map(({ cause: _cause, ...issue }) => issue);
  const before = options.previous ? collect(options.previous, context, true) : [];
  const old = new Set(before.map(issueIdentity));
  const introduced = current
    .filter((issue) => {
      if (issue.category === 'incomplete') return false;
      if (issue.code.startsWith('database.')) return true;
      return !old.has(issueIdentity(issue));
    })
    .map(({ cause: _cause, ...issue }) => issue);
  return [...introduced, ...inspectNativeLegacyChanges(document, options.previous)];
}

/** Trusted storage/history origins only; a client baseline is never an authority for legacy data. */
export function inspectNativeLegacyChanges(
  document: NativeDesignDocument,
  previous?: NativeDesignDocument,
): DatabaseIssue[] {
  const sameContext =
    previous &&
    previous.database.kind === document.database.kind &&
    previous.database.profileId === document.database.profileId;
  const columns = new Map(
    (sameContext ? (previous.columns ?? []) : []).map((item) => [item.id, item]),
  );
  const tables = new Map(
    (sameContext ? (previous.tables ?? []) : []).map((item) => [item.id, item]),
  );
  const issues: DatabaseIssue[] = [];
  const retain = (objectId: string, path: string, value: unknown, trusted: unknown) => {
    if (trusted !== undefined && requestFingerprint(value) === requestFingerprint(trusted)) return;
    issues.push({
      code: 'legacy.source-not-trusted',
      category: 'unsupported',
      severity: 'error',
      objectId,
      path,
      params: {},
    });
  };
  for (const column of document.columns ?? []) {
    const before = columns.get(column.id);
    const sameOwner = before?.tableId === column.tableId;
    const path = `/columns/${segment(column.id)}/physical`;
    if (column.physical.type.kind === 'legacy')
      retain(
        column.id,
        `${path}/type`,
        column.physical.type,
        sameOwner ? before?.physical.type : undefined,
      );
    if (column.physical.defaultValue.kind === 'legacyExpression')
      retain(
        column.id,
        `${path}/defaultValue`,
        column.physical.defaultValue,
        sameOwner ? before?.physical.defaultValue : undefined,
      );
  }
  for (const table of document.tables ?? [])
    if (table.physical.namespace.kind === 'legacyNamespace')
      retain(
        table.id,
        `/tables/${segment(table.id)}/physical/namespace`,
        table.physical.namespace,
        tables.get(table.id)?.physical.namespace,
      );
  return issues;
}
function issueIdentity(issue: CollectedIssue): string {
  return requestFingerprint([issue.code, issue.objectId, issue.path, issue.params, issue.cause]);
}

function collect(
  doc: NativeDesignDocument,
  context: DatabaseContext,
  availability: boolean,
): CollectedIssue[] {
  const issues: CollectedIssue[] = [];
  const add = (
    code: string,
    objectId: string | null,
    path: string,
    cause: unknown,
    category: DatabaseIssue['category'] = 'invalid',
    params: DatabaseIssue['params'] = {},
    severity: DatabaseIssue['severity'] = 'error',
  ) => {
    issues.push({
      code,
      category,
      severity,
      objectId,
      path,
      params,
      cause: requestFingerprint(cause),
    });
  };
  try {
    getDatabaseProfile(context);
  } catch {
    add('database.profile-unsupported', null, '/database', context, 'unsupported');
    return issues;
  }
  if (doc.database.kind !== context.kind || doc.database.profileId !== context.profileId) {
    add('database.context-changed', null, '/database', doc.database, 'unsupported');
    return issues;
  }
  const tables = new Map((doc.tables ?? []).map((table) => [table.id, table]));
  const columns = new Map((doc.columns ?? []).map((column) => [column.id, column]));
  const domains = new Set(doc.domains.map((domain) => domain.id));
  const enums = new Map((doc.enums ?? []).map((definition) => [definition.id, definition]));
  const visibleColumn = (id: string, tableId: string) => {
    const column = columns.get(id);
    const table = tables.get(tableId);
    return column?.tableId === tableId && physical(column.scope) && table && physical(table.scope)
      ? column
      : undefined;
  };
  const feature = (
    id: DatabaseFeatureId,
    objectId: string,
    path: string,
    facts: DatabaseFeatureFacts,
    cause: unknown,
  ) => {
    const decision = checkDatabaseFeature(context, id, facts);
    if (!decision.supported)
      add(decision.code ?? 'feature.not-supported', objectId, path, cause, 'unsupported', {
        feature: id,
      });
    else if (availability && !decision.usable)
      add('feature.not-implemented', objectId, path, cause, 'unsupported', { feature: id });
  };
  const identifier = (name: string, id: string, path: string) => {
    if (!name.trim()) {
      add('ddl.name-required', id, path, name, 'incomplete');
      return;
    }
    if (
      name.includes('\0') ||
      (context.kind === 'postgresql' && utf8Bytes(name) > 63) ||
      (context.kind === 'mysql' && [...name].length > 64)
    )
      add('identifier.invalid', id, path, name);
  };
  const folded = (name: string) =>
    context.kind === 'postgresql' ? name : name.replace(/[A-Z]/g, (c) => c.toLowerCase());
  const tableNames = new Set<string>();
  const tableKeys = (id: string) =>
    (doc.keys ?? []).filter((key) => key.tableId === id && physical(key.scope));

  function expression(
    value: NativeExpression,
    objectId: string,
    path: string,
    tableId: string,
    purpose: 'default' | 'computed' | 'check' | 'index',
  ) {
    let ids: string[];
    try {
      ids = nativeExpressionColumnIds(value);
    } catch {
      add('expression.complexity-limit', objectId, path, value.kind);
      return;
    }
    for (const id of ids) {
      if (!visibleColumn(id, tableId))
        add('expression.column-not-found', objectId, path, [value, id, tableId]);
      else if (purpose === 'default')
        add('default.column-reference-not-supported', objectId, path, value);
    }
    const pending = [value];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.kind === 'call') {
        if (!node.functionId.startsWith(`${context.kind}:`))
          add('expression.function-not-supported', objectId, path, node, 'unsupported');
        const name = node.functionId.split(':')[1]!;
        const variable = [
          'current_timestamp',
          'current_date',
          'current_time',
          'gen_random_uuid',
          'uuid',
        ].includes(name);
        const required = variable ? 0 : name === 'coalesce' ? null : 1;
        if (
          (required !== null && node.args.length !== required) ||
          (required === null && node.args.length < 2)
        )
          add('expression.function-arguments-invalid', objectId, path, node);
        if (purpose !== 'default' && variable)
          add('expression.non-deterministic', objectId, path, node);
        pending.push(...node.args);
      } else if (node.kind === 'binary') pending.push(node.left, node.right);
      else if (node.kind === 'unary' || node.kind === 'isNull') pending.push(node.operand);
      else if (node.kind === 'in') pending.push(node.operand, ...node.values);
    }
    return ids;
  }

  for (const table of tables.values()) {
    if (!physical(table.scope)) continue;
    const path = `/tables/${segment(table.id)}/physical`;
    identifier(table.physical.name, table.id, `${path}/name`);
    if (table.physical.comment.includes('\0'))
      add('comment.invalid', table.id, `${path}/comment`, table.physical.comment);
    feature('table', table.id, path, {}, true);
    if (table.domainId !== null && !domains.has(table.domainId))
      add(
        'table.domain-not-found',
        table.id,
        `/tables/${segment(table.id)}/domainId`,
        table.domainId,
      );
    if (table.physical.options.database !== context.kind)
      add(
        'table.options-context-mismatch',
        table.id,
        `${path}/options`,
        table.physical.options,
        'unsupported',
      );
    const namespace = table.physical.namespace;
    if (namespace.kind === 'legacyNamespace')
      add('legacy.namespace-unresolved', table.id, `${path}/namespace`, namespace, 'unsupported');
    else if (
      (context.kind === 'postgresql' && namespace.kind !== 'postgresSchema') ||
      (context.kind === 'mysql' && namespace.kind !== 'mysqlCurrentDatabase') ||
      (context.kind === 'sqlite' && namespace.kind !== 'sqliteMain')
    )
      add('namespace.not-supported', table.id, `${path}/namespace`, namespace, 'unsupported');
    if (namespace.kind === 'postgresSchema' && namespace.name)
      identifier(namespace.name, table.id, `${path}/namespace/name`);
    const name = JSON.stringify([
      namespace.kind === 'postgresSchema' ? namespace.name || 'public' : '',
      context.kind === 'sqlite' ? folded(table.physical.name) : table.physical.name,
    ]);
    if (tableNames.has(name))
      add('table.duplicate-name', table.id, `${path}/name`, [namespace, table.physical.name]);
    tableNames.add(name);
    if (!(doc.columns ?? []).some((column) => visibleColumn(column.id, table.id)))
      add('ddl.empty-table', table.id, path, table.id, 'incomplete');
    if (table.physical.options.database === 'sqlite') {
      if (table.physical.options.strict)
        feature('strictTable', table.id, `${path}/options/strict`, {}, true);
      if (table.physical.options.withoutRowid) {
        feature('withoutRowid', table.id, `${path}/options/withoutRowid`, {}, true);
        if (!tableKeys(table.id).some((key) => key.kind === 'primary'))
          add('table.primary-key-required', table.id, `${path}/options/withoutRowid`, true);
      }
    }
  }

  const generatedDependencies = new Map<string, string[]>();
  for (const column of columns.values()) {
    if (!physical(column.scope)) continue;
    const table = tables.get(column.tableId);
    const path = `/columns/${segment(column.id)}/physical`;
    if (!table) {
      add(
        'column.table-not-found',
        column.id,
        `/columns/${segment(column.id)}/tableId`,
        column.tableId,
      );
      continue;
    }
    if (!physical(table.scope)) continue;
    identifier(column.physical.name, column.id, `${path}/name`);
    if (column.physical.comment.includes('\0'))
      add('comment.invalid', column.id, `${path}/comment`, column.physical.comment);
    const peers = (doc.columns ?? []).filter((c) => visibleColumn(c.id, table.id));
    if (
      peers.some(
        (c) => c.id !== column.id && folded(c.physical.name) === folded(column.physical.name),
      )
    )
      add('column.duplicate-name', column.id, `${path}/name`, [
        column.tableId,
        folded(column.physical.name),
      ]);
    const type = column.physical.type;
    feature(
      'column',
      column.id,
      path,
      {},
      {
        type,
        generation: column.physical.generation,
        defaultValue: column.physical.defaultValue,
        options: column.physical.options,
        nullable: column.physical.nullable,
      },
    );
    if (table.scope === 'physical' && column.scope !== 'physical')
      add('column.scope-mismatch', column.id, `/columns/${segment(column.id)}/scope`, [
        table.scope,
        column.scope,
      ]);
    const definition = scalarType(type);
    const tableMode =
      table.physical.options.database === 'sqlite' ? table.physical.options : undefined;
    if (type.kind === 'legacy')
      add('legacy.type-unresolved', column.id, `${path}/type`, type, 'unsupported');
    else if (type.database !== context.kind)
      add('type.not-supported', column.id, `${path}/type`, type, 'unsupported');
    else if (type.kind === 'builtin') {
      if (!definition || definition.databaseKind !== context.kind)
        add('type.not-supported', column.id, `${path}/type`, type, 'unsupported');
      else {
        for (const issue of validateDatabaseTypeParameters(definition, type.parameters))
          add(
            issue.code,
            column.id,
            `${path}/type/parameters/${issue.parameter}`,
            type.parameters,
            'invalid',
            { ...issue.params },
          );
        if (availability && !hasDatabaseCoverage(definition.coverage))
          add('type.not-implemented', column.id, `${path}/type`, type, 'unsupported');
        if (tableMode?.strict && !definition.sqliteStrict)
          add('type.strict-not-supported', column.id, `${path}/type`, [type, true], 'unsupported');
      }
      if (isArray(type))
        feature(
          'array',
          column.id,
          `${path}/type/array`,
          {
            typeId: type.typeId,
            generation: column.physical.generation.kind,
          },
          [type, column.physical.generation.kind],
        );
    } else if (type.kind === 'projectEnum') {
      feature('enumType', column.id, `${path}/type`, {}, type.enumId);
      if (isArray(type))
        feature(
          'array',
          column.id,
          `${path}/type/array`,
          { projectEnum: true, generation: column.physical.generation.kind },
          [type, column.physical.generation.kind],
        );
      if (!enums.has(type.enumId))
        add('type.enum-not-found', column.id, `${path}/type/enumId`, type.enumId);
    } else if (type.kind === 'valueList') {
      feature(
        type.typeId === 'mysql:enum' ? 'enumColumn' : 'setColumn',
        column.id,
        `${path}/type`,
        {},
        type,
      );
      if (
        !type.values.length ||
        new Set(type.values).size !== type.values.length ||
        type.values.some((v) => v.includes('\0'))
      )
        add('type.values-invalid', column.id, `${path}/type/values`, type.values);
      if (
        type.typeId === 'mysql:set' &&
        (type.values.length > 64 || type.values.some((v) => v.includes(',')))
      )
        add('type.set-values-invalid', column.id, `${path}/type/values`, type.values);
    } else if (tableMode?.strict)
      add('type.strict-not-supported', column.id, `${path}/type`, type, 'unsupported');
    if (column.physical.options.database !== context.kind)
      add(
        'column.options-context-mismatch',
        column.id,
        `${path}/options`,
        column.physical.options,
        'unsupported',
      );
    const options = column.physical.options;
    if (options.database === 'postgresql' && options.collation && definition?.category !== 'string')
      add(
        'column.collation-not-supported',
        column.id,
        `${path}/options/collation`,
        [type, options.collation],
        'unsupported',
      );
    if (options.database === 'mysql') {
      if (
        (options.charset || options.collation) &&
        definition?.category !== 'string' &&
        type.kind !== 'valueList'
      )
        add(
          'column.charset-not-supported',
          column.id,
          `${path}/options`,
          [type, options],
          'unsupported',
        );
      if (options.onUpdate) {
        expression(options.onUpdate, column.id, `${path}/options/onUpdate`, table.id, 'default');
        if (
          !['mysql:datetime', 'mysql:timestamp'].includes(definition?.id ?? '') ||
          options.onUpdate.kind !== 'call' ||
          options.onUpdate.functionId !== 'mysql:current_timestamp'
        )
          add(
            'column.on-update-not-supported',
            column.id,
            `${path}/options/onUpdate`,
            [type, options.onUpdate],
            'unsupported',
          );
      }
    }
    const primary = tableKeys(table.id).find(
      (key) => key.kind === 'primary' && key.columnIds.includes(column.id),
    );
    const generation = column.physical.generation;
    if (generation.kind !== 'none') {
      if (generation.database !== context.kind)
        add(
          'generation.context-mismatch',
          column.id,
          `${path}/generation`,
          generation,
          'unsupported',
        );
      else if (generation.kind === 'computed') {
        feature(
          generation.storage === 'stored' ? 'generatedStored' : 'generatedVirtual',
          column.id,
          `${path}/generation`,
          {},
          generation.storage,
        );
        if (!none(column))
          add(
            'generation.default-not-supported',
            column.id,
            `${path}/defaultValue`,
            column.physical.defaultValue,
          );
        const references =
          expression(
            generation.expression,
            column.id,
            `${path}/generation/expression`,
            table.id,
            'computed',
          ) ?? [];
        generatedDependencies.set(column.id, references);
        const order = peers.findIndex((item) => item.id === column.id);
        if (
          references.some(
            (id) =>
              id === column.id ||
              (columns.get(id)?.physical.generation.kind === 'computed' &&
                (context.kind === 'postgresql' ||
                  (context.kind === 'mysql' &&
                    peers.findIndex((item) => item.id === id) >= order))),
          )
        )
          add(
            'generation.reference-not-supported',
            column.id,
            `${path}/generation/expression`,
            generation.expression,
          );
      } else {
        if (column.physical.nullable)
          add('generation.nullability-mismatch', column.id, `${path}/generation`, [
            generation,
            column.physical.nullable,
          ]);
        const firstKey = tableKeys(table.id).some((key) => key.columnIds[0] === column.id);
        const firstIndex = (doc.indexes ?? []).some(
          (index) =>
            index.tableId === table.id &&
            physical(index.scope) &&
            index.parts[0]?.expression.kind === 'column' &&
            index.parts[0].expression.columnId === column.id,
        );
        feature(
          generation.kind,
          column.id,
          `${path}/generation`,
          {
            ...(type.kind === 'builtin' && { typeId: type.typeId }),
            array: isArray(type),
            hasDefault: !none(column),
            indexed: firstKey || firstIndex,
            firstIndexColumn: firstKey || firstIndex,
            otherAutoIncrementColumns: peers.filter(
              (peer) => peer.id !== column.id && peer.physical.generation.kind === 'autoIncrement',
            ).length,
            isPrimaryKeyColumn: !!primary,
            primaryKeyColumns: primary?.columnIds.length ?? 0,
            withoutRowid: tableMode?.withoutRowid ?? false,
          },
          [
            generation,
            type,
            !none(column),
            tableKeys(table.id),
            tableMode,
            peers
              .filter((peer) => peer.physical.generation.kind === 'autoIncrement')
              .map((peer) => peer.id),
          ],
        );
      }
    }
    const defaultValue = column.physical.defaultValue;
    if (isArray(type) && defaultValue.kind !== 'none' && defaultValue.kind !== 'null')
      add(
        'default.array-literal-not-supported',
        column.id,
        `${path}/defaultValue`,
        [type, defaultValue],
        'unsupported',
      );
    if (defaultValue.kind === 'legacyExpression')
      add(
        'legacy.default-unresolved',
        column.id,
        `${path}/defaultValue`,
        defaultValue,
        'unsupported',
      );
    else if (defaultValue.kind === 'null' && (!column.physical.nullable || primary))
      add('default.null-not-supported', column.id, `${path}/defaultValue`, [
        defaultValue,
        column.physical.nullable,
        !!primary,
      ]);
    else if (defaultValue.kind === 'expression') {
      expression(
        defaultValue.expression,
        column.id,
        `${path}/defaultValue/expression`,
        table.id,
        'default',
      );
      if (defaultValue.expression.kind === 'call') {
        const functionName = defaultValue.expression.functionId.split(':')[1];
        const typeName = definition?.sqlName;
        if (
          (functionName === 'gen_random_uuid' && typeName !== 'uuid') ||
          (context.kind !== 'sqlite' &&
            functionName === 'current_timestamp' &&
            !['timestamp', 'timestamptz', 'datetime'].includes(typeName ?? '')) ||
          (context.kind !== 'sqlite' && functionName === 'current_date' && typeName !== 'date') ||
          (context.kind !== 'sqlite' &&
            functionName === 'current_time' &&
            !['time', 'timetz'].includes(typeName ?? ''))
        )
          add('default.type-mismatch', column.id, `${path}/defaultValue`, [type, defaultValue]);
      }
    } else if (defaultValue.kind === 'literal') {
      if (
        type.kind === 'projectEnum' &&
        (defaultValue.literalType !== 'string' ||
          !enums.get(type.enumId)?.values.includes(String(defaultValue.value)))
      )
        add('default.enum-value-invalid', column.id, `${path}/defaultValue`, [
          defaultValue,
          enums.get(type.enumId)?.values,
        ]);
      if (
        type.kind === 'valueList' &&
        type.typeId === 'mysql:enum' &&
        (defaultValue.literalType !== 'string' || !type.values.includes(String(defaultValue.value)))
      )
        add('default.enum-value-invalid', column.id, `${path}/defaultValue`, [
          defaultValue,
          type.values,
        ]);
      if (definition && context.kind !== 'sqlite') {
        const value = defaultValue.value;
        const category = definition.category;
        const booleanAlias =
          type.kind === 'builtin' &&
          type.database === 'mysql' &&
          type.declarationAlias === 'boolean' &&
          defaultValue.literalType === 'boolean';
        if (
          category === 'integer' &&
          !booleanAlias &&
          (defaultValue.literalType !== 'number' ||
            typeof value !== 'string' ||
            !/^[+-]?\d+$/.test(value))
        )
          add('default.type-mismatch', column.id, `${path}/defaultValue`, [defaultValue, type]);
        else if (category === 'integer' && typeof value === 'string') {
          const width = {
            smallint: 16,
            integer: 32,
            bigint: 64,
            tinyint: 8,
            mediumint: 24,
            int: 32,
          }[definition.sqlName];
          if (width) {
            const unsigned =
              type.kind === 'builtin' &&
              type.database === 'mysql' &&
              'unsigned' in type.parameters &&
              type.parameters.unsigned;
            const upper = (1n << BigInt(unsigned ? width : width - 1)) - 1n;
            const lower = unsigned ? 0n : -upper - 1n;
            if (BigInt(value) < lower || BigInt(value) > upper)
              add('default.number-out-of-range', column.id, `${path}/defaultValue`, [
                defaultValue,
                type,
              ]);
          }
        }
        if (
          (category === 'decimal' || category === 'floating') &&
          defaultValue.literalType !== 'number'
        )
          add('default.type-mismatch', column.id, `${path}/defaultValue`, [defaultValue, type]);
        if (
          category === 'decimal' &&
          defaultValue.literalType === 'number' &&
          typeof value === 'string' &&
          type.kind === 'builtin'
        ) {
          const p = 'precision' in type.parameters ? type.parameters.precision : undefined;
          const s = 'scale' in type.parameters ? type.parameters.scale : undefined;
          const precision = p ?? (context.kind === 'mysql' ? 10 : undefined);
          if (precision !== undefined && !decimalFits(value, precision, s ?? 0))
            add('default.number-out-of-range', column.id, `${path}/defaultValue`, [
              type,
              defaultValue,
            ]);
        }
        if (category === 'boolean' && defaultValue.literalType !== 'boolean')
          add('default.type-mismatch', column.id, `${path}/defaultValue`, [defaultValue, type]);
        if (
          category === 'json' &&
          ['json', 'jsonb'].includes(definition.sqlName) &&
          defaultValue.literalType !== 'json'
        )
          add('default.type-mismatch', column.id, `${path}/defaultValue`, [defaultValue, type]);
        if (category === 'string' && defaultValue.literalType !== 'string')
          add('default.type-mismatch', column.id, `${path}/defaultValue`, [defaultValue, type]);
        if (
          category === 'string' &&
          typeof value === 'string' &&
          type.kind === 'builtin' &&
          'length' in type.parameters &&
          type.parameters.length !== undefined &&
          [...value].length > type.parameters.length
        )
          add('default.length-exceeded', column.id, `${path}/defaultValue`, [defaultValue, type]);
      }
    }
  }

  for (const key of doc.keys ?? []) {
    if (!physical(key.scope)) continue;
    const path = `/keys/${segment(key.id)}`;
    if (!tables.has(key.tableId)) {
      add('key.table-not-found', key.id, `${path}/tableId`, key.tableId);
      continue;
    }
    if (!physical(tables.get(key.tableId)!.scope)) continue;
    if (key.name) identifier(key.name, key.id, `${path}/name`);
    feature(key.kind === 'primary' ? 'primaryKey' : 'unique', key.id, path, {}, key.kind);
    if (!key.columnIds.length)
      add('ddl.empty-key', key.id, `${path}/columnIds`, key.columnIds, 'incomplete');
    if (
      new Set(key.columnIds).size !== key.columnIds.length ||
      key.columnIds.some((id) => !visibleColumn(id, key.tableId))
    )
      add('key.columns-invalid', key.id, `${path}/columnIds`, key.columnIds);
    if (
      key.kind === 'primary' &&
      tableKeys(key.tableId).filter((item) => item.kind === 'primary').length > 1
    )
      add(
        'key.multiple-primary-keys',
        key.id,
        path,
        tableKeys(key.tableId)
          .filter((item) => item.kind === 'primary')
          .map((item) => item.id),
      );
    if (key.deferrable && context.kind !== 'postgresql')
      add(
        'key.deferrable-not-supported',
        key.id,
        `${path}/deferrable`,
        key.deferrable,
        'unsupported',
      );
    if (key.nullsNotDistinct && context.kind !== 'postgresql')
      add(
        'key.nulls-policy-not-supported',
        key.id,
        `${path}/nullsNotDistinct`,
        true,
        'unsupported',
      );
    for (const id of key.columnIds) {
      const column = visibleColumn(id, key.tableId);
      if (!column) continue;
      const definition = scalarType(column.physical.type);
      if (
        context.kind === 'sqlite' &&
        key.kind === 'primary' &&
        column.physical.generation.kind === 'computed'
      )
        add(
          'key.generated-not-supported',
          key.id,
          `${path}/columnIds`,
          [key.columnIds, column.physical.generation],
          'unsupported',
        );
      if (
        (context.kind === 'postgresql' && definition?.id === 'postgresql:json') ||
        (context.kind === 'mysql' &&
          definition &&
          (definition.category === 'json' ||
            definition.category === 'geometry' ||
            /^(tiny|medium|long)?(text|blob)$/.test(definition.sqlName)))
      )
        add(
          'key.type-not-supported',
          key.id,
          `${path}/columnIds`,
          [key.columnIds, column.physical.type],
          'unsupported',
        );
    }
  }

  for (const relation of doc.tableRelations ?? []) {
    if (!physical(relation.scope) || !relation.physical) continue;
    const path = `/tableRelations/${segment(relation.id)}`;
    const fk = relation.physical;
    const source = tables.get(relation.sourceTableId);
    const target = tables.get(relation.targetTableId);
    if (!source || !target || !physical(source.scope) || !physical(target.scope)) {
      add('foreign-key.table-not-found', relation.id, path, [
        relation.sourceTableId,
        relation.targetTableId,
      ]);
      continue;
    }
    if (fk.name) identifier(fk.name, relation.id, `${path}/physical/name`);
    const left = fk.sourceColumnIds.map((id) => visibleColumn(id, source.id));
    const right = fk.targetColumnIds.map((id) => visibleColumn(id, target.id));
    if (
      left.some((c) => !c) ||
      right.some((c) => !c) ||
      new Set(fk.sourceColumnIds).size !== left.length ||
      new Set(fk.targetColumnIds).size !== right.length
    ) {
      add('foreign-key.columns-invalid', relation.id, path, fk);
      continue;
    }
    if (!left.length || !right.length || left.length !== right.length) {
      add('ddl.incomplete-foreign-key', relation.id, path, fk, 'incomplete');
      continue;
    }
    if (
      context.kind === 'mysql' &&
      right.some(
        (column) =>
          column?.physical.generation.kind === 'computed' &&
          column.physical.generation.storage === 'virtual',
      )
    )
      add(
        'foreign-key.virtual-generated-target',
        relation.id,
        path,
        right.map((column) => column?.physical.generation),
        'unsupported',
      );
    if (
      !tableKeys(target.id).some(
        (key) =>
          !key.deferrable &&
          key.columnIds.length === right.length &&
          key.columnIds.every((id, i) => id === fk.targetColumnIds[i]),
      )
    )
      add('foreign-key.referenced-key-required', relation.id, path, [
        fk.targetColumnIds,
        tableKeys(target.id),
      ]);
    for (const action of [fk.onDelete, fk.onUpdate])
      feature(
        'foreignKey',
        relation.id,
        `${path}/physical`,
        {
          foreignKeyAction: action,
          nullable: left.every((c) => c?.physical.nullable),
          isPrimaryKeyColumn: tableKeys(source.id).some(
            (key) =>
              key.kind === 'primary' && key.columnIds.some((id) => fk.sourceColumnIds.includes(id)),
          ),
        },
        [fk, left.map((c) => c?.physical.nullable), tableKeys(source.id)],
      );
    if (relation.deferrable)
      feature('deferrableForeignKey', relation.id, `${path}/deferrable`, {}, relation.deferrable);
    if (
      left.some(
        (column, index) =>
          column && right[index] && !compatible(column, right[index]!, context, source, target),
      )
    )
      add('foreign-key.type-mismatch', relation.id, `${path}/physical`, [
        left.map((c) => [c?.physical.type, c?.physical.options]),
        right.map((c) => [c?.physical.type, c?.physical.options]),
        source.physical.options,
        target.physical.options,
      ]);
  }
  const enumNames = new Set<string>();
  for (const definition of enums.values()) {
    const path = `/enums/${segment(definition.id)}`;
    if (context.kind !== 'postgresql') {
      add('legacy.enum-context-mismatch', definition.id, path, definition, 'unsupported');
      continue;
    }
    feature('enumType', definition.id, path, {}, true);
    identifier(definition.name, definition.id, `${path}/name`);
    if (definition.schema) identifier(definition.schema, definition.id, `${path}/schema`);
    const qualifiedName = JSON.stringify([definition.schema || 'public', definition.name]);
    if (enumNames.has(qualifiedName) || tableNames.has(qualifiedName))
      add('enum.type-name-collision', definition.id, `${path}/name`, [
        definition.schema,
        definition.name,
      ]);
    enumNames.add(qualifiedName);
    if (
      !definition.values.length ||
      new Set(definition.values).size !== definition.values.length ||
      definition.values.some((value) => value.includes('\0') || utf8Bytes(value) > 63)
    )
      add('enum.values-invalid', definition.id, `${path}/values`, definition.values);
  }
  for (const check of doc.checks ?? []) {
    if (!physical(check.scope)) continue;
    if (!tables.has(check.tableId))
      add('check.table-not-found', check.id, `/checks/${segment(check.id)}/tableId`, check.tableId);
    else if (physical(tables.get(check.tableId)!.scope)) {
      const path = `/checks/${segment(check.id)}`;
      if (check.name) identifier(check.name, check.id, `${path}/name`);
      feature('check', check.id, path, {}, true);
      expression(check.expression, check.id, `${path}/expression`, check.tableId, 'check');
    }
  }
  for (const index of doc.indexes ?? []) {
    if (!physical(index.scope)) continue;
    const path = `/indexes/${segment(index.id)}`;
    if (!tables.has(index.tableId)) {
      add('index.table-not-found', index.id, `${path}/tableId`, index.tableId);
      continue;
    }
    if (!physical(tables.get(index.tableId)!.scope)) continue;
    identifier(index.name, index.id, `${path}/name`);
    feature('index', index.id, path, {}, true);
    if (index.options.database !== context.kind)
      add('index.context-mismatch', index.id, `${path}/options`, index.options, 'unsupported');
    for (let i = 0; i < index.parts.length; i++) {
      const part = index.parts[i]!;
      expression(part.expression, index.id, `${path}/parts/${i}`, index.tableId, 'index');
      if (part.expression.kind !== 'column')
        feature('expressionIndex', index.id, `${path}/parts/${i}`, {}, part.expression);
      if (part.prefixLength !== undefined && context.kind !== 'mysql')
        add(
          'index.prefix-not-supported',
          index.id,
          `${path}/parts/${i}/prefixLength`,
          part.prefixLength,
          'unsupported',
        );
    }
    if ('predicate' in index.options && index.options.predicate) {
      feature('partialIndex', index.id, `${path}/options/predicate`, {}, true);
      expression(
        index.options.predicate,
        index.id,
        `${path}/options/predicate`,
        index.tableId,
        'index',
      );
    }
    if (index.options.database === 'postgresql' && index.options.includeColumnIds) {
      feature(
        'includedIndexColumns',
        index.id,
        `${path}/options/includeColumnIds`,
        {},
        index.options.method,
      );
      if (index.options.includeColumnIds.some((id) => !visibleColumn(id, index.tableId)))
        add(
          'index.columns-invalid',
          index.id,
          `${path}/options/includeColumnIds`,
          index.options.includeColumnIds,
        );
    }
  }
  for (const [id, references] of generatedDependencies) {
    const visited = new Set<string>();
    const pending = [...references];
    while (pending.length) {
      const dependency = pending.pop()!;
      if (dependency === id) {
        add('generation.cycle', id, `/columns/${segment(id)}/physical/generation`, [
          references,
          [...visited]
            .sort()
            .map((dependencyId) => [dependencyId, generatedDependencies.get(dependencyId)]),
        ]);
        break;
      }
      if (!visited.has(dependency)) {
        visited.add(dependency);
        pending.push(...(generatedDependencies.get(dependency) ?? []));
      }
    }
  }
  if (![...tables.values()].some((table) => physical(table.scope)))
    add('ddl.incomplete-model', null, '/tables', true, 'incomplete');
  return issues;
}

function compatible(
  left: NativeColumn,
  right: NativeColumn,
  context: DatabaseContext,
  leftTable: NativeTable,
  rightTable: NativeTable,
): boolean {
  const a = left.physical.type;
  const b = right.physical.type;
  if (context.kind === 'sqlite') return a.kind !== 'legacy' && b.kind !== 'legacy';
  if (isArray(a) !== isArray(b)) return false;
  if (a.kind === 'projectEnum' || b.kind === 'projectEnum')
    return a.kind === 'projectEnum' && b.kind === 'projectEnum' && a.enumId === b.enumId;
  if (a.kind === 'valueList' || b.kind === 'valueList')
    return requestFingerprint(a) === requestFingerprint(b);
  if (a.kind !== 'builtin' || b.kind !== 'builtin') return false;
  const leftType = getDatabaseType(a.typeId);
  const rightType = getDatabaseType(b.typeId);
  if (!leftType || !rightType) return false;
  if (context.kind === 'postgresql') {
    if (leftType.category === 'integer' && rightType.category === 'integer' && !isArray(a))
      return true;
    return a.typeId === b.typeId;
  }
  if (a.typeId !== b.typeId) return false;
  if (leftType.category === 'string') {
    const l = left.physical.options;
    const r = right.physical.options;
    const lt = leftTable.physical.options;
    const rt = rightTable.physical.options;
    if (
      l.database !== 'mysql' ||
      r.database !== 'mysql' ||
      lt.database !== 'mysql' ||
      rt.database !== 'mysql'
    )
      return false;
    const lc = l.charset ?? lt.charset ?? 'utf8mb4';
    const rc = r.charset ?? rt.charset ?? 'utf8mb4';
    return (
      lc === rc &&
      (l.collation ?? lt.collation ?? `default:${lc}`) ===
        (r.collation ?? rt.collation ?? `default:${rc}`)
    );
  }
  if (leftType.category === 'integer')
    return (
      ('unsigned' in a.parameters ? (a.parameters.unsigned ?? false) : false) ===
      ('unsigned' in b.parameters ? (b.parameters.unsigned ?? false) : false)
    );
  if (leftType.category === 'decimal')
    return (
      ('precision' in a.parameters ? (a.parameters.precision ?? 10) : 10) ===
        ('precision' in b.parameters ? (b.parameters.precision ?? 10) : 10) &&
      ('scale' in a.parameters ? (a.parameters.scale ?? 0) : 0) ===
        ('scale' in b.parameters ? (b.parameters.scale ?? 0) : 0)
    );
  return requestFingerprint(a.parameters) === requestFingerprint(b.parameters);
}

/** Compare decimal digits after scale rounding without converting the value to JS number. */
function decimalFits(value: string, precision: number, scale: number): boolean {
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
