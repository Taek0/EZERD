import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  forgetNativeMemoryDraft,
  getNativeMemoryDraft,
  nativeDraftMemoryState,
  retainNativeMemoryDraft,
  subscribeNativeDraftMemory,
} from './native-durable-drafts.js';
import {
  clearNativeExportBlocker,
  installNativeDraftNavigationGuard,
  nativeEditorExportBlocked,
  nativeEditorStorageFailed,
  registerNativeExportBlocker,
  useNativeExportBlocked,
} from './native-export-state.js';
import { loadNativeEditorDraft, storeNativeEditorDraft } from './native-editor-draft.js';
import { loadNativeDraft, storeNativeDraft } from './native-save.js';

// Capture the actual hook subscription; state initialization below uses real React SSR.
// This checks render-stack delivery, not a browser-mounted React warning assertion.
const hook = vi.hoisted(() => ({
  subscribe: undefined as undefined | ((listener: () => void) => () => void),
}));
vi.mock('react', async (original: () => Promise<typeof import('react')>) => ({
  ...(await original()),
  useSyncExternalStore(subscribe: typeof hook.subscribe, snapshot: () => boolean) {
    hook.subscribe = subscribe;
    return snapshot();
  },
}));

let userId: string, projectId: string;
const cleanups: (() => void)[] = [];
beforeEach(async () => {
  await Promise.resolve();
  userId = crypto.randomUUID();
  projectId = crypto.randomUUID();
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  });
});
afterEach(async () => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup());
  clearNativeExportBlocker(userId, projectId, 'editor:form');
  await Promise.resolve();
  vi.unstubAllGlobals();
});
function subscribeExport(listener: () => void) {
  useNativeExportBlocked(userId, projectId);
  const unsubscribe = hook.subscribe!(listener);
  cleanups.push(unsubscribe);
  return unsubscribe;
}
function subscribeMemory(listener: () => void) {
  const unsubscribe = subscribeNativeDraftMemory(listener);
  cleanups.push(unsubscribe);
  return unsubscribe;
}
function retain(value = 'unfinished') {
  retainNativeMemoryDraft(
    'memory',
    {
      userId,
      projectId,
      before: { token: '' },
      values: { token: value },
    },
    false,
  );
}
function block(dirty: boolean) {
  return registerNativeExportBlocker(userId, projectId, 'editor:form', {
    dirty,
    storageFailure: false,
  });
}

