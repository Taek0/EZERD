import { nativeEditorCommandSchema, type NativeEditorCommand } from '@ezerd/contracts';
import {
  autoLayoutView,
  TABLES_VIEW_ID,
  type NativeDesignDocument,
  type NodeLayout,
  type Viewport,
} from '@ezerd/model';
import { nativeDurableId } from './native-durable-queue.js';

export function nativeCanvasMoveCommand(
  source: NativeDesignDocument,
  displayed: NodeLayout,
  patch: Pick<NodeLayout, 'x' | 'y'> & Partial<Pick<NodeLayout, 'width' | 'height'>>,
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
    placement: { width: displayed.width, height: displayed.height, ...patch },
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

/** The original flow layout is given only the visible scene, never hidden nodes. */
export function nativeAutoLayoutPlacements(
  source: NativeDesignDocument,
  nodes: NodeLayout[],
  viewId: string,
): NodeLayout[] {
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
