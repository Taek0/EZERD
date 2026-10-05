import {
  nativePersonalCanvasCommandSchema,
  relationLayoutSchema,
  type NativePersonalCanvasCommand,
} from '@ezerd/contracts';
import type { NativeDesignDocument, RelationLayout } from '@ezerd/model';
import type { nativeCanvasScene } from './NativeERDCanvas.js';
import {
  moveRelationSegment,
  relationAnchorAtPoint,
  relationGeometry,
  type Point,
} from '../relations/relation-routing.js';
export type NativeRouteScene = ReturnType<typeof nativeCanvasScene>;
export const nativeRouteKey = (viewId: string, relationId: string) =>
  `canvas:route:${JSON.stringify([viewId, relationId])}`;
export function nativeRouteCommand(
  document: NativeDesignDocument,
  viewId: string,
  relationId: string,
  raw: string,
  reset = false,
): NativePersonalCanvasCommand {
  if (!document.tableRelations?.some((r) => r.id === relationId))
    throw Error('document.object-not-found');
  if (reset)
    return nativePersonalCanvasCommandSchema.parse({
      type: 'delete_relation_layout',
      relationId,
      viewId,
    });
  const route = relationLayoutSchema.parse(JSON.parse(raw));
  if (route.relationId !== relationId || route.viewId !== viewId)
    throw Error('canvas.route-context-changed');
  return nativePersonalCanvasCommandSchema.parse({ type: 'upsert_relation_layout', value: route });
}
export function nativeRouteGeometry(
  scene: NativeRouteScene,
  relationId: string,
  route: RelationLayout,
) {
  const item = scene.relations.find((item) => item.relation.id === relationId);
  if (!item) throw Error('canvas.route-not-visible');
  const source = scene.nodes.find((n) => n.objectId === item.relation.sourceTableId)!;
  const target = scene.nodes.find((n) => n.objectId === item.relation.targetTableId)!;
  const { points } = item.geometry;
  return relationGeometry(
    source,
    target,
    Math.max(90, item.label.length * 8 + 24),
    scene.relations.indexOf(item),
    route.offset,
    route.bend,
    scene.nodes.filter((n) => n !== source && n !== target),
    {
      ...route,
      sourceAnchor: route.sourceAnchor ?? relationAnchorAtPoint(source, points[0]!),
      targetAnchor: route.targetAnchor ?? relationAnchorAtPoint(target, points.at(-1)!),
    },
  );
}
export function nativeRouteDrag(
  scene: NativeRouteScene,
  relationId: string,
  route: RelationLayout,
  points: Point[],
  kind: number | 'source' | 'target',
  point: Point,
  start: Point,
): RelationLayout {
  const item = scene.relations.find((item) => item.relation.id === relationId);
  if (!item) throw Error('canvas.route-not-visible');
  const source = scene.nodes.find((n) => n.objectId === item.relation.sourceTableId)!;
  const target = scene.nodes.find((n) => n.objectId === item.relation.targetTableId)!;
  if (kind === 'source' || kind === 'target')
    return relationLayoutSchema.parse({
      ...route,
      [kind === 'source' ? 'sourceAnchor' : 'targetAnchor']: relationAnchorAtPoint(
        kind === 'source' ? source : target,
        point,
      ),
    });
  const a = points[kind],
    b = points[kind + 1];
  if (!a || !b) return route;
  const moved = moveRelationSegment(
    points,
    kind,
    a.y === b.y ? point.y - start.y : point.x - start.x,
    scene.nodes,
  );
  return relationLayoutSchema.parse({
    ...route,
    bend: undefined,
    sourceAnchor: relationAnchorAtPoint(source, moved[0]!),
    targetAnchor: relationAnchorAtPoint(target, moved.at(-1)!),
    waypoints: moved.slice(1, -1),
  });
}
