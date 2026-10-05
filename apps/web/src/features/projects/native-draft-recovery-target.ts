import { nativeRouteKey } from './native-route-edit.js';
import { nativeInlineKey } from './native-inline-edit.js';
import type { NativeDesignDocument } from '@ezerd/model';
import type { NativeDraftArchiveEntry } from './native-draft-archive.js';
import type { NativeStructureAction } from './native-editor-structure.js';
import type { NativeDomainAction } from './NativeDomainEditor.js';
import type { NativeCanvasRecoverySelection } from './native-canvas-recovery-types.js';
export type { NativeCanvasRecoverySelection } from './native-canvas-recovery-types.js';
export type NativeDraftRecoveryTarget =
  | { kind: 'property' | 'format'; tableId: string; columnId?: string; personal: false }
  | {
      kind: 'structure';
      tableId?: string;
      selection: { action: NativeStructureAction | 'patch' | 'delete'; target: string };
      personal: false;
    }
  | { kind: 'advanced'; tableId: string; selection: string; personal: false }
  | {
      kind: 'domain';
      action: NativeDomainAction;
      domainId?: string;
      tableId?: string;
      personal: false;
    }
  | { kind: 'canvas'; selection: NativeCanvasRecoverySelection; personal: boolean };

/** Routing only: an archive never authorizes creating an object or changing its expected revision. */
export function nativeDraftRecoveryTarget(
  doc: NativeDesignDocument | null,
  entry: NativeDraftArchiveEntry,
): NativeDraftRecoveryTarget | null {
  if (!doc) return null;
  const key = entry.logicalKey,
    draft = entry.draft;
  const tables = doc.tables ?? [],
    columns = doc.columns ?? [];
  const hasTable = (id: string) => tables.some((table) => table.id === id);
  const views = [
    '__tables__',
    'overview',
    ...doc.domains.map((domain) => domain.id),
    ...(doc.views ?? []).map((view) => view.id),
  ];
  const privateView = (id: string) => !!doc.views?.some((view) => view.id === id);
  const allIds = new Set(
    [
      ...doc.domains,
      ...tables,
      ...columns,
      ...(doc.keys ?? []),
      ...(doc.indexes ?? []),
      ...(doc.checks ?? []),
      ...(doc.enums ?? []),
      ...(doc.tableRelations ?? []),
      ...doc.notes,
      ...(doc.views ?? []),
      ...doc.domainRelations,
      ...doc.layout.nodes,
    ].map((item) => item.id),
  );
  if (entry.category === 'property') {
    if (!('kind' in draft) || key !== JSON.stringify([draft.kind, draft.objectId])) return null;
    const column =
      draft.kind === 'column' ? columns.find((item) => item.id === draft.objectId) : undefined;
    const tableId = column?.tableId ?? (draft.kind === 'table' ? draft.objectId : '');
    return hasTable(tableId)
      ? { kind: 'property', tableId, ...(column ? { columnId: column.id } : {}), personal: false }
      : null;
  }
  if (!('key' in draft) || draft.key !== key) return null;
  const freshCreation = () =>
    !!draft.before.id && draft.values.id === draft.before.id && !allIds.has(draft.before.id);
  for (const table of tables) {
    if (key === `format:table:${table.id}`)
      return { kind: 'format', tableId: table.id, personal: false };
  }
  for (const column of columns) {
    if (key === `format:column:${column.id}` && hasTable(column.tableId))
      return { kind: 'format', tableId: column.tableId, columnId: column.id, personal: false };
  }
  for (const table of tables)
    for (const column of [undefined, ...columns.filter((c) => c.tableId === table.id)])
      for (const mode of ['physical', 'logical'] as const)
        for (const field of ['name', 'comment', 'semanticType', 'required'] as const) {
          if ((field === 'semanticType' || field === 'required') && (!column || mode !== 'logical'))
            continue;
          const target = {
            tableId: table.id,
            ...(column ? { columnId: column.id } : {}),
            mode,
            field,
          };
          if (key === nativeInlineKey(target))
            return {
              kind: 'canvas',
              selection: { viewId: '__tables__', inline: target },
              personal: false,
            };
        }
  for (const viewId of views)
    for (const relation of doc.tableRelations ?? []) {
      if (key === nativeRouteKey(viewId, relation.id))
        return {
          kind: 'canvas',
          selection: { viewId, routeId: relation.id },
          personal: privateView(viewId),
        };
    }
  if (key === 'create:domain:project')
    return freshCreation() ? { kind: 'domain', action: 'create', personal: false } : null;
  for (const domain of doc.domains) {
    for (const action of ['edit', 'delete'] as const)
      if (key === `${action}:domain:${domain.id}`)
        return { kind: 'domain', action, domainId: domain.id, personal: false };
  }
  for (const table of tables) {
    if (key === `move:domain:${table.id}`)
      return { kind: 'domain', action: 'move', tableId: table.id, personal: false };
  }
  for (const action of [
    'table',
    'column',
    'key',
    'index',
    'check',
    'enum',
    'foreignKey',
  ] as const) {
    for (const owner of ['project', ...tables.map((table) => table.id)]) {
      if (key !== `create:${action}:${owner}`) continue;
      if (!freshCreation() || (owner === 'project' && !['table', 'enum'].includes(action)))
        return null;
      return {
        kind: 'structure',
        ...(owner !== 'project' ? { tableId: owner } : {}),
        selection: { action, target: '' },
        personal: false,
      };
    }
  }
  for (const collection of [
    'tables',
    'columns',
    'keys',
    'indexes',
    'checks',
    'enums',
    'tableRelations',
  ] as const) {
    for (const item of doc[collection] ?? []) {
      const tableId =
        'tableId' in item
          ? item.tableId
          : 'sourceTableId' in item
            ? item.sourceTableId
            : collection === 'tables'
              ? item.id
              : undefined;
      if (tableId && !hasTable(tableId)) continue;
      for (const action of ['constraint', 'delete'] as const) {
        if (
          key !== `${action}:${collection}:${item.id}` ||
          (action === 'constraint' && ['tables', 'columns'].includes(collection))
        )
          continue;
        return {
          kind: 'structure',
          ...(tableId ? { tableId } : {}),
          selection: {
            action: action === 'constraint' ? 'patch' : 'delete',
            target: JSON.stringify([collection, item.id]),
          },
          personal: false,
        };
      }
    }
  }
  for (const table of tables) {
    if (key === `advanced:index:${table.id}:new`)
      return freshCreation()
        ? { kind: 'advanced', tableId: table.id, selection: 'index:new', personal: false }
        : null;
    if (key === `advanced:expression:${table.id}:check:new`)
      return freshCreation()
        ? { kind: 'advanced', tableId: table.id, selection: 'check:new', personal: false }
        : null;
    for (const index of doc.indexes ?? []) {
      if (index.tableId === table.id && key === `advanced:index:${table.id}:${index.id}`)
        return {
          kind: 'advanced',
          tableId: table.id,
          selection: JSON.stringify(['index', index.id]),
          personal: false,
        };
    }
    for (const check of doc.checks ?? []) {
      if (check.tableId === table.id && key === `advanced:expression:${table.id}:check:${check.id}`)
        return {
          kind: 'advanced',
          tableId: table.id,
          selection: JSON.stringify(['check', check.id]),
          personal: false,
        };
    }
    for (const column of columns) {
      if (column.tableId !== table.id) continue;
      for (const action of ['default', 'computed'] as const)
        if (key === `advanced:expression:${table.id}:${action}:${column.id}`)
          return {
            kind: 'advanced',
            tableId: table.id,
            selection: JSON.stringify([action, column.id]),
            personal: false,
          };
    }
  }
  for (const viewId of views) {
    const descriptionId = draft.values.objectId;
    if (
      descriptionId &&
      key === `canvas:description:${viewId}:${descriptionId}` &&
      ((viewId === 'overview' && doc.domains.some((domain) => domain.id === descriptionId)) ||
        doc.notes.some(
          (note) =>
            note.id === descriptionId &&
            note.viewId ===
              (doc.domains.some((domain) => domain.id === viewId) ? '__tables__' : viewId),
        ))
    )
      return {
        kind: 'canvas',
        selection: { viewId, descriptionId },
        personal: privateView(viewId),
      };
    if (key === `canvas:placement:${viewId}`) {
      const node = doc.layout.nodes.find(
        (item) =>
          item.id === draft.values.nodeId &&
          item.viewId === draft.values.viewId &&
          item.objectId === draft.values.objectId,
      );
      const placementView = doc.domains.some((domain) => domain.id === viewId)
        ? '__tables__'
        : viewId;
      if (!node || node.viewId !== placementView) return null;
      return { kind: 'canvas', selection: { viewId }, personal: privateView(viewId) };
    }
    for (const action of ['note', 'view'] as const) {
      if (key === `canvas:action:${viewId}:${action}:`)
        return freshCreation()
          ? {
              kind: 'canvas',
              selection: { viewId, action: { action, target: '' } },
              personal: action === 'view' || privateView(viewId),
            }
          : null;
    }
    for (const note of doc.notes) {
      const placementView = doc.domains.some((domain) => domain.id === viewId)
        ? '__tables__'
        : viewId;
      if (note.viewId !== placementView) continue;
      for (const action of ['note-edit', 'note-delete'] as const)
        if (key === `canvas:action:${viewId}:${action}:${note.id}`)
          return {
            kind: 'canvas',
            selection: { viewId, action: { action, target: note.id } },
            personal: privateView(viewId),
          };
    }
    for (const view of doc.views ?? []) {
      for (const action of ['view-edit', 'view-delete'] as const)
        if (key === `canvas:action:${viewId}:${action}:${view.id}`)
          return {
            kind: 'canvas',
            selection: { viewId, action: { action, target: view.id } },
            personal: true,
          };
    }
    for (const table of tables) {
      if (
        key === `canvas:action:${viewId}:reference:${table.id}` &&
        viewId !== 'overview' &&
        freshCreation()
      )
        return {
          kind: 'canvas',
          selection: { viewId, action: { action: 'reference', target: table.id } },
          personal: privateView(viewId),
        };
      if (
        key === `canvas:action:${viewId}:remove-reference:${table.id}` &&
        privateView(viewId) &&
        doc.layout.nodes.some((node) => node.viewId === viewId && node.objectId === table.id)
      )
        return {
          kind: 'canvas',
          selection: { viewId, action: { action: 'remove-reference', target: table.id } },
          personal: true,
        };
    }
  }
  for (const [kind, objects] of [
    ['table', tables],
    ['domain', doc.domains],
    ['note', doc.notes.filter((note) => !privateView(note.viewId))],
  ] as const) {
    for (const item of objects)
      if (key === `canvas:style:${kind}:${item.id}`)
        return { kind: 'canvas', selection: { style: `${kind}:${item.id}` }, personal: false };
  }
  if (key === 'canvas:domain-relation:create' && doc.domains.length && freshCreation())
    return { kind: 'canvas', selection: { domainRelation: { action: 'create' } }, personal: false };
  for (const relation of doc.domainRelations) {
    if (
      !doc.domains.some((domain) => domain.id === relation.sourceDomainId) ||
      !doc.domains.some((domain) => domain.id === relation.targetDomainId)
    )
      continue;
    for (const action of ['edit', 'delete'] as const)
      if (key === `canvas:domain-relation:${action}:${relation.id}`)
        return {
          kind: 'canvas',
          selection: { domainRelation: { action, id: relation.id } },
          personal: false,
        };
  }
  // Clipboard creation / unknown producer keys have no safe form route. Source remains downloadable.
  return null;
}
