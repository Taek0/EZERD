import {
  TABLES_VIEW_ID,
  isVisibleInView,
  type DesignDocument,
  type ModelScope,
  type Table,
} from '@ezerd/model';

export function initialCanvasView(doc: DesignDocument): string {
  return doc.domains.length ? 'overview' : TABLES_VIEW_ID;
}

/** Undefined means this view cannot create or paste tables. Null is a valid owner. */
export function tableCanvasOwner(doc: DesignDocument, viewId: string): string | null | undefined {
  if (viewId === TABLES_VIEW_ID) return null;
  return doc.domains.find((domain) => domain.id === viewId)?.id;
}

export function visibleCanvasTable(
  doc: DesignDocument,
  table: Table,
  viewId: string,
  mode: ModelScope,
): boolean {
  if (!isVisibleInView(table.scope, mode)) return false;
  if (viewId === TABLES_VIEW_ID) return true;
  const combined = doc.views?.find((view) => view.id === viewId);
  return combined
    ? table.domainId !== null && combined.domainIds.includes(table.domainId)
    : table.domainId === viewId;
}
