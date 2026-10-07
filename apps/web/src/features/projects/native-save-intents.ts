import {
  nativePendingSaveSchema,
  nativeSyncOperationResultSchema,
  type ProjectDocumentState,
  type NativeEditorDraftRef,
  type NativeSyncOperationResult,
} from '@ezerd/contracts';
import { ApiError, request } from '../../shared/api/client.js';
import { captureNativeActorApi } from './native-actor-api.js';
import { loadNativeEditorDraft } from './native-editor-draft.js';
import { getNativeDurableQueue, nativeDurableId } from './native-durable-queue.js';
import {
  cancelNativePending,
  checkNativeAck,
  discardNativePending,
  loadNativePending,
  recoverNativePending,
  sendNativePending,
  stageNativeSave,
  type NativePendingSave,
  type NativeSaveExpected,
  type NativeWebCommand,
} from './native-save.js';
import { registerNativeExportBlocker, clearNativeExportBlocker } from './native-export-state.js';
import { requestFingerprint } from '@ezerd/model';

type Storage = Pick<globalThis.Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
const prefix = (user: string, project: string) =>
  `ezerd.native.intent:${JSON.stringify([user, project])}:`;
interface Intent {
  key: string;
  pending: NativePendingSave;
}
export async function lookupNativeSaveIntentResult(
  pending: NativePendingSave,
  api: typeof request = request,
  onResult?: (result: NativeSyncOperationResult) => void,
): Promise<boolean | null> {
  const actorApi = captureNativeActorApi(pending.userId, api);
  try {
    const result = nativeSyncOperationResultSchema.parse(
      await actorApi(
        `/api/projects/${encodeURIComponent(pending.projectId)}/native-sync/operations/${pending.request.operationId}`,
        { cache: 'no-store' },
      ),
    );
    checkNativeAck(pending, result);
    onResult?.(result);
    return result.status === 'accepted';
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
export function updateNativeIntentBlocker(
  user: string,
  project: string,
  storage: Storage = localStorage,
) {
  const dirty = nativeSaveIntents(user, project, storage).length > 0;
  if (dirty)
    registerNativeExportBlocker(user, project, 'save-intents', { dirty, storageFailure: false });
  else clearNativeExportBlocker(user, project, 'save-intents');
}
function finishIntent(intent: Intent, accepted: boolean, storage: Storage) {
  if (!accepted)
    storage.setItem(
      intent.key.replace('ezerd.native.intent:', 'ezerd.native.rejected-intent:'),
      JSON.stringify(intent.pending),
    );
  storage.removeItem(intent.key);
  updateNativeIntentBlocker(intent.pending.userId, intent.pending.projectId, storage);
}

/** Separate immutable keys keep tabs from overwriting each other's unsent work. */
export function nativeSaveIntents(
  user: string,
  project: string,
  storage: Storage = localStorage,
): Intent[] {
  const start = prefix(user, project);
  const intents: Intent[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(start)) continue;
    const pending = nativePendingSaveSchema.parse(JSON.parse(storage.getItem(key)!));
    if (pending.userId !== user || pending.projectId !== project)
      throw Error('native.pending-invalid');
    intents.push({ key, pending });
  }
  return intents.sort((a, b) => a.key.localeCompare(b.key));
}

export function nativeRejectedSaveIntents(
  user: string,
  project: string,
  storage: Storage = localStorage,
): Intent[] {
  const start = prefix(user, project).replace(
    'ezerd.native.intent:',
    'ezerd.native.rejected-intent:',
  );
  const intents: Intent[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(start)) continue;
    const pending = nativePendingSaveSchema.parse(JSON.parse(storage.getItem(key)!));
    if (pending.userId !== user || pending.projectId !== project)
      throw Error('native.pending-invalid');
    intents.push({ key, pending });
  }
  return intents.sort((a, b) => a.key.localeCompare(b.key));
}

export function enqueueNativeSave(
  user: string,
  snapshot: ProjectDocumentState,
  commands: NativeWebCommand[],
  expected?: NativeSaveExpected,
  editorDraft?: NativeEditorDraftRef,
  storage: Storage = localStorage,
): string {
  const intents = nativeSaveIntents(user, snapshot.project.id, storage);
  const identical = intents
    .slice(-1)
    .find(
      ({ pending }) =>
        requestFingerprint(pending.request.commands) === requestFingerprint(commands) &&
        requestFingerprint(pending.editorDraft) === requestFingerprint(editorDraft) &&
        pending.request.expectedVersion === (expected?.version ?? snapshot.project.version) &&
        pending.request.expectedSequence === (expected?.sequence ?? snapshot.sequence) &&
        pending.request.expectedDatabaseRevision ===
          (expected?.databaseRevision ?? snapshot.project.databaseRevision),
    );
  if (identical) return identical.pending.request.operationId;
  if (intents.length >= 128) throw Error('native.pending-exists');
  const operationId = nativeDurableId();
  const pending = nativePendingSaveSchema.parse({
    userId: user,
    projectId: snapshot.project.id,
    ...(editorDraft ? { editorDraft } : {}),
    request: {
      operationId,
      groupId: operationId,
      clientId: operationId,
      expectedVersion: expected?.version ?? snapshot.project.version,
      expectedSequence: expected?.sequence ?? snapshot.sequence,
      expectedDatabaseRevision: expected?.databaseRevision ?? snapshot.project.databaseRevision,
      commands,
      includeDocument: true,
    },
  });
  // Monotonic ordering also survives a backward-moving local clock.
  const last = intents.at(-1)?.key.slice(prefix(user, snapshot.project.id).length).split(':')[0];
  const order = Math.max(Date.now(), Number(last ?? 0) + 1);
  storage.setItem(
    `${prefix(user, snapshot.project.id)}${String(order).padStart(16, '0')}:${operationId}`,
    JSON.stringify(pending),
  );
  updateNativeIntentBlocker(user, snapshot.project.id, storage);
  return operationId;
}

