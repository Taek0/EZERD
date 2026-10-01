import { z } from 'zod';
import {
  TABLES_VIEW_ID,
  inspectNativeDatabaseDocument,
  nativeExpressionColumnIds,
  remapNativeDocumentIds,
  validateDatabaseDocument,
  type NativeDesignDocument,
  type NodeLayout,
  type DatabaseContext,
} from '@ezerd/model';
import { databaseContextSchema } from './database-state.js';
import { nativeStoredDesignDocumentSchema } from './native-document.js';
import { rawStoredDesignDocumentSchema } from './workspace.js';

export const MAX_TABLE_CLIPBOARD_BYTES = 2_000_000;
const bytes = (value: string) => {
  let count = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    count += code <= 127 ? 1 : code <= 2047 ? 2 : code <= 65535 ? 3 : 4;
  }
  return count;
};
const sameDatabase = (left: DatabaseContext, right: DatabaseContext) =>
  left.kind === right.kind && left.profileId === right.profileId;
function fragmentError(document: NativeDesignDocument): string | undefined {
  if (
    !document.tables?.length ||
    document.domains.length ||
    document.domainRelations.length ||
    document.notes.length ||
    document.views?.length ||
    document.layout.viewports.length
  )
    return 'clipboard.fragment-invalid';
  if (document.tables.some((table) => table.domainId !== null)) return 'clipboard.fragment-invalid';
  if (
    document.tables.some((table) => table.physical.namespace.kind === 'legacyNamespace') ||
    document.columns?.some(
      (column) =>
        column.physical.type.kind === 'legacy' ||
        column.physical.defaultValue.kind === 'legacyExpression',
    )
  )
    return 'clipboard.legacy-copy-not-supported';
  const tables = new Set(document.tables.map((table) => table.id));
  const columns = new Map((document.columns ?? []).map((column) => [column.id, column]));
  const enums = new Set((document.enums ?? []).map((item) => item.id));
  const owns = (id: string, tableId: string) => columns.get(id)?.tableId === tableId;
  if (
    document.layout.nodes.length !== tables.size ||
    document.layout.nodes.some(
      (node) => node.viewId !== TABLES_VIEW_ID || !tables.has(node.objectId),
    )
  )
    return 'clipboard.placement-invalid';
  for (const column of document.columns ?? []) {
    if (
      !tables.has(column.tableId) ||
      (column.physical.type.kind === 'projectEnum' && !enums.has(column.physical.type.enumId))
    )
      return 'clipboard.reference-missing';
    const expressions = [
      ...(column.physical.generation.kind === 'computed'
        ? [column.physical.generation.expression]
        : []),
      ...(column.physical.defaultValue.kind === 'expression'
        ? [column.physical.defaultValue.expression]
        : []),
      ...(column.physical.options.database === 'mysql' && column.physical.options.onUpdate
        ? [column.physical.options.onUpdate]
        : []),
    ];
    if (
      expressions.some((expression) =>
        nativeExpressionColumnIds(expression).some((id) => !owns(id, column.tableId)),
      )
    )
      return 'clipboard.reference-missing';
  }
  if (
    document.keys?.some(
      (key) => !tables.has(key.tableId) || key.columnIds.some((id) => !owns(id, key.tableId)),
    )
  )
    return 'clipboard.reference-missing';
  for (const index of document.indexes ?? []) {
    const refs = index.parts.flatMap((part) => nativeExpressionColumnIds(part.expression));
    if ('predicate' in index.options && index.options.predicate)
      refs.push(...nativeExpressionColumnIds(index.options.predicate));
    if (index.options.database === 'postgresql')
      refs.push(...(index.options.includeColumnIds ?? []));
    if (!tables.has(index.tableId) || refs.some((id) => !owns(id, index.tableId)))
      return 'clipboard.reference-missing';
  }
  if (
    document.checks?.some(
      (check) =>
        !tables.has(check.tableId) ||
        nativeExpressionColumnIds(check.expression).some((id) => !owns(id, check.tableId)),
    )
  )
    return 'clipboard.reference-missing';
  for (const relation of document.tableRelations ?? [])
    if (
      !tables.has(relation.sourceTableId) ||
      !tables.has(relation.targetTableId) ||
      (relation.physical &&
        (relation.physical.sourceColumnIds.some((id) => !owns(id, relation.sourceTableId)) ||
          relation.physical.targetColumnIds.some((id) => !owns(id, relation.targetTableId))))
    )
      return 'clipboard.reference-missing';
  const relations = new Set((document.tableRelations ?? []).map((relation) => relation.id));
  if (
    document.layout.relations?.some(
      (route) => route.viewId !== TABLES_VIEW_ID || !relations.has(route.relationId),
    )
  )
    return 'clipboard.reference-missing';
  const issue = inspectNativeDatabaseDocument(document, document.database).find(
    (issue) => issue.severity === 'error' && issue.category !== 'incomplete',
  );
  return issue?.code;
}
export const nativeTableClipboardSchema = z
  .strictObject({
    format: z.literal('ezerd/tables'),
    formatVersion: z.literal(2),
    sourceDatabase: databaseContextSchema,
    document: nativeStoredDesignDocumentSchema,
  })
  .superRefine((file, ctx) => {
    if (!sameDatabase(file.sourceDatabase, file.document.database))
      ctx.addIssue({
        code: 'custom',
        path: ['sourceDatabase'],
        message: 'database.context-mismatch',
      });
    if (bytes(JSON.stringify(file)) > MAX_TABLE_CLIPBOARD_BYTES)
      ctx.addIssue({ code: 'custom', message: 'clipboard.size-limit' });
    const error = fragmentError(file.document);
    if (error) ctx.addIssue({ code: 'custom', path: ['document'], message: error });
  });
