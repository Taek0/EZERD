import type { DesignDocument } from './document.js';
import type { NativeDesignDocument } from './database/native-document.js';
import { nativeExpressionColumnIds } from './database/native-document.js';
type SyncDocument = DesignDocument | NativeDesignDocument;

export interface DocumentChange {
  path: string;
  before: unknown;
  after: unknown;
  beforeExists?: boolean;
  afterExists?: boolean;
}

export interface DocumentOperation<T extends SyncDocument = DesignDocument> {
  operationId: string;
  baseSequence: number;
  kind: 'online' | 'reconnect';
  changes: readonly DocumentChange[];
  dependencyPaths?: readonly string[];
  document?: T;
}

const entityCollections = new Set([
  'views',
  'enums',
  'tables',
  'columns',
  'keys',
  'tableRelations',
  'domains',
  'domainRelations',
  'notes',
  'indexes',
  'checks',
  'nodes',
  'relations',
]);

const clone = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
const escapeSegment = (value: string) => value.replace(/~/g, '~0').replace(/\//g, '~1');
const unescapeSegment = (value: string) => value.replace(/~1/g, '/').replace(/~0/g, '~');

export function normalizeSyncPath(path: string): string {
  const segments = path.split('/').filter(Boolean).map(unescapeSegment);
  if (!segments.length || segments.some((segment) => !segment.length))
    throw new Error('Invalid sync path.');
  return `/${segments.map(escapeSegment).join('/')}`;
}

function combinedViewIds(document: SyncDocument): Set<string> {
  return new Set((document.views ?? []).map((view) => view.id));
}

/** Removes state that belongs to a browser or is regenerated from original shared layouts. */
export function sharedDocument<T extends SyncDocument>(
  document: T,
  additionalCombinedViewIds: ReadonlySet<string> = new Set(),
): T {
  const combinedIds = new Set([...combinedViewIds(document), ...additionalCombinedViewIds]);
  const { views: _personalViews, ...withoutPersonalViews } = document;
  return clone({
    ...withoutPersonalViews,
    notes: document.notes.filter((note) => !combinedIds.has(note.viewId)),
    enums: document.enums ?? [],
    tables: document.tables ?? [],
    columns: document.columns ?? [],
    keys: document.keys ?? [],
    tableRelations: document.tableRelations ?? [],
    ...(document.schemaVersion === 2 && {
      indexes: document.indexes ?? [],
      checks: document.checks ?? [],
    }),
    layout: {
      ...document.layout,
      nodes: document.layout.nodes.filter((node) => !combinedIds.has(node.viewId)),
      viewports: [],
      ...(document.layout.relations && {
        relations: document.layout.relations.filter((route) => !combinedIds.has(route.viewId)),
      }),
      ...(!document.layout.relations && { relations: [] }),
    },
  }) as unknown as T;
}

function keyedArray(value: unknown[]): value is Array<{ id: string }> {
  return value.every(
    (item) =>
      !!item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string',
  );
}

function atomicPath(path: string): 'position' | 'size' | 'value' | null {
  if (/^\/columns\/[^/]+\/physical\/(generation|defaultValue|options)$/.test(path)) return 'value';
  if (/^\/tables\/[^/]+\/physical\/(namespace|options)$/.test(path)) return 'value';
  if (/^\/indexes\/[^/]+\/(parts|options)$/.test(path)) return 'value';
  if (/^\/checks\/[^/]+\/expression$/.test(path)) return 'value';
  if (/^\/(keys|tableRelations)\/[^/]+\/deferrable$/.test(path)) return 'value';
  if (/^\/layout\/nodes\/[^/]+$/.test(path)) return null;
  if (/^\/columns\/[^/]+\/physical\/type$/.test(path)) return 'value';
  if (/^\/tableRelations\/[^/]+\/physical$/.test(path)) return 'value';
  if (/^\/layout\/relations\/[^/]+$/.test(path)) return 'value';
  if (/^\/keys\/[^/]+\/columnIds$/.test(path)) return 'value';
  return null;
}

function pushChange(
  output: DocumentChange[],
  path: string,
  before: unknown,
  after: unknown,
  beforeExists = true,
  afterExists = true,
): void {
  output.push({
    path: normalizeSyncPath(path),
    before: clone(before ?? null),
    after: clone(after ?? null),
    ...(beforeExists ? {} : { beforeExists: false }),
    ...(afterExists ? {} : { afterExists: false }),
  });
}

function routeKey(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null;
  const route = item as { viewId?: unknown; relationId?: unknown };
  return typeof route.viewId === 'string' && typeof route.relationId === 'string'
    ? `${route.viewId}:${route.relationId}`
    : null;
}

function diffValue(
  before: unknown,
  after: unknown,
  path: string,
  output: DocumentChange[],
  native = false,
): void {
  if (Object.is(before, after)) return;
  const routes =
    path === '/layout/relations' &&
    Array.isArray(before) &&
    Array.isArray(after) &&
    [...before, ...after].every((item) => routeKey(item) !== null);
  const keyedItems =
    Array.isArray(before) &&
    Array.isArray(after) &&
    ((keyedArray(before) && keyedArray(after)) || routes);
  if (
    Array.isArray(before) &&
    Array.isArray(after) &&
    !keyedItems &&
    stable(before) === stable(after)
  )
    return;
  if (Array.isArray(before) && Array.isArray(after) && keyedItems) {
    const itemKey = routes
      ? (item: unknown) => routeKey(item)!
      : (item: unknown) => (item as { id: string }).id;
    const oldItems = new Map(before.map((item) => [itemKey(item), item]));
    const newItems = new Map(after.map((item) => [itemKey(item), item]));
    if (native && !routes) {
      // All inverse creations must run before original-order moves, including deleted anchors.
      // v1 claims stay byte-compatible; only native envelopes carry this ordering metadata.
      for (let index = before.length - 1; index >= 0; index--) {
        const id = itemKey(before[index]);
        if (newItems.has(id)) continue;
        pushChange(
          output,
          `${path}/@move/${escapeSegment(id)}`,
          index > 0 ? itemKey(before[index - 1]) : null,
          null,
        );
      }
    }
    for (const id of [...new Set([...oldItems.keys(), ...newItems.keys()])].sort()) {
      const childPath = `${path}/${escapeSegment(id)}`;
      if (!oldItems.has(id)) pushChange(output, childPath, null, newItems.get(id), false, true);
      else if (!newItems.has(id))
        pushChange(output, childPath, oldItems.get(id), null, true, false);
      else diffValue(oldItems.get(id), newItems.get(id), childPath, output, native);
    }
    const group = (item: unknown) =>
      path === '/columns' ? String((item as { tableId?: unknown }).tableId ?? '') : '';
    const groups = new Set([...before, ...after].map(group));
    if (!routes)
      for (const groupId of groups) {
        const oldOrder = before.filter((item) => group(item) === groupId).map(itemKey);
        const newOrder = after.filter((item) => group(item) === groupId).map(itemKey);
        const oldSurvivors = oldOrder.filter((id) => newItems.has(id));
        const reorderedExisting = newOrder.filter((id) => oldItems.has(id));
        const existingReordered = oldSurvivors.some((id, index) => id !== reorderedExisting[index]);
        const additions = newOrder.filter((id) => !oldItems.has(id)).sort();
        const working = [...oldSurvivors, ...additions];
        for (let index = 0; index < newOrder.length; index++) {
          const id = newOrder[index]!;
          if (working[index] === id || (!existingReordered && oldItems.has(id))) continue;
          pushChange(
            output,
            `${path}/@move/${escapeSegment(id)}`,
            working[working.indexOf(id) - 1] ?? null,
            newOrder[index - 1] ?? null,
          );
          working.splice(working.indexOf(id), 1);
          working.splice(index, 0, id);
        }
      }
    return;
  }
  if (
    before &&
    after &&
    typeof before === 'object' &&
    typeof after === 'object' &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const oldObject = before as Record<string, unknown>;
    const newObject = after as Record<string, unknown>;
    if (/^\/layout\/nodes\/[^/]+$/.test(path)) {
      if (oldObject.x !== newObject.x || oldObject.y !== newObject.y)
        pushChange(
          output,
          `${path}/position`,
          { x: oldObject.x, y: oldObject.y },
          { x: newObject.x, y: newObject.y },
        );
      if (oldObject.width !== newObject.width || oldObject.height !== newObject.height)
        pushChange(
          output,
          `${path}/size`,
          { width: oldObject.width, height: oldObject.height },
          { width: newObject.width, height: newObject.height },
        );
      for (const key of [...new Set([...Object.keys(oldObject), ...Object.keys(newObject)])].sort())
        if (!['x', 'y', 'width', 'height'].includes(key))
          diffValue(
            oldObject[key],
            newObject[key],
            `${path}/${escapeSegment(key)}`,
            output,
            native,
          );
      return;
    }
    if (atomicPath(path)) {
      if (stable(oldObject) !== stable(newObject)) pushChange(output, path, oldObject, newObject);
      return;
    }
    for (const key of [...new Set([...Object.keys(oldObject), ...Object.keys(newObject)])].sort()) {
      const oldHas = Object.hasOwn(oldObject, key);
      const newHas = Object.hasOwn(newObject, key);
      if (!oldHas || !newHas)
        pushChange(
          output,
          `${path}/${escapeSegment(key)}`,
          oldObject[key],
          newObject[key],
          oldHas,
          newHas,
        );
      else
        diffValue(oldObject[key], newObject[key], `${path}/${escapeSegment(key)}`, output, native);
    }
    return;
  }
  pushChange(output, path, before, after);
}

export function diffSharedDocument<T extends SyncDocument>(before: T, after: T): DocumentChange[] {
  assertSameSyncContext(before, after);
  const output: DocumentChange[] = [];
  const combinedIds = new Set([...combinedViewIds(before), ...combinedViewIds(after)]);
  diffValue(
    sharedDocument(before, combinedIds),
    sharedDocument(after, combinedIds),
    '',
    output,
    before.schemaVersion === 2,
  );
  return output;
}

/** Semantic ID-based changes derived from the trusted baseline and validated final candidate. */
export const deriveOperationChanges = diffSharedDocument;

type StructuralEntity =
  | NonNullable<DesignDocument['tableRelations']>[number]
  | NonNullable<DesignDocument['keys']>[number]
  | NonNullable<SyncDocument['columns']>[number]
  | NonNullable<NativeDesignDocument['indexes']>[number]
  | NonNullable<NativeDesignDocument['checks']>[number];

function changedEntity<T extends StructuralEntity>(
  candidateItems: readonly T[] | undefined,
  collection: string,
  id: string,
  changes: readonly DocumentChange[],
): T | undefined {
  const current = candidateItems?.find((item) => item.id === id);
  if (current) return current;
  const entityChange = changes.find((change) => {
    const segments = normalizeSyncPath(change.path).split('/').slice(1).map(unescapeSegment);
    return segments.length === 2 && segments[0] === collection && segments[1] === id;
  });
  const snapshot =
    entityChange?.afterExists === false
      ? entityChange.before
      : (entityChange?.after ?? entityChange?.before);
  return snapshot && typeof snapshot === 'object' ? (snapshot as T) : undefined;
}

/**
 * Derives the structural read-set from the validated candidate and server-derived writes.
 * Returned entity paths cover object existence as well as every descendant field version.
 */
export function deriveStructuralDependencyPaths(
  candidate: SyncDocument,
  changes: readonly DocumentChange[],
): string[] {
  const dependencies = new Set<string>();
  const add = (collection: string, id: string | undefined, property = '@exists') => {
    if (id) dependencies.add(`/${collection}/${escapeSegment(id)}/${property}`);
  };
  const changed = new Map<string, Set<string>>();
  for (const change of changes) {
    const [collection, id] = normalizeSyncPath(change.path)
      .split('/')
      .slice(1)
      .map(unescapeSegment);
    if (
      !collection ||
      !id ||
      !['tableRelations', 'keys', 'columns', 'indexes', 'checks'].includes(collection)
    )
      continue;
    const ids = changed.get(collection) ?? new Set<string>();
    ids.add(id);
    changed.set(collection, ids);
  }

  for (const id of changed.get('tableRelations') ?? []) {
    const relation = changedEntity(candidate.tableRelations, 'tableRelations', id, changes);
    if (!relation || !('sourceTableId' in relation) || !('targetTableId' in relation)) continue;
    add('tables', relation.sourceTableId);
    add('tables', relation.targetTableId);
    for (const columnId of [
      ...(relation.physical?.sourceColumnIds ?? []),
      ...(relation.physical?.targetColumnIds ?? []),
    ]) {
      add('columns', columnId);
      add('columns', columnId, 'tableId');
      add('columns', columnId, 'physical/type');
    }
    if (relation.physical) {
      for (const key of candidate.keys ?? []) {
        if (key.tableId !== relation.targetTableId || !['primary', 'unique'].includes(key.kind))
          continue;
        if (
          key.columnIds.length !== relation.physical.targetColumnIds.length ||
          key.columnIds.some(
            (columnId, index) => columnId !== relation.physical!.targetColumnIds[index],
          )
        )
          continue;
        add('keys', key.id);
        add('keys', key.id, 'tableId');
        add('keys', key.id, 'kind');
        add('keys', key.id, 'columnIds');
      }
    }
  }
  for (const id of changed.get('keys') ?? []) {
    const key = changedEntity(candidate.keys, 'keys', id, changes);
    if (!key || !('tableId' in key) || !('columnIds' in key)) continue;
    add('tables', key.tableId);
    for (const columnId of key.columnIds) {
      add('columns', columnId);
      add('columns', columnId, 'tableId');
    }
  }
  for (const id of changed.get('columns') ?? []) {
    const column = changedEntity<NonNullable<SyncDocument['columns']>[number]>(
      candidate.columns,
      'columns',
      id,
      changes,
    );
    if (!column || !('tableId' in column) || !('physical' in column)) continue;
    add('tables', column.tableId);
    const type = column.physical.type;
    add('enums', 'enumId' in type ? type.enumId : undefined);
  }
  if (candidate.schemaVersion === 2) {
    const columnDependency = (id: string) => {
      for (const property of [
        '@exists',
        'tableId',
        'scope',
        'physical/type',
        'physical/generation',
        'physical/options',
        'physical/nullable',
      ])
        add('columns', id, property);
    };
    const tableDependency = (id: string) => {
      for (const property of ['@exists', 'scope', 'physical/options', 'physical/namespace'])
        add('tables', id, property);
    };
    const expressionDependency = (expression: Parameters<typeof nativeExpressionColumnIds>[0]) => {
      for (const id of nativeExpressionColumnIds(expression)) columnDependency(id);
    };
    for (const id of changed.get('columns') ?? []) {
      const column = changedEntity(candidate.columns, 'columns', id, changes);
      if (!column) continue;
      tableDependency(column.tableId);
      const physical = column.physical;
      if (physical.generation.kind === 'computed')
        expressionDependency(physical.generation.expression);
      if (physical.defaultValue.kind === 'expression')
        expressionDependency(physical.defaultValue.expression);
      if (physical.options.database === 'mysql' && physical.options.onUpdate)
        expressionDependency(physical.options.onUpdate);
    }
    for (const id of changed.get('keys') ?? []) {
      const key = changedEntity(candidate.keys, 'keys', id, changes);
      if (!key) continue;
      tableDependency(key.tableId);
      for (const columnId of key.columnIds) columnDependency(columnId);
    }
    for (const id of changed.get('tableRelations') ?? []) {
      const relation = changedEntity(candidate.tableRelations, 'tableRelations', id, changes);
      if (!relation) continue;
      tableDependency(relation.sourceTableId);
      tableDependency(relation.targetTableId);
      for (const columnId of [
        ...(relation.physical?.sourceColumnIds ?? []),
        ...(relation.physical?.targetColumnIds ?? []),
      ])
        columnDependency(columnId);
    }
    for (const id of changed.get('indexes') ?? []) {
      const index = changedEntity(candidate.indexes, 'indexes', id, changes);
      if (!index) continue;
      tableDependency(index.tableId);
      for (const part of index.parts) expressionDependency(part.expression);
      if ('predicate' in index.options && index.options.predicate)
        expressionDependency(index.options.predicate);
      if (index.options.database === 'postgresql')
        for (const columnId of index.options.includeColumnIds ?? []) columnDependency(columnId);
    }
    for (const id of changed.get('checks') ?? []) {
      const check = changedEntity(candidate.checks, 'checks', id, changes);
      if (!check) continue;
      tableDependency(check.tableId);
      expressionDependency(check.expression);
    }
  }
  return [...dependencies].sort();
}

export function claimedChangesMatch(
  derived: readonly DocumentChange[],
  claimed: readonly DocumentChange[],
): boolean {
  return requestFingerprint(derived) === requestFingerprint(claimed);
}

function stable(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(object[key])}`)
    .join(',')}}`;
}