describe('draft notifications leave the render stack while guards remain synchronous', () => {
  it('coalesces memory and export notifications for their shared subscriber', async () => {
    const listener = vi.fn();
    subscribeExport(listener);
    block(true);
    retain('20e');
    retain('20e-');
    expect(getNativeMemoryDraft('memory')).toMatchObject({ values: { token: '20e-' } });
    expect(nativeDraftMemoryState(userId, projectId).dirty).toBe(true);
    expect(nativeEditorExportBlocked(userId, projectId)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(0);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each(['memory', 'export'] as const)(
    'honors unsubscribe before and during %s delivery',
    async (store) => {
      const subscribe = store === 'memory' ? subscribeMemory : subscribeExport;
      const notify = store === 'memory' ? () => retain() : () => block(true);
      const removedBefore = vi.fn();
      const removeBeforeFlush = subscribe(removedBefore);
      let removeLater = () => {};
      const first = vi.fn(() => removeLater());
      subscribe(first);
      const removedDuring = vi.fn();
      removeLater = subscribe(removedDuring);
      notify();
      removeBeforeFlush();
      await Promise.resolve();
      expect(first).toHaveBeenCalledTimes(1);
      expect(removedBefore).toHaveBeenCalledTimes(0);
      expect(removedDuring).toHaveBeenCalledTimes(0);
    },
  );

  it.each(['memory', 'export'] as const)(
    'queues new dirty state during %s flush without recursive delivery',
    async (store) => {
      const subscribe = store === 'memory' ? subscribeMemory : subscribeExport;
      const mutate = (dirty: boolean) =>
        store === 'memory' ? retain(dirty ? 'new input' : '') : block(dirty);
      const seen: boolean[] = [];
      const added = vi.fn();
      subscribe(() => {
        seen.push(nativeEditorExportBlocked(userId, projectId));
        if (seen.length === 1) {
          subscribe(added);
          mutate(true);
          expect(nativeEditorExportBlocked(userId, projectId)).toBe(true);
          expect(seen).toEqual([false]);
        }
      });
      mutate(false);
      await Promise.resolve();
      expect(seen).toEqual([false]);
      expect(added).toHaveBeenCalledTimes(0);
      await Promise.resolve();
      expect(seen).toEqual([false, true]);
      expect(added).toHaveBeenCalledTimes(1);
    },
  );

  it('clears acknowledged identity immediately and guards a new draft before notification', async () => {
    const listener = vi.fn();
    subscribeExport(listener);
    const key = `ezerd.native.editor:${JSON.stringify([userId, projectId, 'form'])}`;
    block(true);
    forgetNativeMemoryDraft(key);
    expect(nativeEditorExportBlocked(userId, projectId)).toBe(false);
    retain();
    expect(nativeEditorExportBlocked(userId, projectId)).toBe(true);
    const target = new EventTarget();
    cleanups.push(installNativeDraftNavigationGuard(target as unknown as Window));
    const closing = new Event('beforeunload', { cancelable: true });
    target.dispatchEvent(closing);
    expect(closing.defaultPrevented).toBe(true);
    expect(listener).toHaveBeenCalledTimes(0);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each(['editor', 'property'] as const)(
    'defers retain/forget notifications from %s useState draft loading',
    async (kind) => {
      const before = { physicalName: 'id', comment: '', logicalName: '', definition: '' };
      const draft = {
        userId,
        projectId,
        expected: { version: 1, sequence: 0, databaseRevision: 0 },
        before,
        values: { ...before, comment: 'raw <20e> draft' },
      };
      if (kind === 'editor')
        storeNativeEditorDraft({ ...draft, key: 'form', revision: crypto.randomUUID() });
      else storeNativeDraft({ ...draft, kind: 'column', objectId: 'column' });
      await Promise.resolve();
      let rendering = false;
      const listener = vi.fn(() => expect(rendering).toBe(false));
      subscribeExport(listener);
      function DraftReader({ missing }: { missing: boolean }) {
        const [loaded] = useState(() =>
          kind === 'editor'
            ? loadNativeEditorDraft(userId, projectId, missing ? 'missing' : 'form')
            : loadNativeDraft(userId, projectId, 'column', missing ? 'missing' : 'column'),
        );
        return createElement('span', null, loaded?.values.comment ?? 'empty');
      }
      rendering = true;
      try {
        expect(renderToStaticMarkup(createElement(DraftReader, { missing: false }))).toContain(
          'raw &lt;20e&gt; draft',
        );
        expect(renderToStaticMarkup(createElement(DraftReader, { missing: true }))).toContain(
          'empty',
        );
        expect(nativeEditorExportBlocked(userId, projectId)).toBe(true);
        expect(listener).toHaveBeenCalledTimes(0);
      } finally {
        rendering = false;
      }
      await Promise.resolve();
      expect(listener).toHaveBeenCalledTimes(1);
    },
  );

  it('exposes storage failure synchronously while postponing UI delivery', async () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw Error('Denied');
      },
      setItem() {
        throw Error('Denied');
      },
      removeItem() {
        throw Error('Denied');
      },
    });
    const listener = vi.fn();
    subscribeExport(listener);
    expect(() => loadNativeEditorDraft(userId, projectId, 'form')).toThrow('Denied');
    expect(nativeEditorStorageFailed(userId, projectId)).toBe(true);
    expect(nativeEditorExportBlocked(userId, projectId)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(0);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
