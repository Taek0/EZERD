import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativePropertyEditor } from './NativePropertyEditor.js';

import { decorationSnapshot, decorationUserId } from './native-canvas-decoration-test-fixtures.js';
import { loadNativeDraft } from './native-save.js';

// Exercise the actual submit registration, field callback and native storage in Node;
// this driver models committed effects without claiming DOM or browser interaction coverage.
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
  useI18n: () => ({ t: (value: string) => value }),
  registerTranslations() {},
}));
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  const effect = (callback: () => void | (() => void), deps?: readonly unknown[]) => {
    const active = hooks.active!;
    const slot = (active.slots[active.cursor++] ??= {});
    if (
      !deps ||
      !slot.deps ||
      deps.length !== slot.deps.length ||
      deps.some((value, i) => !Object.is(value, slot.deps![i]))
    ) {
      active.effects.push(() => {
        slot.cleanup?.();
        slot.cleanup = callback() || undefined;
      });
      slot.deps = deps;
    }
  };
  return {
    ...react,
    useState(initial: unknown) {
      const active = hooks.active!;
      const slot = (active.slots[active.cursor++] ??= {
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
    useLayoutEffect: effect,
    useEffect: effect,
  };
});
function nodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}

function fixture(save = vi.fn(async () => true)) {
  const state = {
    slots: [] as NonNullable<typeof hooks.active>['slots'],
    cursor: 0,
    effects: [] as (() => void)[],
  };
  const snapshot = decorationSnapshot();
  if (snapshot.native.status !== 'available') throw Error();
  const column = snapshot.native.document.columns![0]!;
  column.logical.name = '';
  const props: Parameters<typeof NativePropertyEditor>[0] = {
    userId: decorationUserId,
    snapshot,
    table: snapshot.native.document.tables![0]!,
    column,
    busy: false,
    onSave: save,
    mode: 'physical',
  };
  let change!: (event: { target: { value: string } }) => void;
  return {
    props,
    save,
    snapshot,
    column,
    render() {
      hooks.active = state;
      state.cursor = 0;
      try {
        const tree = NativePropertyEditor(props);
        change = nodes(tree).find(
          (n) => typeof n.props.onChange === 'function' && n.props.maxLength === 120,
        )!.props.onChange as typeof change;
        state.effects.splice(0).forEach((f) => f());
        return tree;
      } finally {
        hooks.active = null;
      }
    },
    change: (value: string) => change({ target: { value } }),
    unmount: () => state.slots.forEach((s) => s.cleanup?.()),
    draft: () => loadNativeDraft(decorationUserId, snapshot.project.id, 'column', column.id),
  };
}
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('property autosave lifecycle', () => {
  it('flushes input immediately before selection change without requiring a rerender', async () => {
    vi.useFakeTimers();
    const ui = fixture();
    ui.render();
    ui.change('typed');
    ui.unmount();
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.save).toHaveBeenCalledTimes(1);
    expect(ui.draft()).toBeNull();
  });
  it('drains input typed during ACK after unmount and retains only the pending revision', async () => {
    vi.useFakeTimers();
    const a: ((value: boolean) => void)[] = [];
    const save = vi.fn(() => new Promise<boolean>((resolve) => a.push(resolve)));
    const ui = fixture(save);
    ui.render();
    ui.change('first');
    ui.render();
    await vi.advanceTimersByTimeAsync(300);
    ui.props.busy = true;
    ui.render();
    ui.change('last');
    ui.render();
    ui.unmount();
    a[0]!(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(
      (save.mock.calls[1] as unknown as [Array<{ patch: { physical: { name: string } } }>])[0][0]!
        .patch.physical.name,
    ).toBe('last');
    expect(ui.draft()?.before.physicalName).toBe('first');
    expect(ui.draft()?.values.physicalName).toBe('last');
    a[1]!(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ui.draft()).toBeNull();
    expect(save).toHaveBeenCalledTimes(2);
  });
  it('rebases against an ACK snapshot already observed and saves the next edit with its sequence', async () => {
    vi.useFakeTimers();
    let ack!: (value: boolean) => void;
    const save = vi.fn(
      () =>
        new Promise<boolean>((r) => {
          ack = r;
        }),
    );
    const ui = fixture(save);
    ui.render();
    ui.change('first');
    ui.render();
    await vi.advanceTimersByTimeAsync(300);
    ui.change('next');
    ui.column.physical.name = 'first';
    ui.snapshot.sequence++;
    ui.snapshot.project.version++;
    ui.render();
    ack(true);
    await vi.advanceTimersByTimeAsync(0);
    ui.render();
    ui.render();
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(2);
    expect((save.mock.calls[1] as unknown as [unknown, { sequence: number }])[1].sequence).toBe(
      ui.snapshot.sequence,
    );
    ack(true);
    await vi.advanceTimersByTimeAsync(0);
    ui.unmount();
  });
});
