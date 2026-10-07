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
let pendingNotifications = new Set<Set<() => void>>();
/** Defer only UI subscriptions, never draft mutations or synchronous forget/ACK handling.
 * A subscriber shared by memory and export stores receives one callback per batch. */
export function queueNativeDraftNotifications(subscribers: Set<() => void>) {
  const scheduled = pendingNotifications.size > 0;
  pendingNotifications.add(subscribers);
  if (scheduled) return;
  queueMicrotask(() => {
    const batch = [...pendingNotifications];
    pendingNotifications = new Set();
    // Snapshot before delivery: a subscription added while flushing waits for the next change.
    const callbacks = new Set(batch.flatMap((group) => [...group]));
    for (const listener of callbacks) {
      if (batch.some((group) => group.has(listener))) listener();
    }
  });
}
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
  queueNativeDraftNotifications(listeners);
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
/** Includes failed inputs from closed forms; no object/document lookup is required. */
export function listNativeMemoryDrafts(
  userId: string,
  projectId: string,
  storage?: NativeDraftStorage,
) {
  return [...pool(storage)]
    .filter(
      ([, draft]) =>
        draft.userId === userId && draft.projectId === projectId && draft.value !== undefined,
    )
    .map(([key, draft]) => ({
      key,
      value: structuredClone(draft.value),
      storageFailure: draft.storageFailure,
    }));
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
