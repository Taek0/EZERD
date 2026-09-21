import { type DesignDocument, updateNodeLayout } from '@ezerd/model';
export type SelectionPoint = { x: number; y: number };
export function selectionRect(a: SelectionPoint, b: SelectionPoint) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}
export function intersectingObjects(
  rect: ReturnType<typeof selectionRect>,
  nodes: { objectId: string; x: number; y: number; width: number; height: number }[],
) {
  if (!rect.width || !rect.height) return [];
  return nodes
    .filter(
      (n) =>
        n.x < rect.x + rect.width &&
        n.x + n.width > rect.x &&
        n.y < rect.y + rect.height &&
        n.y + n.height > rect.y,
    )
    .map((n) => n.objectId);
}
export function translateSelectedNodes(
  doc: DesignDocument,
  origins: { id: string; x: number; y: number }[],
  dx: number,
  dy: number,
) {
  let next = doc;
  for (const n of origins) {
    if (!next.layout.nodes.some((row) => row.id === n.id)) continue;
    next = updateNodeLayout(next, n.id, {
      x: Math.max(-1e7, Math.min(1e7, n.x + dx)),
      y: Math.max(-1e7, Math.min(1e7, n.y + dy)),
    });
  }
  return next;
}
