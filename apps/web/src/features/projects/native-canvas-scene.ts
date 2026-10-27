import { nodeLayoutSchema } from '@ezerd/contracts';
import {
  createNativeTableCanvasMetrics,
  TABLES_VIEW_ID,
  basicCardSize,
  isVisibleInView,
  type NativeDesignDocument,
  type NodeLayout,
} from '@ezerd/model';
import type { NativeDomainFilterValue } from './NativeDomainFilter.js';
import { nativeTableCanvasHeaderHeight, nativeRelationLabelWidth } from './native-canvas-style.js';
import { nativeCanvasDraftPlacements } from './native-canvas-selection.js';
import {
  routeNativeScene,
  validNativeSceneRoutingResult,
  type NativeSceneRoutingInput,
  type NativeSceneGeometry,
  type NativeSceneRoutingCache,
} from './native-ghost-routing.js';
export { createNativeSceneRoutingCache } from './native-ghost-routing.js';
const limit = (value: number) =>
  Math.max(nodeLayoutSchema.shape.x.minValue!, Math.min(nodeLayoutSchema.shape.x.maxValue!, value));
const viewFor = (_doc: NativeDesignDocument, viewId: string) =>
  viewId === 'overview' ? 'overview' : TABLES_VIEW_ID;
const sceneMetrics = new WeakMap<object, ReturnType<typeof createNativeTableCanvasMetrics>>();
export const nativeCanvasSceneMetrics = (scene: object) => sceneMetrics.get(scene);
/** Preview nodes can be reader-generated. Persist a real reference before moving an absent raw node. */
export function prepareNativeCanvasScene(
  document: NativeDesignDocument,
  viewId: string,
  mode: 'physical' | 'logical',
  filter?: NativeDomainFilterValue | null,
  metricsFor = createNativeTableCanvasMetrics(document, mode),
) {
  const view = viewFor(document, viewId);
  // Placement changes still reroute every edge, but card measurements are shared by its ports.
  const tablesById = new Map((document.tables ?? []).map((table) => [table.id, table]));
  const domainIds = new Set(document.domains.map((domain) => domain.id));
  const noteIds = new Set(
    document.notes.filter((note) => note.viewId === view).map((note) => note.id),
  );
  const routesByRelation = new Map<
    string,
    NonNullable<NativeDesignDocument['layout']['relations']>[number]
  >();
  for (const route of document.layout.relations ?? [])
    if (route.viewId === view && !routesByRelation.has(route.relationId))
      routesByRelation.set(route.relationId, route);
  const sceneNodes = [...document.layout.nodes];
  if (view === 'overview') {
    const ids = new Set(sceneNodes.map((node) => node.id));
    const bottom = sceneNodes
      .filter((node) => node.viewId === view)
      .reduce(
        (max, node) =>
          Math.max(max, node.y + basicCardSize('domain', node.width, node.height).height),
        -240,
      );
    document.domains
      .filter(
        (domain) => !sceneNodes.some((node) => node.viewId === view && node.objectId === domain.id),
      )
      .forEach((domain, index) => {
        let id = `native-domain-preview:${index}`;
        while (ids.has(id)) id += ':';
        ids.add(id);
        sceneNodes.push({
          id,
          objectId: domain.id,
          viewId: view,
          x: (index % 3) * 280,
          y: limit(bottom + 280 + Math.floor(index / 3) * 250),
          width: 240,
          height: 210,
        });
      });
  }
  const nodes = sceneNodes
    .filter((node) => {
      if (node.viewId !== view) return false;
      const table = tablesById.get(node.objectId);
      if (table)
        return (
          view !== 'overview' &&
          (!filter ||
            (table.domainId === null
              ? filter.unassigned
              : filter.domainIds.includes(table.domainId))) &&
          isVisibleInView(table.scope, mode) &&
          (!domainIds.has(viewId) || table.domainId === viewId)
        );
      return noteIds.has(node.objectId) || (view === 'overview' && domainIds.has(node.objectId));
    })
    .map((node) => {
      const table = tablesById.get(node.objectId);
      const kind = table ? 'table' : domainIds.has(node.objectId) ? 'domain' : 'note';
      const size = basicCardSize(kind, node.width, node.height);
      const metrics = table ? metricsFor(table) : null;
      // Native labels drive rows; no v1 type/DDL/metrics adapter is involved.
      return {
        ...node,
        width: Math.min(
          nodeLayoutSchema.shape.width.maxValue!,
          Math.max(size.width, metrics?.width ?? size.width),
        ),
        height: Math.min(
          nodeLayoutSchema.shape.height.maxValue!,
          Math.max(size.height, metrics?.height ?? size.height),
        ),
      };
    });
  const byObject = new Map(nodes.map((node) => [node.objectId, node]));
  const routingRelations: NativeSceneRoutingInput['relations'] = [];
  const indexByNode = new Map(nodes.map((node, index) => [node, index]));
  const relations = (document.tableRelations ?? []).flatMap((relation, lane) => {
    const source = byObject.get(relation.sourceTableId),
      target = byObject.get(relation.targetTableId);
    if (
      !source ||
      !target ||
      !isVisibleInView(relation.scope, mode) ||
      (mode === 'physical' && !relation.physical)
    )
      return [];
    const route = routesByRelation.get(relation.id);
    const label = mode === 'physical' ? (relation.physical?.name ?? '') : relation.logical.name;
    const columnAnchor = (
      node: NodeLayout,
      columnId: string | undefined,
      side: 'left' | 'right',
    ) => {
      const table = tablesById.get(node.objectId)!;
      const rows = metricsFor(table).rows;
      const index = rows.findIndex((row) => row.column.id === columnId);
      return index < 0
        ? undefined
        : {
            side,
            ratio: Math.max(
              0,
              Math.min(
                1,
                (nativeTableCanvasHeaderHeight +
                  rows.slice(0, index).reduce((height, row) => height + row.height, 0) +
                  rows[index]!.height / 2) /
                  node.height,
              ),
            ),
          };
    };
    const towardRight = target.x >= source.x;
    const sourceAnchor =
      route?.sourceAnchor ??
      (mode === 'physical'
        ? columnAnchor(
            source,
            relation.physical?.sourceColumnIds[0],
            towardRight ? 'right' : 'left',
          )
        : undefined);
    const targetAnchor =
      route?.targetAnchor ??
      (mode === 'physical'
        ? columnAnchor(
            target,
            relation.physical?.targetColumnIds[0],
            towardRight ? 'left' : 'right',
          )
        : undefined);
    routingRelations.push({
      source: indexByNode.get(source)!,
      target: indexByNode.get(target)!,
      labelWidth: nativeRelationLabelWidth(label),
      lane,
      offset: route?.offset ?? 0,
      ...(route?.bend ? { bend: route.bend } : {}),
      options: {
        ...(route?.waypoints ? { waypoints: route.waypoints } : {}),
        ...(sourceAnchor ? { sourceAnchor } : {}),
        ...(targetAnchor ? { targetAnchor } : {}),
      },
    });
    return [{ relation, label }];
  });
  return {
    nodes,
    relations,
    viewId: view,
    metricsFor,
    routing: {
      bounds: nodes.map(({ x, y, width, height }) => ({ x, y, width, height })),
      relations: routingRelations,
    },
  };
}

