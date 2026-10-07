import { isValidElement, type ReactElement } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NativeEditorForm } from './native-editor-form.js';
import { clipboardActor, clipboardSnapshot } from './native-clipboard-test-fixtures.js';
import { loadNativeEditorDraft } from './native-editor-draft.js';
const hooks = vi.hoisted(() => ({
  active: null as null | {
    slots: {
      value?: unknown;
      deps?: readonly unknown[] | undefined;
      cleanup?: (() => void) | undefined;
    }[];
    cursor: number;
    effects: (() => void)[];
  },
}));
vi.mock('./native-export-state.js', () => ({ useNativeExportBlocker() {} }));
vi.mock('../../shared/i18n/index.js', () => ({
  registerTranslations() {},
  useI18n: () => ({ t: (value: string) => value }),
}));
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return {
    ...react,
    useState(initial: unknown) {
      const active = hooks.active!,
        index = active.cursor++,
        slot = (active.slots[index] ??= {
          value: typeof initial === 'function' ? initial() : initial,
        });
      return [
        slot.value,
        (value: unknown) => {
          slot.value = typeof value === 'function' ? value(slot.value) : value;
        },
      ];
    },
    useRef(initial: unknown) {
      const active = hooks.active!;
      return (active.slots[active.cursor++] ??= { value: { current: initial } }).value;
    },
    useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
      const active = hooks.active!,
        slot = (active.slots[active.cursor++] ??= {});
      if (!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps![index]))) {
        active.effects.push(() => {
          slot.cleanup?.();
          slot.cleanup = effect() || undefined;
        });
        slot.deps = deps;
      }
    },
    useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      const active = hooks.active!,
        slot = (active.slots[active.cursor++] ??= {});
      if (
        !deps ||
        !slot.deps ||
        deps.some((value, index) => !Object.is(value, slot.deps![index]))
      ) {
        active.effects.push(() => {
          slot.cleanup?.();
          slot.cleanup = effect() || undefined;
        });
        slot.deps = deps;
      }
    },
  };
});
function root() {
  const state = {
    slots: [] as NonNullable<typeof hooks.active>['slots'],
    cursor: 0,
    effects: [] as (() => void)[],
  };
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
function nodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
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
    await vi.advanceTimersByTimeAsync(300);
    render();
    expect(save).toHaveBeenCalledTimes(1);
    const firstAck = resolve;
    render();
    change('name', 'A');
    render();
    await vi.advanceTimersByTimeAsync(300);
    render();
    expect(save).toHaveBeenCalledTimes(1);
    firstAck(true);
    await vi.advanceTimersByTimeAsync(0);
    render();
    expect(
      loadNativeEditorDraft(clipboardActor, snapshot.project.id, 'test:continuous')?.values.name,
    ).toBe('A');
    await vi.advanceTimersByTimeAsync(300);
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
