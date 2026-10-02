import { useEffect, useRef, useSyncExternalStore } from 'react';
type State = { dirty: boolean; storageFailure: boolean };
const states = new Map<string, Map<symbol, State>>(),
  listeners = new Set<() => void>();
const scope = (userId: string, projectId: string) => JSON.stringify([userId, projectId]);
function notify() {
  for (const listener of listeners) listener();
}
export function nativeEditorExportBlocked(userId: string, projectId: string): boolean {
  return [...(states.get(scope(userId, projectId))?.values() ?? [])].some(
    (state) => state.dirty || state.storageFailure,
  );
}
export function nativeEditorStorageFailed(userId: string, projectId: string): boolean {
  return [...(states.get(scope(userId, projectId))?.values() ?? [])].some(
    (state) => state.storageFailure,
  );
}
export function useNativeExportBlocker(
  userId: string,
  projectId: string,
  dirty: boolean,
  storageFailure: boolean,
) {
  const token = useRef(Symbol());
  useEffect(() => {
    const key = scope(userId, projectId),
      entries = states.get(key) ?? new Map<symbol, State>();
    states.set(key, entries);
    entries.set(token.current, { dirty, storageFailure });
    notify();
    return () => {
      entries.delete(token.current);
      if (!entries.size) states.delete(key);
      notify();
    };
  }, [userId, projectId, dirty, storageFailure]);
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
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
