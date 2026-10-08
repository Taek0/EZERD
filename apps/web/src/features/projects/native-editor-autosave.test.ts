import { NATIVE_AUTOSAVE_QUIET_WINDOW_MS } from './use-native-autosave.js';
import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeEditorForm } from './native-editor-form.js';
import { NativeCreateForm, nativeStructureCommands } from './native-editor-structure.js';
import { decorationSnapshot, decorationUserId } from './native-canvas-decoration-test-fixtures.js';
import { loadNativeEditorDraft } from './native-editor-draft.js';

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
vi.mock('./NativeLogicalMode.js', () => ({
  useNativeLogicalMode: () => ({ enabled: true, onEnabledChange() {} }),
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

function fixture(save = vi.fn(async () => true), creation = false) {
  const state = {
    slots: [] as NonNullable<typeof hooks.active>['slots'],
    cursor: 0,
    effects: [] as (() => void)[],
  };
  const snapshot = decorationSnapshot();
  let change!: (field: string, value: string) => void;
  let values!: Record<string, string>;
  const props: Parameters<typeof NativeEditorForm>[0] = {
    context: { userId: decorationUserId, snapshot, busy: false, onSave: save },
    title: 'Edit',
    draftKey: 'autosave:test',
    initial: { name: 'before' },
    build: (v) => [{ type: 'patch_table', id: 'table', patch: { physical: { name: v.name! } } }],
    children: (v, c) => {
      values = v;
      change = c;
      return null;
    },
  };
  return {
    props,
    snapshot,
    save,
    change: (key: string, value: string) => change(key, value),
    values: () => values,
    render() {
      hooks.active = state;
      state.cursor = 0;
      try {
        let formProps = props;
        if (creation) {
          if (snapshot.native.status !== 'available') throw Error('fixture unavailable');
          const create = NativeCreateForm({
            context: props.context,
            document: snapshot.native.document,
            action: 'table',
          });
          formProps = { ...create.props, children: props.children };
        }
        const tree = NativeEditorForm(formProps);
        state.effects.splice(0).forEach((f) => f());
        return tree;
      } finally {
        hooks.active = null;
      }
    },
    unmount() {
      state.slots.forEach((s) => s.cleanup?.());
    },
    draft: () => loadNativeEditorDraft(decorationUserId, snapshot.project.id, props.draftKey),
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

describe('editor autosave', () => {
  it('patches only the changed creation field and preserves remote names and scope', () => {
    const ui = fixture();
    if (ui.snapshot.native.status !== 'available') throw Error('fixture unavailable');
    const document = ui.snapshot.native.document;
    const table = document.tables![0]!;
    table.physical.name = 'remote-name';
    const before = { id: table.id, scope: 'logical', name: 'old-name', logicalName: 'old-logical' };
    const commands = nativeStructureCommands(
      document,
      undefined,
      'table',
      { ...before, logicalName: 'new-logical' },
      before,
    );
    expect(commands).toEqual([
      { type: 'patch_table', id: table.id, patch: { logical: { name: 'new-logical' } } },
    ]);
  });
  it('flushes a pending valid edit on selection unmount but never recovered or unfinished IME input', async () => {
    vi.useFakeTimers();
    const ui = fixture();
    ui.render();
    ui.change('name', 'typed');
    ui.unmount();
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.save).toHaveBeenCalledTimes(1);
    const ime = fixture();
    const tree = ime.render();
    (nodes(tree).find((n) => n.type === 'form')!.props.onCompositionStart as () => void)();
    ime.change('name', '조합');
    ime.render();
    ime.unmount();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ime.save).not.toHaveBeenCalled();
    expect(ime.draft()?.values.name).toBe('조합');
    const recovered = fixture();
    recovered.render();
    recovered.unmount();
    await vi.advanceTimersByTimeAsync(1000);
    expect(recovered.save).not.toHaveBeenCalled();
  });
  it('preserves all input after rejection and newer edits across a successful ACK', async () => {
    vi.useFakeTimers();
    let acknowledge!: (saved: boolean) => void;
    const save = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          acknowledge = resolve;
        }),
    );
    const ui = fixture(save);
    ui.render();
    ui.change('name', 'first');
    ui.render();
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    ui.change('name', 'second');
    ui.render();
    acknowledge(false);
    await vi.advanceTimersByTimeAsync(0);
    ui.render();
    expect(ui.draft()?.before.name).toBe('before');
    expect(ui.draft()?.values.name).toBe('second');
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    expect(save).toHaveBeenCalledTimes(2);
    ui.change('name', 'third');
    ui.render();
    acknowledge(true);
    await vi.advanceTimersByTimeAsync(0);
    ui.render();
    expect(ui.draft()?.values.name).toBe('third');
    expect(ui.draft()?.before.name).toBe('second');
    ui.unmount();
  });
  it('turns continued creation input into a patch after the first ACK snapshot', async () => {
    vi.useFakeTimers();
    const ui = fixture();
    ui.props.draftKey = 'create:table:project';
    ui.props.initial = {
      id: '00000000-0000-4000-8000-000000000099',
      scope: 'logical',
      name: '',
      logicalName: '',
    };
    if (ui.snapshot.native.status !== 'available') throw Error('fixture unavailable');
    const document = ui.snapshot.native.document;
    ui.props.build = (v) => nativeStructureCommands(document, undefined, 'table', v);
    ui.render();
    ui.change('logicalName', 'first');
    ui.render();
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    ui.render();
    expect(
      ui.save,
      JSON.stringify(
        nodes(ui.render())
          .filter((n) => n.props.role === 'alert')
          .map((n) => n.props.children),
      ),
    ).toHaveBeenCalledTimes(1);
    const first = ui.save.mock.calls[0] as unknown as [Array<{ type: string; value: any }>];
    expect(first[0][0]!.type).toBe('add_table');
    ui.change('logicalName', 'second');
    ui.render();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ui.save).toHaveBeenCalledTimes(1);
    document.tables!.push(first[0][0]!.value);
    ui.snapshot.sequence++;
    ui.snapshot.project.version++;
    ui.render();
    ui.render();
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    expect(ui.save).toHaveBeenCalledTimes(2);
    const second = ui.save.mock.calls[1] as unknown as [Array<{ type: string; patch: any }>];
    expect(second[0][0]!.type).toBe('patch_table');
    expect(second[0][0]!.patch.logical.name).toBe('second');
    ui.unmount();
  });
  it('drains a newer revision after an in-flight ACK even after unmount', async () => {
    vi.useFakeTimers();
    const acknowledgements: ((saved: boolean) => void)[] = [];
    const save = vi.fn(() => new Promise<boolean>((resolve) => acknowledgements.push(resolve)));
    const ui = fixture(save);
    ui.render();
    ui.change('name', 'first');
    ui.render();
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    ui.change('name', 'last');
    ui.render();
    ui.unmount();
    expect(save).toHaveBeenCalledTimes(1);
    acknowledgements[0]!(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(
      (save.mock.calls[1] as unknown as [Array<{ patch: { physical: { name: string } } }>])[0][0]!
        .patch.physical.name,
    ).toBe('last');
    acknowledgements[1]!(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(ui.draft()).toBeNull();
  });

  it('drains creation edits as patch even if unmounted before the creation snapshot arrives', async () => {
    vi.useFakeTimers();
    const acknowledgements: ((saved: boolean) => void)[] = [];
    const save = vi.fn(() => new Promise<boolean>((resolve) => acknowledgements.push(resolve)));
    const ui = fixture(save, true);
    ui.render();
    ui.change('logicalName', 'first');
    ui.render();
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    expect((save.mock.calls[0] as unknown as [Array<{ type: string }>])[0][0]!.type).toBe(
      'add_table',
    );
    ui.change('logicalName', 'last');
    ui.render();
    ui.unmount();
    acknowledgements[0]!(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    const commands = (
      save.mock.calls[1] as unknown as [
        Array<{ type: string; patch: { logical: { name: string } } }>,
      ]
    )[0];
    expect(commands[0]!.type).toBe('patch_table');
    expect(commands[0]!.patch.logical.name).toBe('last');
    acknowledgements[1]!(true);
    await vi.advanceTimersByTimeAsync(0);
  });
});
