import {
  createHookDriverState,
  type HookDriverState,
} from '../../shared/testing/react-hook-driver.js';
import { elementNodes as nodes } from '../../shared/testing/react-element-tree.js';
import { NATIVE_AUTOSAVE_QUIET_WINDOW_MS } from './use-native-autosave.js';

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NativeEditorForm } from './native-editor-form.js';
import { clipboardActor, clipboardSnapshot } from './native-clipboard-test-fixtures.js';
import { loadNativeEditorDraft } from './native-editor-draft.js';
const hooks = vi.hoisted(() => ({
  active: null as HookDriverState | null,
}));
vi.mock('./native-export-state.js', () => ({ useNativeExportBlocker() {} }));
vi.mock('../../shared/i18n/index.js', () => ({
  registerTranslations() {},
  useI18n: () => ({ t: (value: string) => value }),
}));
vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>();
  const { mockReactHooks } = await import('../../shared/testing/react-hook-driver.js');
  return mockReactHooks(actual, () => hooks.active);
});
function root() {
  const state = createHookDriverState();
  return {
    render<T>(render: () => T): T {
      hooks.active = state;
      state.cursor = 0;
      const result = render();
      state.effects.splice(0).forEach((effect) => effect());
      hooks.active = null;
      return result;
    },
    unmount() {
      state.slots.forEach((slot) => slot.cleanup?.());
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal('navigator', {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('continuous form editing during queued saves', () => {
  it('sends a return to the original value after an earlier edit, and old ACK does not erase it', async () => {
    const snapshot = clipboardSnapshot();
    const view = root();
    let resolve!: (value: boolean) => void;
    const save = vi.fn(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    let change!: (field: string, value: string) => void;
    const render = () =>
      view.render(() =>
        NativeEditorForm({
          context: { userId: clipboardActor, snapshot, busy: false, onSave: save },
          draftKey: 'test:continuous',
          title: 'test',
          initial: { name: 'A' },
          build: (values) => [
            { type: 'patch_table', id: 'a', patch: { logical: { name: values.name! } } },
          ],
          children: (_values, edit) => {
            change = edit;
            return null;
          },
        }),
      );
    render();
    change('name', 'B');
    render();
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    render();
    expect(save).toHaveBeenCalledTimes(1);
    const firstAck = resolve;
    render();
    change('name', 'A');
    render();
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    render();
    expect(save).toHaveBeenCalledTimes(1);
    firstAck(true);
    await vi.advanceTimersByTimeAsync(0);
    render();
    expect(
      loadNativeEditorDraft(clipboardActor, snapshot.project.id, 'test:continuous')?.values.name,
    ).toBe('A');
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    expect(save).toHaveBeenCalledTimes(2);
    expect((save.mock.calls[1] as unknown as [unknown])[0]).toEqual([
      { type: 'patch_table', id: 'a', patch: { logical: { name: 'A' } } },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(
      loadNativeEditorDraft(clipboardActor, snapshot.project.id, 'test:continuous')?.values.name,
    ).toBe('A');
    resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    view.unmount();
  });
});
