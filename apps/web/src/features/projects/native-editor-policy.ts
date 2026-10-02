import {
  databaseTypeCatalog,
  projectDatabaseCapabilities,
  checkDatabaseFeature,
  getDatabaseType,
  nativeColumnTypeDisplay,
  type DatabaseFeatureId,
  type DatabaseFeatureFacts,
  type NativeColumn,
  type NativeDesignDocument,
  type NativeTable,
} from '@ezerd/model';
import { nativeDefaultChoices, nativeKeyColumnPolicies } from './native-editor-option-policy.js';

export function nativeEditorPolicy(
  document: NativeDesignDocument,
  table?: NativeTable,
  column?: NativeColumn,
) {
  const capabilities = projectDatabaseCapabilities({ ...document.database, revision: 0 }, 2);
  const strict = table?.physical.options.database === 'sqlite' && table.physical.options.strict;
  const withoutRowid =
    table?.physical.options.database === 'sqlite' && table.physical.options.withoutRowid;
  const keys = (document.keys ?? []).filter(
    (key) => key.tableId === table?.id && key.scope !== 'logical',
  );
  const primary = keys.find(
    (key) => key.kind === 'primary' && key.columnIds.includes(column?.id ?? ''),
  );
  const facts: DatabaseFeatureFacts = {
    ...(column?.physical.type.kind === 'builtin' ? { typeId: column.physical.type.typeId } : {}),
    projectEnum: column?.physical.type.kind === 'projectEnum',
    array: !!(column && 'array' in column.physical.type && column.physical.type.array),
    nullable: column?.physical.nullable ?? false,
    primaryKeyColumns: primary?.columnIds.length ?? 0,
    isPrimaryKeyColumn: !!primary,
    indexed:
      keys.some((key) => key.columnIds.includes(column?.id ?? '')) ||
      (document.indexes ?? []).some(
        (index) =>
          index.tableId === table?.id &&
          index.scope !== 'logical' &&
          index.parts.some(
            (part) => part.expression.kind === 'column' && part.expression.columnId === column?.id,
          ),
      ),
    firstIndexColumn:
      keys.some((key) => key.columnIds[0] === column?.id) ||
      (document.indexes ?? []).some(
        (index) =>
          index.tableId === table?.id &&
          index.scope !== 'logical' &&
          index.parts[0]?.expression.kind === 'column' &&
          index.parts[0].expression.columnId === column?.id,
      ),
    otherAutoIncrementColumns: (document.columns ?? []).filter(
      (item) =>
        item.tableId === table?.id &&
        item.id !== column?.id &&
        item.physical.generation.kind === 'autoIncrement',
    ).length,
    hasDefault: !!column && column.physical.defaultValue.kind !== 'none',
    generation: column?.physical.generation.kind ?? 'none',
    strict: !!strict,
    withoutRowid: !!withoutRowid,
  };
  const feature = (id: DatabaseFeatureId, extra: DatabaseFeatureFacts = {}) =>
    checkDatabaseFeature(document.database, id, { ...facts, ...extra });
  const types = databaseTypeCatalog
    .filter((definition) => definition.databaseKind === document.database.kind)
    .map((definition) => {
      const entry = capabilities.types.find((type) => type.id === definition.id);
      const supported =
        definition.databaseKind === document.database.kind && (!strict || definition.sqliteStrict);
      return {
        definition,
        usable: supported && !!entry?.usable,
        code: !supported
          ? 'type.not-supported'
          : !entry?.usable
            ? 'type.not-implemented'
            : undefined,
      };
    });
  return {
    capabilities,
    types,
    feature,
    facts,
    defaults: table && column ? nativeDefaultChoices(document, table, column) : [],
    keyColumns: (kind: 'primary' | 'unique', preservedIds: readonly string[] = []) =>
      table ? nativeKeyColumnPolicies(document, table, kind, preservedIds) : [],
  };
}
export function nativeTypeChoice(type: NativeColumn['physical']['type']): string {
  return type.kind === 'builtin' || type.kind === 'valueList'
    ? type.typeId
    : type.kind === 'projectEnum'
      ? `enum:${type.enumId}`
      : type.kind;
}
export function nativeTypeReady(
  document: NativeDesignDocument,
  table: NativeTable,
  type: NativeColumn['physical']['type'],
): boolean {
  const policy = nativeEditorPolicy(document, table);
  if (type.kind === 'builtin' || type.kind === 'valueList')
    return !!policy.types.find((item) => item.definition.id === type.typeId)?.usable;
  if (type.kind === 'projectEnum')
    return document.database.kind === 'postgresql' && policy.feature('enumType').usable;
  // No capability/coverage entry exists for SQLite arbitrary declarations or untyped columns yet.
  return false;
}
export function nativeTypeCurrentLabel(
  column: NativeColumn,
  document: NativeDesignDocument,
): string {
  return nativeColumnTypeDisplay(column.physical.type, document.enums) || column.physical.type.kind;
}
export function nativeTypeParameterRules(typeId: string) {
  return getDatabaseType(typeId as Parameters<typeof getDatabaseType>[0])?.parameters ?? {};
}