/** At most one immutable durable request is transmitted. Unknown delivery is recovered first. */
export async function flushNativeSaveIntent(
  user: string,
  snapshot: ProjectDocumentState,
  storage: Storage = localStorage,
  api: typeof request = request,
  canTransmit: () => boolean = () => true,
  onResult?: (result: NativeSyncOperationResult) => void,
): Promise<{ operationId: string; accepted: boolean } | null> {
  const actorApi = captureNativeActorApi(user, api);
  updateNativeIntentBlocker(user, snapshot.project.id, storage);
  const existing = await loadNativePending(user, snapshot.project.id, storage);
  if (existing) {
    let result;
    let noChanges = false;
    try {
      result = await recoverNativePending(existing, snapshot, storage, actorApi, true, canTransmit);
    } catch (error) {
      if (
        !(error instanceof Error && error.message === 'database.context-changed') &&
        (!(error instanceof ApiError) || ![400, 409, 422].includes(error.status))
      )
        throw error;
      noChanges = error instanceof ApiError && error.code === 'sync.no-changes';
      // HTTP validation errors alone do not prove late delivery impossible: fence the request.
      result = await cancelNativePending(existing, storage, actorApi);
    }
    if (result.status === 'rejected')
      await discardNativePending(user, snapshot.project.id, existing.request.operationId, storage);
    const intent = nativeSaveIntents(user, snapshot.project.id, storage).find(
      (item) => item.pending.request.operationId === existing.request.operationId,
    );
    if (intent) finishIntent(intent, noChanges || result.status === 'accepted', storage);
    onResult?.(result);
    return {
      operationId: existing.request.operationId,
      accepted: noChanges || result.status === 'accepted',
    };
  }
  if (await getNativeDurableQueue().read(user, snapshot.project.id)) return null;
  const intent = nativeSaveIntents(user, snapshot.project.id, storage)[0];
  if (!intent) return null;
  const pending = intent.pending;
  // The prior tab may have crashed after consuming its durable ACK, before removing the intent.
  try {
    const result = nativeSyncOperationResultSchema.parse(
      await actorApi(
        `/api/projects/${encodeURIComponent(snapshot.project.id)}/native-sync/operations/${pending.request.operationId}`,
        { cache: 'no-store' },
      ),
    );
    checkNativeAck(pending, result);
    finishIntent(intent, result.status === 'accepted', storage);
    onResult?.(result);
    return { operationId: pending.request.operationId, accepted: result.status === 'accepted' };
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }
  if (pending.request.expectedDatabaseRevision !== snapshot.project.databaseRevision) {
    // Claim the exact unsent request only to obtain a server cancellation fence.
    await getNativeDurableQueue().claim({
      userId: user,
      projectId: snapshot.project.id,
      operationId: pending.request.operationId,
      kind: 'commands',
      payload: pending,
    });
    const result = await cancelNativePending(pending, storage, actorApi);
    finishIntent(intent, result.status === 'accepted', storage);
    onResult?.(result);
    return { operationId: pending.request.operationId, accepted: result.status === 'accepted' };
  }
  let editorDraft = pending.editorDraft;
  if (
    editorDraft &&
    loadNativeEditorDraft(user, snapshot.project.id, editorDraft.key, storage)?.revision !==
      editorDraft.revision
  )
    editorDraft = undefined;
  if (!canTransmit()) throw Error('project.read-only');
  const staged = await stageNativeSave(
    user,
    snapshot,
    pending.request.commands,
    storage,
    {
      version: pending.request.expectedVersion,
      sequence: pending.request.expectedSequence,
      databaseRevision: pending.request.expectedDatabaseRevision,
    },
    editorDraft,
    pending.request.operationId,
  );
  if (!canTransmit()) throw Error('project.read-only');
  let result;
  let noChanges = false;
  try {
    result = await sendNativePending(staged, storage, actorApi);
  } catch (error) {
    if (!(error instanceof ApiError) || ![400, 409, 422].includes(error.status)) throw error;
    noChanges = error instanceof ApiError && error.code === 'sync.no-changes';
    result = await cancelNativePending(staged, storage, actorApi);
  }
  if (result.status === 'rejected')
    await discardNativePending(user, snapshot.project.id, staged.request.operationId, storage);
  finishIntent(intent, noChanges || result.status === 'accepted', storage);
  onResult?.(result);
  return {
    operationId: staged.request.operationId,
    accepted: noChanges || result.status === 'accepted',
  };
}
