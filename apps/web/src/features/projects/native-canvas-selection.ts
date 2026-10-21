import { nativeEditorCommandSchema, type NativeEditorCommand } from '@ezerd/contracts';
import {
  autoLayoutView,
  arrangeNativeTableNodes,
  isVisibleInView,
  TABLES_VIEW_ID,
  type NativeDesignDocument,
  type NodeLayout,
  type Viewport,
} from '@ezerd/model';
import { nativeDurableId } from './native-durable-queue.js';

export function nativeCanvasMoveCommand(
  source: NativeDesignDocument,
  displayed: NodeLayout,
  patch: Partial<Pick<NodeLayout, 'x' | 'y' | 'width' | 'height'>>,
): NativeEditorCommand {
  const raw = source.layout.nodes.find(
    (node) => node.objectId === displayed.objectId && node.viewId === displayed.viewId,
  );
  if (raw)
    return nativeEditorCommandSchema.parse({ type: 'update_node_layout', nodeId: raw.id, patch });
  if (!source.tables?.some((table) => table.id === displayed.objectId))
    throw Error('canvas.node-not-found');
  return nativeEditorCommandSchema.parse({
    type: 'add_table_reference',
    tableId: displayed.objectId,
    viewId: displayed.viewId,
    nodeId: nativeDurableId(),
    placement: {
      x: displayed.x,
      y: displayed.y,
      width: displayed.width,
      height: displayed.height,
      ...patch,
    },
  });
}

/** Clamp a group as a whole, preserving the relative positions of selected nodes. */
export function nativeSelectionPlacements(
  nodes: NodeLayout[],
  dx: number,
  dy: number,
): NodeLayout[] {
  if (!nodes.length || !Number.isFinite(dx) || !Number.isFinite(dy)) return [];
  dx = Math.max(
    -1e7 - Math.min(...nodes.map((n) => n.x)),
    Math.min(1e7 - Math.max(...nodes.map((n) => n.x)), dx),
  );
  dy = Math.max(
    -1e7 - Math.min(...nodes.map((n) => n.y)),
    Math.min(1e7 - Math.max(...nodes.map((n) => n.y)), dy),
  );
  return nodes.map((node) => ({ ...node, x: node.x + dx, y: node.y + dy }));
}

/** Worker payload contains measured visible cards and scoped edges only. */
export function nativeTableLayoutInput(
  source: NativeDesignDocument,
  nodes: NodeLayout[],
  mode: 'physical' | 'logical' = 'physical',
) {
  const tables = new Set(
    (source.tables ?? [])
      .filter((table) => isVisibleInView(table.scope, mode))
      .map((table) => table.id),
  );
  const visible = nodes.filter((node) => tables.has(node.objectId));
  const ids = new Set(visible.map((node) => node.objectId));
  const notes = new Set(source.notes.map((note) => note.id));
  const bottoms = nodes
    .filter((node) => notes.has(node.objectId))
    .map((node) => node.y + node.height + 200);
  const minY = visible.length ? Math.min(...visible.map((node) => node.y)) : 0;
  const shift = Math.max(0, ...bottoms.map((bottom) => bottom - minY));
  return {
    nodes: visible.map((node) => ({ ...node, y: node.y + shift })),
    relations: (source.tableRelations ?? [])
      .filter(
        (relation) =>
          isVisibleInView(relation.scope, mode) &&
          (mode !== 'physical' || relation.physical !== null) &&
          ids.has(relation.sourceTableId) &&
          ids.has(relation.targetTableId),
      )
      .map(({ sourceTableId, targetTableId }) => ({ sourceTableId, targetTableId })),
  };
}

/** Overview preserves the domain layout; table views use measured compact placement. */
export function nativeAutoLayoutPlacements(
  source: NativeDesignDocument,
  nodes: NodeLayout[],
  viewId: string,
  mode: 'physical' | 'logical' = 'physical',
): NodeLayout[] {
  if (viewId !== 'overview') {
    const input = nativeTableLayoutInput(source, nodes, mode);
    return arrangeNativeTableNodes(input.nodes, input.relations);
  }
  const view = source.domains.some((d) => d.id === viewId) ? TABLES_VIEW_ID : viewId;
  const ids = new Set(nodes.map((node) => node.objectId));
  const document = {
    ...source,
    tables: source.tables?.filter((table) => ids.has(table.id)),
    layout: { ...source.layout, nodes: nodes.map((node) => ({ ...node, viewId: view })) },
  };
  const next = autoLayoutView(document, view);
  return next.layout.nodes.filter(
    (node) => !source.notes.some((note) => note.id === node.objectId),
  );
}

export function nativeZoomAt(
  camera: Viewport,
  zoom: number,
  point: { x: number; y: number },
): Viewport {
  return {
    ...camera,
    zoom,
    x: point.x - ((point.x - camera.x) * zoom) / camera.zoom,
    y: point.y - ((point.y - camera.y) * zoom) / camera.zoom,
  };
}

export function nativeCanvasDraftPlacements(values: Record<string, string>): NodeLayout[] {
  if (!values.nodesJSON) return [];
  // Node shape is verified by the existing strict layout command schemas at submit time.
  const nodes: unknown = JSON.parse(values.nodesJSON);
  if (
    !Array.isArray(nodes) ||
    nodes.length > 100 ||
    nodes.some(
      (node) =>
        !node ||
        typeof node !== 'object' ||
        typeof node.id !== 'string' ||
        typeof node.objectId !== 'string' ||
        typeof node.viewId !== 'string' ||
        ![node.x, node.y, node.width, node.height].every(Number.isFinite),
    )
  )
    throw Error('canvas.placement-invalid');
  return nodes as NodeLayout[];
}
