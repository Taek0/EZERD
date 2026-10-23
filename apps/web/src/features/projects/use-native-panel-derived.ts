import { useCallback, useMemo } from 'react';
import { nativeColumnTypeDisplay, type NativeDesignDocument } from '@ezerd/model';
import {
  nativeInspectorMatches,
  nativeInspectorOutline,
  type NativeCanvasScope,
} from './native-inspector-state.js';
import { nativeTableCanvasRows } from './native-canvas-style.js';
import { navigatorTableMatches, type NativeNavigatorColumn } from './NativeNavigatorTable.js';

export function useNativePanelDerived({
  doc,
  mode,
  canvasScope,
  canvasView,
  selected,
  selectedTableRelation,
  logicalEnabled,
  search,
  domain,
  untitledTable,
}: {
  doc: NativeDesignDocument | null;
  mode: 'physical' | 'logical';
  canvasScope: NativeCanvasScope | null;
  canvasView: string;
  selected: string | null;
  selectedTableRelation: string | null;
  logicalEnabled: boolean;
  search: string;
  domain: string;
  untitledTable: string;
}) {
  const visible = (scope: string) => scope === 'both' || scope === mode;
  const outline = useMemo(
    () =>
      doc
        ? nativeInspectorOutline(doc, mode, canvasScope, canvasView)
        : { tables: [], relations: [] },
    [doc, mode, canvasScope?.visibleObjectIds, canvasView],
  );
  const indexes = useMemo(
    () => ({
      tables: new Map(doc?.tables?.map((table) => [table.id, table])),
      columns: new Map(doc?.columns?.map((column) => [column.id, column])),
      domains: new Map(doc?.domains.map((domain) => [domain.id, domain])),
    }),
    [doc],
  );
  const candidate = selected ? indexes.tables.get(selected) : undefined;
  const selectedTable = candidate && visible(candidate.scope) ? candidate : undefined;
  const selectedTableDomain = indexes.domains.get(selectedTable?.domainId ?? '');
  const selectedTableKeys = useMemo(
    () =>
      (doc?.keys ?? []).filter((key) => key.tableId === selectedTable?.id && visible(key.scope)),
    [doc, selectedTable, mode],
  );
  const selectedTableRelations = useMemo(
    () =>
      (doc?.tableRelations ?? []).filter(
        (relation) =>
          visible(relation.scope) &&
          (relation.sourceTableId === selectedTable?.id ||
            relation.targetTableId === selectedTable?.id),
      ),
    [doc, selectedTable, mode],
  );
  const selectedRelation = doc?.tableRelations?.find(
    (relation) => relation.id === selectedTableRelation && visible(relation.scope),
  );
  const selectedRows = useMemo(
    () => (doc && selectedTable ? nativeTableCanvasRows(doc, selectedTable, mode) : []),
    [doc, selectedTable, mode],
  );
  const tableName = useCallback(
    (id: string) => {
      const table = indexes.tables.get(id);
      return (
        (mode === 'physical' ? table?.physical.name : table?.logical.name) ||
        table?.physical.name ||
        (logicalEnabled && table?.logical.name) ||
        untitledTable
      );
    },
    [indexes, mode, logicalEnabled, untitledTable],
  );
  const columnName = useCallback(
    (id: string) =>
      (mode === 'physical'
        ? indexes.columns.get(id)?.physical.name
        : indexes.columns.get(id)?.logical.name) ||
      indexes.columns.get(id)?.physical.name ||
      (logicalEnabled && indexes.columns.get(id)?.logical.name) ||
      id,
    [indexes, mode, logicalEnabled],
  );
  const navigatorColumns = useMemo(() => {
    const result = new Map<string, NativeNavigatorColumn[]>();
    for (const column of doc?.columns ?? []) {
      if (!visible(column.scope)) continue;
      const list = result.get(column.tableId) ?? [];
      list.push({
        id: column.id,
        name:
          (mode === 'physical' ? column.physical.name : column.logical.name) ||
          column.physical.name ||
          (logicalEnabled && column.logical.name) ||
          column.id,
        physicalName: column.physical.name,
        logicalName: column.logical.name,
        type:
          mode === 'physical'
            ? nativeColumnTypeDisplay(column.physical.type, doc?.enums ?? [])
            : column.logical.semanticType,
      });
      result.set(column.tableId, list);
    }
    return result;
  }, [doc, mode, logicalEnabled]);
  const tables = useMemo(
    () =>
      (canvasView === 'overview' ? (doc?.tables ?? []) : outline.tables).filter(
        (table) =>
          visible(table.scope) &&
          (domain === '*' ||
            (domain === '' ? table.domainId === null : table.domainId === domain)) &&
          (nativeInspectorMatches(search, indexes.domains.get(table.domainId ?? '')?.name) ||
            navigatorTableMatches(
              search,
              table.physical.name,
              table.logical.name,
              navigatorColumns.get(table.id) ?? [],
            )),
      ),
    [doc, outline, canvasView, mode, domain, search, indexes, navigatorColumns],
  );
  const matches = (...values: (string | undefined)[]) => nativeInspectorMatches(search, ...values);
  const filteredDomainRelations = useMemo(
    () =>
      (doc?.domainRelations ?? []).filter((relation) =>
        matches(
          relation.name,
          relation.description,
          indexes.domains.get(relation.sourceDomainId)?.name,
          indexes.domains.get(relation.targetDomainId)?.name,
        ),
      ),
    [doc, search, indexes],
  );
  const filteredTableRelations = useMemo(
    () =>
      outline.relations.filter((relation) =>
        matches(
          relation.logical.name,
          relation.logical.description,
          relation.physical?.name,
          tableName(relation.sourceTableId),
          tableName(relation.targetTableId),
        ),
      ),
    [outline, search, tableName],
  );
  const tablesByDomain = useMemo(() => {
    const groups = new Map<string | null, typeof tables>();
    for (const table of tables) {
      const group = groups.get(table.domainId) ?? [];
      group.push(table);
      groups.set(table.domainId, group);
    }
    return groups;
  }, [tables]);
  return {
    outline,
    selectedTable,
    selectedTableDomain,
    selectedTableKeys,
    selectedTableRelations,
    selectedRelation,
    selectedRows,
    tableName,
    columnName,
    navigatorColumns,
    tables,
    matches,
    filteredDomainRelations,
    filteredTableRelations,
    tablesByDomain,
  };
}
