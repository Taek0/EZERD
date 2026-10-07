import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeEditorForm } from './native-editor-form.js';
import { NativePropertyEditor } from './NativePropertyEditor.js';
import { clipboardSnapshot } from './native-clipboard-test-fixtures.js';
import { nativeTestDeferred } from './native-durable-test-environment.js';
import type { NativeWebCommand } from './native-save.js';
// Run the actual component's event handlers and effect dependency graph without a browser.
const hooks = vi.hoisted(() => ({
  cursor: 0,
  dirty: false,
  slots: [] as {
    value?: unknown;
    deps?: readonly unknown[] | undefined;
    cleanup?: (() => void) | undefined;
  }[],
  layouts: [] as (() => void)[],
  effects: [] as (() => void)[],
}));
vi.mock('./native-export-state.js', () => ({ useNativeExportBlocker() {} }));
vi.mock('../../shared/i18n/index.js', () => ({
  registerTranslations() {},
  useI18n: () => ({ t: (value: string) => value, locale: 'en' }),
}));
vi.mock('../../components/ui/ConfirmProvider.js', () => ({
  ConfirmProvider: ({ children }: { children: unknown }) => children,
  useConfirm: () => vi.fn(async () => true),
}));
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  function changed(previous: readonly unknown[] | undefined, next?: readonly unknown[]) {
    return (
      !previous ||
      !next ||
      previous.length !== next.length ||
      next.some((value, i) => !Object.is(value, previous[i]))
    );
  }
  function effect(
    callback: () => void | (() => void),
    deps: readonly unknown[] | undefined,
    layout: boolean,
  ) {
    const slot = (hooks.slots[hooks.cursor++] ??= {});
    if (changed(slot.deps, deps)) {
      (layout ? hooks.layouts : hooks.effects).push(() => {
        slot.cleanup?.();
        slot.cleanup = callback() || undefined;
      });
      slot.deps = deps;
    }
  }
  function memo(factory: () => unknown, deps: readonly unknown[]) {
    const slot = (hooks.slots[hooks.cursor++] ??= {});
    if (changed(slot.deps, deps)) {
      slot.value = factory();
      slot.deps = deps;
    }
    return slot.value;
  }
  return {
    ...react,
    useState(initial: unknown) {
      const slot = (hooks.slots[hooks.cursor++] ??= {
        value: typeof initial === 'function' ? initial() : initial,
      });
      return [
        slot.value,
        (value: unknown) => {
          const next = typeof value === 'function' ? value(slot.value) : value;
          if (!Object.is(slot.value, next)) hooks.dirty = true;
          slot.value = next;
        },
      ];
    },
    useRef(initial: unknown) {
      return (hooks.slots[hooks.cursor++] ??= { value: { current: initial } }).value;
    },
    useMemo: memo,
    useCallback: (callback: unknown, deps: readonly unknown[]) => memo(() => callback, deps),
    useEffect: (callback: () => void, deps?: readonly unknown[]) => effect(callback, deps, false),
    useLayoutEffect: (callback: () => void, deps?: readonly unknown[]) =>
      effect(callback, deps, true),
  };
});

function nodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
beforeEach(() => {
  vi.useFakeTimers();
  hooks.cursor = 0;
  hooks.dirty = false;
  hooks.slots = [];
  hooks.layouts = [];
  hooks.effects = [];
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
afterEach(() => {
  hooks.slots.forEach((slot) => slot.cleanup?.());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function editor(kind: 'generic' | 'property') {
  const snapshot = clipboardSnapshot();
  if (snapshot.native?.status !== 'available') throw Error('Expected native document');
  const table = {
    ...snapshot.native.document.tables![0]!,
    physical: { ...snapshot.native.document.tables![0]!.physical, name: 'A' },
  };
  const completions: ReturnType<typeof nativeTestDeferred<boolean>>[] = [];
  const onSave = vi.fn((_commands: NativeWebCommand[]) => {
    const pending = nativeTestDeferred<boolean>();
    completions.push(pending);
    return pending.promise;
  });
  const context = { userId: crypto.randomUUID(), snapshot, busy: false, onSave };
  let change: (value: string) => void;
  let value = '';
  let tree: unknown;
  function render() {
    let renders = 0;
    do {
      if (++renders > 30) throw Error('Editor effects did not settle');
      hooks.cursor = 0;
      hooks.dirty = false;
      if (kind === 'generic') {
        tree = NativeEditorForm({
          context,
          draftKey: 'concurrent',
          title: 'Concurrent editor',
          initial: { name: table.physical.name },
          build: (values, before) =>
            values.name === before.name
              ? []
              : [
                  {
                    type: 'patch_table',
                    id: table.id,
                    patch: { physical: { name: values.name! } },
                  },
                ],
          children: (values, onChange) => {
            value = values.name!;
            change = (next) => onChange('name', next);
            return null;
          },
        });
      } else {
        tree = NativePropertyEditor({
          table,
          busy: false,
          userId: context.userId,
          snapshot: context.snapshot,
          onSave,
        });
        const input = nodes(tree).find(
          (node) =>
            typeof node.props.value === 'string' && typeof node.props.onChange === 'function',
        )!;
        value = input.props.value as string;
        change = (next) =>
          (input.props.onChange as (event: unknown) => void)({ target: { value: next } });
      }
      hooks.layouts.splice(0).forEach((effect) => effect());
      hooks.effects.splice(0).forEach((effect) => effect());
    } while (hooks.dirty);
  }
  render();
  return {
    onSave,
    completions,
    value: () => value,
    change(next: string) {
      change(next);
      render();
    },
    async settleDebounce() {
      render();
      await vi.advanceTimersByTimeAsync(300);
      render();
    },
    unrelatedSnapshot() {
      context.snapshot = {
        ...context.snapshot,
        sequence: context.snapshot.sequence + 1,
        project: { ...context.snapshot.project, version: context.snapshot.project.version + 1 },
      };
      render();
    },
    async accept(index: number) {
      completions[index]!.resolve(true);
      await vi.advanceTimersByTimeAsync(0);
      render();
    },
    render,
  };
}
for (const kind of ['generic', 'property'] as const) {
  describe(`${kind} form concurrent save`, () => {
    it('preserves a return to the original value through an unrelated snapshot and earlier ACK', async () => {
      const ui = editor(kind);
      ui.change('B');
      await ui.settleDebounce();
      expect(ui.onSave).toHaveBeenCalledTimes(1);
      ui.change('A');
      ui.unrelatedSnapshot();
      expect(ui.value()).toBe('A');
      await ui.accept(0);
      expect(ui.value()).toBe('A');
      await ui.settleDebounce();
      expect(ui.onSave).toHaveBeenCalledTimes(2);
      expect(ui.onSave.mock.calls[1]![0]).toMatchObject([{ patch: { physical: { name: 'A' } } }]);
      await ui.accept(1);
    });
    it('keeps newer input editable and preserves it after an older save finishes', async () => {
      const ui = editor(kind);
      ui.change('B');
      await ui.settleDebounce();
      ui.change('C');
      ui.unrelatedSnapshot();
      await ui.accept(0);
      expect(ui.value()).toBe('C');
      await ui.settleDebounce();
      expect(ui.onSave).toHaveBeenCalledTimes(2);
      expect(ui.onSave.mock.calls[1]![0]).toMatchObject([{ patch: { physical: { name: 'C' } } }]);
      await ui.accept(1);
    });
  });
}
