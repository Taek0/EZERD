import type {
  DesignDocument,
  CombinedView,
  Note,
  NodeLayout,
  Viewport,
  RelationLayout,
} from './document.js';
import { TABLES_VIEW_ID } from './document.js';
import type { TableCanvasDocument } from './document.js';

export interface PersonalCanvasDocument
  extends TableCanvasDocument, Pick<DesignDocument, 'domains' | 'views' | 'notes'> {
  tableRelations?:
    readonly { id: string; sourceTableId: string; targetTableId: string }[] | undefined;
}

export interface PersonalState {
  views: CombinedView[];
  notes: Note[];
  nodes: NodeLayout[];
  viewports: Viewport[];
  relations: RelationLayout[];
}

export function extractPersonalState(document: PersonalCanvasDocument): PersonalState {
  const combinedIds = new Set((document.views ?? []).map((view) => view.id));
  return {
    views: document.views ?? [],
    notes: document.notes.filter((note) => combinedIds.has(note.viewId)),
    nodes: document.layout.nodes.filter((node) => combinedIds.has(node.viewId)),
    viewports: document.layout.viewports,
    relations: (document.layout.relations ?? []).filter((route) => combinedIds.has(route.viewId)),
  };
}

export function mergeStoredPersonalState<T extends PersonalCanvasDocument>(
  shared: T,
  personal: PersonalState,
): T {
  const combinedIds = new Set([...(shared.views ?? []), ...personal.views].map((view) => view.id));
  return {
    ...shared,
    views: personal.views,
    notes: [...shared.notes.filter((note) => !combinedIds.has(note.viewId)), ...personal.notes],
    layout: {
      ...shared.layout,
      nodes: [
        ...shared.layout.nodes.filter((node) => !combinedIds.has(node.viewId)),
        ...personal.nodes,
      ],
      viewports: personal.viewports,
      relations: [
        ...(shared.layout.relations ?? []).filter((route) => !combinedIds.has(route.viewId)),
        ...personal.relations,
      ],
    },
  };
}

export function reconcilePersonalState(
  shared: PersonalCanvasDocument,
  personal: PersonalState,
): PersonalState {
  const domainIds = new Set(shared.domains.map((domain) => domain.id));
  const tables = new Map((shared.tables ?? []).map((table) => [table.id, table]));
  const views = personal.views
    .map((view) => ({
      ...view,
      domainIds: view.domainIds.filter((id) => domainIds.has(id)),
    }))
    .filter((view) => view.domainIds.length > 0);
  const viewIds = new Set(views.map((view) => view.id));
  const notes = personal.notes.filter((note) => viewIds.has(note.viewId));
  const notePairs = new Set(notes.map((note) => JSON.stringify([note.viewId, note.id])));
  const nodes = personal.nodes.filter((node) => {
    const view = views.find((item) => item.id === node.viewId);
    if (!view) return false;
    const table = tables.get(node.objectId);
    return (
      notePairs.has(JSON.stringify([node.viewId, node.objectId])) ||
      (!!table && table.domainId !== null && view.domainIds.includes(table.domainId))
    );
  });
  const nodePairs = new Set(nodes.map((node) => JSON.stringify([node.viewId, node.objectId])));
  const relations = personal.relations.filter((route) => {
    const relation = shared.tableRelations?.find((item) => item.id === route.relationId);
    return (
      !!relation &&
      viewIds.has(route.viewId) &&
      nodePairs.has(JSON.stringify([route.viewId, relation.sourceTableId])) &&
      nodePairs.has(JSON.stringify([route.viewId, relation.targetTableId]))
    );
  });
  const validViewIds = new Set(['overview', TABLES_VIEW_ID, ...domainIds, ...viewIds]);
  return {
    views,
    notes,
    nodes,
    viewports: personal.viewports.filter((viewport) => validViewIds.has(viewport.viewId)),
    relations,
  };
}
