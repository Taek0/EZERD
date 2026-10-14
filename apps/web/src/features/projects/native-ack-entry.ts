import type { NativeSyncOperationResult } from '@ezerd/contracts';
import {
  extractPersonalState,
  applyChanges,
  mergeStoredPersonalState,
  normalizeSharedTableCanvas,
  reconcilePersonalState,
  TABLES_VIEW_ID,
  validateDatabaseDocument,
} from '@ezerd/model';
import type { ProjectEntry } from './project-entry.js';
type NativeEntry = Extract<ProjectEntry, { kind: 'native' }>;

/** Retain equal subtrees so confirming a save does not invalidate every table/column. */
export function shareNativeJson<T>(before: T, after: T): T {
  if (Object.is(before, after)) return before;
  if (
    !before ||
    !after ||
    typeof before !== 'object' ||
    typeof after !== 'object' ||
    Array.isArray(before) !== Array.isArray(after)
  )
    return after;
  if (Array.isArray(before) && Array.isArray(after)) {
    // Entity deletion/reordering must not invalidate every following row.
    const entities = [...before, ...after].every((value: unknown) => {
      if (!value || typeof value !== 'object') return false;
      return 'id' in value && typeof value.id === 'string';
    });
    const byId = entities ? new Map(before.map((value) => [value.id, value])) : null;
    const next = after.map((value, index) =>
      shareNativeJson(byId ? byId.get(value.id) : before[index], value),
    );
    return (
      next.length === before.length && next.every((value, index) => value === before[index])
        ? before
        : next
    ) as T;
  }
  const previous = before as Record<string, unknown>,
    incoming = after as Record<string, unknown>;
  const keys = Object.keys(incoming),
    next: Record<string, unknown> = {};
  let equal = keys.length === Object.keys(previous).length;
  for (const key of keys) {
    next[key] = shareNativeJson(previous[key], incoming[key]);
    if (!Object.hasOwn(previous, key) || next[key] !== previous[key]) equal = false;
  }
  return (equal ? before : next) as T;
}

/** A contiguous accepted ACK already contains the authoritative document: no GET is needed. */
export function nativeEntryAfterAck(
  current: NativeEntry,
  ack: NativeSyncOperationResult,
): NativeEntry | null {
  const snapshot = current.snapshot;
  if (
    ack.status !== 'accepted' ||
    ack.databaseRevision !== snapshot.project.databaseRevision ||
    ack.database.kind !== snapshot.project.databaseKind ||
    ack.database.profileId !== snapshot.project.databaseProfileId
  )
    return null;
  if (ack.sequence <= snapshot.sequence) return current;
  // A sequence gap may contain rejected operations, so project.version cannot be guessed.
  if (
    ack.sequence !== snapshot.sequence + 1 ||
    (!ack.document && !ack.delta) ||
    snapshot.native.status !== 'available' ||
    snapshot.sourceDocument.schemaVersion !== 2
  )
    return null;
  let incoming = ack.document;
  if (!incoming && ack.delta) {
    if (
      ack.delta.baseSequence !== snapshot.sequence ||
      ack.delta.projectVersion !== snapshot.project.version + 1
    )
      return null;
    try {
      incoming = applyChanges(
        snapshot.sourceDocument,
        ack.delta.changes.map((change) => ({
          path: change.path,
          before: change.before,
          after: change.after,
          ...(change.beforeExists !== undefined ? { beforeExists: change.beforeExists } : {}),
          ...(change.afterExists !== undefined ? { afterExists: change.afterExists } : {}),
        })),
      );
    } catch {
      return null;
    }
  }
  if (!incoming) return null;
  const document = shareNativeJson(snapshot.sourceDocument, incoming);
  // ACKs carry raw storage, whereas the server reader supplies canonical canvas placement.
  // Apply exactly that read-only projection without ever replacing sourceDocument.
  const displayDocument = shareNativeJson(
    snapshot.native.document,
    normalizeSharedTableCanvas(document, {
      nodeId: (tableId) => `node:${tableId.slice(0, 128)}:${TABLES_VIEW_ID}`,
    }),
  );
  const geometryOnly =
    ack.changedPaths.length > 0 &&
    ack.changedPaths.every((path) =>
      /^\/layout\/nodes\/[^/]+\/(position|size|x|y|width|height)$/.test(path),
    );
  const preview = current.document
    ? shareNativeJson(
        current.document,
        mergeStoredPersonalState(
          displayDocument,
          reconcilePersonalState(displayDocument, extractPersonalState(current.document)),
        ),
      )
    : displayDocument;
  return {
    ...current,
    document: preview,
    snapshot: {
      ...snapshot,
      sequence: ack.sequence,
      project: {
        ...snapshot.project,
        version: snapshot.project.version + 1,
        updatedAt: ack.createdAt,
      },
      sourceDocument: document,
      native: {
        ...snapshot.native,
        document: displayDocument,
        issues: geometryOnly
          ? snapshot.native.issues
          : validateDatabaseDocument(displayDocument, displayDocument.database, { mode: 'read' }),
      },
    },
  };
}
