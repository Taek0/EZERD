import { TABLES_VIEW_ID } from '../document.js';
import { getDatabaseProfile } from './profiles.js';
import {
  mapNativeExpressionColumns,
  type NativeDesignDocument,
  type NativeColumn,
  type NativeIndex,
} from './native-document.js';

export interface NativeIdentityRemap {
  entities: ReadonlyMap<string, string>;
  nodes: ReadonlyMap<string, string>;
  /** Live identities which the caller deliberately preserves outside this fragment. */
  retainedEntityIds?: ReadonlySet<string>;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const validId = (id: string) =>
  typeof id === 'string' &&
  id.trim() === id &&
  id.length > 0 &&
  id.length <= 160 &&
  !['overview', TABLES_VIEW_ID].includes(id);

/** Changes only declared identities/reference fields, never SQL names, literal strings or legacy evidence. */
export function remapNativeDocumentIds(
  source: NativeDesignDocument,
  mapping: NativeIdentityRemap,
): NativeDesignDocument {
  getDatabaseProfile(source.database);
  const entityItems = [
    ...source.domains,
    ...source.domainRelations,
    ...source.notes,
    ...(source.views ?? []),
    ...(source.enums ?? []),
    ...(source.tables ?? []),
    ...(source.columns ?? []),
    ...(source.keys ?? []),
    ...(source.tableRelations ?? []),
    ...(source.indexes ?? []),
    ...(source.checks ?? []),
  ];
  const declaredSources = new Set<string>();
  const entityTargets = new Set<string>();
  const declared = (id: string) => {
    const target = mapping.entities.get(id);
    if (!target || !validId(target)) throw new Error('remap.identity-missing');
    return target;
  };
  for (const item of entityItems) {
    const target = declared(item.id);
    if (declaredSources.has(item.id) || entityTargets.has(target))
      throw new Error('remap.identity-collision');
    declaredSources.add(item.id);
    entityTargets.add(target);
  }
  const nodeSources = new Set<string>();
  const allTargets = new Set(entityTargets);
  for (const node of source.layout.nodes) {
    const target = mapping.nodes.get(node.id);
    if (!target || !validId(target)) throw new Error('remap.node-identity-missing');
    if (
      nodeSources.has(node.id) ||
      allTargets.has(target) ||
      mapping.retainedEntityIds?.has(target)
    )
      throw new Error('remap.identity-collision');
    nodeSources.add(node.id);
    allTargets.add(target);
  }
  const reference = (id: string) => {
    const target = mapping.entities.get(id);
    if (mapping.entities.has(id)) {
      if (
        target &&
        validId(target) &&
        (entityTargets.has(target) || mapping.retainedEntityIds?.has(target))
      )
        return target;
      throw new Error('remap.reference-missing');
    }
    if (mapping.retainedEntityIds?.has(id)) return id;
    throw new Error('remap.reference-missing');
  };
  const view = (id: string) => (['overview', TABLES_VIEW_ID].includes(id) ? id : reference(id));
  const expression = (value: Parameters<typeof mapNativeExpressionColumns>[0]) =>
    mapNativeExpressionColumns(value, reference);
  const column = (item: NativeColumn): NativeColumn => {
    const next = clone(item);
    next.id = declared(item.id);
    next.tableId = reference(item.tableId);
    if (item.physical.type.kind === 'projectEnum')
      next.physical.type = {
        ...clone(item.physical.type),
        enumId: reference(item.physical.type.enumId),
      };
    if (item.physical.generation.kind === 'computed')
      next.physical.generation = {
        ...clone(item.physical.generation),
        expression: expression(item.physical.generation.expression),
      };
    if (item.physical.defaultValue.kind === 'expression')
      next.physical.defaultValue = {
        kind: 'expression',
        expression: expression(item.physical.defaultValue.expression),
      };
    if (item.physical.options.database === 'mysql' && item.physical.options.onUpdate)
      next.physical.options = {
        ...clone(item.physical.options),
        onUpdate: expression(item.physical.options.onUpdate),
      };
    return next;
  };
  const index = (item: NativeIndex): NativeIndex => {
    const next = clone(item);
    next.id = declared(item.id);
    next.tableId = reference(item.tableId);
    next.parts = item.parts.map((part) => ({
      ...clone(part),
      expression: expression(part.expression),
    }));
    if (item.options.database === 'postgresql')
      next.options = {
        ...clone(item.options),
        ...(item.options.predicate && { predicate: expression(item.options.predicate) }),
        ...(item.options.includeColumnIds && {
          includeColumnIds: item.options.includeColumnIds.map(reference),
        }),
      };
    else if (item.options.database === 'sqlite')
      next.options = {
        ...clone(item.options),
        ...(item.options.predicate && { predicate: expression(item.options.predicate) }),
      };
    return next;
  };
  const next = clone(source);
  next.domains = source.domains.map((item) => ({ ...clone(item), id: declared(item.id) }));
  next.domainRelations = source.domainRelations.map((item) => ({
    ...clone(item),
    id: declared(item.id),
    sourceDomainId: reference(item.sourceDomainId),
    targetDomainId: reference(item.targetDomainId),
  }));
  next.notes = source.notes.map((item) => ({
    ...clone(item),
    id: declared(item.id),
    viewId: view(item.viewId),
  }));
  if (source.views)
    next.views = source.views.map((item) => ({
      ...clone(item),
      id: declared(item.id),
      domainIds: item.domainIds.map(reference),
    }));
  if (source.enums)
    next.enums = source.enums.map((item) => ({ ...clone(item), id: declared(item.id) }));
  if (source.tables)
    next.tables = source.tables.map((item) => ({
      ...clone(item),
      id: declared(item.id),
      domainId: item.domainId === null ? null : reference(item.domainId),
    }));
  if (source.columns) next.columns = source.columns.map(column);
  if (source.keys)
    next.keys = source.keys.map((item) => ({
      ...clone(item),
      id: declared(item.id),
      tableId: reference(item.tableId),
      columnIds: item.columnIds.map(reference),
    }));
  if (source.tableRelations)
    next.tableRelations = source.tableRelations.map((item) => ({
      ...clone(item),
      id: declared(item.id),
      sourceTableId: reference(item.sourceTableId),
      targetTableId: reference(item.targetTableId),
      physical: item.physical
        ? {
            ...clone(item.physical),
            sourceColumnIds: item.physical.sourceColumnIds.map(reference),
            targetColumnIds: item.physical.targetColumnIds.map(reference),
          }
        : null,
    }));
  if (source.indexes) next.indexes = source.indexes.map(index);
  if (source.checks)
    next.checks = source.checks.map((item) => ({
      ...clone(item),
      id: declared(item.id),
      tableId: reference(item.tableId),
      expression: expression(item.expression),
    }));
  next.layout.nodes = source.layout.nodes.map((item) => ({
    ...clone(item),
    id: mapping.nodes.get(item.id)!,
    objectId: reference(item.objectId),
    viewId: view(item.viewId),
  }));
  next.layout.viewports = source.layout.viewports.map((item) => ({
    ...clone(item),
    viewId: view(item.viewId),
  }));
  if (source.layout.relations)
    next.layout.relations = source.layout.relations.map((item) => ({
      ...clone(item),
      relationId: reference(item.relationId),
      viewId: view(item.viewId),
    }));
  return next;
}
