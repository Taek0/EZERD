import {
  nativeEditorDraftSchema,
  type NativeEditorDraft,
  type NativeEditorDraftRef,
} from '@ezerd/contracts';
export type { NativeEditorDraft, NativeEditorDraftRef } from '@ezerd/contracts';
import {
  getNativeMemoryDraft,
  retainNativeMemoryDraft,
  forgetNativeMemoryDraft,
  nativeMemoryDraftFailed,
  type NativeDraftStorage,
  markNativeDraftStorageFailure,
} from './native-durable-drafts.js';
import { nativeDurableId } from './native-durable-queue.js';
import { nativeDraftArchive } from './native-draft-archive.js';
const storageKey = (userId: string, projectId: string, key: string) =>
  `ezerd.native.editor:${JSON.stringify([userId, projectId, key])}`;
function persisted(
  userId: string,
  projectId: string,
  key: string,
  storage?: NativeDraftStorage,
): NativeEditorDraft | null {
  const archive = nativeDraftArchive(storage);
  const legacy = archive.legacy(userId, projectId, 'editor', key);
  const entry = archive.read(userId, projectId, 'editor', key);
  if (!entry && legacy) throw Error('native.draft-recovery-required');
  return entry ? nativeEditorDraftSchema.parse(entry.draft) : null;
}
export function loadNativeEditorDraft(
  userId: string,
  projectId: string,
  key: string,
  storage?: NativeDraftStorage,
): NativeEditorDraft | null {
  const identity = storageKey(userId, projectId, key),
    memory = getNativeMemoryDraft<NativeEditorDraft>(identity, storage);
  try {
    const draft = persisted(userId, projectId, key, storage);
    if (memory && nativeMemoryDraftFailed(identity, storage)) return memory;
    if (draft) retainNativeMemoryDraft(identity, draft, false, storage);
    else forgetNativeMemoryDraft(identity, storage);
    return draft;
  } catch (error) {
    markNativeDraftStorageFailure(identity, userId, projectId, storage);
    if (!memory) throw error;
    retainNativeMemoryDraft(identity, memory, true, storage);
    return memory;
  }
}
export function storeNativeEditorDraft(
  draft: NativeEditorDraft,
  storage?: NativeDraftStorage,
): void {
  const key = storageKey(draft.userId, draft.projectId, draft.key);
  // Keep the input before storage access or schema parsing can fail.
  retainNativeMemoryDraft(key, draft, true, storage);
  const archive = nativeDraftArchive(storage);
  archive.legacy(draft.userId, draft.projectId, 'editor', draft.key);
  archive.store('editor', draft.key, nativeEditorDraftSchema.parse(draft));
  retainNativeMemoryDraft(key, draft, false, storage);
}
export function discardNativeEditorDraft(
  userId: string,
  projectId: string,
  ref: NativeEditorDraftRef,
  storage?: NativeDraftStorage,
): void {
  const key = storageKey(userId, projectId, ref.key),
    memory = getNativeMemoryDraft<NativeEditorDraft>(key, storage);
  const archive = nativeDraftArchive(storage),
    entry = archive.read(userId, projectId, 'editor', ref.key);
  if (entry?.revision === ref.revision) archive.discard(userId, projectId, entry);
  if (memory?.revision === ref.revision) {
    forgetNativeMemoryDraft(key, storage);
  }
}
/** Explicit reset is separate from ACK matching and preserves input if storage is still unreadable. */
export function resetNativeEditorDraft(
  userId: string,
  projectId: string,
  key: string,
  storage?: NativeDraftStorage,
): void {
  const identity = storageKey(userId, projectId, key);
  nativeDraftArchive(storage).reset(userId, projectId, 'editor', key);
  forgetNativeMemoryDraft(identity, storage);
}
export function rebaseNativeEditorDraft(
  draft: NativeEditorDraft,
  expected: NativeEditorDraft['expected'],
  current: Record<string, string>,
): NativeEditorDraft {
  if (draft.expected.databaseRevision !== expected.databaseRevision)
    throw new Error('database.context-changed');
  if (draft.key.startsWith('create:') && draft.before.id)
    current = { ...current, id: draft.before.id };
  const values = { ...current };
  for (const [key, value] of Object.entries(draft.values))
    if (value !== draft.before[key]) values[key] = value;
  return { ...draft, revision: nativeDurableId(), expected, before: { ...current }, values };
}
