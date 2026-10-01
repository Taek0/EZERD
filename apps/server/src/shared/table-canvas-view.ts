import { TABLES_VIEW_ID, type PersonalCanvasDocument } from '@ezerd/model';

/** Shared aliases use canonical coordinates; explicitly authenticated personal views keep their own. */
export function sharedCanvasSelection(
  document: PersonalCanvasDocument,
  viewId: string,
  personalViewIds: readonly string[] = [],
) {
  if (viewId === 'overview') return { layoutViewId: 'overview', tableIds: null };
  if (viewId === TABLES_VIEW_ID) return { layoutViewId: TABLES_VIEW_ID, tableIds: null };
  const domainIds = document.domains.some((domain) => domain.id === viewId)
    ? [viewId]
    : document.views?.find((view) => view.id === viewId)?.domainIds;
  if (!domainIds) return undefined;
  return {
    layoutViewId:
      personalViewIds.includes(viewId) && document.views?.some((view) => view.id === viewId)
        ? viewId
        : TABLES_VIEW_ID,
    tableIds: new Set(
      (document.tables ?? [])
        .filter((table) => table.domainId !== null && domainIds.includes(table.domainId))
        .map((table) => table.id),
    ),
  };
}

export function sharedCanvasNodes(
  document: PersonalCanvasDocument,
  viewId: string,
  personalViewIds: readonly string[] = [],
) {
  const selection = sharedCanvasSelection(document, viewId, personalViewIds);
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
