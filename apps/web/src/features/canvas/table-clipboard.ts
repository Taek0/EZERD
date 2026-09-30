import { designDocumentSchema } from '@ezerd/contracts';
import { addTable, TABLES_VIEW_ID, type DesignDocument, type NodeLayout } from '@ezerd/model';

const format = 'ezerd/tables-v1';
let localClipboard = '';
let localOnly = false;
export const readLocalTableClipboard = () => localClipboard;
export const localTablePasteFallback = () => (localOnly ? localClipboard : '');
export function rememberTableClipboard(text: string, fallback = false) {
  localClipboard = text;
  localOnly = fallback;
}
export function acknowledgeSystemTableClipboard(text: string) {
  if (localClipboard === text) localOnly = false;
}

export function copyTables(
  doc: DesignDocument,
  ids: readonly string[],
  nodes: NodeLayout[],
): string {
  const selected = new Set(ids);
  const tables = (doc.tables ?? []).filter((t) => selected.has(t.id));
  if (!tables.length) return '';
  const tableIds = new Set(tables.map((t) => t.id));
  const columns = (doc.columns ?? []).filter((c) => tableIds.has(c.tableId));
  const enumIds = new Set(columns.map((c) => c.physical.type.enumId));
  const fragment: DesignDocument = {
    schemaVersion: 1,
    domains: doc.domains.filter((d) => tables.some((t) => t.domainId === d.id)),
    domainRelations: [],
    notes: [],
    tables,
    columns,
    keys: (doc.keys ?? []).filter((k) => tableIds.has(k.tableId)),
    enums: (doc.enums ?? []).filter((e) => enumIds.has(e.id)),
    tableRelations: (doc.tableRelations ?? []).filter(
      (r) => tableIds.has(r.sourceTableId) && tableIds.has(r.targetTableId),
    ),
    layout: {
      nodes: nodes
        .filter((n) => tableIds.has(n.objectId))
        .map((n) => ({
          ...n,
          viewId:
            n.viewId === TABLES_VIEW_ID
              ? TABLES_VIEW_ID
              : (tables.find((t) => t.id === n.objectId)!.domainId ?? TABLES_VIEW_ID),
        }))
        .flatMap((primary) => [
          primary,
          ...doc.layout.nodes.filter(
            (node) =>
              node.objectId === primary.objectId &&
              node.viewId !== primary.viewId &&
              (node.viewId === TABLES_VIEW_ID ||
                node.viewId === tables.find((table) => table.id === node.objectId)!.domainId),
          ),
        ]),
      viewports: [],
    },
  };
  return JSON.stringify({ format, document: fragment });
}

export function parseTableClipboard(text: string): DesignDocument | null {
  if (text.length > 2_000_000) return null;
  try {
    const value = JSON.parse(text);
    if (value?.format !== format) return null;
    const result = designDocumentSchema.safeParse(value.document);
    if (!result.success) return null;
    const doc = result.data;
    const tables = new Map(doc.tables?.map((t) => [t.id, t]));
    const columns = new Map(doc.columns?.map((c) => [c.id, c]));
    const owns = (id: string, tableId: string) => columns.get(id)?.tableId === tableId;
    if (
      !tables.size ||
      doc.notes.length ||
      doc.domainRelations.length ||
      doc.views?.length ||
      [...tables.values()].some(
        (t) =>
          (t.domainId !== null && !doc.domains.some((d) => d.id === t.domainId)) ||
          !doc.layout.nodes.some((n) => n.objectId === t.id) ||
          doc.layout.nodes
            .filter((n) => n.objectId === t.id)
            .some(
              (n, index, layouts) =>
                (n.viewId !== TABLES_VIEW_ID && n.viewId !== t.domainId) ||
                layouts.some(
                  (other, otherIndex) => otherIndex !== index && other.viewId === n.viewId,
                ),
            ),
      ) ||
      doc.layout.nodes.some((n) => !tables.has(n.objectId)) ||
      [...columns.values()].some(
        (c) =>
          !tables.has(c.tableId) ||
          (c.physical.type.enumId && !doc.enums?.some((e) => e.id === c.physical.type.enumId)),
      ) ||
      doc.keys?.some(
        (k) => !tables.has(k.tableId) || k.columnIds.some((id) => !owns(id, k.tableId)),
      ) ||
      doc.tableRelations?.some(
        (r) =>
          !tables.has(r.sourceTableId) ||
          !tables.has(r.targetTableId) ||
          (r.physical &&
            (r.physical.sourceColumnIds.some((id) => !owns(id, r.sourceTableId)) ||
              r.physical.targetColumnIds.some((id) => !owns(id, r.targetTableId)))),
      )
    )
      return null;
    return doc;
  } catch {
    return null;
  }
}