/** Returns whether a stored change changes either value or property existence. */
export function isEffectiveChange(change: {
  before: unknown;
  after: unknown;
  beforeExists?: boolean | undefined;
  afterExists?: boolean | undefined;
}): boolean {
  const beforeExists = change.beforeExists !== false;
  const afterExists = change.afterExists !== false;
  if (beforeExists !== afterExists) return true;
  if (!beforeExists) return false;
  return stable(change.before) !== stable(change.after);
}

/** Canonical, hash-free request identity; server-authenticated actor data is intentionally absent. */
export function requestFingerprint(request: unknown): string {
  return stable(request);
}

export type FieldVersions = ReadonlyMap<string, number> | Readonly<Record<string, number>>;

function versionAt(versions: FieldVersions, path: string): number {
  if ('get' in versions && typeof versions.get === 'function') return versions.get(path) ?? 0;
  return (versions as Readonly<Record<string, number>>)[path] ?? 0;
}

function pathAndAncestors(path: string): string[] {
  const parts = normalizeSyncPath(path).split('/').slice(1);
  return parts.map((_, index) => `/${parts.slice(0, index + 1).join('/')}`);
}

function versionEntries(versions: FieldVersions): Array<[string, number]> {
  return 'entries' in versions && typeof versions.entries === 'function'
    ? [...versions.entries()]
    : Object.entries(versions as Readonly<Record<string, number>>);
}

