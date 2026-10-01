import {
  nativeExpressionColumnIds,
  type NativeDesignDocument,
  type NativeExpression,
} from './native-document.js';

export const nativeDeletionCollections = [
  'tables',
  'columns',
  'keys',
  'enums',
  'indexes',
  'checks',
  'tableRelations',
] as const;
export type NativeDeletionCollection = (typeof nativeDeletionCollections)[number];
export interface NativeDeletionTarget {
  collection: NativeDeletionCollection;
  id: string;
}
export interface NativeDeletionBlocker {
  code: string;
  objectId: string;
  path: string;
  referencedIds: string[];
}
export interface NativeDeletionPlan {
  document: NativeDesignDocument;
  removed: NativeDeletionTarget[];
  logicalOnlyRelationIds: string[];
  cascadedColumnIds: string[];
  blockers: NativeDeletionBlocker[];
}
const segment = (id: string) => id.replaceAll('~', '~0').replaceAll('/', '~1');
const physical = (scope: string) => scope !== 'logical';
const keySignature = (tableId: string, ids: string[]) => JSON.stringify([tableId, ids]);

/** Previews data loss and blocking references; it never silently rewrites defaults or types. */
export function planNativeDeletion(
  source: NativeDesignDocument,
  targets: readonly NativeDeletionTarget[],
  options: { cascadeGeneratedColumns?: boolean } = {},
): NativeDeletionPlan {
  const document = JSON.parse(JSON.stringify(source)) as NativeDesignDocument;
  const remove = new Map<NativeDeletionCollection, Set<string>>(
    nativeDeletionCollections.map((collection) => [collection, new Set()]),
  );
  for (const target of targets) {
    if (
      !nativeDeletionCollections.includes(target.collection) ||
      !source[target.collection]?.some((item) => item.id === target.id)
    )
      throw new Error('deletion.object-not-found');
    remove.get(target.collection)!.add(target.id);
  }
  const removedTables = remove.get('tables')!;
  const removedColumns = remove.get('columns')!;
  for (const column of source.columns ?? [])
    if (removedTables.has(column.tableId)) removedColumns.add(column.id);
  const cascadedColumnIds: string[] = [];
  if (options.cascadeGeneratedColumns) {
    const dependents = new Map<string, string[]>();
    for (const column of source.columns ?? []) {
      const generation = column.physical.generation;
      if (generation.kind !== 'computed') continue;
      for (const id of nativeExpressionColumnIds(generation.expression)) {
        const bucket = dependents.get(id) ?? [];
        bucket.push(column.id);
        dependents.set(id, bucket);
      }
    }
    const queue = [...removedColumns];
    for (let index = 0; index < queue.length; index++) {
      for (const id of dependents.get(queue[index]!) ?? []) {
        if (removedColumns.has(id)) continue;
        removedColumns.add(id);
        cascadedColumnIds.push(id);
        queue.push(id);
      }
    }
  }
  const intersects = (ids: readonly string[]) => ids.some((id) => removedColumns.has(id));
  for (const key of source.keys ?? [])
    if (removedTables.has(key.tableId) || intersects(key.columnIds))
      remove.get('keys')!.add(key.id);
  for (const index of source.indexes ?? []) {
    const refs = index.parts.flatMap((part) => nativeExpressionColumnIds(part.expression));
    if ('predicate' in index.options && index.options.predicate)
      refs.push(...nativeExpressionColumnIds(index.options.predicate));
    if (index.options.database === 'postgresql')
      refs.push(...(index.options.includeColumnIds ?? []));
    if (removedTables.has(index.tableId) || intersects(refs)) remove.get('indexes')!.add(index.id);
  }
  for (const check of source.checks ?? [])
    if (removedTables.has(check.tableId) || intersects(nativeExpressionColumnIds(check.expression)))
      remove.get('checks')!.add(check.id);
  for (const collection of ['tables', 'columns', 'keys', 'enums', 'indexes', 'checks'] as const) {
    // All collections are filtered by identity without altering surviving native payloads.
    if (document[collection])
      (document as unknown as Record<string, unknown>)[collection] = document[collection]!.filter(
        (item) => !remove.get(collection)!.has(item.id),
      );
  }
  const removedKeys = new Set(
    (source.keys ?? [])
      .filter((key) => physical(key.scope) && remove.get('keys')!.has(key.id))
      .map((key) => keySignature(key.tableId, key.columnIds)),
  );
  const remainingKeys = new Set(
    (document.keys ?? [])
      .filter((key) => physical(key.scope))
      .map((key) => keySignature(key.tableId, key.columnIds)),
  );
  const logicalOnlyRelationIds: string[] = [];
  const relations = (source.tableRelations ?? []).flatMap((relation) => {
    if (
      remove.get('tableRelations')!.has(relation.id) ||
      removedTables.has(relation.sourceTableId) ||
      removedTables.has(relation.targetTableId)
    ) {
      remove.get('tableRelations')!.add(relation.id);
      return [];
    }
    const fk = relation.physical;
    const lostColumn = fk && intersects([...fk.sourceColumnIds, ...fk.targetColumnIds]);
    const signature = fk && keySignature(relation.targetTableId, fk.targetColumnIds);
    const lostKey = signature && removedKeys.has(signature) && !remainingKeys.has(signature);
    if (!lostColumn && !lostKey) return [JSON.parse(JSON.stringify(relation))];
    if (relation.scope === 'physical') {
      remove.get('tableRelations')!.add(relation.id);
      return [];
    }
    logicalOnlyRelationIds.push(relation.id);
    const { deferrable: _deferrable, ...logical } = relation;
    return [{ ...logical, scope: 'logical' as const, physical: null }];
  });
  if (source.tableRelations) document.tableRelations = relations;
  document.layout.nodes = document.layout.nodes.filter((node) => !removedTables.has(node.objectId));
  if (document.layout.relations)
    document.layout.relations = document.layout.relations.filter(
      (route) => !remove.get('tableRelations')!.has(route.relationId),
    );
  const blockers: NativeDeletionBlocker[] = [];
  const expressionBlocker = (expression: NativeExpression, objectId: string, path: string) => {
    const referencedIds = nativeExpressionColumnIds(expression).filter((id) =>
      removedColumns.has(id),
    );
    if (referencedIds.length)
      blockers.push({ code: 'deletion.expression-dependent', objectId, path, referencedIds });
  };
  for (const column of document.columns ?? []) {
    const path = `/columns/${segment(column.id)}/physical`;
    if (column.physical.generation.kind === 'computed')
      expressionBlocker(column.physical.generation.expression, column.id, `${path}/generation`);
    if (column.physical.defaultValue.kind === 'expression')
      expressionBlocker(column.physical.defaultValue.expression, column.id, `${path}/defaultValue`);
    if (column.physical.options.database === 'mysql' && column.physical.options.onUpdate)
      expressionBlocker(column.physical.options.onUpdate, column.id, `${path}/options/onUpdate`);
    const type = column.physical.type;
    const enumId =
      type.kind === 'projectEnum'
        ? type.enumId
        : type.kind === 'legacy'
          ? type.original.enumId
          : undefined;
    if (enumId && remove.get('enums')!.has(enumId))
      blockers.push({
        code: 'deletion.enum-dependent',
        objectId: column.id,
        path: `${path}/type`,
        referencedIds: [enumId],
      });
  }
  const supportsGeneration = (doc: NativeDesignDocument, columnId: string) => {
    const column = doc.columns?.find((item) => item.id === columnId)!;
    const keys = (doc.keys ?? []).filter(
      (key) => key.tableId === column.tableId && physical(key.scope),
    );
    if (doc.database.kind === 'sqlite')
      return keys.some(
        (key) =>
          key.kind === 'primary' && key.columnIds.length === 1 && key.columnIds[0] === columnId,
      );
    return (
      keys.some((key) => key.columnIds[0] === columnId) ||
      (doc.indexes ?? []).some(
        (index) =>
          index.tableId === column.tableId &&
          physical(index.scope) &&
          index.parts[0]?.expression.kind === 'column' &&
          index.parts[0].expression.columnId === columnId,
      )
    );
  };
  for (const column of document.columns ?? [])
    if (
      column.physical.generation.kind === 'autoIncrement' &&
      supportsGeneration(source, column.id) &&
      !supportsGeneration(document, column.id)
    )
      blockers.push({
        code: 'deletion.generation-key-required',
        objectId: column.id,
        path: `/columns/${segment(column.id)}/physical/generation`,
        referencedIds: [],
      });
  for (const table of document.tables ?? [])
    if (
      table.physical.options.database === 'sqlite' &&
      table.physical.options.withoutRowid &&
      (source.keys ?? []).some(
        (key) => key.tableId === table.id && physical(key.scope) && key.kind === 'primary',
      ) &&
      !(document.keys ?? []).some(
        (key) => key.tableId === table.id && physical(key.scope) && key.kind === 'primary',
      )
    )
      blockers.push({
        code: 'deletion.primary-key-required',
        objectId: table.id,
        path: `/tables/${segment(table.id)}/physical/options/withoutRowid`,
        referencedIds: [],
      });
  return {
    document,
    removed: nativeDeletionCollections.flatMap((collection) =>
      [...remove.get(collection)!].sort().map((id) => ({ collection, id })),
    ),
    logicalOnlyRelationIds,
    cascadedColumnIds,
    blockers,
  };
}

/** Callers still validate the final candidate against trusted storage/context before saving. */
export function deleteNativeObjects(
  source: NativeDesignDocument,
  targets: readonly NativeDeletionTarget[],
  options: { cascadeGeneratedColumns?: boolean } = {},
): NativeDesignDocument {
  const plan = planNativeDeletion(source, targets, options);
  if (plan.blockers.length) throw new Error(plan.blockers[0]!.code);
  return plan.document;
}
