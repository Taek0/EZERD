import {
  columnTypeDisplay,
  nativeColumnTypeDisplay,
  isVisibleInView,
  type DesignDocument,
  type NativeDesignDocument,
} from '@ezerd/model';

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
                ? nativeColumnTypeDisplay(column.physical.type, document.enums).slice(0, 120)
                : columnTypeDisplay(column.physical.type, document.enums),
            primaryKey: primaryColumns.has(column.id),
          })),
      };
    }),
  };
}