function hasNewerOverlap(path: string, baseSequence: number, versions: FieldVersions): boolean {
  return (
    pathAndAncestors(path).some((candidate) => versionAt(versions, candidate) > baseSequence) ||
    versionEntries(versions).some(
      ([versionPath, version]) => versionPath.startsWith(`${path}/`) && version > baseSequence,
    )
  );
}

/** Online writes are ordered by the server, while structural reads still protect their baseline. */
export function findFieldVersionConflicts(
  operation: Pick<DocumentOperation, 'kind' | 'baseSequence' | 'changes' | 'dependencyPaths'>,
  versions: FieldVersions,
): string[] {
  const guardedPaths = [
    ...(operation.kind === 'reconnect' ? operation.changes.map((change) => change.path) : []),
    ...(operation.dependencyPaths ?? []),
  ];
  return guardedPaths
    .map(normalizeSyncPath)
    .filter((path) => hasNewerOverlap(path, operation.baseSequence, versions));
}

export function canApplyOperation(
  operation: Pick<DocumentOperation, 'kind' | 'baseSequence' | 'changes' | 'dependencyPaths'>,
  versions: FieldVersions,
): boolean {
  return findFieldVersionConflicts(operation, versions).length === 0;
}

function locate(container: unknown, segment: string): unknown {
  if (Array.isArray(container))
    return container.find(
      (item) =>
        item &&
        typeof item === 'object' &&
        ((item as { id?: unknown }).id === segment || routeKey(item) === segment),
    );
  if (container && typeof container === 'object')
    return (container as Record<string, unknown>)[segment];
  return undefined;
}