function uniqueName(name: string, used: string[]): string {
  if (!used.includes(name)) return name;
  for (let i = 1; ; i++) {
    const suffix = `_copy${i === 1 ? '' : i}`;
    const candidate = name.slice(0, 120 - suffix.length) + suffix;
    if (!used.includes(candidate)) return candidate;
  }
}

export function pasteTables(
  doc: DesignDocument,
  fragment: DesignDocument,
  domainId: string | null,
  point: { x: number; y: number },
  newId: () => string,
): { document: DesignDocument; ids: string[] } {
  if (domainId !== null && !doc.domains.some((d) => d.id === domainId))
    throw new Error('Invalid destination');
  const source = structuredClone(fragment);
  const mapping = new Map<string, string>();
  for (const item of [
    ...(source.tables ?? []),
    ...(source.columns ?? []),
    ...(source.keys ?? []),
    ...(source.tableRelations ?? []),
  ])
    mapping.set(item.id, newId());
  const mapped = (id: string) => {
    const value = mapping.get(id);
    if (!value) throw new Error('Invalid clipboard reference');
    return value;
  };
  let next = doc;
  for (const item of source.enums ?? []) {
    const same = next.enums?.find(
      (e) =>
        e.schema === item.schema &&
        e.name === item.name &&
        JSON.stringify(e.values) === JSON.stringify(item.values),
    );
    const id = same?.id ?? newId();
    mapping.set(item.id, id);
    if (!same)
      next = {
        ...next,
        enums: [
          ...(next.enums ?? []),
          {
            ...item,
            id,
            name: uniqueName(
              item.name,
              (next.enums ?? []).filter((e) => e.schema === item.schema).map((e) => e.name),
            ),
          },
        ],
      };
  }
  // The first placement of each table is the selection's active-view snapshot.
  const primaryNodes = (source.tables ?? []).map((table) =>
    source.layout.nodes.find((node) => node.objectId === table.id)!,
  );
  const left = Math.min(...primaryNodes.map((n) => n.x));
  const top = Math.min(...primaryNodes.map((n) => n.y));
  const ids: string[] = [];
  for (const table of source.tables ?? []) {
    const id = mapped(table.id);
    ids.push(id);
    const node = source.layout.nodes.find((n) => n.objectId === table.id)!;
    next = addTable(
      next,
      {
        ...table,
        id,
        domainId,
        logical: {
          ...table.logical,
          name: uniqueName(
            table.logical.name,
            (next.tables ?? []).filter((t) => t.domainId === domainId).map((t) => t.logical.name),
          ),
        },
        physical: {
          ...table.physical,
          name: uniqueName(
            table.physical.name,
            (next.tables ?? [])
              .filter((t) => t.physical.schema === table.physical.schema)
              .map((t) => t.physical.name),
          ),
        },
      },
      { x: point.x + node.x - left, y: point.y + node.y - top },
    );
    next = {
      ...next,
      layout: {
        ...next.layout,
        nodes: next.layout.nodes.map((n) => {
          if (n.objectId !== id) return n;
          const placement =
            n.viewId === (domainId ?? TABLES_VIEW_ID)
              ? node
              : (source.layout.nodes.find(
                  (item) => item.objectId === table.id && item.viewId === n.viewId,
                ) ?? node);
          return {
            ...n,
            x: point.x + placement.x - left,
            y: point.y + placement.y - top,
            width: placement.width,
            height: placement.height,
          };
        }),
      },
    };
  }
  const keyNames = (next.keys ?? []).map((k) => k.name);
  const keys = (source.keys ?? []).map((key) => {
    const name = uniqueName(key.name, keyNames);
    keyNames.push(name);
    return {
      ...key,
      id: mapped(key.id),
      tableId: mapped(key.tableId),
      name,
      columnIds: key.columnIds.map(mapped),
    };
  });
  next = {
    ...next,
    columns: [
      ...(next.columns ?? []),
      ...(source.columns ?? []).map((c) => ({
        ...c,
        id: mapped(c.id),
        tableId: mapped(c.tableId),
        physical: {
          ...c.physical,
          type: {
            ...c.physical.type,
            ...(c.physical.type.enumId ? { enumId: mapped(c.physical.type.enumId) } : {}),
          },
        },
      })),
    ],
    keys: [...(next.keys ?? []), ...keys],
    tableRelations: [
      ...(next.tableRelations ?? []),
      ...(source.tableRelations ?? []).map((r) => ({
        ...r,
        id: mapped(r.id),
        sourceTableId: mapped(r.sourceTableId),
        targetTableId: mapped(r.targetTableId),
        physical: r.physical
          ? {
              ...r.physical,
              sourceColumnIds: r.physical.sourceColumnIds.map(mapped),
              targetColumnIds: r.physical.targetColumnIds.map(mapped),
            }
          : null,
      })),
    ],
  };
  // Enforce document capacity and coordinate limits before committing any changes.
  designDocumentSchema.parse(next);
  return { document: next, ids };
}
