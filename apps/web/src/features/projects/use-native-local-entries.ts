import { useEffect, useState } from 'react';
import {
  readNativeLocalEntries,
  pruneNativeLocalBridges,
  subscribeNativeLocalChanges,
  type NativeLocalEntry,
} from './native-local-projection.js';
const empty: NativeLocalEntry[] = [];
export function useNativeLocalEntries(
  user: string,
  project: string,
  sequence: number,
  revision: number,
) {
  const identity = JSON.stringify([user, project]);
  const read = () => {
    try {
      const entries =
        user && typeof localStorage !== 'undefined'
          ? readNativeLocalEntries(user, project, localStorage)
          : empty;
      return {
        identity,
        entries,
        error: false,
        signature: JSON.stringify(entries.map((entry) => [entry.key, entry.ackSequence])),
      };
    } catch {
      return { identity, entries: empty, error: true, signature: 'error' };
    }
  };
  const [state, setState] = useState(read);
  useEffect(() => {
    const refresh = () => {
      const next = read();
      setState((current) =>
        current.identity === next.identity && current.signature === next.signature ? current : next,
      );
    };
    const unsubscribe = subscribeNativeLocalChanges(user, project, refresh);
    const storage = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key.startsWith('ezerd.native.intent:') ||
        event.key.startsWith('ezerd.native.visual-ack:')
      )
        refresh();
    };
    window.addEventListener('storage', storage);
    refresh();
    return () => {
      unsubscribe();
      window.removeEventListener('storage', storage);
    };
  }, [identity]);
  useEffect(() => {
    if (!user) return;
    try {
      pruneNativeLocalBridges(user, project, sequence, revision, localStorage);
      const next = read();
      setState((current) =>
        current.identity === next.identity && current.signature === next.signature ? current : next,
      );
    } catch {
      /* The projection reader reports storage failures. */
    }
  }, [identity, sequence, revision]);
  return state.identity === identity ? state : { entries: empty, error: false };
}
