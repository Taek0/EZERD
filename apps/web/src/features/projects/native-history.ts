import {
  nativeHistoryPendingSchema as pendingSchema,
  nativeHistoryCommandResultSchema,
  nativeHistoryPageSchema,
  nativeSyncSnapshotSchema,
  type ProjectDocumentState,
  type NativeHistoryPending,
} from '@ezerd/contracts';
import { ApiError, body, request } from '../../shared/api/client.js';
import { assertNativeExportReady } from './project-ddl-export.js';
import { nativeEditorExportBlocked } from './native-export-state.js';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
const key = (actor: string, project: string) =>
  `ezerd.native.history:${JSON.stringify([actor, project])}`;
export type { NativeHistoryPending };
export function loadNativeHistoryPending(
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
  if (snapshot.sourceDocument.schemaVersion !== 2 || snapshot.project.status !== 'active')
    throw Error('project.read-only');
  if (nativeEditorExportBlocked(userId, snapshot.project.id))
    throw Error('project-export.unsaved-draft');
  assertNativeExportReady(userId, snapshot.project.id, storage);
  const clientId = crypto.randomUUID();
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
  assertNativeExportReady(userId, snapshot.project.id, storage);
  if (nativeEditorExportBlocked(userId, snapshot.project.id))
    throw Error('project-export.unsaved-draft');
  const pending = pendingSchema.parse({
    userId,
    projectId: snapshot.project.id,
    sourceOperationId,
    command,
    request: {
      operationId: crypto.randomUUID(),
      groupId: crypto.randomUUID(),
      clientId,
      baselineId: baseline.baselineId,
      baselineIssuedAt: baseline.baselineIssuedAt,
      expectedVersion: baseline.projectVersion,
      expectedSequence: baseline.sequence,
      database: baseline.database,
      databaseRevision: baseline.databaseRevision,
    },
  });
  const raw = JSON.stringify(pending);
  storage.setItem(key(userId, pending.projectId), raw);
  if (storage.getItem(key(userId, pending.projectId)) !== raw)
    throw Error('native.history-storage-failed');
  return pending;
}
/** The exact persisted request is replayable even after the head/role changes. */
export async function sendNativeHistory(
  pending: NativeHistoryPending,
  storage: Storage = localStorage,
  api: typeof request = request,
) {
  const stored = loadNativeHistoryPending(pending.userId, pending.projectId, storage);
  if (JSON.stringify(stored) !== JSON.stringify(pending))
    throw Error('native.history-pending-changed');
  let response: unknown;
  try {
    response = await api(
      `/api/projects/${pending.projectId}/native-history/${pending.sourceOperationId}/${pending.command}`,
      body('POST', pending.request),
    );
  } catch (cause) {
    if (cause instanceof ApiError && [400, 403, 404, 409, 422].includes(cause.status)) {
      try {
        await api(
          `/api/projects/${pending.projectId}/native-sync/operations/${pending.request.operationId}`,
          { cache: 'no-store' },
        );
      } catch (lookup) {
        // Terminal rejection plus an authorized missing ledger entry confirms no ACK.
        // Network/permission failures remain pending and replayable.
        if (
          lookup instanceof ApiError &&
          lookup.status === 404 &&
          JSON.stringify(loadNativeHistoryPending(pending.userId, pending.projectId, storage)) ===
            JSON.stringify(pending)
        )
          storage.removeItem(key(pending.userId, pending.projectId));
      }
    }
    throw cause;
  }
  const output = nativeHistoryCommandResultSchema.parse(response);
  if (
    output.command !== pending.command ||
    output.sourceOperationId !== pending.sourceOperationId ||
    output.result.operationId !== pending.request.operationId ||
    output.result.groupId !== pending.request.groupId ||
    output.result.actor.id !== pending.userId ||
    output.result.databaseRevision !== pending.request.databaseRevision ||
    output.result.database.kind !== pending.request.database.kind ||
    output.result.database.profileId !== pending.request.database.profileId ||
    output.result.status !== 'accepted'
  )
    throw Error('native.history-ack-invalid');
  // A concurrent replacement is kept for its own ACK rather than erased.
  if (
    JSON.stringify(loadNativeHistoryPending(pending.userId, pending.projectId, storage)) ===
    JSON.stringify(pending)
  )
    storage.removeItem(key(pending.userId, pending.projectId));
  return output;
}
