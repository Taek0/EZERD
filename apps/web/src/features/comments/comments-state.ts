import { TABLES_VIEW_ID, type DesignDocument } from '@ezerd/model';
export type ReviewDocument = Pick<DesignDocument, 'domains' | 'views' | 'layout'>;
export type ReviewTarget = { viewId: string; objectId: string | null; x: number; y: number };
/** Resolve legacy domain/saved-view pins against their canonical shared placements. */
export function reviewCanvasView(
  document: ReviewDocument,
  target: Pick<ReviewTarget, 'viewId' | 'objectId'>,
): string {
  if (target.viewId === 'overview' || target.viewId === TABLES_VIEW_ID) return target.viewId;
  return document.domains.some((d) => d.id === target.viewId) ||
    document.layout.nodes.some((n) => n.viewId === TABLES_VIEW_ID && n.objectId === target.objectId)
    ? TABLES_VIEW_ID
    : target.viewId;
}

export function pinVisibleInCanvas(
  document: ReviewDocument,
  target: ReviewTarget,
  viewId: string,
  visibleObjectIds?: readonly string[],
): boolean {
  return (
    reviewCanvasView(document, target) === viewId &&
    (!target.objectId || !visibleObjectIds || visibleObjectIds.includes(target.objectId))
  );
}

export function pinPosition(document: ReviewDocument, target: ReviewTarget) {
  const viewId = reviewCanvasView(document, target);
  const node = target.objectId
    ? document.layout.nodes.find((n) => n.objectId === target.objectId && n.viewId === viewId)
    : undefined;
  const missingView =
    viewId !== 'overview' &&
    viewId !== TABLES_VIEW_ID &&
    !document.domains.some((domain) => domain.id === viewId) &&
    !document.views?.some((view) => view.id === viewId);
  return {
    x: target.x + (node?.x ?? 0),
    y: target.y + (node?.y ?? 0),
    missing: missingView || (target.objectId !== null && !node),
  };
}
export function pinAttachment(
  document: ReviewDocument,
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
