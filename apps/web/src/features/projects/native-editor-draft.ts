import {
  nativeEditorDraftSchema,
  type NativeEditorDraft,
  type NativeEditorDraftRef,
} from '@ezerd/contracts';
export type { NativeEditorDraft, NativeEditorDraftRef } from '@ezerd/contracts';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
const storageKey = (userId: string, projectId: string, key: string) =>
  `ezerd.native.editor:${JSON.stringify([userId, projectId, key])}`;
export function loadNativeEditorDraft(
  userId: string,
  projectId: string,
  key: string,
  storage: Storage = localStorage,
): NativeEditorDraft | null {
  const raw = storage.getItem(storageKey(userId, projectId, key));
  if (raw === null) return null;
  const draft = nativeEditorDraftSchema.parse(JSON.parse(raw));
  if (draft.userId !== userId || draft.projectId !== projectId || draft.key !== key)
    throw new Error('native.draft-invalid');
  return draft;
}
export function storeNativeEditorDraft(
  draft: NativeEditorDraft,
  storage: Storage = localStorage,
): void {
  loadNativeEditorDraft(draft.userId, draft.projectId, draft.key, storage);
  const value = JSON.stringify(nativeEditorDraftSchema.parse(draft));
  const key = storageKey(draft.userId, draft.projectId, draft.key);
  storage.setItem(key, value);
  if (storage.getItem(key) !== value) throw new Error('native.draft-storage-failed');
}
export function discardNativeEditorDraft(
  userId: string,
  projectId: string,
  ref: NativeEditorDraftRef,
  storage: Storage = localStorage,
): void {
  const draft = loadNativeEditorDraft(userId, projectId, ref.key, storage);
  if (draft?.revision === ref.revision) storage.removeItem(storageKey(userId, projectId, ref.key));
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
  return { ...draft, revision: crypto.randomUUID(), expected, before: { ...current }, values };
}
