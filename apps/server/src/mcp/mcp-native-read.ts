import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import {
  databaseContextSchema,
  databaseRevisionSchema,
  domainSchema,
  nativeStoredColumnSchema,
  nativeStoredDesignDocumentSchema,
  nativeStoredTableSchema,
  nodeLayoutSchema,
  noteSchema,
  projectDocumentStateSchema,
  relationLayoutSchema,
  viewportSchema,
} from '@ezerd/contracts';
import {
  nativeColumnTypeDisplay,
  nativeDefaultDisplay,
  nativeGenerationDisplay,
  TABLES_VIEW_ID,
  type NativeDesignDocument,
  type NativeTable,
} from '@ezerd/model';
import { sharedCanvasNodes, sharedCanvasSelection } from '../shared/table-canvas-view.js';

const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const objectId = z.string().trim().min(1).max(160);
const collections = nativeStoredDesignDocumentSchema.in.shape;
const tableSummarySchema = nativeStoredTableSchema
  .pick({ id: true, domainId: true, scope: true, color: true })
  .extend({ logicalName: z.string(), physicalName: z.string() });
const domainSummarySchema = domainSchema.pick({ id: true, name: true }).extend({
  tableCount: z.number().int().nonnegative(),
});
const viewSummarySchema = z.strictObject({
  id: objectId,
  name: z.string(),
  kind: z.enum(['overview', 'tables', 'domain', 'combined']),
  domainIds: z.array(objectId),
});
const baseSchema = z.strictObject({
  protocolVersion: z.literal(2),
  schemaVersion: z.literal(2),
  project: projectDocumentStateSchema.shape.project,
  syncSequence: sequence,
  database: databaseContextSchema,
  databaseRevision: databaseRevisionSchema,
});
export const projectSummarySchema = baseSchema.extend({
  counts: z.strictObject({
    domains: sequence,
    tables: sequence,
    columns: sequence,
    keys: sequence,
    domainRelations: sequence,
    tableRelations: sequence,
    notes: sequence,
    indexes: sequence,
    checks: sequence,
    enums: sequence,
  }),
  domains: z.array(domainSummarySchema),
  views: z.array(viewSummarySchema),
});
export const listTablesInputSchema = z.strictObject({
  projectId: z.uuid(),
  domainId: objectId.nullable().optional(),
  search: z.string().trim().max(120).default(''),
  cursor: objectId.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export const tableListSchema = baseSchema.extend({
  tables: z.array(tableSummarySchema),
  nextCursor: objectId.nullable(),
});
const domainRelationSummarySchema = z.strictObject({
  id: objectId,
  sourceDomainId: objectId,
  targetDomainId: objectId,
  name: z.string(),
});
const tableRelationSummarySchema = collections.tableRelations
  .unwrap()
  .element.pick({ id: true, sourceTableId: true, targetTableId: true, scope: true })
  .extend({ name: z.string() });
export const projectViewSchema = baseSchema.extend({
  view: viewSummarySchema,
  totalNodes: sequence,
  nextCursor: objectId.nullable(),
  domains: z.array(domainSchema.pick({ id: true, name: true, color: true })),
  tables: z.array(tableSummarySchema),
  notes: z.array(noteSchema),
  domainRelations: z.array(domainRelationSummarySchema),
  tableRelations: z.array(tableRelationSummarySchema),
  nodes: z.array(nodeLayoutSchema),
  relationLayouts: z.array(relationLayoutSchema),
  viewport: viewportSchema.nullable(),
});
export const projectViewInputSchema = z.strictObject({
  projectId: z.uuid(),
  viewId: objectId,
  cursor: objectId.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export const viewRelationsInputSchema = projectViewInputSchema;
export const viewRelationsSchema = baseSchema.extend({
  view: viewSummarySchema,
  relations: z.array(
    z.strictObject({
      id: objectId,
      kind: z.enum(['domain', 'table']),
      sourceId: objectId,
      targetId: objectId,
      name: z.string(),
      scope: nativeStoredTableSchema.shape.scope.optional(),
      layout: relationLayoutSchema.nullable(),
    }),
  ),
  nextCursor: objectId.nullable(),
});
const columnDisplaySchema = z.strictObject({
  id: objectId,
  type: z.string(),
  defaultValue: z.string(),
  generation: z.string(),
});
export const tableDetailsSchema = baseSchema.extend({
  table: nativeStoredTableSchema,
  domain: domainSchema.pick({ id: true, name: true, color: true }).nullable(),
  columns: z.array(nativeStoredColumnSchema),
  columnDisplays: z.array(columnDisplaySchema),
  keys: z.array(collections.keys.unwrap().element),
  relations: z.array(collections.tableRelations.unwrap().element),
  relatedTables: z.array(tableSummarySchema),
  enums: z.array(collections.enums.unwrap().element),
  indexes: z.array(collections.indexes.unwrap().element),
  checks: z.array(collections.checks.unwrap().element),
  nodes: z.array(nodeLayoutSchema),
});
// Runtime validation above preserves recursive expressions. SDK metadata uses shallow native records.
const nativeRecordMetadataSchema = z.object({ id: objectId }).passthrough();
export const tableDetailsMetadataSchema = tableDetailsSchema.extend({
  columns: z.array(nativeRecordMetadataSchema),
  indexes: z.array(nativeRecordMetadataSchema),
  checks: z.array(nativeRecordMetadataSchema),
});

export type NativeProjectState = {
  project: z.infer<typeof baseSchema.shape.project>;
  document: NativeDesignDocument;
  syncSequence: number;
  personalViewIds?: readonly string[];
};

function base(state: NativeProjectState) {
  return {
    protocolVersion: 2 as const,
    schemaVersion: 2 as const,
    project: state.project,
    syncSequence: state.syncSequence,
    database: state.document.database,
    databaseRevision: state.project.databaseRevision,
  };
}
function tableSummary(table: NativeTable) {
  return {
    id: table.id,
    domainId: table.domainId,
    scope: table.scope,
    ...(table.color !== undefined ? { color: table.color } : {}),
    logicalName: table.logical.name,
    physicalName: table.physical.name,
  };
}
function views(state: NativeProjectState) {
  return [
    { id: 'overview', name: 'Overview', kind: 'overview' as const, domainIds: [] },
    { id: TABLES_VIEW_ID, name: 'Tables', kind: 'tables' as const, domainIds: [] },
    ...state.document.domains.map((domain) => ({
      id: domain.id,
      name: domain.name,
      kind: 'domain' as const,
      domainIds: [domain.id],
    })),
    ...(state.document.views ?? [])
      .filter((view) => state.personalViewIds?.includes(view.id))
      .map((view) => ({
        id: view.id,
        name: view.name,
        kind: 'combined' as const,
        domainIds: view.domainIds,
      })),
  ];
}
function view(state: NativeProjectState, viewId: string) {
  const result = views(state).find((item) => item.id === viewId);
  if (!result) throw new NotFoundException('화면을 찾을 수 없습니다.');
  return result;
}
/** The caller supplies only the authenticated actor's personal IDs and merged document. */
export function nativeViewSelection(state: NativeProjectState, viewId: string) {
  view(state, viewId);
  return sharedCanvasSelection(state.document, viewId, state.personalViewIds)!;
}
export function nativeViewNodes(state: NativeProjectState, viewId: string) {
  nativeViewSelection(state, viewId);
  return sharedCanvasNodes(state.document, viewId, state.personalViewIds);
}
function compareId(a: { id: string }, b: { id: string }) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
function page<T extends { id: string }>(items: T[], limit: number, cursor?: string) {
  const candidates = items
    .filter((item) => !cursor || item.id > cursor)
    .sort(compareId)
    .slice(0, limit + 1);
  const result = candidates.slice(0, limit);
  return { items: result, nextCursor: candidates.length > limit ? result.at(-1)!.id : null };
}
export function projectSummary(state: NativeProjectState) {
  const document = state.document;
  const allowedViews = new Set(views(state).map((item) => item.id));
  return projectSummarySchema.parse({
    ...base(state),
    counts: {
      domains: document.domains.length,
      tables: document.tables?.length ?? 0,
      columns: document.columns?.length ?? 0,
      keys: document.keys?.length ?? 0,
      domainRelations: document.domainRelations.length,
      tableRelations: document.tableRelations?.length ?? 0,
      notes: document.notes.filter((note) => allowedViews.has(note.viewId)).length,
      indexes: document.indexes?.length ?? 0,
      checks: document.checks?.length ?? 0,
      enums: document.enums?.length ?? 0,
    },
    domains: document.domains.map((domain) => ({
      id: domain.id,
      name: domain.name,
      tableCount: document.tables?.filter((table) => table.domainId === domain.id).length ?? 0,
    })),
    views: views(state),
  });
}
export function listTables(
  state: NativeProjectState,
  input: z.infer<typeof listTablesInputSchema>,
) {
  const search = input.search.toLocaleLowerCase();
  const filtered = (state.document.tables ?? []).filter(
    (table) =>
      (input.domainId === undefined || table.domainId === input.domainId) &&
      (!search ||
        [table.id, table.logical.name, table.physical.name].some((name) =>
          name.toLocaleLowerCase().includes(search),
        )),
  );
  const result = page(filtered, input.limit, input.cursor);
  return tableListSchema.parse({
    ...base(state),
    tables: result.items.map(tableSummary),
    nextCursor: result.nextCursor,
  });
}
export function projectView(
  state: NativeProjectState,
  viewId: string,
  limit = 50,
  cursor?: string,
) {
  const document = state.document;
  const selection = nativeViewSelection(state, viewId);
  const allNodes = nativeViewNodes(state, viewId);
  const result = page(allNodes, limit, cursor);
  const visible = new Set(result.items.map((node) => node.objectId));
  const tableRelations = (document.tableRelations ?? [])
    .filter(
      (relation) => visible.has(relation.sourceTableId) && visible.has(relation.targetTableId),
    )
    .map(({ id, sourceTableId, targetTableId, scope, logical }) => ({
      id,
      sourceTableId,
      targetTableId,
      scope,
      name: logical.name,
    }));
  const domainRelations = document.domainRelations
    .filter(
      (relation) => visible.has(relation.sourceDomainId) && visible.has(relation.targetDomainId),
    )
    .map(({ id, sourceDomainId, targetDomainId, name }) => ({
      id,
      sourceDomainId,
      targetDomainId,
      name,
    }));
  const relationIds = new Set(
    [...tableRelations, ...domainRelations].map((relation) => relation.id),
  );
  return projectViewSchema.parse({
    ...base(state),
    view: view(state, viewId),
    totalNodes: allNodes.length,
    nextCursor: result.nextCursor,
    domains: document.domains
      .filter((domain) => visible.has(domain.id))
      .map(({ id, name, color }) => ({ id, name, ...(color !== undefined ? { color } : {}) })),
    tables: (document.tables ?? []).filter((table) => visible.has(table.id)).map(tableSummary),
    notes: document.notes.filter(
      (note) => note.viewId === selection.layoutViewId && visible.has(note.id),
    ),
    domainRelations,
    tableRelations,
    nodes: result.items,
    relationLayouts: (document.layout.relations ?? []).filter(
      (relation) =>
        relation.viewId === selection.layoutViewId && relationIds.has(relation.relationId),
    ),
    viewport:
      document.layout.viewports.find((viewport) => viewport.viewId === selection.layoutViewId) ??
      null,
  });
}
export function listViewRelations(
  state: NativeProjectState,
  viewId: string,
  limit = 50,
  cursor?: string,
) {
  const document = state.document;
  const selection = nativeViewSelection(state, viewId);
  const visible = new Set(nativeViewNodes(state, viewId).map((node) => node.objectId));
  const layouts = new Map(
    (document.layout.relations ?? [])
      .filter((layout) => layout.viewId === selection.layoutViewId)
      .map((layout) => [layout.relationId, layout]),
  );
  const result = page(
    [
      ...document.domainRelations
        .filter((item) => visible.has(item.sourceDomainId) && visible.has(item.targetDomainId))
        .map((item) => ({
          id: item.id,
          kind: 'domain' as const,
          sourceId: item.sourceDomainId,
          targetId: item.targetDomainId,
          name: item.name,
          layout: layouts.get(item.id) ?? null,
        })),
      ...(document.tableRelations ?? [])
        .filter((item) => visible.has(item.sourceTableId) && visible.has(item.targetTableId))
        .map((item) => ({
          id: item.id,
          kind: 'table' as const,
          sourceId: item.sourceTableId,
          targetId: item.targetTableId,
          name: item.logical.name,
          scope: item.scope,
          layout: layouts.get(item.id) ?? null,
        })),
    ],
    limit,
    cursor,
  );
  return viewRelationsSchema.parse({
    ...base(state),
    view: view(state, viewId),
    relations: result.items,
    nextCursor: result.nextCursor,
  });
}
export function tableDetails(state: NativeProjectState, tableId: string) {
  const document = state.document;
  const table = document.tables?.find((item) => item.id === tableId);
  if (!table) throw new NotFoundException('테이블을 찾을 수 없습니다.');
  const domain = document.domains.find((item) => item.id === table.domainId);
  if (table.domainId !== null && !domain)
    throw new NotFoundException('테이블의 도메인을 찾을 수 없습니다.');
  const columns = (document.columns ?? []).filter((column) => column.tableId === tableId);
  const relations = (document.tableRelations ?? []).filter(
    (relation) => relation.sourceTableId === tableId || relation.targetTableId === tableId,
  );
  const relatedIds = new Set(
    relations.flatMap((relation) => [relation.sourceTableId, relation.targetTableId]),
  );
  relatedIds.delete(tableId);
  const enumIds = new Set(
    columns.flatMap((column) => {
      const type = column.physical.type;
      return type.kind === 'projectEnum'
        ? [type.enumId]
        : type.kind === 'legacy' && type.original.enumId
          ? [type.original.enumId]
          : [];
    }),
  );
  const allowedLayouts = new Set(
    views(state).map((item) => nativeViewSelection(state, item.id).layoutViewId),
  );
  return tableDetailsSchema.parse({
    ...base(state),
    table,
    domain: domain
      ? {
          id: domain.id,
          name: domain.name,
          ...(domain.color !== undefined ? { color: domain.color } : {}),
        }
      : null,
    columns,
    columnDisplays: columns.map((column) => ({
      id: column.id,
      type: nativeColumnTypeDisplay(column.physical.type, document.enums),
      defaultValue: nativeDefaultDisplay(column.physical.defaultValue, document),
      generation: nativeGenerationDisplay(column.physical.generation, document),
    })),
    keys: (document.keys ?? []).filter((key) => key.tableId === tableId),
    indexes: (document.indexes ?? []).filter((index) => index.tableId === tableId),
    checks: (document.checks ?? []).filter((check) => check.tableId === tableId),
    relations,
    relatedTables: (document.tables ?? [])
      .filter((item) => relatedIds.has(item.id))
      .map(tableSummary),
    enums: (document.enums ?? []).filter((item) => enumIds.has(item.id)),
    nodes: document.layout.nodes.filter(
      (node) => node.objectId === tableId && allowedLayouts.has(node.viewId),
    ),
  });
}
