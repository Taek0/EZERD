import type { DesignDocument } from '@ezerd/model';
export type ReviewTarget = { viewId: string; objectId: string | null; x: number; y: number };
export function pinPosition(document: DesignDocument, target: ReviewTarget) {
  const node = target.objectId
    ? document.layout.nodes.find(
        (n) => n.objectId === target.objectId && n.viewId === target.viewId,
      )
    : undefined;
  const missingView =
    target.viewId !== 'overview' &&
    !document.domains.some((domain) => domain.id === target.viewId) &&
    !document.views?.some((view) => view.id === target.viewId);
  return {
    x: target.x + (node?.x ?? 0),
    y: target.y + (node?.y ?? 0),
    missing: missingView || (target.objectId !== null && !node),
  };
}
export function pinAttachment(
  document: DesignDocument,
  viewId: string,
  objectId: string | null,
  point: { x: number; y: number },
) {
  const node = document.layout.nodes.find((n) => n.objectId === objectId && n.viewId === viewId);
  return {
    objectId: node ? objectId : null,
    x: point.x - (node?.x ?? 0),
    y: point.y - (node?.y ?? 0),
  };
}
export function selectedMentions(ids: string[], users: { id: string }[]) {
  const valid = new Set(users.map((u) => u.id));
  return [...new Set(ids)].filter((id) => valid.has(id));
}
export class LatestRequest {
  private sequence = 0;
  begin() {
    return ++this.sequence;
  }
  isCurrent(sequence: number) {
    return this.sequence === sequence;
  }
}
