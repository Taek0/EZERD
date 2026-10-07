import { useLayoutEffect, useRef, useState } from 'react';

export const NATIVE_AUTOSAVE_QUIET_WINDOW_MS = 750;
export const NATIVE_AUTOSAVE_MAX_WAIT_MS = 2000;

/** Destructive actions always require a separate explicit confirmation. */
export function requiresNativeConfirmation(commands: readonly { type: string }[]) {
  return commands.some(({ type }) => /^(delete|clear|remove|reset)_/.test(type));
}

/** Only explicit user edits arm saving; recovered drafts and mount never do. */
export function useNativeAutosave({
  blocked,
  save,
  getBlocked,
  delay = NATIVE_AUTOSAVE_QUIET_WINDOW_MS,
  maxWait = NATIVE_AUTOSAVE_MAX_WAIT_MS,
}: {
  blocked: boolean;
  save: (draining?: boolean) => Promise<unknown>;
  getBlocked?: (draining: boolean) => boolean;
  delay?: number;
  maxWait?: number;
}) {
  const [revision, setRevision] = useState(0);
  const [composing, setComposing] = useState(false);
  const [saving, setSaving] = useState(false);
  const state = useRef({
    revision: 0,
    attempted: 0,
    composing: false,
    saving: false,
    mounted: false,
    firstChangedAt: null as number | null,
    lastChangedAt: null as number | null,
  });
  const latest = useRef({ blocked, save, getBlocked });
  useLayoutEffect(() => {
    latest.current = { blocked, save, getBlocked };
  });
  function flush(draining = false) {
    const current = state.current;
    if (
      !current.revision ||
      current.revision === current.attempted ||
      current.composing ||
      current.saving ||
      (latest.current.getBlocked?.(draining) ?? latest.current.blocked)
    )
      return;
    current.attempted = current.revision;
    current.firstChangedAt = null;
    current.saving = true;
    if (current.mounted) setSaving(true);
    void Promise.resolve()
      .then(() => latest.current.save(draining))
      .catch(() => {
        // Forms preserve and present errors; failed edits never automatically retry.
      })
      .finally(() => {
        current.saving = false;
        if (current.mounted) setSaving(false);
        else flush(true);
      });
  }
  useLayoutEffect(() => {
    state.current.mounted = true;
    return () => {
      state.current.mounted = false;
      // Selection changes must not strand a valid edit inside the debounce window.
      // Busy, unfinished IME and never-edited recovery input remain durably preserved.
      flush();
    };
  }, []);
  useLayoutEffect(() => {
    if (!revision || revision === state.current.attempted || blocked || composing || saving) return;
    const now = Date.now();
    const elapsed = now - (state.current.firstChangedAt ?? now);
    const quiet = now - (state.current.lastChangedAt ?? now);
    // ACK/blocker changes must not restart the user's quiet window or max-wait budget.
    const timer = setTimeout(
      () => flush(),
      Math.max(0, Math.min(delay - quiet, maxWait - elapsed)),
    );
    return () => clearTimeout(timer);
  }, [revision, blocked, composing, saving, delay, maxWait]);
  return {
    markChanged: () => {
      state.current.firstChangedAt ??= Date.now();
      state.current.lastChangedAt = Date.now();
      state.current.revision++;
      setRevision(state.current.revision);
    },
    flush,
    compositionProps: {
      onCompositionStart: () => {
        state.current.composing = true;
        setComposing(true);
      },
      onCompositionEnd: () => {
        state.current.composing = false;
        setComposing(false);
      },
    },
  };
}