export type PreparedNativeCanvasScene = ReturnType<typeof prepareNativeCanvasScene>;
const sceneRoutingCaches = new WeakMap<object, NativeSceneRoutingCache>();

/** Attach current relation objects and content metrics without routing on the main thread. */
export function completeNativeCanvasScene(
  prepared: PreparedNativeCanvasScene,
  geometries: NativeSceneGeometry[] = routeNativeScene(prepared.routing),
  cache?: NativeSceneRoutingCache,
) {
  if (
    !validNativeSceneRoutingResult(geometries, prepared.routing.relations.length, prepared.routing)
  )
    throw Error('canvas.placement-invalid');
  const scene = {
    nodes: prepared.nodes,
    relations: prepared.relations.map((relation, index) => ({
      ...relation,
      geometry: geometries[index]!,
    })),
    viewId: prepared.viewId,
  };
  sceneMetrics.set(scene, prepared.metricsFor);
  if (cache) {
    cache.set(prepared.routing, geometries);
    sceneRoutingCaches.set(scene, cache);
  }
  return scene;
}

/** Geometry cache is exact, bounded, and independent of document/layout identity. */
export function nativeCanvasScene(
  document: NativeDesignDocument,
  viewId: string,
  mode: 'physical' | 'logical',
  filter?: NativeDomainFilterValue | null,
  metricsFor = createNativeTableCanvasMetrics(document, mode),
  cache?: NativeSceneRoutingCache,
) {
  const prepared = prepareNativeCanvasScene(document, viewId, mode, filter, metricsFor);
  return completeNativeCanvasScene(prepared, cache?.get(prepared.routing), cache);
}

