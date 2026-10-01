import { TABLES_VIEW_ID, type PersonalCanvasDocument } from '@ezerd/model';

/** Legacy domain/combined IDs select tables without selecting a separate layout. */
export function sharedCanvasSelection(document: PersonalCanvasDocument, viewId: string) {
  if (viewId === 'overview') return { layoutViewId: 'overview', tableIds: null };
  if (viewId === TABLES_VIEW_ID) return { layoutViewId: TABLES_VIEW_ID, tableIds: null };
  const domainIds = document.domains.some((domain) => domain.id === viewId)
    ? [viewId]
    : document.views?.find((view) => view.id === viewId)?.domainIds;
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

export function sharedCanvasNodes(document: PersonalCanvasDocument, viewId: string) {
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
