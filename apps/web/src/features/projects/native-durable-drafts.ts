export type NativeDraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface MemoryDraft {
  userId: string;
  projectId: string;
  value: unknown;
  dirty: boolean;
  storageFailure: boolean;
}
const defaultOwner = {};
const pools = new WeakMap<object, Map<string, MemoryDraft>>();
const listeners = new Set<() => void>();
const forgotten = new Set<(key: string) => void>();
export function subscribeNativeDraftForget(listener: (key: string) => void) {
  forgotten.add(listener);
  return () => {
    forgotten.delete(listener);
  };
}
function owner(storage?: NativeDraftStorage): object {
  if (storage) return storage;
  try {
    return globalThis.localStorage ?? defaultOwner;
  } catch {
    return defaultOwner;
  }
}
function pool(storage?: NativeDraftStorage) {
  const id = owner(storage);
  let entries = pools.get(id);
  if (!entries) {
    entries = new Map();
    pools.set(id, entries);
  }
  if (id !== defaultOwner) {
    const fallback = pools.get(defaultOwner);
    for (const [key, draft] of fallback ?? []) {
      if (draft.value !== undefined) entries.set(key, draft);
      fallback!.delete(key);
    }
  }
  return entries;
}
function notify() {
  for (const listener of listeners) listener();
}
export function subscribeNativeDraftMemory(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function getNativeMemoryDraft<T>(key: string, storage?: NativeDraftStorage): T | null {
  const value = pool(storage).get(key)?.value;
  return value === undefined ? null : (structuredClone(value) as T);
}
export function nativeDraftMemoryState(
  userId: string,
  projectId: string,
  storage?: NativeDraftStorage,
) {
  const entries = [...pool(storage).values()].filter(
    (value) => value.userId === userId && value.projectId === projectId,
  );
  return {
    dirty: entries.some((value) => value.dirty),
    storageFailure: entries.some((value) => value.storageFailure),
  };
}
export function nativeMemoryDraftFailed(key: string, storage?: NativeDraftStorage): boolean {
  return pool(storage).get(key)?.storageFailure ?? false;
}
export function markNativeDraftStorageFailure(
  key: string,
  userId: string,
  projectId: string,
  storage?: NativeDraftStorage,
) {
  const previous = pool(storage).get(key);
  pool(storage).set(key, {
    userId,
    projectId,
    value: previous?.value,
    dirty: previous?.dirty ?? false,
    storageFailure: true,
  });
  notify();
}
export function hasNativeMemoryDrafts(): boolean {
  return [...pool().values()].some((draft) => draft.dirty || draft.storageFailure);
}
export function retainNativeMemoryDraft(
  key: string,
  draft: { userId: string; projectId: string; values: object; before: object },
  failed: boolean,
  storage?: NativeDraftStorage,
) {
  pool(storage).set(key, {
    userId: draft.userId,
    projectId: draft.projectId,
    value: structuredClone(draft),
    dirty: [...new Set([...Object.keys(draft.values), ...Object.keys(draft.before)])].some(
      (key) =>
        (draft.values as Record<string, unknown>)[key] !==
        (draft.before as Record<string, unknown>)[key],
    ),
    storageFailure: failed,
  });
  notify();
}
export function forgetNativeMemoryDraft(key: string, storage?: NativeDraftStorage) {
  pool(storage).delete(key);
  for (const listener of forgotten) listener(key);
  notify();
}
export function nativeDraftStorage(storage?: NativeDraftStorage): NativeDraftStorage {
  const target = storage ?? globalThis.localStorage;
  if (!target) throw Error('native.draft-storage-failed');
  return target;
}