export type NativeTableClipboard = z.infer<typeof nativeTableClipboardSchema>;
export const tableClipboardReadSchema = z.union([
  z
    .strictObject({ format: z.literal('ezerd/tables-v1'), document: rawStoredDesignDocumentSchema })
    .refine(
      (file) => bytes(JSON.stringify(file)) <= MAX_TABLE_CLIPBOARD_BYTES,
      'clipboard.size-limit',
    ),
  nativeTableClipboardSchema,
]);
export function parseTableClipboardRead(
  text: string,
): z.infer<typeof tableClipboardReadSchema> | null {
  if (text.length > MAX_TABLE_CLIPBOARD_BYTES || bytes(text) > MAX_TABLE_CLIPBOARD_BYTES)
    return null;
  try {
    const parsed = tableClipboardReadSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Copies complete selected tables without cloning collaboration/private view state. */
export function copyNativeTableClipboard(
  sourceInput: NativeDesignDocument,
  tableIds: readonly string[],
  placements: readonly NodeLayout[] = [],
) {
  const source = nativeStoredDesignDocumentSchema.parse(sourceInput);
  const selected = new Set(tableIds);
  const tables = (source.tables ?? []).filter((table) => selected.has(table.id));
  if (!tables.length || tables.length !== selected.size)
    throw new Error('clipboard.selection-invalid');
  const columns = (source.columns ?? []).filter((column) => selected.has(column.tableId));
  const enumIds = new Set(
    columns.flatMap((column) =>
      column.physical.type.kind === 'projectEnum' ? [column.physical.type.enumId] : [],
    ),
  );
  const relations = (source.tableRelations ?? []).filter(
    (relation) => selected.has(relation.sourceTableId) && selected.has(relation.targetTableId),
  );
  const relationIds = new Set(relations.map((relation) => relation.id));
  const document: NativeDesignDocument = {
    schemaVersion: 2,
    database: { ...source.database },
    domains: [],
    domainRelations: [],
    notes: [],
    tables: tables.map((table) => ({ ...table, domainId: null })),
    columns,
    keys: (source.keys ?? []).filter((key) => selected.has(key.tableId)),
    enums: (source.enums ?? []).filter((item) => enumIds.has(item.id)),
    tableRelations: relations,
    indexes: (source.indexes ?? []).filter((index) => selected.has(index.tableId)),
    checks: (source.checks ?? []).filter((check) => selected.has(check.tableId)),
    layout: {
      nodes: tables.map((table) => {
        const node =
          placements.find((node) => node.objectId === table.id) ??
          source.layout.nodes.find(
            (node) => node.objectId === table.id && node.viewId === TABLES_VIEW_ID,
          );
        if (!node) throw new Error('clipboard.placement-missing');
        return { ...node, viewId: TABLES_VIEW_ID };
      }),
      viewports: [],
      relations: (source.layout.relations ?? []).filter(
        (route) => route.viewId === TABLES_VIEW_ID && relationIds.has(route.relationId),
      ),
    },
  };
  const file = nativeTableClipboardSchema.parse({
    format: 'ezerd/tables',
    formatVersion: 2,
    sourceDatabase: source.database,
    document,
  });
  return {
    text: JSON.stringify(file),
    omittedRelationIds: (source.tableRelations ?? [])
      .filter(
        (relation) =>
          (selected.has(relation.sourceTableId) || selected.has(relation.targetTableId)) &&
          !relationIds.has(relation.id),
      )
      .map((relation) => relation.id),
  };
}
function fold(name: string, database: DatabaseContext) {
  return database.kind === 'postgresql'
    ? name
    : name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
function uniqueName(name: string, used: Set<string>, database: DatabaseContext) {
  if (!name) return name;
  if (!used.has(fold(name, database))) {
    used.add(fold(name, database));
    return name;
  }
  for (let index = 1; ; index++) {
    const suffix = index === 1 ? '_copy' : `_copy${index}`;
    const chars = [...name];
    while (
      chars.length &&
      ((chars.join('') + suffix).length > 120 ||
        (database.kind === 'postgresql' && bytes(chars.join('') + suffix) > 63) ||
        (database.kind === 'mysql' && chars.length + suffix.length > 64))
    )
      chars.pop();
    const value = chars.join('') + suffix;
    if (!used.has(fold(value, database))) {
      used.add(fold(value, database));
      return value;
    }
  }
}

/** Returns a reviewable preparation; actual availability remains the same native write policy. */
export function planNativeTablePaste(
  targetInput: NativeDesignDocument,
  clipboardInput: NativeTableClipboard,
  domainId: string | null,
  point: { x: number; y: number },
  newId: () => string,
) {
  const target = nativeStoredDesignDocumentSchema.parse(targetInput);
  const clipboard = nativeTableClipboardSchema.parse(clipboardInput);
  if (!sameDatabase(target.database, clipboard.sourceDatabase))
    throw new Error('clipboard.database-mismatch');
  if (domainId !== null && !target.domains.some((domain) => domain.id === domainId))
    throw new Error('clipboard.destination-invalid');
  const usedIds = new Set(
    [
      ...target.domains,
      ...target.domainRelations,
      ...target.notes,
      ...(target.views ?? []),
      ...(target.tables ?? []),
      ...(target.columns ?? []),
      ...(target.keys ?? []),
      ...(target.enums ?? []),
      ...(target.tableRelations ?? []),
      ...(target.indexes ?? []),
      ...(target.checks ?? []),
      ...target.layout.nodes,
    ].map((item) => item.id),
  );
  const allocate = () => {
    const id = newId();
    if (
      !id ||
      id.trim() !== id ||
      id.length > 160 ||
      ['overview', TABLES_VIEW_ID].includes(id) ||
      usedIds.has(id)
    )
      throw new Error('clipboard.identity-collision');
    usedIds.add(id);
    return id;
  };
  const fragment = clipboard.document;
  const mapping = new Map<string, string>();
  for (const item of [
    ...(fragment.tables ?? []),
    ...(fragment.columns ?? []),
    ...(fragment.keys ?? []),
    ...(fragment.tableRelations ?? []),
    ...(fragment.indexes ?? []),
    ...(fragment.checks ?? []),
  ])
    mapping.set(item.id, allocate());
  const reusedEnums = new Set<string>();
  for (const item of fragment.enums ?? []) {
    const existing = target.enums?.find(
      (value) =>
        (value.schema || 'public') === (item.schema || 'public') &&
        value.name === item.name &&
        JSON.stringify(value.values) === JSON.stringify(item.values),
    );
    mapping.set(item.id, existing?.id ?? allocate());
    if (existing) reusedEnums.add(existing.id);
  }
  const nodes = new Map(fragment.layout.nodes.map((node) => [node.id, allocate()]));
  const remapped = remapNativeDocumentIds(fragment, { entities: mapping, nodes });
  const names = new Set(
    [
      ...(target.tables ?? []).map((table) => table.physical.name),
      ...(target.enums ?? []).map((item) => item.name),
      ...(target.keys ?? []).map((key) => key.name),
      ...(target.indexes ?? []).map((index) => index.name),
      ...(target.checks ?? []).map((check) => check.name),
      ...(target.tableRelations ?? []).flatMap((relation) =>
        relation.physical ? [relation.physical.name] : [],
      ),
    ].map((name) => fold(name, target.database)),
  );
  const logicalNames = new Set(
    (target.tables ?? [])
      .filter((table) => table.domainId === domainId)
      .map((table) => fold(table.logical.name, target.database)),
  );
  for (const table of remapped.tables ?? []) {
    table.domainId = domainId;
    table.physical.name = uniqueName(table.physical.name, names, target.database);
    table.logical.name = uniqueName(table.logical.name, logicalNames, target.database);
  }
  remapped.enums = (remapped.enums ?? []).filter((item) => !reusedEnums.has(item.id));
  for (const item of [
    ...remapped.enums,
    ...(remapped.keys ?? []),
    ...(remapped.indexes ?? []),
    ...(remapped.checks ?? []),
  ])
    item.name = uniqueName(item.name, names, target.database);
  for (const relation of remapped.tableRelations ?? [])
    if (relation.physical)
      relation.physical.name = uniqueName(relation.physical.name, names, target.database);
  const left = Math.min(...fragment.layout.nodes.map((node) => node.x));
  const top = Math.min(...fragment.layout.nodes.map((node) => node.y));
  remapped.layout.nodes = remapped.layout.nodes.map((node) => ({
    ...node,
    x: point.x + node.x - left,
    y: point.y + node.y - top,
  }));
  remapped.layout.relations = (remapped.layout.relations ?? []).map((route) => ({
    ...route,
    ...(route.bend && {
      bend: { x: point.x + route.bend.x - left, y: point.y + route.bend.y - top },
    }),
    ...(route.waypoints && {
      waypoints: route.waypoints.map((value) => ({
        x: point.x + value.x - left,
        y: point.y + value.y - top,
      })),
    }),
  }));
  const candidate: NativeDesignDocument = {
    ...target,
    tables: [...(target.tables ?? []), ...(remapped.tables ?? [])],
    columns: [...(target.columns ?? []), ...(remapped.columns ?? [])],
    enums: [...(target.enums ?? []), ...remapped.enums],
    keys: [...(target.keys ?? []), ...(remapped.keys ?? [])],
    tableRelations: [...(target.tableRelations ?? []), ...(remapped.tableRelations ?? [])],
    indexes: [...(target.indexes ?? []), ...(remapped.indexes ?? [])],
    checks: [...(target.checks ?? []), ...(remapped.checks ?? [])],
    layout: {
      ...target.layout,
      nodes: [...target.layout.nodes, ...remapped.layout.nodes],
      relations: [...(target.layout.relations ?? []), ...(remapped.layout.relations ?? [])],
    },
  };
  const document = nativeStoredDesignDocumentSchema.parse(candidate);
  const issues = validateDatabaseDocument(document, target.database, {
    mode: 'write',
    previous: target,
  });
  return {
    document,
    ids: (remapped.tables ?? []).map((table) => table.id),
    issues,
    canApply: !issues.some((issue) => issue.severity === 'error'),
  };
}