function applyChange(root: Record<string, unknown>, change: DocumentChange): void {
  const segments = normalizeSyncPath(change.path).split('/').slice(1).map(unescapeSegment);
  const moveIndex = segments.indexOf('@move');
  if (moveIndex >= 0) {
    let collection: unknown = root;
    for (const segment of segments.slice(0, moveIndex)) collection = locate(collection, segment);
    if (!Array.isArray(collection)) throw new Error(`Missing sync target: ${change.path}`);
    const id = segments[moveIndex + 1]!;
    const index = collection.findIndex(
      (item) => item && typeof item === 'object' && (item as { id?: unknown }).id === id,
    );
    if (index < 0) throw new Error(`Missing sync target: ${change.path}`);
    const [item] = collection.splice(index, 1);
    const anchor =
      typeof change.after === 'string'
        ? collection.findIndex(
            (candidate) =>
              candidate &&
              typeof candidate === 'object' &&
              (candidate as { id?: unknown }).id === change.after,
          )
        : -1;
    if (typeof change.after === 'string' && anchor < 0)
      throw new Error(`Missing sync move anchor: ${change.after}`);
    collection.splice(anchor + 1, 0, item);
    return;
  }
  const final = segments.pop()!;
  let parent: unknown = root;
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex]!;
    let next = locate(parent, segment);
    const canMaterializeCollection =
      change.beforeExists === false &&
      parent &&
      typeof parent === 'object' &&
      !Array.isArray(parent) &&
      ((segmentIndex === 0 && entityCollections.has(segment)) ||
        (segmentIndex === 1 &&
          segments[0] === 'layout' &&
          ['nodes', 'relations'].includes(segment)));
    if (next === undefined && canMaterializeCollection) {
      next = [];
      (parent as Record<string, unknown>)[segment] = next;
    }
    // Throwing makes the caller reject the whole atomic bundle; no partial result escapes the clone.
    if (next === undefined) throw new Error(`Missing sync target: ${change.path}`);
    parent = next;
  }
  if (
    (final === 'position' || final === 'size') &&
    parent &&
    typeof parent === 'object' &&
    change.after &&
    typeof change.after === 'object'
  ) {
    Object.assign(parent, clone(change.after));
    return;
  }
  if (Array.isArray(parent)) {
    const index = parent.findIndex(
      (item) =>
        item &&
        typeof item === 'object' &&
        ((item as { id?: unknown }).id === final || routeKey(item) === final),
    );
    if (isDeletionChange(change) && index >= 0) parent.splice(index, 1);
    else if (index >= 0) parent[index] = clone(change.after);
    else if (
      (change.beforeExists === false || change.before === null) &&
      change.after &&
      typeof change.after === 'object'
    )
      parent.push(clone(change.after));
    else throw new Error(`Missing sync target: ${change.path}`);
    return;
  }
  if (parent && typeof parent === 'object') {
    if (change.afterExists === false) delete (parent as Record<string, unknown>)[final];
    else (parent as Record<string, unknown>)[final] = clone(change.after);
  }
}

