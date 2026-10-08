import {
  nativePendingSaveSchema as pendingSchema,
  nativePropertyDraftSchema as draftSchema,
  nativeSyncOperationResultSchema,
  type NativeSyncOperationResult,
  type ProjectDocumentState,
  type NativeEditorCommand,
  type NativeEditorDraftRef,
} from '@ezerd/contracts';
import { loadNativeEditorDraft } from './native-editor-draft.js';
import { ApiError, body, request } from '../../shared/api/client.js';
import { captureNativeActorApi } from './native-actor-api.js';
import { markNativeLocalOperation } from './native-local-operations.js';
import { requestFingerprint } from '@ezerd/model';
import {
  nativeDraftArchive,
  nativePropertyArchiveKey,
  preserveNativeDraftAckSources,
  consumeNativeDraftAckSources,
  type NativeDraftArchiveEntry,
} from './native-draft-archive.js';
import { cancelNativeDurableEntry } from './native-cancellation.js';
import {
  getNativeDurableQueue,
  nativeDurableId,
  type NativeDurablePending,
} from './native-durable-queue.js';
import {
  nativeDraftMemoryState,
  getNativeMemoryDraft,
  retainNativeMemoryDraft,
  forgetNativeMemoryDraft,
  nativeMemoryDraftFailed,
  markNativeDraftStorageFailure,
} from './native-durable-drafts.js';

