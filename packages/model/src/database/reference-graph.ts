import { TABLES_VIEW_ID, type ModelScope } from '../document.js';
import {
  nativeExpressionColumnIds,
  type NativeDesignDocument,
  type NativeExpression,
} from './native-document.js';

interface ReferenceProblem {
  code: string;
  objectId: string;
  path: string;
  cause: unknown;
}
const segment = (id: string) => id.replaceAll('~', '~0').replaceAll('/', '~1');
/** Internal causal graph checks. Shape/budget and engine rules remain separate boundaries. */
export function nativeReferenceProblems(document: NativeDesignDocument): ReferenceProblem[] {
  const problems: ReferenceProblem[] = [];
  const add = (code: string, id: string, path: string, cause: unknown) =>
    problems.push({ code: `document.${code}`, objectId: id, path, cause });
  const domains = new Set(document.domains.map((item) => item.id));
  const views = new Map((document.views ?? []).map((item) => [item.id, item]));
  const tables = new Map((document.tables ?? []).map((item) => [item.id, item]));
  const columns = new Map((document.columns ?? []).map((item) => [item.id, item]));
  const enums = new Set((document.enums ?? []).map((item) => item.id));
  const validView = (id: string) =>
    id === 'overview' || id === TABLES_VIEW_ID || domains.has(id) || views.has(id);
  const scope = (child: ModelScope, parent: ModelScope, id: string, path: string) => {
    if (parent !== 'both' && child !== parent) add('scope-mismatch', id, path, [child, parent]);
  };
  for (const view of views.values())
    for (const id of view.domainIds)
      if (!domains.has(id))
        add('view-domain-not-found', view.id, `/views/${segment(view.id)}/domainIds`, [
          view.domainIds,
          id,
        ]);
  for (const item of document.domainRelations)
    if (!domains.has(item.sourceDomainId) || !domains.has(item.targetDomainId))
      add('relation-domain-not-found', item.id, `/domainRelations/${segment(item.id)}`, [
        item.sourceDomainId,
        item.targetDomainId,
        [item.sourceDomainId, item.targetDomainId].filter((id) => !domains.has(id)),
      ]);
  for (const note of document.notes)
    if (!validView(note.viewId))
      add('note-view-not-found', note.id, `/notes/${segment(note.id)}/viewId`, note.viewId);
  for (const table of tables.values())
    if (table.domainId !== null && !domains.has(table.domainId))
      add(
        'table-domain-not-found',
        table.id,
        `/tables/${segment(table.id)}/domainId`,
        table.domainId,
      );
  const owner = (item: { id: string; tableId: string; scope: ModelScope }, collection: string) => {
    const path = `/${collection}/${segment(item.id)}`;
    const table = tables.get(item.tableId);
    if (!table) add('owner-table-not-found', item.id, `${path}/tableId`, item.tableId);
    else scope(item.scope, table.scope, item.id, `${path}/scope`);
    return path;
  };
  const reference = (
    id: string,
    tableId: string,
    objectId: string,
    path: string,
    modelScope?: ModelScope,
  ) => {
    const column = columns.get(id);
    if (!column || column.tableId !== tableId)
      add('column-reference-invalid', objectId, path, [id, tableId, column?.tableId]);
    else if (modelScope) scope(modelScope, column.scope, objectId, path);
  };
  const expression = (
    value: NativeExpression,
    item: { id: string; tableId: string },
    path: string,
  ) => {
    try {
      for (const id of nativeExpressionColumnIds(value)) reference(id, item.tableId, item.id, path);
    } catch {
      add('expression-complexity-limit', item.id, path, value.kind);
    }
  };
  for (const column of columns.values()) {
    const path = owner(column, 'columns') + '/physical';
    const type = column.physical.type;
    const enumId =
      type.kind === 'projectEnum'
        ? type.enumId
        : type.kind === 'legacy'
          ? type.original.enumId
          : undefined;
    if (enumId && !enums.has(enumId)) add('enum-not-found', column.id, `${path}/type`, enumId);
    if (column.physical.generation.kind === 'computed')
      expression(column.physical.generation.expression, column, `${path}/generation/expression`);
    if (column.physical.defaultValue.kind === 'expression')
      expression(
        column.physical.defaultValue.expression,
        column,
        `${path}/defaultValue/expression`,
      );
    if (column.physical.options.database === 'mysql' && column.physical.options.onUpdate)
      expression(column.physical.options.onUpdate, column, `${path}/options/onUpdate`);
  }
  for (const key of document.keys ?? []) {
    const path = owner(key, 'keys');
    for (const id of key.columnIds)
      reference(id, key.tableId, key.id, `${path}/columnIds`, key.scope);
    if (new Set(key.columnIds).size !== key.columnIds.length)
      add('key-columns-duplicate', key.id, `${path}/columnIds`, key.columnIds);
  }
  const relations = new Map((document.tableRelations ?? []).map((item) => [item.id, item]));
  const primaryGroups = new Map<string, string[]>();
  for (const key of document.keys ?? []) {
    if (key.kind !== 'primary') continue;
    for (const facet of ['logical', 'physical'] as const) {
      if (key.scope !== 'both' && key.scope !== facet) continue;
      const group = JSON.stringify([key.tableId, facet]);
      const ids = primaryGroups.get(group) ?? [];
      ids.push(key.id);
      primaryGroups.set(group, ids);
    }
  }
  for (const [group, ids] of primaryGroups)
    if (ids.length > 1)
      for (const id of ids)
        add('multiple-primary-keys', id, `/keys/${segment(id)}`, [group, ids.toSorted()]);
  for (const relation of relations.values()) {
    const path = `/tableRelations/${segment(relation.id)}`;
    for (const [field, id] of [
      ['sourceTableId', relation.sourceTableId],
      ['targetTableId', relation.targetTableId],
    ] as const) {
      const table = tables.get(id);
      if (!table) add('relation-table-not-found', relation.id, `${path}/${field}`, id);
      else scope(relation.scope, table.scope, relation.id, `${path}/scope`);
    }
    if (!relation.physical) continue;
    if (relation.scope === 'logical')
      add('logical-relation-has-fk', relation.id, `${path}/physical`, relation.physical);
    for (const [field, tableId] of [
      ['sourceColumnIds', relation.sourceTableId],
      ['targetColumnIds', relation.targetTableId],
    ] as const) {
      const ids = relation.physical[field];
      for (const id of ids)
        reference(id, tableId, relation.id, `${path}/physical/${field}`, 'physical');
      if (new Set(ids).size !== ids.length)
        add('fk-columns-duplicate', relation.id, `${path}/physical/${field}`, ids);
    }
  }
  for (const index of document.indexes ?? []) {
    const path = owner(index, 'indexes');
    for (const [number, part] of index.parts.entries())
      expression(part.expression, index, `${path}/parts/${number}/expression`);
    if ('predicate' in index.options && index.options.predicate)
      expression(index.options.predicate, index, `${path}/options/predicate`);
    if (index.options.database === 'postgresql')
      for (const id of index.options.includeColumnIds ?? [])
        reference(id, index.tableId, index.id, `${path}/options/includeColumnIds`, index.scope);
  }
  for (const check of document.checks ?? [])
    expression(check.expression, check, owner(check, 'checks') + '/expression');
  const notes = new Map(document.notes.map((item) => [item.id, item]));
  const placements = new Set(
    document.layout.nodes.map((item) => JSON.stringify([item.viewId, item.objectId])),
  );
  for (const node of document.layout.nodes) {
    const table = tables.get(node.objectId);
    const view = views.get(node.viewId);
    const note = notes.get(node.objectId);
    const valid = domains.has(node.objectId)
      ? node.viewId === 'overview'
      : note
        ? note.viewId === node.viewId && validView(node.viewId)
        : table
          ? node.viewId === TABLES_VIEW_ID ||
            domains.has(node.viewId) ||
            !!(view && table.domainId !== null && view.domainIds.includes(table.domainId))
          : false;
    if (!valid)
      add('layout-target-invalid', node.objectId, `/layout/nodes/${segment(node.id)}`, [
        node.objectId,
        node.viewId,
        table?.domainId,
        view?.domainIds,
        note?.viewId,
      ]);
  }
  for (const viewport of document.layout.viewports)
    if (!validView(viewport.viewId))
      add(
        'viewport-view-not-found',
        viewport.viewId,
        `/layout/viewports/${segment(viewport.viewId)}`,
        viewport.viewId,
      );
  for (const route of document.layout.relations ?? []) {
    const relation = relations.get(route.relationId);
    if (
      !validView(route.viewId) ||
      !relation ||
      ![relation.sourceTableId, relation.targetTableId].every((id) =>
        placements.has(JSON.stringify([route.viewId, id])),
      )
    )
      add(
        'relation-layout-invalid',
        route.relationId,
        `/layout/relations/${segment(route.viewId)}:${segment(route.relationId)}`,
        [
          route.viewId,
          route.relationId,
          validView(route.viewId),
          relation?.sourceTableId,
          relation?.targetTableId,
          relation &&
            [relation.sourceTableId, relation.targetTableId].filter(
              (id) => !placements.has(JSON.stringify([route.viewId, id])),
            ),
        ],
      );
  }
  return problems;
}
