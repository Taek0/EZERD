import type { Column, DesignDocument } from '../document.js';
import type { DatabaseContext, DatabaseTypeParameterInput } from './definitions.js';
import { resolveDatabaseType, validateDatabaseTypeParameters } from './catalog.js';
import { getDatabaseProfile } from './profiles.js';
import type {
  NativeColumn,
  NativeColumnType,
  NativeDefaultValue,
  NativeDesignDocument,
  NativeGeneration,
  NativeNamespace,
  NativeTable,
  PostgresBuiltinSpec,
} from './native-document.js';

export interface NativeMigrationIssue {
  code:
    | 'legacy.type-unresolved'
    | 'legacy.default-unresolved'
    | 'legacy.namespace-unresolved'
    | 'legacy.enum-context-mismatch';
  objectId: string;
  path: string;
}
export interface NativeMigrationResult {
  document: NativeDesignDocument;
  issues: NativeMigrationIssue[];
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const segment = (id: string) => id.replaceAll('~', '~0').replaceAll('/', '~1');

/** Pure migration: callers decide when to persist it and invalidate old sync baselines. */
export function migrateDesignDocumentV1(
  original: DesignDocument,
  context: DatabaseContext,
): NativeMigrationResult {
  if (original.schemaVersion !== 1) throw new Error('document.version-not-supported');
  getDatabaseProfile(context);
  const source = clone(original);
  const issues: NativeMigrationIssue[] = [];
  const tables = source.tables?.map((table): NativeTable => {
    let namespace: NativeNamespace;
    if (context.kind === 'postgresql')
      namespace = { kind: 'postgresSchema', name: table.physical.schema };
    else {
      namespace = {
        kind: 'legacyNamespace',
        source: 'document-v1',
        original: table.physical.schema,
      };
      issues.push({
        code: 'legacy.namespace-unresolved',
        objectId: table.id,
        path: `/tables/${segment(table.id)}/physical/namespace`,
      });
    }
    return {
      ...table,
      physical: {
        name: table.physical.name,
        comment: table.physical.comment,
        namespace,
        options: tableOptions(context),
      },
    };
  });
  const columns = source.columns?.map((column): NativeColumn => {
    const result = migrateColumnType(column.physical.type, context);
    if (result.type.kind === 'legacy')
      issues.push({
        code: 'legacy.type-unresolved',
        objectId: column.id,
        path: `/columns/${segment(column.id)}/physical/type`,
      });
    const defaultValue = migrateDefault(column, result.type, context);
    if (defaultValue.kind === 'legacyExpression')
      issues.push({
        code: 'legacy.default-unresolved',
        objectId: column.id,
        path: `/columns/${segment(column.id)}/physical/defaultValue`,
      });
    return {
      ...column,
      physical: {
        name: column.physical.name,
        type: result.type,
        nullable: column.physical.nullable,
        comment: column.physical.comment,
        generation: result.generation,
        defaultValue,
        options: { database: context.kind },
      },
    };
  });
  if (context.kind !== 'postgresql')
    for (const definition of source.enums ?? [])
      issues.push({
        code: 'legacy.enum-context-mismatch',
        objectId: definition.id,
        path: `/enums/${segment(definition.id)}`,
      });
  const { tables: _tables, columns: _columns, ...shared } = source;
  return {
    document: {
      ...shared,
      schemaVersion: 2,
      database: { ...context },
      ...(tables && { tables }),
      ...(columns && { columns }),
    },
    issues,
  };
}

function tableOptions(context: DatabaseContext): NativeTable['physical']['options'] {
  if (context.kind === 'mysql') return { database: 'mysql', engine: 'InnoDB' };
  if (context.kind === 'sqlite') return { database: 'sqlite', strict: false, withoutRowid: false };
  return { database: 'postgresql' };
}

function migrateColumnType(
  original: Column['physical']['type'],
  context: DatabaseContext,
): { type: NativeColumnType; generation: NativeGeneration } {
  const legacy = () => ({
    type: { kind: 'legacy', source: 'document-v1', original: clone(original) } as const,
    generation: { kind: 'none' } as const,
  });
  // v1 metadata did not change the PostgreSQL editor's native type semantics.
  if (context.kind !== 'postgresql') return legacy();
  if (original.enumId !== undefined) {
    if (
      original.length !== undefined ||
      original.precision !== undefined ||
      original.scale !== undefined
    )
      return legacy();
    return {
      type: {
        kind: 'projectEnum',
        database: 'postgresql',
        enumId: original.enumId,
        ...(original.isArray && { array: { dimensions: 1 } }),
      },
      generation: { kind: 'none' },
    };
  }
  const parameters: DatabaseTypeParameterInput = {
    ...(original.length !== undefined && { length: original.length }),
    ...(original.precision !== undefined && { precision: original.precision }),
    ...(original.scale !== undefined && { scale: original.scale }),
  };
  const resolution = resolveDatabaseType(context, original.name, parameters);
  if (
    !resolution ||
    resolution.definition.deprecated ||
    validateDatabaseTypeParameters(resolution.definition, resolution.parameters).length ||
    (resolution.impliedGeneration && original.isArray)
  )
    return legacy();
  // The resolver and per-definition rules establish the discriminated spec before this boundary.
  const spec = {
    typeId: resolution.definition.id,
    parameters: clone(resolution.parameters),
  } as PostgresBuiltinSpec;
  return {
    type: {
      kind: 'builtin',
      database: 'postgresql',
      ...spec,
      ...(original.isArray && { array: { dimensions: 1 } }),
    },
    generation:
      resolution.impliedGeneration === 'serial'
        ? { kind: 'serial', database: 'postgresql' }
        : { kind: 'none' },
  };
}

function migrateDefault(
  column: Column,
  type: NativeColumnType,
  context: DatabaseContext,
): NativeDefaultValue {
  const raw = column.physical.defaultExpression;
  if (raw === null || !raw.trim()) return { kind: 'none' };
  const legacy = (): NativeDefaultValue => ({
    kind: 'legacyExpression',
    source: 'document-v1',
    original: raw,
  });
  if (context.kind !== 'postgresql' || type.kind === 'legacy') return legacy();
  const value = raw.trim();
  if (/^null$/i.test(value)) return { kind: 'null' };
  if (type.database === 'postgresql' && type.array) return legacy();
  if (/^(true|false)$/i.test(value))
    return { kind: 'literal', literalType: 'boolean', value: /^true$/i.test(value) };
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))
    return { kind: 'literal', literalType: 'number', value };
  const calls = {
    'now()': 'postgresql:current_timestamp',
    current_timestamp: 'postgresql:current_timestamp',
    current_date: 'postgresql:current_date',
    current_time: 'postgresql:current_time',
    'gen_random_uuid()': 'postgresql:gen_random_uuid',
  } as const;
  const lowered = value.toLowerCase();
  if (Object.hasOwn(calls, lowered))
    return {
      kind: 'expression',
      expression: { kind: 'call', functionId: calls[lowered as keyof typeof calls], args: [] },
    };
  if (/^'(?:[^'\0]|'')*'$/su.test(value)) {
    const text = value.slice(1, -1).replaceAll("''", "'");
    if (type.kind === 'projectEnum') return { kind: 'literal', literalType: 'string', value: text };
    if (type.kind === 'builtin' && ['postgresql:json', 'postgresql:jsonb'].includes(type.typeId)) {
      try {
        JSON.parse(text);
        return { kind: 'literal', literalType: 'json', value: text };
      } catch {
        return legacy();
      }
    }
    if (
      type.kind === 'builtin' &&
      ['postgresql:text', 'postgresql:varchar', 'postgresql:char'].includes(type.typeId)
    ) {
      // Non-ENUM PG v1 defaults rejected backslashes; preserve them for explicit repair.
      if (text.includes('\\')) return legacy();
      return { kind: 'literal', literalType: 'string', value: text };
    }
    return { kind: 'literal', literalType: 'typedText', value: text };
  }
  return legacy();
}

/** Ordinary metadata edits must never reinterpret a document's physical database. */
export function nativeDocumentMatchesContext(
  document: NativeDesignDocument,
  context: DatabaseContext,
): boolean {
  getDatabaseProfile(context);
  return (
    document.database.kind === context.kind && document.database.profileId === context.profileId
  );
}
