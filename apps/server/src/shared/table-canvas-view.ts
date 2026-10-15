import { TABLES_VIEW_ID, type CanvasDocument } from '@ezerd/model';

/** Shared domain filters use canonical table-canvas coordinates. */
export function sharedCanvasSelection(document: CanvasDocument, viewId: string) {
  if (viewId === 'overview') return { layoutViewId: 'overview', tableIds: null };
  if (viewId === TABLES_VIEW_ID) return { layoutViewId: TABLES_VIEW_ID, tableIds: null };
  const domainIds = document.domains.some((domain) => domain.id === viewId) ? [viewId] : undefined;
  if (!domainIds) return undefined;
  return {
    layoutViewId: TABLES_VIEW_ID,
    tableIds: new Set(
      (document.tables ?? [])
        .filter((table) => table.domainId !== null && domainIds.includes(table.domainId))
        .map((table) => table.id),
    ),
  };
}

export function sharedCanvasNodes(document: CanvasDocument, viewId: string) {
  const selection = sharedCanvasSelection(document, viewId);
  if (!selection) return [];
  const noteIds = new Set(
    document.notes.filter((note) => note.viewId === selection.layoutViewId).map((note) => note.id),
  );
  return document.layout.nodes.filter(
    (node) =>
      node.viewId === selection.layoutViewId &&
      (selection.tableIds === null ||
        selection.tableIds.has(node.objectId) ||
        noteIds.has(node.objectId)),
  );
}
