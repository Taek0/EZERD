import {
  TABLES_VIEW_ID,
  isVisibleInView,
  type DesignDocument,
  type ModelScope,
  type Table,
} from '@ezerd/model';
import {
  domainCanvasTarget,
  matchesDomainFilter,
  type DomainFilter,
} from '../domains/domain-view.js';

export function initialCanvasView(_doc: DesignDocument): string {
  return TABLES_VIEW_ID;
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
  filter?: DomainFilter,
): boolean {
  if (!isVisibleInView(table.scope, mode)) return false;
  if (viewId === 'overview') return false;
  return matchesDomainFilter(
    table,
    filter === undefined ? domainCanvasTarget(doc, viewId).filter : filter,
  );
}
