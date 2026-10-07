import type { NativeDesignDocument, NativeTable, NodeLayout } from '@ezerd/model';
import type { NativeWebCommand } from './native-save.js';

export interface NativeTableCreationPreview {
  operationId: string;
  table: NativeTable;
  node: NodeLayout;
}

/** Only an empty table and its explicit shared placement may appear before ACK. */
export function nativeTableCreationPreview(
  document: NativeDesignDocument,
  commands: readonly NativeWebCommand[],
  operationId: string,
): NativeTableCreationPreview | null {
  if (commands.length !== 2) return null;
  const [table, reference] = commands;
  if (
    table?.type !== 'add_table' ||
    reference?.type !== 'add_table_reference' ||
    reference.tableId !== table.value.id ||
    reference.viewId !== '__tables__' ||
    !reference.nodeId ||
    table.value.physical.name ||
    table.value.logical.name ||
    document.tables?.some((item) => item.id === table.value.id) ||
    document.layout.nodes.some((item) => item.id === reference.nodeId)
  )
    return null;
  return {
    operationId,
    table: structuredClone(table.value),
    node: {
      id: reference.nodeId,
      objectId: table.value.id,
      viewId: '__tables__',
      x: reference.placement.x,
      y: reference.placement.y,
      width: reference.placement.width ?? 320,
      height: reference.placement.height ?? 260,
    },
  };
}

export function nativeTableCreationReflected(
  document: NativeDesignDocument,
  preview: NativeTableCreationPreview,
) {
  return (
    document.tables?.some((table) => table.id === preview.table.id) &&
    document.layout.nodes.some((node) => node.id === preview.node.id)
  );
}

export function withNativeTableCreationPreviews(
  document: NativeDesignDocument,
  previews: readonly NativeTableCreationPreview[],
): NativeDesignDocument {
  const tables = previews.filter(
    (preview) => !document.tables?.some((table) => table.id === preview.table.id),
  );
  const nodes = previews.filter(
    (preview) => !document.layout.nodes.some((node) => node.id === preview.node.id),
  );
  if (!tables.length && !nodes.length) return document;
  return {
    ...document,
    tables: [...(document.tables ?? []), ...tables.map((preview) => preview.table)],
    layout: {
      ...document.layout,
      nodes: [...document.layout.nodes, ...nodes.map((preview) => preview.node)],
    },
  };
}
