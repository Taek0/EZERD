import {
  columnTypeDisplay,
  getDatabaseType,
  isVisibleInView,
  type DesignDocument,
  type NativeDesignDocument,
  type NativeColumnType,
} from '@ezerd/model';

function nativeTypeCaption(type: NativeColumnType, enums: NativeDesignDocument['enums']): string {
  if (type.kind === 'legacy') return type.original.name + (type.original.isArray ? '[]' : '');
  const suffix = 'array' in type && type.array ? '[]'.repeat(type.array.dimensions) : '';
  if (type.kind === 'projectEnum')
    return (enums?.find((item) => item.id === type.enumId)?.name || 'ENUM') + suffix;
  if (type.kind === 'untyped') return '';
  if (type.kind === 'declared') return type.name;
  if (type.kind === 'builtin' && type.database === 'mysql' && type.declarationAlias === 'boolean')
    return 'BOOLEAN';
  return (getDatabaseType(type.typeId)?.sqlName.toUpperCase() ?? type.typeId) + suffix;
}

/** A bounded physical-model preview of the saved project, independent of its active view. */
export function projectPreview(document: DesignDocument | NativeDesignDocument) {
  const tables = (document.tables ?? []).filter((table) =>
    isVisibleInView(table.scope, 'physical'),
  );
  const tableIds = new Set(tables.map((table) => table.id));
  return {
    tableCount: tables.length,
    relationCount: (document.tableRelations ?? []).filter(
      (relation) =>
        isVisibleInView(relation.scope, 'physical') &&
        relation.physical !== null &&
        tableIds.has(relation.sourceTableId) &&
        tableIds.has(relation.targetTableId),
    ).length,
    tables: tables.slice(0, 2).map((table) => {
      const primaryColumns = new Set(
        (document.keys ?? [])
          .filter(
            (key) =>
              key.tableId === table.id &&
              key.kind === 'primary' &&
              isVisibleInView(key.scope, 'physical', table.scope),
          )
          .flatMap((key) => key.columnIds),
      );
      return {
        name: table.physical.name,
        columns: (document.columns ?? [])
          .filter(
            (column) =>
              column.tableId === table.id && isVisibleInView(column.scope, 'physical', table.scope),
          )
          .slice(0, 3)
          .map((column) => ({
            name: column.physical.name,
            type:
              'kind' in column.physical.type
                ? nativeTypeCaption(column.physical.type, document.enums)
                : columnTypeDisplay(column.physical.type, document.enums),
            primaryKey: primaryColumns.has(column.id),
          })),
      };
    }),
  };
}
