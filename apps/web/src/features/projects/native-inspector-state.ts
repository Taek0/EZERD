import { isVisibleInView, type NativeDesignDocument, type NodeLayout } from '@ezerd/model';
import type { NativeDomainFilterValue } from './NativeDomainFilter.js';
export interface NativeCanvasScope {
  viewId: string;
  filter: NativeDomainFilterValue | null;
  visibleObjectIds: string[];
  selectedObjectId: string | null;
  selectedNode: NodeLayout | null;
}
export function nativeInspectorMatches(query: string, ...values: (string | undefined)[]) {
  const normalized = query.trim().toLocaleLowerCase();
  return !normalized || values.some((value) => value?.toLocaleLowerCase().includes(normalized));
}
export function nativeInspectorOutline(
  document: NativeDesignDocument,
  mode: 'physical' | 'logical',
  scope: NativeCanvasScope | null,
  viewId: string,
) {
  const visible = scope ? new Set(scope.visibleObjectIds) : null;
  const tables = (document.tables ?? []).filter(
    (table) =>
      isVisibleInView(table.scope, mode) &&
      (visible
        ? visible.has(table.id)
        : !document.domains.some((domain) => domain.id === viewId) || table.domainId === viewId),
  );
  const tableIds = new Set(tables.map((table) => table.id));
  const relations = (document.tableRelations ?? []).filter(
    (relation) =>
      isVisibleInView(relation.scope, mode) &&
      (visible?.has(relation.id) ||
        (tableIds.has(relation.sourceTableId) && tableIds.has(relation.targetTableId))),
  );
  return { tables, relations };
}
export function nativeInspectorLocation(
  document: NativeDesignDocument,
  viewId: string,
  filter: NativeDomainFilterValue | null,
  allTables: string,
  domainMap: string,
  unassigned: string,
  empty: string,
) {
  const name =
    viewId === 'overview'
      ? domainMap
      : (document.domains.find((item) => item.id === viewId)?.name ??
        document.views?.find((item) => item.id === viewId)?.name ??
        allTables);
  if (viewId !== '__tables__' || !filter) return name;
  const names = [
    ...document.domains
      .filter((domain) => filter.domainIds.includes(domain.id))
      .map((domain) => domain.name),
    ...(filter.unassigned ? [unassigned] : []),
  ];
  return `${name} · ${names.join(' · ') || empty}`;
}
export function nativeInspectorSaveStatus(input: {
  offline: boolean;
  saving: boolean;
  initializing: boolean;
  pending: boolean;
  durable: string;
  dirty: boolean;
  error: boolean;
}) {
  if (input.error || input.pending || input.durable === 'unknown' || input.durable === 'pending')
    return 'attention';
  if (input.saving || input.initializing || input.durable === 'sending') return 'saving';
  if (input.offline) return 'offline';
  if (input.dirty) return 'draft';
  return 'snapshot';
}