/** Prepare final group placements, including reader-generated nodes, without routing. */
export function prepareNativeCanvasPlacementScene(
  document: NativeDesignDocument,
  scene: ReturnType<typeof nativeCanvasScene>,
  viewId: string,
  mode: 'physical' | 'logical',
  placements: NodeLayout[],
  filter?: NativeDomainFilterValue | null,
) {
  const byId = new Map(placements.map((node) => [node.id, node]));
  const rawIds = new Set(document.layout.nodes.map((node) => node.id));
  const originals = [
    ...document.layout.nodes,
    ...scene.nodes.filter((node) => !rawIds.has(node.id)),
  ];
  return prepareNativeCanvasScene(
    {
      ...document,
      layout: { ...document.layout, nodes: originals.map((node) => byId.get(node.id) ?? node) },
    },
    viewId,
    mode,
    filter,
    sceneMetrics.get(scene),
  );
}

/** Reuse the base scene unless a persisted node in this view has a changed draft position. */
export function nativeCanvasDraftScene(
  document: NativeDesignDocument,
  scene: ReturnType<typeof nativeCanvasScene>,
  viewId: string,
  mode: 'physical' | 'logical',
  objectId?: string,
  x?: string,
  y?: string,
  filter?: NativeDomainFilterValue | null,
  width?: string,
  height?: string,
) {
  const moved = scene.nodes.find((node) => node.objectId === objectId);
  if (
    !moved ||
    !document.layout.nodes.some((node) => node.id === moved.id) ||
    (moved.x === Number(x) &&
      moved.y === Number(y) &&
      (width === undefined || moved.width === Number(width)) &&
      (height === undefined || moved.height === Number(height)))
  )
    return scene;
  const displayed = new Map(
    scene.nodes.map((node) => [
      node.id,
      node.objectId === objectId
        ? {
            ...node,
            x: Number(x),
            y: Number(y),
            ...(width === undefined ? {} : { width: Number(width) }),
            ...(height === undefined ? {} : { height: Number(height) }),
          }
        : node,
    ]),
  );
  return nativeCanvasScene(
    {
      ...document,
      layout: {
        ...document.layout,
        nodes: document.layout.nodes.map((node) => displayed.get(node.id) ?? node),
      },
    },
    viewId,
    mode,
    filter,
    sceneMetrics.get(scene),
    sceneRoutingCaches.get(scene),
  );
}
/** Choose group or single preview before routing, retaining malformed-draft recovery. */
export function nativeCanvasPlacementDraftScene(
  document: NativeDesignDocument,
  scene: ReturnType<typeof nativeCanvasScene>,
  viewId: string,
  mode: 'physical' | 'logical',
  values: Record<string, string>,
  filter?: NativeDomainFilterValue | null,
) {
  if (values.nodesJSON) {
    try {
      const placements = new Map(
        nativeCanvasDraftPlacements(values).map((node) => [node.id, node]),
      );
      const originals = [
        ...document.layout.nodes,
        ...scene.nodes.filter((node) => !document.layout.nodes.some((raw) => raw.id === node.id)),
      ];
      const display = {
        ...document,
        layout: {
          ...document.layout,
          nodes: originals.map((node) => placements.get(node.id) ?? node),
        },
      };
      const result = nativeCanvasScene(
        display,
        viewId,
        mode,
        filter,
        sceneMetrics.get(scene),
        sceneRoutingCaches.get(scene),
      );
      result.nodes = result.nodes.map((node) => placements.get(node.id) ?? node);
      return result;
    } catch {
      // Corrupt group drafts retain the existing single-node recovery preview.
    }
  }
  return nativeCanvasDraftScene(
    document,
    scene,
    viewId,
    mode,
    values.objectId,
    values.x,
    values.y,
    filter,
    values.width,
    values.height,
  );
}
