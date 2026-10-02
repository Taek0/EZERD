import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeDurableId } from './native-durable-queue.js';
import {
  registerNativeExportBlocker,
  clearNativeExportBlocker,
  nativeEditorExportBlocked,
  nativeEditorStorageFailed,
  installNativeDraftNavigationGuard,
  assertNativeDurableReady,
} from './native-export-state.js';
import {
  storeNativeEditorDraft,
  loadNativeEditorDraft,
  resetNativeEditorDraft,
} from './native-editor-draft.js';
afterEach(() => vi.unstubAllGlobals());
describe('native draft blocker survives editor lifetime', () => {
  it('unmount cleanup cannot clear storage failure or unapplied input', () => {
    const user = nativeDurableId(),
      project = nativeDurableId();
    const unmount = registerNativeExportBlocker(user, project, 'editor:format', {
      dirty: true,
      storageFailure: true,
    });
    unmount();
    expect(nativeEditorExportBlocked(user, project)).toBe(true);
    expect(nativeEditorStorageFailed(user, project)).toBe(true);
    expect(nativeEditorExportBlocked(nativeDurableId(), project)).toBe(false);
    clearNativeExportBlocker(user, project, 'editor:format');
    expect(nativeEditorExportBlocked(user, project)).toBe(false);
  });
  it('an old clean cleanup does not erase a newer mounted failed form with the same identity', () => {
    const user = nativeDurableId(),
      project = nativeDurableId();
    const old = registerNativeExportBlocker(user, project, 'editor:format', {
      dirty: false,
      storageFailure: false,
    });
    const next = registerNativeExportBlocker(user, project, 'editor:format', {
      dirty: true,
      storageFailure: true,
    });
    old();
    next();
    expect(nativeEditorStorageFailed(user, project)).toBe(true);
    clearNativeExportBlocker(user, project, 'editor:format');
  });
  it('preserves failed tokens and the close/navigation blocker until explicit durable reset', () => {
    const values = new Map<string, string>();
    let failing = true;
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failing) throw Error('Quota');
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    vi.stubGlobal('localStorage', storage);
    const userId = nativeDurableId(),
      projectId = nativeDurableId(),
      key = 'format:column:c';
    const draft = {
      userId,
      projectId,
      key,
      revision: nativeDurableId(),
      expected: { version: 1, sequence: 1, databaseRevision: 1 },
      before: { token: '' },
      values: { token: '-unfinished' },
    };
    expect(() => storeNativeEditorDraft(draft)).toThrow('Quota');
    expect(loadNativeEditorDraft(userId, projectId, key)).toEqual(draft);
    expect(nativeEditorStorageFailed(userId, projectId)).toBe(true);
    const unmount = registerNativeExportBlocker(userId, projectId, `editor:${key}`, {
      dirty: true,
      storageFailure: true,
    });
    unmount();
    const target = new EventTarget(),
      remove = installNativeDraftNavigationGuard(target as unknown as Window);
    const blocked = new Event('beforeunload', { cancelable: true });
    target.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);
    failing = false;
    resetNativeEditorDraft(userId, projectId, key);
    expect(nativeEditorExportBlocked(userId, projectId)).toBe(false);
    const ready = new Event('beforeunload', { cancelable: true });
    target.dispatchEvent(ready);
    expect(ready.defaultPrevented).toBe(false);
    remove();
  });
  it('recovers failed input when the localStorage property itself throws, then becomes available again', () => {
    const data = new Map<string, string>(),
      storage = {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => {
          data.set(key, value);
        },
        removeItem: (key: string) => {
          data.delete(key);
        },
      };
    vi.stubGlobal('localStorage', storage);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw Error('Denied access');
      },
    });
    const userId = nativeDurableId(),
      projectId = nativeDurableId(),
      key = 'format:column:failed-getter';
    const input = {
      userId,
      projectId,
      key,
      revision: nativeDurableId(),
      expected: { version: 1, sequence: 1, databaseRevision: 1 },
      before: { token: '' },
      values: { token: '-input' },
    };
    expect(() => storeNativeEditorDraft(input)).toThrow('Denied access');
    expect(loadNativeEditorDraft(userId, projectId, key)).toEqual(input);
    expect(nativeEditorStorageFailed(userId, projectId)).toBe(true);
    vi.stubGlobal('localStorage', storage);
    expect(loadNativeEditorDraft(userId, projectId, key)).toEqual(input);
    storeNativeEditorDraft(input);
    expect(nativeEditorStorageFailed(userId, projectId)).toBe(false);
    resetNativeEditorDraft(userId, projectId, key);
  });
  it('storage unknown cannot be treated as a ready empty project', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(assertNativeDurableReady(nativeDurableId(), nativeDurableId())).rejects.toThrow(
      'native.pending-storage-unknown',
    );
  });
});