export type NativeWebCommand = NativeEditorCommand;
export type NativePendingSave = ReturnType<typeof pendingSchema.parse>;
export interface NativeSaveExpected {
  version: number;
  sequence: number;
  databaseRevision: number;
}
export interface NativePropertyDraft {
  userId: string;
  projectId: string;
  objectId: string;
  kind: 'table' | 'column';
  expected: NativeSaveExpected;
  values: { physicalName: string; comment: string; logicalName: string; definition: string };
  before: { physicalName: string; comment: string; logicalName: string; definition: string };
}
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
const key = (userId: string, projectId: string) => `ezerd.native.pending:${userId}:${projectId}`;
function loadLegacyNativePending(
  userId: string,
  projectId: string,
  storage: Storage = localStorage,
): NativePendingSave | null {
  const raw = storage.getItem(key(userId, projectId));
  if (raw === null) return null;
  const parsed = pendingSchema.safeParse(JSON.parse(raw));
  if (!parsed.success || parsed.data.userId !== userId || parsed.data.projectId !== projectId)
    throw new Error('native.pending-invalid');
  return parsed.data;
}
const durable = (pending: NativePendingSave): NativeDurablePending => ({
  userId: pending.userId,
  projectId: pending.projectId,
  operationId: pending.request.operationId,
  kind: 'commands',
  payload: pending,
});
function otherLegacyPending(userId: string, projectId: string, storage: Storage): void {
  if (
    storage.getItem(`ezerd.native.history:${JSON.stringify([userId, projectId])}`) !== null ||
    storage.getItem(`ezerd.native.canvas.personal:${JSON.stringify([userId, projectId])}`) !== null
  )
    throw Error('native.pending-exists');
}
export async function loadNativePending(
  userId: string,
  projectId: string,
  storage: Storage = localStorage,
): Promise<NativePendingSave | null> {
  const old = loadLegacyNativePending(userId, projectId, storage),
    queue = getNativeDurableQueue();
  if (old) {
    await queue.claim(
      durable(old),
      () => {
        otherLegacyPending(userId, projectId, storage);
        if (
          requestFingerprint(loadLegacyNativePending(userId, projectId, storage)) !==
          requestFingerprint(old)
        )
          throw Error('native.pending-changed');
      },
      true,
    );
    return old;
  }
  const pending = await queue.read(userId, projectId);
  if (!pending || pending.kind !== 'commands') return null;
  const parsed = pendingSchema.parse(pending.payload);
  if (
    parsed.userId !== userId ||
    parsed.projectId !== projectId ||
    parsed.request.operationId !== pending.operationId
  )
    throw Error('native.pending-invalid');
  return parsed;
}
export async function stageNativeSave(
  userId: string,
  snapshot: ProjectDocumentState,
  input: NativeWebCommand[],
  storage: Storage = localStorage,
  expected?: NativeSaveExpected,
  editorDraft?: NativeEditorDraftRef,
  operationId = nativeDurableId(),
): Promise<NativePendingSave> {
  if (snapshot.sourceDocument.schemaVersion !== 2)
    throw new Error('document.native-upgrade-required');
  if (snapshot.project.status !== 'active') throw new Error('project.read-only');
  if (
    storage.getItem(`ezerd.native.history:${JSON.stringify([userId, snapshot.project.id])}`) !==
    null
  )
    throw new Error('native.pending-exists');
  if (expected && expected.databaseRevision !== snapshot.project.databaseRevision)
    throw new Error('database.context-changed');
  if (loadLegacyNativePending(userId, snapshot.project.id, storage))
    throw new Error('native.pending-exists');
  if (editorDraft) {
    const draft = loadNativeEditorDraft(userId, snapshot.project.id, editorDraft.key, storage);
    if (
      !draft ||
      draft.revision !== editorDraft.revision ||
      !expected ||
      draft.expected.version !== expected.version ||
      draft.expected.sequence !== expected.sequence ||
      draft.expected.databaseRevision !== expected.databaseRevision
    )
      throw new Error('native.draft-changed');
  }
  const pending = pendingSchema.parse({
    userId,
    projectId: snapshot.project.id,
    ...(editorDraft
      ? { editorDraft: { key: editorDraft.key, revision: editorDraft.revision } }
      : {}),
    request: {
      operationId,
      groupId: operationId,
      clientId: operationId,
      expectedVersion: expected?.version ?? snapshot.project.version,
      expectedSequence: expected?.sequence ?? snapshot.sequence,
      expectedDatabaseRevision: expected?.databaseRevision ?? snapshot.project.databaseRevision,
      commands: input,
      includeDocument: true,
    },
  });
  await getNativeDurableQueue().claim(durable(pending), () => {
    // Recheck all legacy/draft guards inside the same transactional claim, after IDB I/O.
    otherLegacyPending(userId, pending.projectId, storage);
    if (loadLegacyNativePending(userId, pending.projectId, storage))
      throw Error('native.pending-exists');
    if (nativeDraftMemoryState(userId, pending.projectId, storage).storageFailure)
      throw Error('native.draft-storage-failed');
    if (editorDraft) {
      const draft = loadNativeEditorDraft(userId, pending.projectId, editorDraft.key, storage);
      if (
        !draft ||
        draft.revision !== editorDraft.revision ||
        requestFingerprint(draft.expected) !== requestFingerprint(expected)
      )
        throw Error('native.draft-changed');
    }
    const sources: NativeDraftArchiveEntry[] = [];
    const archive = nativeDraftArchive(storage);
    if (editorDraft) {
      const entry = archive.read(userId, pending.projectId, 'editor', editorDraft.key);
      if (entry?.revision === editorDraft.revision) sources.push(entry);
    }
    for (const command of pending.request.commands) {
      if (command.type !== 'patch_table' && command.type !== 'patch_column') continue;
      const kind = command.type === 'patch_table' ? 'table' : 'column';
      const entry = archive.read(
        userId,
        pending.projectId,
        'property',
        nativePropertyArchiveKey(kind, command.id),
      );
      if (!entry || !('kind' in entry.draft)) continue;
      const draft = entry.draft;
      if (
        draft.expected.version !== pending.request.expectedVersion ||
        draft.expected.sequence !== pending.request.expectedSequence ||
        draft.expected.databaseRevision !== pending.request.expectedDatabaseRevision
      )
        continue;
      const saved = {
        physicalName: command.patch.physical?.name ?? draft.before.physicalName,
        comment: command.patch.physical?.comment ?? draft.before.comment,
        logicalName: command.patch.logical?.name ?? draft.before.logicalName,
        definition: command.patch.logical?.definition ?? draft.before.definition,
      };
      if (
        Object.keys(saved).every(
          (field) =>
            saved[field as keyof typeof saved] === draft.values[field as keyof typeof saved],
        )
      )
        sources.push(entry);
    }
    preserveNativeDraftAckSources(
      userId,
      pending.projectId,
      operationId,
      pending.request,
      sources,
      storage,
    );
  });
  return pending;
}

const draftKey = (userId: string, projectId: string, kind: string, objectId: string) =>
  `ezerd.native.draft:${JSON.stringify([userId, projectId, kind, objectId])}`;
