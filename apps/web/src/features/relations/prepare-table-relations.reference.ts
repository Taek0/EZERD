// Test-only reference frozen from 5f6479a; not imported by the application.
import { type DesignDocument, type ModelScope, isVisibleInView } from '@ezerd/model';
import { tableCardSize } from '../tables/table-geometry.js';
import { tableRelationLabel } from './table-relation-label.js';
import { relationGeometry } from './relation-routing.js';

/** Pure document-space geometry, shared by the visible line and its interaction overlay. */
export function prepareTableRelationsReference(
  doc: DesignDocument,
  viewId: string,
  viewMode: ModelScope,
  visibleNodeIds?: readonly string[],
) {
  return (doc.tableRelations ?? []).map((relation) => {
    const source = doc.tables?.find((table) => table.id === relation.sourceTableId);
    const target = doc.tables?.find((table) => table.id === relation.targetTableId);
    const a = doc.layout.nodes.find(
      (node) => node.objectId === relation.sourceTableId && node.viewId === viewId,
    );
    const b = doc.layout.nodes.find(
      (node) => node.objectId === relation.targetTableId && node.viewId === viewId,
    );
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
    if (visibleNodeIds && (!visibleNodeIds.includes(a.id) || !visibleNodeIds.includes(b.id)))
      return null;
    if (viewMode === 'physical' && !relation.physical) return null;
    const combined = doc.views?.find((view) => view.id === viewId);
    if (
      combined &&
      (source.domainId === null ||
        target.domainId === null ||
        !combined.domainIds.includes(source.domainId) ||
        !combined.domainIds.includes(target.domainId))
    )
      return null;
    const physical = viewMode !== 'logical' && !!relation.physical && relation.scope !== 'logical';
    const fullLabel = tableRelationLabel(doc, relation);
    const label = fullLabel;
    const labelWidth = Math.max(
      90,
      [...label].reduce((sum, character) => sum + (character.charCodeAt(0) > 255 ? 14 : 8), 24),
    );
    const pair = (doc.tableRelations ?? []).filter(
      (r) =>
        [r.sourceTableId, r.targetTableId].sort().join(':') ===
        [relation.sourceTableId, relation.targetTableId].sort().join(':'),
    );
    const sourceBounds = { ...a, ...tableCardSize(doc, source.id, a.width, a.height) };
    const targetBounds =
      source.id === target.id
        ? sourceBounds
        : { ...b, ...tableCardSize(doc, target.id, b.width, b.height) };
    const route = doc.layout.relations?.find(
      (item) => item.relationId === relation.id && item.viewId === viewId,
    );
    const offset = route?.offset ?? 0;
    const obstacles = doc.layout.nodes
      .filter(
        (n) =>
          n.viewId === viewId &&
          n.objectId !== source.id &&
          n.objectId !== target.id &&
          doc.tables?.some((t) => t.id === n.objectId) &&
          (!visibleNodeIds || visibleNodeIds.includes(n.id)),
      )
      .map((n) => ({ ...n, ...tableCardSize(doc, n.objectId, n.width, n.height) }));
    const geometry = relationGeometry(
      sourceBounds,
      targetBounds,
      labelWidth,
      pair.findIndex((r) => r.id === relation.id),
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