function assertSameSyncContext(before: SyncDocument, after: SyncDocument): void {
  if (before.schemaVersion !== after.schemaVersion) throw new Error('document.upgrade-required');
  if (
    before.schemaVersion === 2 &&
    after.schemaVersion === 2 &&
    requestFingerprint(before.database) !== requestFingerprint(after.database)
  )
    throw new Error('database.context-changed');
}

export function applyChanges<T extends SyncDocument>(
  document: T,
  changes: readonly DocumentChange[],
): T {
  const next = clone(document) as unknown as Record<string, unknown>;
  for (const change of changes) {
    const root = normalizeSyncPath(change.path).split('/')[1];
    if (root === 'schemaVersion' || root === 'database')
      throw new Error(
        root === 'database' ? 'database.context-changed' : 'document.upgrade-required',
      );
    applyChange(next, change);
  }
  return next as unknown as T;
}

/** Applies only the candidate's semantic paths to current server state, preserving disjoint edits. */
export function mergeCandidateOntoDocument<T extends SyncDocument>(
  baseline: T,
  current: T,
  finalCandidate: T,
): { document: T; changes: DocumentChange[] } {
  assertSameSyncContext(baseline, current);
  const changes = deriveOperationChanges(baseline, finalCandidate);
  return { document: applyChanges(current, changes), changes };
}

