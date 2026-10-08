import type { DocumentBase } from './document-base.js';
import {
  ensureTableCanvasLayout,
  TABLES_VIEW_ID,
  type TableCanvasDocument,
  type Position,
  type RelationLayout,
} from './document.js';

/** Consolidate shared domain annotations into the canonical canvas; personal views stay private. */
export function normalizeSharedTableCanvas<
  T extends TableCanvasDocument & Pick<DocumentBase, 'domains' | 'notes'>,
>(document: T, options: { nodeId?: (tableId: string) => string } = {}): T {
  const doc = ensureTableCanvasLayout(document, options);
  const domains = new Set(doc.domains.map((domain) => domain.id));
  const migratingNotes = new Map(
    doc.notes.filter((note) => domains.has(note.viewId)).map((note) => [note.id, note]),
  );
  const routes = doc.layout.relations ?? [];
  if (!migratingNotes.size && !routes.some((route) => domains.has(route.viewId))) return doc;
  const global = new Map(
    doc.layout.nodes
      .filter((node) => node.viewId === TABLES_VIEW_ID)
      .map((node) => [node.objectId, node]),
  );
  const offsets = new Map<string, Position>();
  for (const table of (doc.tables ?? []).toSorted((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    if (table.domainId === null || offsets.has(table.domainId)) continue;
    const source = doc.layout.nodes.find(
      (node) => node.objectId === table.id && node.viewId === table.domainId,
    );
    const destination = global.get(table.id);
    if (source && destination)
      offsets.set(table.domainId, { x: destination.x - source.x, y: destination.y - source.y });
  }
  const shift = (point: Position, viewId: string): Position => {
    const offset = offsets.get(viewId) ?? { x: 0, y: 0 };
    return {
      x: Math.max(-1e7, Math.min(1e7, point.x + offset.x)),
      y: Math.max(-1e7, Math.min(1e7, point.y + offset.y)),
    };
  };
  const chosen = new Map<string, RelationLayout>(
    routes
      .filter((route) => route.viewId === TABLES_VIEW_ID)
      .map((route) => [route.relationId, route]),
  );
  for (const route of routes
    .filter((item) => domains.has(item.viewId))
    .toSorted((a, b) => (a.viewId < b.viewId ? -1 : a.viewId > b.viewId ? 1 : 0))) {
    if (chosen.has(route.relationId)) continue;
    chosen.set(route.relationId, {
      ...route,
      viewId: TABLES_VIEW_ID,
      ...(route.bend ? { bend: shift(route.bend, route.viewId) } : {}),
      ...(route.waypoints
        ? { waypoints: route.waypoints.map((point) => shift(point, route.viewId)) }
        : {}),
    });
  }
  return {
    ...doc,
    notes: doc.notes.map((note) =>
      migratingNotes.has(note.id) ? { ...note, viewId: TABLES_VIEW_ID } : note,
    ),
    layout: {
      ...doc.layout,
      nodes: doc.layout.nodes.map((node) => {
        const note = migratingNotes.get(node.objectId);
        return note && node.viewId === note.viewId
          ? { ...node, ...shift(node, note.viewId), viewId: TABLES_VIEW_ID }
          : node;
      }),
      ...(doc.layout.relations && {
        relations: [
          ...routes.filter(
            (route) => route.viewId !== TABLES_VIEW_ID && !domains.has(route.viewId),
          ),
          ...chosen.values(),
        ],
      }),
    },
  };
}
