import {
  nativePendingSaveSchema as pendingSchema,
  nativePropertyDraftSchema as draftSchema,
  nativeSyncOperationResultSchema,
  type NativeSyncOperationResult,
  type ProjectDocumentState,
  type NativeEditorCommand,
  type NativeEditorDraftRef,
} from '@ezerd/contracts';
import { loadNativeEditorDraft, discardNativeEditorDraft } from './native-editor-draft.js';
import { ApiError, body, request } from '../../shared/api/client.js';

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
export function loadNativePending(
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
export function stageNativeSave(
  userId: string,
  snapshot: ProjectDocumentState,
  input: NativeWebCommand[],
  storage: Storage = localStorage,
  expected?: NativeSaveExpected,
  editorDraft?: NativeEditorDraftRef,
): NativePendingSave {
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
  if (loadNativePending(userId, snapshot.project.id, storage))
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
  const operationId = crypto.randomUUID();
  const pending = pendingSchema.parse({
    userId,
    projectId: snapshot.project.id,
    ...(editorDraft
      ? { editorDraft: { key: editorDraft.key, revision: editorDraft.revision } }
      : {}),
    request: {
      operationId,
      groupId: operationId,
      clientId: crypto.randomUUID(),
      expectedVersion: expected?.version ?? snapshot.project.version,
      expectedSequence: expected?.sequence ?? snapshot.sequence,
      expectedDatabaseRevision: expected?.databaseRevision ?? snapshot.project.databaseRevision,
      commands: input,
      includeDocument: true,
    },
  });
  const raw = JSON.stringify(pending);
  storage.setItem(key(userId, pending.projectId), raw);
  if (storage.getItem(key(userId, pending.projectId)) !== raw)
    throw new Error('native.pending-storage-failed');
  return pending;
}
const draftKey = (userId: string, projectId: string, kind: string, objectId: string) =>
  `ezerd.native.draft:${JSON.stringify([userId, projectId, kind, objectId])}`;
export function loadNativeDraft(
  userId: string,
  projectId: string,
  kind: 'table' | 'column',
  objectId: string,
  storage: Storage = localStorage,
): NativePropertyDraft | null {
  const raw = storage.getItem(draftKey(userId, projectId, kind, objectId));
  if (raw === null) return null;
  const draft = draftSchema.parse(JSON.parse(raw));
  if (
    draft.userId !== userId ||
    draft.projectId !== projectId ||
    draft.kind !== kind ||
    draft.objectId !== objectId
  )
    throw new Error('native.draft-invalid');
  return draft;
}
export function storeNativeDraft(
  draft: NativePropertyDraft,
  storage: Storage = localStorage,
): void {
  loadNativeDraft(draft.userId, draft.projectId, draft.kind, draft.objectId, storage);
  const value = JSON.stringify(draftSchema.parse(draft)),
    key = draftKey(draft.userId, draft.projectId, draft.kind, draft.objectId);
  storage.setItem(key, value);
  if (storage.getItem(key) !== value) throw new Error('native.draft-storage-failed');
}
export function discardNativeDraft(
  userId: string,
  projectId: string,
  kind: 'table' | 'column',
  objectId: string,
  storage: Storage = localStorage,
  expected?: NativePropertyDraft,
): void {
  if (
    expected &&
    JSON.stringify(loadNativeDraft(userId, projectId, kind, objectId, storage)) !==
      JSON.stringify(expected)
  )
    return;
  storage.removeItem(draftKey(userId, projectId, kind, objectId));
}
/** Explicit user review preserves only edited fields; other users' newer fields are inherited. */
export function rebaseNativeDraft(
  draft: NativePropertyDraft,
  expected: NativeSaveExpected,
  current: NativePropertyDraft['values'],
): NativePropertyDraft {
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
export function discardNativePending(
  userId: string,
  projectId: string,
  operationId: string,
  storage: Storage = localStorage,
): void {
  const pending = loadNativePending(userId, projectId, storage);
  if (pending?.request.operationId === operationId) storage.removeItem(key(userId, projectId));
}
/** Clear only the property draft represented by this ACK; a newer tab's input stays intact. */
function acknowledgePropertyDrafts(pending: NativePendingSave, storage: Storage): void {
  for (const command of pending.request.commands) {
    if (command.type !== 'patch_table' && command.type !== 'patch_column') continue;
    const kind = command.type === 'patch_table' ? 'table' : 'column';
    const draft = loadNativeDraft(pending.userId, pending.projectId, kind, command.id, storage);
    if (
      !draft ||
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
        (field) => saved[field as keyof typeof saved] === draft.values[field as keyof typeof saved],
      )
    )
      discardNativeDraft(pending.userId, pending.projectId, kind, command.id, storage, draft);
  }
}
function acknowledgeEditorDraft(pending: NativePendingSave, storage: Storage): void {
  if (pending.editorDraft)
    discardNativeEditorDraft(pending.userId, pending.projectId, pending.editorDraft, storage);
}
function checkNativeAck(pending: NativePendingSave, result: NativeSyncOperationResult): void {
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
export async function sendNativePending(
  pending: NativePendingSave,
  storage: Storage = localStorage,
  api: typeof request = request,
): Promise<NativeSyncOperationResult> {
  const result = nativeSyncOperationResultSchema.parse(
    await api(
      `/api/projects/${encodeURIComponent(pending.projectId)}/native-sync/commands`,
      body('POST', pending.request),
    ),
  );
  checkNativeAck(pending, result);
  if (result.status === 'accepted') {
    acknowledgePropertyDrafts(pending, storage);
    acknowledgeEditorDraft(pending, storage);
    discardNativePending(pending.userId, pending.projectId, pending.request.operationId, storage);
  }
  return result;
}
/** A lookup can confirm an old ACK after context changes. Only a missing operation may be replayed. */
export async function recoverNativePending(
  pending: NativePendingSave,
  snapshot: ProjectDocumentState,
  storage: Storage = localStorage,
  api: typeof request = request,
  allowReplay = true,
): Promise<NativeSyncOperationResult> {
  try {
    const result = nativeSyncOperationResultSchema.parse(
      await api(
        `/api/projects/${encodeURIComponent(pending.projectId)}/native-sync/operations/${pending.request.operationId}`,
      ),
    );
    checkNativeAck(pending, result);
    if (result.status === 'accepted') {
      acknowledgePropertyDrafts(pending, storage);
      acknowledgeEditorDraft(pending, storage);
      discardNativePending(pending.userId, pending.projectId, pending.request.operationId, storage);
    }
    return result;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    if (!allowReplay || snapshot.project.status !== 'active') throw new Error('project.read-only');
    if (
      snapshot.project.id !== pending.projectId ||
      snapshot.project.databaseRevision !== pending.request.expectedDatabaseRevision
    )
      throw new Error('database.context-changed');
    return sendNativePending(pending, storage, api);
  }
}
