import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import {
  columnSchema,
  domainSchema,
  noteSchema,
  nodeLayoutSchema,
  projectEnumSchema,
  projectSchema,
  relationLayoutSchema,
  tableKeySchema,
  tableRelationSchema,
  tableSchema,
  viewportSchema,
} from '@ezerd/contracts';
import type { DesignDocument, Project } from '@ezerd/contracts';
import { TABLES_VIEW_ID } from '@ezerd/model';
import { sharedCanvasNodes, sharedCanvasSelection } from '../shared/table-canvas-view.js';

const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const objectId = z.string().trim().min(1).max(160);
const tableSummarySchema = tableSchema
  .pick({
    id: true,
    domainId: true,
    scope: true,
    color: true,
  })
  .extend({
    logicalName: z.string(),
    physicalName: z.string(),
  });
const domainSummarySchema = domainSchema.pick({ id: true, name: true }).extend({
  tableCount: z.number().int().nonnegative(),
});
const viewSummarySchema = z.strictObject({
  id: objectId,
  name: z.string(),
  kind: z.enum(['overview', 'tables', 'domain', 'combined']),
  domainIds: z.array(objectId),
});
const baseSchema = z.strictObject({ project: projectSchema, syncSequence: sequence });

export const projectSummarySchema = baseSchema.extend({
  counts: z.strictObject({
    domains: z.number().int().nonnegative(),
    tables: z.number().int().nonnegative(),
    columns: z.number().int().nonnegative(),
    keys: z.number().int().nonnegative(),
    domainRelations: z.number().int().nonnegative(),
    tableRelations: z.number().int().nonnegative(),
    notes: z.number().int().nonnegative(),
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
export const projectViewSchema = baseSchema.extend({
  view: viewSummarySchema,
  totalNodes: z.number().int().nonnegative(),
  nextCursor: objectId.nullable(),
  domains: z.array(domainSchema.pick({ id: true, name: true, color: true })),
  tables: z.array(tableSummarySchema),
  notes: z.array(noteSchema),
  domainRelations: z.array(
    z.strictObject({
      id: objectId,
      sourceDomainId: objectId,
      targetDomainId: objectId,
      name: z.string(),
    }),
  ),
  tableRelations: z.array(
    z.strictObject({
      id: objectId,
      sourceTableId: objectId,
      targetTableId: objectId,
      name: z.string(),
    }),
  ),
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
export const viewRelationsInputSchema = projectViewInputSchema.extend({
  cursor: objectId.optional(),
});
export const viewRelationsSchema = baseSchema.extend({
  view: viewSummarySchema,
  relations: z.array(
    z.strictObject({
      id: objectId,
      kind: z.enum(['domain', 'table']),
      sourceId: objectId,
      targetId: objectId,
      name: z.string(),
      layout: relationLayoutSchema.nullable(),
    }),
  ),
  nextCursor: objectId.nullable(),
});
export const tableDetailsSchema = baseSchema.extend({
  table: tableSchema,
  domain: domainSchema.pick({ id: true, name: true, color: true }).nullable(),
  columns: z.array(columnSchema),
  keys: z.array(tableKeySchema),
  relations: z.array(tableRelationSchema),
  relatedTables: z.array(tableSummarySchema),
  enums: z.array(projectEnumSchema),
  nodes: z.array(nodeLayoutSchema),
});

export type ProjectState = { project: Project; document: DesignDocument; syncSequence: number };

function tableSummary(table: NonNullable<DesignDocument['tables']>[number]) {
  return {
    id: table.id,
    domainId: table.domainId,
    scope: table.scope,
    ...(table.color !== undefined ? { color: table.color } : {}),
    logicalName: table.logical.name,
    physicalName: table.physical.name,
  };
}

function views(document: DesignDocument) {
  return [
    { id: 'overview', name: 'Overview', kind: 'overview' as const, domainIds: [] },
    { id: TABLES_VIEW_ID, name: 'Tables', kind: 'tables' as const, domainIds: [] },
    ...document.domains.map((domain) => ({
      id: domain.id,
      name: domain.name,
      kind: 'domain' as const,
      domainIds: [domain.id],
    })),
    ...(document.views ?? []).map((view) => ({
      id: view.id,
      name: view.name,
      kind: 'combined' as const,
      domainIds: view.domainIds,
    })),
  ];
}

export function projectSummary(state: ProjectState) {
  const { project, document, syncSequence } = state;
  return projectSummarySchema.parse({
    project,
    syncSequence,
    counts: {
      domains: document.domains.length,
      tables: document.tables?.length ?? 0,
      columns: document.columns?.length ?? 0,
      keys: document.keys?.length ?? 0,
      domainRelations: document.domainRelations.length,
      tableRelations: document.tableRelations?.length ?? 0,
      notes: document.notes.length,
    },
    domains: document.domains.map((domain) => ({
      id: domain.id,
      name: domain.name,
      tableCount: document.tables?.filter((table) => table.domainId === domain.id).length ?? 0,
    })),
    views: views(document),
  });
}

export function listTables(state: ProjectState, input: z.infer<typeof listTablesInputSchema>) {
  const search = input.search.toLocaleLowerCase();
  const filtered = (state.document.tables ?? [])
    .filter(
      (table) =>
        (input.domainId === undefined || table.domainId === input.domainId) &&
        (!input.cursor || table.id > input.cursor) &&
        (!search ||
          table.id.toLocaleLowerCase().includes(search) ||
          table.logical.name.toLocaleLowerCase().includes(search) ||
          table.physical.name.toLocaleLowerCase().includes(search)),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, input.limit + 1);
  const hasMore = filtered.length > input.limit;
  const tables = filtered.slice(0, input.limit).map(tableSummary);
  return tableListSchema.parse({
    project: state.project,
    syncSequence: state.syncSequence,
    tables,
    nextCursor: hasMore ? tables.at(-1)!.id : null,
  });
}

export function projectView(state: ProjectState, viewId: string, limit = 50, cursor?: string) {
  const { project, document, syncSequence } = state;
  const view = views(document).find((item) => item.id === viewId);
  if (!view) throw new NotFoundException('화면을 찾을 수 없습니다.');
  const layoutViewId = sharedCanvasSelection(document, viewId)!.layoutViewId;
  const allNodes = sharedCanvasNodes(document, viewId).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const page = allNodes.filter((node) => !cursor || node.id > cursor).slice(0, limit + 1);
  const nodes = page.slice(0, limit);
  const visible = new Set(nodes.map((node) => node.objectId));
  const tableRelations = (document.tableRelations ?? [])
    .filter(
      (relation) => visible.has(relation.sourceTableId) && visible.has(relation.targetTableId),
    )
    .map(({ id, sourceTableId, targetTableId, logical }) => ({
      id,
      sourceTableId,
      targetTableId,
      name: logical.name,
    }));
  const visibleRelationIds = new Set(tableRelations.map((relation) => relation.id));
  return projectViewSchema.parse({
    project,
    syncSequence,
    view,
    totalNodes: allNodes.length,
    nextCursor: page.length > limit ? nodes.at(-1)!.id : null,
    domains: document.domains
      .filter((domain) => visible.has(domain.id))
      .map(({ id, name, color }) => ({ id, name, ...(color ? { color } : {}) })),
    tables: (document.tables ?? []).filter((table) => visible.has(table.id)).map(tableSummary),
    notes: document.notes.filter((note) => note.viewId === layoutViewId && visible.has(note.id)),
    domainRelations: document.domainRelations
      .filter(
        (relation) => visible.has(relation.sourceDomainId) && visible.has(relation.targetDomainId),
      )
      .map(({ id, sourceDomainId, targetDomainId, name }) => ({
        id,
        sourceDomainId,
        targetDomainId,
        name,
      })),
    tableRelations,
    nodes,
    relationLayouts: (document.layout.relations ?? []).filter(
      (relation) => relation.viewId === layoutViewId && visibleRelationIds.has(relation.relationId),
    ),
    viewport:
      document.layout.viewports.find((viewport) => viewport.viewId === layoutViewId) ?? null,
  });
}

export function listViewRelations(
  state: ProjectState,
  viewId: string,
  limit = 50,
  cursor?: string,
) {
  const { project, document, syncSequence } = state;
  const view = views(document).find((item) => item.id === viewId);
  if (!view) throw new NotFoundException('화면을 찾을 수 없습니다.');
  const layoutViewId = sharedCanvasSelection(document, viewId)!.layoutViewId;
  const visible = new Set(sharedCanvasNodes(document, viewId).map((node) => node.objectId));
  const layouts = new Map(
    (document.layout.relations ?? [])
      .filter((item) => item.viewId === layoutViewId)
      .map((item) => [item.relationId, item]),
  );
  const relations = [
    ...document.domainRelations
      .filter((item) => visible.has(item.sourceDomainId) && visible.has(item.targetDomainId))
      .map((item) => ({
        id: item.id,
        kind: 'domain' as const,
        sourceId: item.sourceDomainId,
        targetId: item.targetDomainId,
        name: item.name,
        layout: null,
      })),
    ...(document.tableRelations ?? [])
      .filter((item) => visible.has(item.sourceTableId) && visible.has(item.targetTableId))
      .map((item) => ({
        id: item.id,
        kind: 'table' as const,
        sourceId: item.sourceTableId,
        targetId: item.targetTableId,
        name: item.logical.name,
        layout: layouts.get(item.id) ?? null,
      })),
  ]
    .filter((item) => !cursor || item.id > cursor)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit + 1);
  const page = relations.slice(0, limit);
  return viewRelationsSchema.parse({
    project,
    syncSequence,
    view,
    relations: page,
    nextCursor: relations.length > limit ? page.at(-1)!.id : null,
  });
}

export function tableDetails(state: ProjectState, tableId: string) {
  const { project, document, syncSequence } = state;
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
  const enumIds = new Set(columns.map((column) => column.physical.type.enumId).filter(Boolean));
  return tableDetailsSchema.parse({
    project,
    syncSequence,
    table,
    domain: domain
      ? {
          id: domain.id,
          name: domain.name,
          ...(domain.color ? { color: domain.color } : {}),
        }
      : null,
    columns,
    keys: (document.keys ?? []).filter((key) => key.tableId === tableId),
    relations,
    relatedTables: (document.tables ?? [])
      .filter((item) => relatedIds.has(item.id))
      .map(tableSummary),
    enums: (document.enums ?? []).filter((item) => enumIds.has(item.id)),
    nodes: document.layout.nodes.filter((node) => node.objectId === tableId),
  });
}