function persistedPropertyDraft(
  userId: string,
  projectId: string,
  kind: 'table' | 'column',
  objectId: string,
  storage?: Storage,
): NativePropertyDraft | null {
  const archive = nativeDraftArchive(storage),
    logicalKey = nativePropertyArchiveKey(kind, objectId);
  const legacy = archive.legacy(userId, projectId, 'property', logicalKey);
  const entry = archive.read(userId, projectId, 'property', logicalKey);
  if (!entry && legacy) throw Error('native.draft-recovery-required');
  return entry ? draftSchema.parse(entry.draft) : null;
}
export function loadNativeDraft(
  userId: string,
  projectId: string,
  kind: 'table' | 'column',
  objectId: string,
  storage?: Storage,
): NativePropertyDraft | null {
  const key = draftKey(userId, projectId, kind, objectId),
    memory = getNativeMemoryDraft<NativePropertyDraft>(key, storage);
  try {
    const draft = persistedPropertyDraft(userId, projectId, kind, objectId, storage);
    if (memory && nativeMemoryDraftFailed(key, storage)) return memory;
    if (draft) retainNativeMemoryDraft(key, draft, false, storage);
    else forgetNativeMemoryDraft(key, storage);
    return draft;
  } catch (error) {
    markNativeDraftStorageFailure(key, userId, projectId, storage);
    if (!memory) throw error;
    retainNativeMemoryDraft(key, memory, true, storage);
    return memory;
  }
}
export function storeNativeDraft(draft: NativePropertyDraft, storage?: Storage): void {
  const key = draftKey(draft.userId, draft.projectId, draft.kind, draft.objectId);
  retainNativeMemoryDraft(key, draft, true, storage);
  const archive = nativeDraftArchive(storage),
    logicalKey = nativePropertyArchiveKey(draft.kind, draft.objectId);
  archive.legacy(draft.userId, draft.projectId, 'property', logicalKey);
  archive.store('property', logicalKey, draftSchema.parse(draft));
  retainNativeMemoryDraft(key, draft, false, storage);
}
export function discardNativeDraft(
  userId: string,
  projectId: string,
  kind: 'table' | 'column',
  objectId: string,
  storage?: Storage,
  expected?: NativePropertyDraft,
): void {
  const key = draftKey(userId, projectId, kind, objectId),
    memory = getNativeMemoryDraft<NativePropertyDraft>(key, storage);
  if (expected && memory && requestFingerprint(memory) !== requestFingerprint(expected)) return;
  const archive = nativeDraftArchive(storage),
    entry = archive.read(userId, projectId, 'property', nativePropertyArchiveKey(kind, objectId));
  if (expected && entry && requestFingerprint(entry.draft) !== requestFingerprint(expected)) return;
  if (entry) archive.discard(userId, projectId, entry);
  forgetNativeMemoryDraft(key, storage);
}
/** Explicit user review preserves only edited fields; other users' newer fields are inherited. */
export function rebaseNativeDraft(
  draft: NativePropertyDraft,
  expected: NativeSaveExpected,
  current: NativePropertyDraft['values'],
): NativePropertyDraft {
  if (draft.expected.databaseRevision !== expected.databaseRevision)
    throw Error('database.context-changed');
  return {
    ...draft,
    expected,
    before: { ...current },
    values: {
      physicalName:
        draft.values.physicalName !== draft.before.physicalName
          ? draft.values.physicalName
          : current.physicalName,
      comment:
        draft.values.comment !== draft.before.comment ? draft.values.comment : current.comment,
      logicalName:
        draft.values.logicalName !== draft.before.logicalName
          ? draft.values.logicalName
          : current.logicalName,
      definition:
        draft.values.definition !== draft.before.definition
          ? draft.values.definition
          : current.definition,
    },
  };
}
export async function discardNativePending(
  userId: string,
  projectId: string,
  operationId: string,
  storage: Storage = localStorage,
): Promise<void> {
  const pending = await loadNativePending(userId, projectId, storage);
  if (pending?.request.operationId !== operationId) return;
  if (await getNativeDurableQueue().discard(durable(pending))) {
    const old = loadLegacyNativePending(userId, projectId, storage);
    if (old?.request.operationId === operationId) storage.removeItem(key(userId, projectId));
  }
}
/** Server cancellation fences late delivery; accepted ACKs still consume only matching input. */
export async function cancelNativePending(
  pending: NativePendingSave,
  storage: Storage = localStorage,
  api: typeof request = request,
): Promise<NativeSyncOperationResult> {
  return cancelNativeDurableEntry(durable(pending), {
    api,
    cleanup: (result) => {
      checkNativeAck(pending, result);
      if (result.status === 'accepted') {
        acknowledgeNativeDrafts(pending, storage);
      }
      if (
        requestFingerprint(loadLegacyNativePending(pending.userId, pending.projectId, storage)) ===
        requestFingerprint(pending)
      )
        storage.removeItem(key(pending.userId, pending.projectId));
    },
  });
}
/** No local staging evidence means no authority to erase a subsequently recovered input. */
function acknowledgeNativeDrafts(pending: NativePendingSave, storage: Storage): void {
  consumeNativeDraftAckSources(
    pending.userId,
    pending.projectId,
    pending.request.operationId,
    pending.request,
    storage,
  );
}
export function checkNativeAck(
  pending: NativePendingSave,
  result: NativeSyncOperationResult,
): void {
  if (
    result.operationId !== pending.request.operationId ||
    result.actor.id !== pending.userId ||
    result.groupId !== pending.request.groupId ||
    (result.status === 'accepted' &&
      (result.databaseRevision !== pending.request.expectedDatabaseRevision ||
        result.sequence <= pending.request.expectedSequence))
  )
    throw new Error('native.ack-mismatch');
}
async function ensureNativePending(pending: NativePendingSave, storage: Storage): Promise<void> {
  otherLegacyPending(pending.userId, pending.projectId, storage);
  const stored = await loadNativePending(pending.userId, pending.projectId, storage);
  if (requestFingerprint(stored) !== requestFingerprint(pending))
    throw Error('native.pending-changed');
}
async function consumeNativeAck(pending: NativePendingSave, storage: Storage): Promise<void> {
  await getNativeDurableQueue().acknowledge(durable(pending), () => {
    acknowledgeNativeDrafts(pending, storage);
    const old = loadLegacyNativePending(pending.userId, pending.projectId, storage);
    if (requestFingerprint(old) === requestFingerprint(pending))
      storage.removeItem(key(pending.userId, pending.projectId));
  });
}
export async function sendNativePending(
  pending: NativePendingSave,
  storage: Storage = localStorage,
  api: typeof request = request,
): Promise<NativeSyncOperationResult> {
  const actorApi = captureNativeActorApi(pending.userId, api);
  await ensureNativePending(pending, storage);
  const queue = getNativeDurableQueue(),
    entry = durable(pending),
    token = await queue.beginTransmission(entry);
  const heartbeat = setInterval(() => {
    void queue.renewTransmission(entry, token).catch(() => {});
  }, 5000);
  try {
    markNativeLocalOperation(pending.userId, pending.projectId, pending.request.operationId);
    const result = nativeSyncOperationResultSchema.parse(
      await actorApi(
        `/api/projects/${encodeURIComponent(pending.projectId)}/native-sync/commands`,
        body('POST', pending.request),
      ),
    );
    checkNativeAck(pending, result);
    if (result.status === 'accepted') await consumeNativeAck(pending, storage);
    else await queue.confirmRejected(entry);
    return result;
  } finally {
    clearInterval(heartbeat);
    await queue.endTransmission(entry, token);
  }
}
/** Lookup is read-only and can confirm an old ACK. A missing result never steals another tab's transmission. */
export async function recoverNativePending(
  pending: NativePendingSave,
  snapshot: ProjectDocumentState,
  storage: Storage = localStorage,
  api: typeof request = request,
  allowReplay = true,
  canReplay: () => boolean = () => true,
): Promise<NativeSyncOperationResult> {
  const actorApi = captureNativeActorApi(pending.userId, api);
  await ensureNativePending(pending, storage);
  try {
    const result = nativeSyncOperationResultSchema.parse(
      await actorApi(
        `/api/projects/${encodeURIComponent(pending.projectId)}/native-sync/operations/${pending.request.operationId}`,
        { cache: 'no-store' },
      ),
    );
    checkNativeAck(pending, result);
    if (result.status === 'accepted') await consumeNativeAck(pending, storage);
    else await getNativeDurableQueue().confirmRejected(durable(pending));
    return result;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    if (!allowReplay || !canReplay() || snapshot.project.status !== 'active')
      throw Error('project.read-only');
    if (
      snapshot.project.id !== pending.projectId ||
      snapshot.project.databaseRevision !== pending.request.expectedDatabaseRevision
    )
      throw Error('database.context-changed');
    return sendNativePending(pending, storage, actorApi);
  }
}
