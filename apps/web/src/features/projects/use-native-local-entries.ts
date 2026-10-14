import { useEffect, useState, startTransition } from 'react';
import { subscribeNativeDraftMemory, nativeDraftMemoryState } from './native-durable-drafts.js';
import {
  readNativeLocalDraftNames,
  type NativeLocalDraftName,
} from './native-local-draft-names.js';
import {
  readNativeLocalEntries,
  pruneNativeLocalBridges,
  subscribeNativeLocalChanges,
  type NativeLocalEntry,
} from './native-local-projection.js';
const empty: NativeLocalEntry[] = [];
const emptyDrafts: NativeLocalDraftName[] = [];
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
      const drafts = user ? readNativeLocalDraftNames(user, project) : emptyDrafts;
      const error = user ? nativeDraftMemoryState(user, project).storageFailure : false;
      return {
        identity,
        entries,
        drafts,
        error,
        signature: JSON.stringify([
          entries.map((entry) => [entry.key, entry.ackSequence]),
          drafts,
          error,
        ]),
      };
    } catch {
      return { identity, entries: empty, drafts: emptyDrafts, error: true, signature: 'error' };
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
    const unsubscribeDrafts = subscribeNativeDraftMemory(() => startTransition(refresh));
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
      unsubscribeDrafts();
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
  return state.identity === identity
    ? state
    : { entries: empty, drafts: emptyDrafts, error: false };
}