export function applyOperationOverlay<T extends SyncDocument>(
  document: T,
  operation: Pick<DocumentOperation<SyncDocument>, 'changes' | 'document'>,
): T {
  if (operation.document) assertSameSyncContext(document, operation.document);
  return applyChanges(document, operation.changes);
}

export function applyOperationsOverlay<T extends SyncDocument>(
  document: T,
  operations: readonly Pick<DocumentOperation<SyncDocument>, 'changes' | 'document'>[],
): T {
  return operations.reduce(
    (current, operation) => applyOperationOverlay(current, operation),
    document,
  );
}

/** Builds a compensating edit from the accepted operation itself, without copying later remote state. */
export function inverseChanges(changes: readonly DocumentChange[]): DocumentChange[] {
  return [...changes].reverse().map((change) => ({
    path: normalizeSyncPath(change.path),
    before: clone(change.after),
    after: clone(change.before),
    ...(change.afterExists === false ? { beforeExists: false } : {}),
    ...(change.beforeExists === false ? { afterExists: false } : {}),
  }));
}

/** Undo is safe only while edited fields and their declared structural dependencies are unchanged. */
export function findInverseConflicts(
  changes: readonly DocumentChange[],
  acceptedSequence: number,
  versions: FieldVersions,
  dependencyPaths: readonly string[] = [],
): string[] {
  const candidates = [...changes.map((change) => change.path), ...dependencyPaths].map(
    normalizeSyncPath,
  );
  return [
    ...new Set(candidates.filter((path) => hasNewerOverlap(path, acceptedSequence, versions))),
  ];
}

