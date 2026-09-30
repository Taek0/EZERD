import {
  type DesignDocument,
  type ModelScope,
  type NodeLayout,
  isVisibleInView,
} from '@ezerd/model';
import { tableCardSize } from '../tables/table-geometry.js';
import { tableRelationLabel } from './table-relation-label.js';
import { relationGeometry } from './relation-routing.js';

function firstBy<T>(values: readonly T[], key: (value: T) => string) {
  const result = new Map<string, T>();
  for (const value of values) if (!result.has(key(value))) result.set(key(value), value);
  return result;
}
const pairKey = (source: string, target: string) => [source, target].sort().join(':');

/** Pure document-space geometry, shared by the visible line and its interaction overlay. */
export function prepareTableRelations(
  doc: DesignDocument,
  viewId: string,
  viewMode: ModelScope,
  visibleNodeIds?: readonly string[],
) {
  const relations = doc.tableRelations ?? [];
  const tables = firstBy(doc.tables ?? [], (table) => table.id);
  const columns = firstBy(doc.columns ?? [], (column) => column.id);
  const viewNodes = doc.layout.nodes.filter((node) => node.viewId === viewId);
  const nodes = firstBy(viewNodes, (node) => node.objectId);
  const routes = firstBy(
    (doc.layout.relations ?? []).filter((route) => route.viewId === viewId),
    (route) => route.relationId,
  );
  const visible = visibleNodeIds ? new Set(visibleNodeIds) : undefined;
  const combined = doc.views?.find((view) => view.id === viewId);
  const domainIds = combined ? new Set(combined.domainIds) : undefined;
  const tableNodes = viewNodes.filter(
    (node) => tables.has(node.objectId) && (!visible || visible.has(node.id)),
  );
  const bounds = new Map<NodeLayout, NodeLayout>();
  const boundsFor = (node: NodeLayout) => {
    let value = bounds.get(node);
    if (!value) {
      value = { ...node, ...tableCardSize(doc, node.objectId, node.width, node.height) };
      bounds.set(node, value);
    }
    return value;
  };
  const lanes = new Map<string, { size: number; first: Map<string, number> }>();
  for (const relation of relations) {
    const key = pairKey(relation.sourceTableId, relation.targetTableId);
    const group = lanes.get(key) ?? { size: 0, first: new Map<string, number>() };
    if (!group.first.has(relation.id)) group.first.set(relation.id, group.size);
    group.size++;
    lanes.set(key, group);
  }
  return relations.map((relation) => {
    const source = tables.get(relation.sourceTableId);
    const target = tables.get(relation.targetTableId);
    const a = nodes.get(relation.sourceTableId);
    const b = nodes.get(relation.targetTableId);
    if (
      !source ||
      !target ||
      !a ||
      !b ||
      !isVisibleInView(relation.scope, viewMode) ||
      !isVisibleInView(source.scope, viewMode) ||
      !isVisibleInView(target.scope, viewMode)
    )
      return null;
    if (visible && (!visible.has(a.id) || !visible.has(b.id))) return null;
    if (viewMode === 'physical' && !relation.physical) return null;
    if (
      domainIds &&
      (source.domainId === null ||
        target.domainId === null ||
        !domainIds.has(source.domainId) ||
        !domainIds.has(target.domainId))
    )
      return null;
    const physical = viewMode !== 'logical' && !!relation.physical && relation.scope !== 'logical';
    const fullLabel = tableRelationLabel(doc, relation, columns);
    const label = fullLabel;
    const labelWidth = Math.max(
      90,
      [...label].reduce((sum, character) => sum + (character.charCodeAt(0) > 255 ? 14 : 8), 24),
    );
    const lane = lanes
      .get(pairKey(relation.sourceTableId, relation.targetTableId))!
      .first.get(relation.id)!;
    const sourceBounds = boundsFor(a);
    const targetBounds = source.id === target.id ? sourceBounds : boundsFor(b);
    const route = routes.get(relation.id);
    const offset = route?.offset ?? 0;
    const obstacles = tableNodes
      .filter((node) => node.objectId !== source.id && node.objectId !== target.id)
      .map(boundsFor);
    const geometry = relationGeometry(
      sourceBounds,
      targetBounds,
      labelWidth,
      lane,
      offset,
      route?.bend,
      obstacles,
      route,
    );

    return {
      relation,
      sourceBounds,
      targetBounds,
      obstacles,
      geometry,
      route,
      label,
      fullLabel,
      labelWidth,
      physical,
    };
  });
}
export type PreparedTableRelations = ReturnType<typeof prepareTableRelations>;
