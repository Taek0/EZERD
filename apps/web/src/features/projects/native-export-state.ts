import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  nativeDraftMemoryState,
  subscribeNativeDraftMemory,
  subscribeNativeDraftForget,
  hasNativeMemoryDrafts,
} from './native-durable-drafts.js';
import { getNativeDurableQueue } from './native-durable-queue.js';
type State = { dirty: boolean; storageFailure: boolean };
const states = new Map<string, Map<symbol | string, State>>(),
  listeners = new Set<() => void>();
const scope = (userId: string, projectId: string) => JSON.stringify([userId, projectId]);
function notify() {
  for (const listener of listeners) listener();
}
function hasUnsentIntent(userId: string, projectId: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const prefix = `ezerd.native.intent:${JSON.stringify([userId, projectId])}:`;
    for (let index = 0; index < localStorage.length; index++)
      if (localStorage.key(index)?.startsWith(prefix)) return true;
    return false;
  } catch {
    return true;
  }
}
if (typeof window !== 'undefined')
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key.startsWith('ezerd.native.intent:')) notify();
  });
export function nativeEditorExportBlocked(userId: string, projectId: string): boolean {
  const memory = nativeDraftMemoryState(userId, projectId);
  return (
    memory.dirty ||
    memory.storageFailure ||
    hasUnsentIntent(userId, projectId) ||
    [...(states.get(scope(userId, projectId))?.values() ?? [])].some(
      (state) => state.dirty || state.storageFailure,
    )
  );
}
export function nativeEditorStorageFailed(userId: string, projectId: string): boolean {
  return (
    nativeDraftMemoryState(userId, projectId).storageFailure ||
    [...(states.get(scope(userId, projectId))?.values() ?? [])].some(
      (state) => state.storageFailure,
    )
  );
}
export function useNativeExportBlocker(
  userId: string,
  projectId: string,
  dirty: boolean,
  storageFailure: boolean,
  identity?: string,
) {
  const token = useRef(Symbol());
  useEffect(
    () =>
      registerNativeExportBlocker(userId, projectId, identity ?? token.current, {
        dirty,
        storageFailure,
      }),
    [userId, projectId, dirty, storageFailure, identity],
  );
}
export function registerNativeExportBlocker(
  userId: string,
  projectId: string,
  identity: symbol | string,
  state: State,
): () => void {
  const key = scope(userId, projectId),
    entries = states.get(key) ?? new Map<symbol | string, State>();
  states.set(key, entries);
  entries.set(identity, state);
  notify();
  return () => {
    if (!state.dirty && !state.storageFailure && entries.get(identity) === state)
      entries.delete(identity);
    if (!entries.size && states.get(key) === entries) states.delete(key);
    notify();
  };
}
/** Browser close/reload guard; SPA navigation must use the scoped guard as well. */
export function installNativeDraftNavigationGuard(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
): () => void {
  const guard = (event: BeforeUnloadEvent) => {
    if (
      hasNativeMemoryDrafts() ||
      [...states.values()].some((entries) =>
        [...entries.values()].some((state) => state.dirty || state.storageFailure),
      )
    ) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  target.addEventListener('beforeunload', guard);
  return () => target.removeEventListener('beforeunload', guard);
}
if (typeof window !== 'undefined') installNativeDraftNavigationGuard(window);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const unsubscribeMemory = subscribeNativeDraftMemory(listener);
  return () => {
    unsubscribeMemory();
    listeners.delete(listener);
  };
};
export function useNativeExportBlocked(userId: string, projectId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => nativeEditorExportBlocked(userId, projectId),
    () => false,
  );
}

/** Only call after explicit durable reset or consumption of the matching accepted input. */
export function clearNativeExportBlocker(
  userId: string,
  projectId: string,
  identity: string,
): void {
  const key = scope(userId, projectId),
    entries = states.get(key);
  entries?.delete(identity);
  if (!entries?.size) states.delete(key);
  notify();
}
subscribeNativeDraftForget((key) => {
  const editor = key.startsWith('ezerd.native.editor:'),
    property = key.startsWith('ezerd.native.draft:');
  if (!editor && !property) return;
  const parts: string[] = JSON.parse(
    key.slice((editor ? 'ezerd.native.editor:' : 'ezerd.native.draft:').length),
  );
  clearNativeExportBlocker(
    parts[0]!,
    parts[1]!,
    editor ? `editor:${parts[2]}` : `property:${parts[2]}:${parts[3]}`,
  );
});
/** Main navigation/export/history consumers must await this before trusting an empty queue. */
export async function assertNativeDurableReady(userId: string, projectId: string): Promise<void> {
  if (await getNativeDurableQueue().read(userId, projectId)) throw Error('native.pending-exists');
  if (nativeEditorExportBlocked(userId, projectId)) throw Error('project-export.unsaved-draft');
}
export function useNativeDurableState(userId: string, projectId: string) {
  let queue: ReturnType<typeof getNativeDurableQueue> | undefined;
  try {
    queue = getNativeDurableQueue();
  } catch {
    /* Unknown means blocked; no memory pending fallback. */
  }
  useEffect(() => {
    void queue?.read(userId, projectId).catch(() => {});
  }, [queue, userId, projectId]);
  return useSyncExternalStore(
    (listener) => queue?.subscribe(userId, projectId, listener) ?? (() => {}),
    () => queue?.state(userId, projectId) ?? 'unknown',
    () => 'unknown' as const,
  );
}