export function canApplyInverse(
  changes: readonly DocumentChange[],
  acceptedSequence: number,
  versions: FieldVersions,
  dependencyPaths: readonly string[] = [],
): boolean {
  return findInverseConflicts(changes, acceptedSequence, versions, dependencyPaths).length === 0;
}

/** An ACK removes exactly its operation, preserving edits queued after it. */
export function retainPendingOperations<T extends { operationId: string }>(
  pending: readonly T[],
  acknowledgedOperationId: string,
): T[] {
  return pending.filter((operation) => operation.operationId !== acknowledgedOperationId);
}

export function isDeletionChange(change: DocumentChange): boolean {
  const parts = normalizeSyncPath(change.path).split('/').slice(1);
  const entityPath =
    (parts.length === 2 && entityCollections.has(parts[0]!)) ||
    (parts.length === 3 && parts[0] === 'layout' && entityCollections.has(parts[1]!));
  return (
    entityPath &&
    !!change.before &&
    typeof change.before === 'object' &&
    (change.afterExists === false || change.after === null)
  );
}

export function deletionSnapshots(
  changes: readonly DocumentChange[],
): Array<{ path: string; snapshot: unknown }> {
  return changes
    .filter(isDeletionChange)
    .map((change) => ({ path: normalizeSyncPath(change.path), snapshot: clone(change.before) }));
}
