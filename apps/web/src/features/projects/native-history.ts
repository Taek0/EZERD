import {
  nativeHistoryPendingSchema as pendingSchema,
  nativeHistoryCommandResultSchema,
  nativeHistoryPageSchema,
  nativeSyncSnapshotSchema,
  type ProjectDocumentState,
  type NativeHistoryPending,
} from '@ezerd/contracts';
import { body, request } from '../../shared/api/client.js';
import { assertNativeExportReady, assertNativeLocalInputsReady } from './project-ddl-export.js';
import { nativeEditorExportBlocked } from './native-export-state.js';
import {
  getNativeDurableQueue,
  nativeDurableId,
  type NativeDurablePending,
} from './native-durable-queue.js';
import { captureNativeActorApi } from './native-actor-api.js';
import { cancelNativeDurableEntry } from './native-cancellation.js';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
const key = (actor: string, project: string) =>
  `ezerd.native.history:${JSON.stringify([actor, project])}`;
export type { NativeHistoryPending };
function loadLegacyHistoryPending(
  userId: string,
  projectId: string,
  storage: Storage = localStorage,
): NativeHistoryPending | null {
  const raw = storage.getItem(key(userId, projectId));
  if (raw === null) return null;
  const value = pendingSchema.parse(JSON.parse(raw));
  if (value.userId !== userId || value.projectId !== projectId)
    throw Error('native.history-identity-invalid');
  return value;
}
export function nativeHistoryEntry(pending: NativeHistoryPending): NativeDurablePending {
  return {
    userId: pending.userId,
    projectId: pending.projectId,
    operationId: pending.request.operationId,
    kind: 'history',
    payload: pending,
  };
}
export async function cancelNativeHistory(
  pending: NativeHistoryPending,
  storage: Storage = localStorage,
  api: typeof request = request,
) {
  return cancelNativeDurableEntry(nativeHistoryEntry(pending), {
    api,
    cleanup: () => {
      if (
        JSON.stringify(loadLegacyHistoryPending(pending.userId, pending.projectId, storage)) ===
        JSON.stringify(pending)
      )
        storage.removeItem(key(pending.userId, pending.projectId));
    },
  });
}
export async function loadNativeHistoryPending(
  userId: string,
  projectId: string,
  storage: Storage = localStorage,
): Promise<NativeHistoryPending | null> {
  const old = loadLegacyHistoryPending(userId, projectId, storage),
    queue = getNativeDurableQueue();
  if (old) {
    await queue.claim(
      nativeHistoryEntry(old),
      () => {
        if (
          storage.getItem(`ezerd.native.pending:${userId}:${projectId}`) !== null ||
          storage.getItem(`ezerd.native.canvas.personal:${JSON.stringify([userId, projectId])}`) !==
            null
        )
          throw Error('native.pending-exists');
        if (
          JSON.stringify(loadLegacyHistoryPending(userId, projectId, storage)) !==
          JSON.stringify(old)
        )
          throw Error('native.history-pending-changed');
      },
      true,
    );
    return old;
  }
  const entry = await queue.read(userId, projectId);
  if (!entry || entry.kind !== 'history') return null;
  const parsed = pendingSchema.parse(entry.payload);
  if (
    parsed.userId !== userId ||
    parsed.projectId !== projectId ||
    parsed.request.operationId !== entry.operationId
  )
    throw Error('native.history-identity-invalid');
  return parsed;
}
export async function fetchNativeHistory(
  projectId: string,
  since = 0,
  api: typeof request = request,
) {
  const page = nativeHistoryPageSchema.parse(
    await api(
      `/api/projects/${encodeURIComponent(projectId)}/native-history?since=${since}&limit=25`,
      { cache: 'no-store' },
    ),
  );
  if (page.projectId !== projectId) throw Error('native.history-identity-invalid');
  return page;
}
export async function stageNativeHistory(
  userId: string,
  snapshot: ProjectDocumentState,
  sourceOperationId: string,
  command: 'undo' | 'restore',
  storage: Storage = localStorage,
  api: typeof request = request,
): Promise<NativeHistoryPending> {
  api = captureNativeActorApi(userId, api);
  if (snapshot.sourceDocument.schemaVersion !== 2 || snapshot.project.status !== 'active')
    throw Error('project.read-only');
  if (nativeEditorExportBlocked(userId, snapshot.project.id))
    throw Error('project-export.unsaved-draft');
  await assertNativeExportReady(userId, snapshot.project.id, storage);
  const clientId = nativeDurableId();
  const baseline = nativeSyncSnapshotSchema.parse(
    await api(
      `/api/projects/${snapshot.project.id}/native-sync/baseline`,
      body('POST', {
        clientId,
        expected: {
          version: snapshot.project.version,
          sequence: snapshot.sequence,
          databaseRevision: snapshot.project.databaseRevision,
        },
      }),
    ),
  );
  if (
    baseline.projectVersion !== snapshot.project.version ||
    baseline.sequence !== snapshot.sequence ||
    baseline.databaseRevision !== snapshot.project.databaseRevision ||
    baseline.database.kind !== snapshot.project.databaseKind ||
    baseline.database.profileId !== snapshot.project.databaseProfileId
  )
    throw Error('database.context-changed');
  // Re-check after baseline I/O: another editor may have staged input in the meantime.
  await assertNativeExportReady(userId, snapshot.project.id, storage);
  if (nativeEditorExportBlocked(userId, snapshot.project.id))
    throw Error('project-export.unsaved-draft');
  const pending = pendingSchema.parse({
    userId,
    projectId: snapshot.project.id,
    sourceOperationId,
    command,
    request: {
      operationId: nativeDurableId(),
      groupId: nativeDurableId(),
      clientId,
      baselineId: baseline.baselineId,
      baselineIssuedAt: baseline.baselineIssuedAt,
      expectedVersion: baseline.projectVersion,
      expectedSequence: baseline.sequence,
      database: baseline.database,
      databaseRevision: baseline.databaseRevision,
    },
  });
  await getNativeDurableQueue().claim(nativeHistoryEntry(pending), () =>
    assertNativeLocalInputsReady(userId, pending.projectId, storage),
  );
  return pending;
}
/** The exact persisted request is replayable even after the head/role changes. */
export async function sendNativeHistory(
  pending: NativeHistoryPending,
  storage: Storage = localStorage,
  api: typeof request = request,
) {
  api = captureNativeActorApi(pending.userId, api);
  const stored = await loadNativeHistoryPending(pending.userId, pending.projectId, storage);
  if (JSON.stringify(stored) !== JSON.stringify(pending))
    throw Error('native.history-pending-changed');
  const queue = getNativeDurableQueue(),
    entry = nativeHistoryEntry(pending),
    token = await queue.beginTransmission(entry);
  const heartbeat = setInterval(() => {
    void queue.renewTransmission(entry, token).catch(() => {});
  }, 5000);
  try {
    const response = await api(
      `/api/projects/${pending.projectId}/native-history/${pending.sourceOperationId}/${pending.command}`,
      body('POST', pending.request),
    );
    const output = nativeHistoryCommandResultSchema.parse(response);
    if (
      output.command !== pending.command ||
      output.sourceOperationId !== pending.sourceOperationId ||
      output.result.operationId !== pending.request.operationId ||
      output.result.groupId !== pending.request.groupId ||
      output.result.actor.id !== pending.userId ||
      (output.result.status === 'accepted' &&
        (output.result.sequence <= pending.request.expectedSequence ||
          output.result.databaseRevision !== pending.request.databaseRevision ||
          output.result.database.kind !== pending.request.database.kind ||
          output.result.database.profileId !== pending.request.database.profileId))
    )
      throw Error('native.history-ack-invalid');
    await queue.acknowledge(entry, () => {
      if (
        JSON.stringify(loadLegacyHistoryPending(pending.userId, pending.projectId, storage)) ===
        JSON.stringify(pending)
      )
        storage.removeItem(key(pending.userId, pending.projectId));
    });
    return output;
  } finally {
    clearInterval(heartbeat);
    await queue.endTransmission(entry, token);
  }
}
