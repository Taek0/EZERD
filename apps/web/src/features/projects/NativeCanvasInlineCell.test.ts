import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type FunctionComponent } from 'react';
import { createNativeColumn, createNativeTable, type DatabaseKind } from '@ezerd/model';
import { Input } from '../../components/ui/index.js';
import { SearchType } from '../../components/ui/SearchType.js';
import {
  NativeCanvasInlineCell,
  type NativeCanvasInlineCellProps,
} from './NativeCanvasInlineCell.js';
import { NativeCanvasInlineEditor } from './NativeCanvasInlineEditor.js';
import { NativeEditorForm } from './native-editor-form.js';
import { loadNativeEditorDraft, storeNativeEditorDraft } from './native-editor-draft.js';
import {
  nativeInlineKey,
  nativeInlineTypeCommand,
  nativeInlineTypeOptions,
} from './native-inline-edit.js';
import {
  decorationFixture,
  decorationSnapshot,
  decorationUserId,
} from './native-canvas-decoration-test-fixtures.js';

vi.mock('../../shared/i18n/index.js', async (original) => ({
  ...(await original<typeof import('../../shared/i18n/index.js')>()),
  useI18n: () => ({ t: (text: string) => text }),
}));
vi.mock('./native-export-state.js', () => ({ useNativeExportBlocker() {} }));
// Preserve hook identities and layout cleanup while invoking the actual component's event handlers.
// This exercises async lifecycle without adding a browser/DOM test dependency.
const driver = vi.hoisted(() => ({
  slots: [] as {
    value?: unknown;
    deps?: readonly unknown[] | undefined;
    cleanup?: (() => void) | undefined;
  }[],
  cursor: 0,
  effects: [] as (() => void)[],
}));
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return {
    ...react,
    useState(initial: unknown) {
      const slot = (driver.slots[driver.cursor++] ??= {
        value: typeof initial === 'function' ? initial() : initial,
      });
      return [
        slot.value,
        (next: unknown) => {
          slot.value = typeof next === 'function' ? next(slot.value) : next;
        },
      ];
    },
    useRef(initial: unknown) {
      return (driver.slots[driver.cursor++] ??= { value: { current: initial } }).value;
    },
    useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      const slot = (driver.slots[driver.cursor++] ??= {});
      if (!deps || !slot.deps || deps.some((item, index) => !Object.is(item, slot.deps![index]))) {
        driver.effects.push(() => {
          slot.cleanup?.();
          slot.cleanup = effect() || undefined;
        });
        slot.deps = deps;
      }
    },
    useMemo: (factory: () => unknown) => factory(),
  };
});
function elements(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...elements(tree.props.children)];
}
function call(node: ReactElement<Record<string, unknown>>, name: string, arg?: unknown) {
  return (node.props[name] as (arg?: unknown) => unknown)(arg);
}
function keyboard(key: string, extra: Record<string, unknown> = {}) {
  return {
    key,
    nativeEvent: { isComposing: false },
    keyCode: 0,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...extra,
  };
}
function fixture(kind: DatabaseKind = 'postgresql'): NativeCanvasInlineCellProps & {
  context: NonNullable<NativeCanvasInlineCellProps['context']>;
} {
  const document = decorationFixture(kind);
  const table = createNativeTable(document.database, 't');
  table.physical.name = 'records';
  const column = createNativeColumn(document.database, table, 'c');
  column.physical.name = 'label';
  document.tables = [table];
  document.columns = [column];
  return {
    document,
    target: { tableId: 't', columnId: 'c', mode: 'physical', field: 'name' },
    context: {
      userId: decorationUserId,
      snapshot: decorationSnapshot(document),
      busy: false,
      onSave: vi.fn().mockResolvedValue(true),
    },
  };
}
function mount(initial = fixture()) {
  let props = initial;
  let nodes: ReactElement<Record<string, unknown>>[] = [];
  const focus = vi.fn(() => {
    const span = root();
    call(span, 'onFocus', { target: element, currentTarget: element });
  });
  const element = { focus, isConnected: true };
  const root = () =>
    nodes.find((node) => node.type === 'span' && node.props['data-inline-cell'] !== undefined)!;
  function render(next = props) {
    props = next;
    const wrapper = NativeCanvasInlineCell(props) as ReactElement<NativeCanvasInlineCellProps>;
    driver.cursor = 0;
    nodes = elements(
      (wrapper.type as FunctionComponent<NativeCanvasInlineCellProps>)(wrapper.props),
    );
    (root().props.ref as { current: unknown }).current = element;
    driver.effects.splice(0).forEach((effect) => effect());
    return nodes;
  }
  render();
  function begin() {
    call(root(), 'onFocus', { target: element, currentTarget: element });
    render();
  }
  const field = () => nodes.find((node) => node.type === Input || node.type === SearchType)!;
  function change(value: string) {
    call(field(), 'onChange', { target: { value } });
    render();
  }
  function stored() {
    return loadNativeEditorDraft(
      props.context.userId,
      props.context.snapshot.project.id,
      nativeInlineKey(props.target),
    );
  }
  function unmount() {
    driver.slots.forEach((slot) => slot.cleanup?.());
  }
  return { render, begin, root, field, change, stored, focus, unmount, props };
}
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}
function mountAdvanced(props = fixture()) {
  const close = vi.fn(),
    focus = vi.fn(),
    initialFocus = vi.fn();
  class TestElement {
    isConnected = true;
    focus = focus;
  }
  vi.stubGlobal('HTMLElement', TestElement);
  vi.stubGlobal('document', { activeElement: new TestElement() });
  const focusTarget = new TestElement() as unknown as HTMLElement;
  let nodes: ReactElement<Record<string, unknown>>[] = [];
  const component = (
    NativeCanvasInlineEditor as unknown as {
      type: FunctionComponent<Record<string, unknown>>;
    }
  ).type;
  function render(next = props) {
    driver.cursor = 0;
    nodes = elements(component({ ...next, onClose: close, focusTarget }));
    (nodes[0]!.props.ref as { current: unknown }).current = {
      querySelector: () => ({ focus: initialFocus }),
    };
    driver.effects.splice(0).forEach((effect) => effect());
  }
  render();
  return {
    close,
    focus,
    initialFocus,
    render,
    root: () => nodes[0]!,
    context: () =>
      nodes.find((node) => !!node.props.context)!.props.context as typeof props.context,
  };
}
beforeEach(() => {
  vi.unstubAllGlobals();
  driver.slots = [];
  driver.cursor = 0;
  driver.effects = [];
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
});

describe('native inline cell lifecycle', () => {
  it('does not overwrite a replacement cell revision when an unmount drain runs', async () => {
    vi.useFakeTimers();
    const ui = mount();
    try {
      ui.begin();
      ui.change('old cell');
      const previous = ui.stored()!;
      ui.unmount();
      storeNativeEditorDraft({
        ...previous,
        revision: '00000000-0000-4000-8000-000000000077',
        values: { value: 'replacement cell' },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(ui.props.context.onSave).not.toHaveBeenCalled();
      expect(ui.stored()?.values.value).toBe('replacement cell');
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps rejected unmount input durable without retrying automatically', async () => {
    vi.useFakeTimers();
    const props = fixture();
    props.context.onSave = vi.fn().mockResolvedValue(false);
    const ui = mount(props);
    try {
      ui.begin();
      ui.change('rejected');
      ui.unmount();
      await vi.advanceTimersByTimeAsync(1000);
      expect(props.context.onSave).toHaveBeenCalledOnce();
      expect(ui.stored()?.values.value).toBe('rejected');
    } finally {
      vi.useRealTimers();
    }
  });
  it.each(['name', 'comment'] as const)(
    'drains %s on unmount before debounce without blur',
    async (field) => {
      vi.useFakeTimers();
      const props = fixture();
      props.target.field = field;
      const ui = mount(props);
      try {
        ui.begin();
        ui.change('leaving cell');
        ui.unmount();
        await vi.advanceTimersByTimeAsync(0);
        expect(props.context.onSave).toHaveBeenCalledOnce();
        expect(props.context.onSave).toHaveBeenCalledWith(
          [{ type: 'patch_column', id: 'c', patch: { physical: { [field]: 'leaving cell' } } }],
          expect.anything(),
          expect.anything(),
        );
        expect(ui.stored()).toBeNull();
        expect(ui.focus).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it('blur saves immediately and unmount does not send the same revision twice', async () => {
    vi.useFakeTimers();
    const ui = mount();
    try {
      ui.begin();
      ui.change('leaving now');
      call(ui.field(), 'onBlur');
      ui.unmount();
      await vi.advanceTimersByTimeAsync(500);
      expect(ui.props.context.onSave).toHaveBeenCalledOnce();
      expect(ui.stored()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it('drains later typing after the in-flight autosave ACK without mounting again', async () => {
    vi.useFakeTimers();
    const props = fixture();
    let accept!: (saved: boolean) => void;
    props.context.onSave = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            accept = resolve;
          }),
      )
      .mockResolvedValue(true);
    const ui = mount(props);
    try {
      ui.begin();
      ui.change('first');
      await vi.advanceTimersByTimeAsync(350);
      ui.render();
      ui.change('last before leaving');
      ui.unmount();
      expect(props.context.onSave).toHaveBeenCalledOnce();
      accept(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(props.context.onSave).toHaveBeenCalledTimes(2);
      expect(props.context.onSave).toHaveBeenLastCalledWith(
        [{ type: 'patch_column', id: 'c', patch: { physical: { name: 'last before leaving' } } }],
        expect.anything(),
        expect.anything(),
      );
      expect(ui.stored()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it.each(['ime', 'query', 'busy', 'databaseRevision'] as const)(
    'preserves %s input rather than draining invalid work on unmount',
    async (guard) => {
      vi.useFakeTimers();
      const props = fixture();
      if (guard === 'query') props.target.field = 'format';
      const ui = mount(props);
      try {
        ui.begin();
        if (guard === 'ime') call(ui.root(), 'onCompositionStart');
        if (guard === 'query') {
          call(ui.field(), 'onQueryChange', 'unfinished');
          ui.render();
        } else ui.change('unfinished');
        if (guard === 'busy') ui.render({ ...props, context: { ...props.context, busy: true } });
        if (guard === 'databaseRevision') {
          const snapshot = structuredClone(props.context.snapshot);
          snapshot.project.databaseRevision++;
          ui.render({ ...props, context: { ...props.context, snapshot } });
        }
        ui.unmount();
        await vi.advanceTimersByTimeAsync(500);
        expect(props.context.onSave).not.toHaveBeenCalled();
        expect(ui.stored()?.values[guard === 'query' ? 'query' : 'value']).toBe('unfinished');
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it('keeps accepting input after an unchanged debounce and saves no reverted value', async () => {
    vi.useFakeTimers();
    const ui = mount();
    try {
      ui.begin();
      ui.change('temporary');
      ui.change('label');
      await vi.advanceTimersByTimeAsync(350);
      ui.render();
      expect(ui.props.context.onSave).not.toHaveBeenCalled();
      ui.change('next');
      await vi.advanceTimersByTimeAsync(350);
      ui.render();
      expect(ui.props.context.onSave).toHaveBeenCalledOnce();
      expect(ui.field().props.value).toBe('next');
    } finally {
      ui.unmount();
      vi.useRealTimers();
    }
  });
  it.each(['name', 'comment'] as const)(
    'autosaves %s without blur and keeps typing after ACK',
    async (field) => {
      vi.useFakeTimers();
      const props = fixture();
      props.target.field = field;
      const ui = mount(props);
      try {
        ui.begin();
        ui.change('first');
        await vi.advanceTimersByTimeAsync(350);
        ui.render();
        expect(props.context.onSave).toHaveBeenCalledOnce();
        expect(ui.field().props.value).toBe('first');
        expect(ui.focus).not.toHaveBeenCalled();
        ui.change('second');
        await vi.advanceTimersByTimeAsync(350);
        ui.render();
        expect(props.context.onSave).toHaveBeenCalledTimes(2);
        expect(props.context.onSave).toHaveBeenLastCalledWith(
          [{ type: 'patch_column', id: 'c', patch: { physical: { [field]: 'second' } } }],
          expect.anything(),
          expect.anything(),
        );
        expect(ui.field().props.value).toBe('second');
      } finally {
        ui.unmount();
        vi.useRealTimers();
      }
    },
  );
  it('defers autosave during IME', async () => {
    vi.useFakeTimers();
    const ui = mount();
    try {
      ui.begin();
      call(ui.root(), 'onCompositionStart');
      ui.change('조합');
      await vi.advanceTimersByTimeAsync(500);
      expect(ui.props.context.onSave).not.toHaveBeenCalled();
      call(ui.root(), 'onCompositionEnd');
      ui.render();
      await vi.advanceTimersByTimeAsync(350);
      expect(ui.props.context.onSave).toHaveBeenCalledOnce();
      ui.render();
    } finally {
      ui.unmount();
      vi.useRealTimers();
    }
  });
  it.each([false, true])(
    'submits later edits after an ACK or another writer advances the shared baseline (%s)',
    async (remoteChange) => {
      const props = fixture();
      let acknowledge!: (saved: boolean) => void;
      props.context.onSave = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<boolean>((resolve) => {
              acknowledge = resolve;
            }),
        )
        .mockResolvedValue(true);
      const ui = mount(props);
      ui.begin();
      ui.change('first');
      call(ui.field(), 'onBlur');
      ui.render();
      ui.begin();
      ui.change('second');
      acknowledge(true);
      await flush();
      const document = structuredClone(props.document);
      document.columns![0]!.physical.name = remoteChange ? 'another writer' : 'first';
      const snapshot = structuredClone(props.context.snapshot);
      snapshot.sequence++;
      ui.render({ ...props, document, context: { ...props.context, snapshot } });
      call(ui.field(), 'onBlur');
      await flush();
      ui.render();
      expect(props.context.onSave).toHaveBeenCalledTimes(2);
      expect(vi.mocked(props.context.onSave).mock.calls[1]![1].sequence).toBe(snapshot.sequence);
    },
  );
  it('edits and submits the same cell repeatedly before ACK without losing the latest draft', async () => {
    const acknowledgements: ((saved: boolean) => void)[] = [];
    const props = fixture();
    props.context.onSave = vi.fn(
      () => new Promise<boolean>((resolve) => acknowledgements.push(resolve)),
    );
    const ui = mount(props);
    ui.begin();
    ui.change('first');
    call(ui.field(), 'onBlur');
    ui.render();
    expect(ui.root().props.tabIndex).toBe(0);
    expect(ui.root().props.children).toContain('first');
    ui.begin();
    ui.change('second');
    call(ui.field(), 'onBlur');
    ui.render();
    expect(props.context.onSave).toHaveBeenCalledTimes(2);
    ui.begin();
    ui.change('still typing');
    const retained = ui.stored();
    acknowledgements[0]!(true);
    await flush();
    ui.render();
    expect(ui.field().props.value).toBe('still typing');
    expect(ui.stored()).toEqual(retained);
    acknowledgements[1]!(false);
    await flush();
    ui.render();
    expect(ui.field().props.value).toBe('still typing');
    expect(ui.stored()).toEqual(retained);
  });
  it('starts an autofocus shared Input on focus and commits with the latest save callback on Enter', async () => {
    const ui = mount();
    ui.begin();
    expect(ui.field().props.autoFocus).toBe(true);
    ui.change('renamed');
    const onSave = vi.fn().mockResolvedValue(true);
    ui.render({ ...ui.props, context: { ...ui.props.context, onSave } });
    call(ui.root(), 'onKeyDown', keyboard('Enter'));
    ui.render();
    await flush();
    ui.render();
    expect(onSave).toHaveBeenCalledWith(
      [{ type: 'patch_column', id: 'c', patch: { physical: { name: 'renamed' } } }],
      { version: 7, sequence: 10, databaseRevision: 3 },
      expect.objectContaining({ key: nativeInlineKey(ui.props.target) }),
    );
    expect(ui.props.context.onSave).not.toHaveBeenCalled();
    expect(ui.stored()).toBeNull();
    expect(ui.focus).toHaveBeenCalledOnce();
    expect(ui.field()).toBeUndefined(); // Restored trigger focus does not reopen editing.
  });
  it('preserves a rejected draft, then Escape cancels only new changes and restores the recovered draft', async () => {
    const props = fixture();
    props.context.onSave = vi.fn().mockResolvedValue(false);
    const ui = mount(props);
    ui.begin();
    ui.change('rejected');
    call(ui.field(), 'onBlur');
    ui.render();
    await flush();
    ui.render();
    expect(ui.stored()?.values.value).toBe('rejected');
    expect(ui.focus).not.toHaveBeenCalled();
    call(ui.root(), 'onKeyDown', keyboard('Escape'));
    expect(ui.stored()?.values.value).toBe('rejected'); // Idle Escape cannot destroy rejected input.
    ui.begin();
    expect(ui.field().props.value).toBe('rejected');
    ui.change('cancelled');
    call(ui.root(), 'onKeyDownCapture', keyboard('Escape'));
    ui.render();
    expect(ui.stored()?.values.value).toBe('rejected');
    expect(props.context.onSave).toHaveBeenCalledOnce();
  });
  it('Escape cancels fresh input without saving, and Tab relies on blur without trapping or returning focus', async () => {
    const ui = mount();
    ui.begin();
    ui.change('cancel');
    call(ui.root(), 'onKeyDownCapture', keyboard('Escape'));
    ui.render();
    expect(ui.stored()).toBeNull();
    expect(ui.props.context.onSave).not.toHaveBeenCalled();
    ui.begin();
    ui.change('tabbed');
    const tab = keyboard('Tab');
    call(ui.root(), 'onKeyDown', tab);
    expect(tab.preventDefault).not.toHaveBeenCalled();
    call(ui.field(), 'onBlur');
    ui.render();
    await flush();
    ui.render();
    expect(ui.props.context.onSave).toHaveBeenCalledOnce();
    expect(ui.focus).toHaveBeenCalledOnce();
  });
  it('never commits or cancels during composition/229 and defers IME blur until composition finishes', async () => {
    const ui = mount();
    ui.begin();
    ui.change('한');
    call(ui.root(), 'onCompositionStart');
    call(ui.root(), 'onKeyDown', keyboard('Enter', { nativeEvent: { isComposing: true } }));
    call(ui.root(), 'onKeyDownCapture', keyboard('Escape', { keyCode: 229 }));
    call(ui.field(), 'onBlur');
    expect(ui.props.context.onSave).not.toHaveBeenCalled();
    expect(ui.field()).toBeDefined();
    ui.change('한글');
    call(ui.root(), 'onCompositionEnd');
    await flush();
    ui.render();
    await flush();
    expect(ui.props.context.onSave).toHaveBeenCalledOnce();
    expect(vi.mocked(ui.props.context.onSave).mock.calls[0]?.[0][0]).toMatchObject({
      patch: { physical: { name: '한글' } },
    });
  });
  it.each(['databaseRevision', 'busy'])(
    'retains input when the %s guard changes',
    async (guard) => {
      const ui = mount();
      ui.begin();
      ui.change('draft');
      const ctx = structuredClone({ ...ui.props.context, onSave: undefined });
      const snapshot = ctx.snapshot;
      if (guard === 'sequence') snapshot.sequence++;
      else if (guard !== 'busy') snapshot.project[guard as 'version' | 'databaseRevision']++;
      ui.render({
        ...ui.props,
        context: { ...ui.props.context, snapshot, busy: guard === 'busy' },
      });
      call(ui.field(), 'onBlur');
      await flush();
      ui.render();
      expect(ui.props.context.onSave).not.toHaveBeenCalled();
      expect(ui.stored()?.values.value).toBe('draft');
    },
  );
  it('late ACK cannot consume a newer revision or change an unmounted actor session', async () => {
    let accept!: (value: boolean) => void;
    const props = fixture();
    props.context.onSave = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    );
    const ui = mount(props);
    ui.begin();
    ui.change('submitted');
    call(ui.field(), 'onBlur');
    ui.render();
    const saved = ui.stored()!;
    storeNativeEditorDraft({
      ...saved,
      revision: '00000000-0000-4000-8000-000000000009',
      values: { value: 'newer tab' },
    });
    ui.unmount();
    accept(true);
    await flush();
    expect(ui.stored()?.values.value).toBe('newer tab');
    expect(ui.focus).not.toHaveBeenCalled();
  });
  it('preserves incomplete text if storage fails and retries it before save', async () => {
    const ui = mount();
    ui.begin();
    const storage = globalThis.localStorage;
    const set = vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw Error('Quota');
    });
    ui.change('-unfinished');
    expect(ui.stored()?.values.value).toBe('-unfinished');
    call(ui.field(), 'onBlur');
    await flush();
    ui.render();
    expect(ui.props.context.onSave).not.toHaveBeenCalled();
    set.mockRestore();
    ui.begin();
    expect(ui.field().props.value).toBe('-unfinished');
    call(ui.root(), 'onKeyDown', keyboard('Enter'));
    await flush();
    ui.render();
    expect(ui.props.context.onSave).toHaveBeenCalledOnce();
  });
  it('can restore the original type before the preceding type edit is acknowledged', async () => {
    const props = fixture();
    props.target.field = 'format';
    const acknowledgements: ((saved: boolean) => void)[] = [];
    props.context.onSave = vi.fn(
      () => new Promise<boolean>((resolve) => acknowledgements.push(resolve)),
    );
    const ui = mount(props);
    ui.begin();
    const original = ui.field().props.value;
    call(ui.field(), 'onValueChange', 'postgresql:integer');
    call(ui.field(), 'onEditEnd', 'selection');
    ui.render();
    ui.begin();
    call(ui.field(), 'onValueChange', original);
    call(ui.field(), 'onEditEnd', 'selection');
    ui.render();
    expect(props.context.onSave).toHaveBeenCalledTimes(2);
    expect(vi.mocked(props.context.onSave).mock.calls[1]![0][0]).toMatchObject({
      patch: { physical: { type: { typeId: original } } },
    });
    acknowledgements.forEach((resolve) => resolve(true));
    await flush();
  });
  it('searchable type selection saves directly and unselected query remains durable without a command', async () => {
    const props = fixture();
    props.target.field = 'format';
    const ui = mount(props);
    ui.begin();
    expect(ui.field().type).toBe(SearchType);
    call(ui.field(), 'onValueChange', 'postgresql:integer');
    call(ui.field(), 'onEditEnd', 'selection');
    await flush();
    ui.render();
    expect(props.context.onSave).toHaveBeenCalledOnce();
    expect(ui.focus).toHaveBeenCalledOnce();
    ui.begin();
    call(ui.field(), 'onQueryChange', 'unfinished type');
    ui.render();
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(500);
    expect(props.context.onSave).toHaveBeenCalledOnce();
    vi.useRealTimers();
    call(ui.field(), 'onEditEnd', 'blur');
    await flush();
    ui.render();
    expect(props.context.onSave).toHaveBeenCalledOnce();
    expect(ui.stored()?.values.query).toBe('unfinished type');
    ui.begin();
    expect(ui.field().props.query).toBe('unfinished type');
  });
  it('hands off nuanced types to advanced format without replacing existing advanced drafts', async () => {
    const props = fixture('mysql');
    props.target.field = 'format';
    props.onAdvancedFormat = vi.fn();
    const ui = mount(props);
    ui.begin();
    call(ui.field(), 'onValueChange', 'mysql:enum');
    call(ui.field(), 'onEditEnd', 'selection');
    await flush();
    ui.render();
    expect(props.context.onSave).not.toHaveBeenCalled();
    expect(props.onAdvancedFormat).toHaveBeenCalledOnce();
    const draft = loadNativeEditorDraft(
      props.context.userId,
      props.context.snapshot.project.id,
      'format:column:c',
    )!;
    expect(draft.values.typeChoice).toBe('mysql:enum');
    expect(draft.values.confirmTypeReset).toBe('false');
    expect(ui.stored()?.values.value).toBe('mysql:enum');
    ui.focus();
    ui.render(); // Closing the advanced editor restores focus without reopening this cell.
    expect(ui.field()).toBeUndefined();
    ui.begin();
    call(ui.field(), 'onValueChange', 'mysql:set');
    call(ui.field(), 'onEditEnd', 'selection');
    await flush();
    expect(
      loadNativeEditorDraft(
        props.context.userId,
        props.context.snapshot.project.id,
        'format:column:c',
      ),
    ).toEqual(draft);
  });
  it('read-only cells render text with no focus/edit handlers and actor identity changes remount state', () => {
    const props = fixture();
    const readOnly = NativeCanvasInlineCell({ ...props, disabled: true })!;
    expect(readOnly.type).toBe('span');
    expect(readOnly.props.children).toBe('label');
    expect(readOnly.props.tabIndex).toBeUndefined();
    expect(readOnly.props.onFocus).toBeUndefined();
    const first = NativeCanvasInlineCell(props)!;
    const other = NativeCanvasInlineCell({
      ...props,
      context: { ...props.context, userId: 'other' },
    })!;
    expect(first.key).not.toBe(other.key);
  });
});

describe('native inline catalog commands', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)('patches only native type on %s', (kind) => {
    const props = fixture(kind);
    props.target.field = 'format';
    props.document.columns![0]!.physical.type =
      kind === 'postgresql'
        ? { kind: 'builtin', database: kind, typeId: 'postgresql:integer', parameters: {} }
        : kind === 'mysql'
          ? { kind: 'builtin', database: kind, typeId: 'mysql:int', parameters: {} }
          : { kind: 'builtin', database: kind, typeId: 'sqlite:integer', parameters: {} };
    const before = structuredClone(props.document);
    const command = nativeInlineTypeCommand(props.document, props.target, `${kind}:bigint`)!;
    expect(command).toMatchObject({
      type: 'patch_column',
      patch: { physical: { type: { kind: 'builtin', typeId: `${kind}:bigint` } } },
    });
    if (command.type === 'patch_column')
      expect(Object.keys(command.patch.physical!)).toEqual(['type']);
    expect(props.document).toEqual(before);
  });
  it('preserves compatible numeric defaults/identity and rejects incompatible defaults without resetting them', () => {
    const props = fixture();
    props.target.field = 'format';
    const column = props.document.columns![0]!;
    column.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:integer',
      parameters: {},
    };
    column.physical.defaultValue = { kind: 'literal', literalType: 'number', value: '42' };
    expect(nativeInlineTypeCommand(props.document, props.target, 'postgresql:bigint')).toBeTruthy();
    expect(() =>
      nativeInlineTypeCommand(props.document, props.target, 'postgresql:date'),
    ).toThrow();
    expect(column.physical.defaultValue).toEqual({
      kind: 'literal',
      literalType: 'number',
      value: '42',
    });
    column.physical.defaultValue = { kind: 'none' };
    column.physical.generation = {
      kind: 'identity',
      database: 'postgresql',
      mode: 'always',
      sequence: { start: '42' },
    };
    expect(nativeInlineTypeCommand(props.document, props.target, 'postgresql:bigint')).toBeTruthy();
    expect(() =>
      nativeInlineTypeCommand(props.document, props.target, 'postgresql:text'),
    ).toThrow();
  });
  it('retains compatible parameters/arrays and delegates required/incompatible parameters', () => {
    const props = fixture();
    props.target.field = 'format';
    const column = props.document.columns![0]!;
    column.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:varchar',
      parameters: { length: 80 },
      array: { dimensions: 2 },
    };
    expect(nativeInlineTypeCommand(props.document, props.target, 'postgresql:char')).toMatchObject({
      patch: { physical: { type: { parameters: { length: 80 }, array: { dimensions: 2 } } } },
    });
    expect(() =>
      nativeInlineTypeCommand(props.document, props.target, 'postgresql:integer'),
    ).toThrow('native.inline-advanced-format-required');
    const mysql = fixture('mysql');
    mysql.target.field = 'format';
    mysql.document.columns![0]!.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:int',
      parameters: {},
    };
    expect(() => nativeInlineTypeCommand(mysql.document, mysql.target, 'mysql:varchar')).toThrow(
      'native.inline-advanced-format-required',
    );
  });
  it('filters source/capability/STRICT options and keeps current opaque types without reinterpretation', () => {
    const props = fixture('sqlite');
    props.target.field = 'format';
    props.document.tables![0]!.physical.options = {
      database: 'sqlite',
      strict: true,
      withoutRowid: false,
    };
    const choices = nativeInlineTypeOptions(props.document, props.target);
    expect(choices.some((item) => item.value === 'sqlite:integer')).toBe(true);
    expect(choices.some((item) => item.value === 'sqlite:bigint')).toBe(false);
    expect(choices.every((item) => item.value.startsWith('sqlite:'))).toBe(true);
    const legacy = decorationFixture();
    const target = { ...props.target };
    expect(nativeInlineTypeOptions(legacy, target)[0]).toMatchObject({ value: 'legacy' });
    expect(nativeInlineTypeCommand(legacy, target, 'legacy')).toBeNull();
    expect(() => nativeInlineTypeCommand(legacy, target, 'mysql:int')).toThrow();
  });
});

describe('advanced inline editor focus and IME', () => {
  it('Escape returns explicit focusTarget and preserves the durable advanced input', () => {
    const props = fixture();
    const key = nativeInlineKey(props.target);
    storeNativeEditorDraft({
      userId: props.context.userId,
      projectId: props.context.snapshot.project.id,
      key,
      revision: decorationUserId,
      expected: { version: 7, sequence: 10, databaseRevision: 3 },
      before: { value: 'label' },
      values: { value: 'preserved' },
    });
    const ui = mountAdvanced(props);
    call(ui.root(), 'onKeyDownCapture', keyboard('Escape'));
    expect(ui.close).toHaveBeenCalledOnce();
    expect(ui.focus).toHaveBeenCalledOnce();
    expect(
      loadNativeEditorDraft(props.context.userId, props.context.snapshot.project.id, key)?.values
        .value,
    ).toBe('preserved');
  });
  it('stale save callbacks cannot write after an actor or version change', async () => {
    const props = fixture();
    const ui = mountAdvanced(props);
    const oldContext = ui.context();
    const snapshot = structuredClone(props.context.snapshot);
    snapshot.project.version++;
    ui.render({ ...props, context: { ...props.context, snapshot } });
    expect(await oldContext.onSave([], { version: 7, sequence: 10, databaseRevision: 3 })).toBe(
      false,
    );
    ui.render({
      ...props,
      context: { ...props.context, userId: '00000000-0000-4000-8000-000000000099' },
    });
    expect(await oldContext.onSave([], { version: 7, sequence: 10, databaseRevision: 3 })).toBe(
      false,
    );
    expect(props.context.onSave).not.toHaveBeenCalled();
    expect(ui.close).not.toHaveBeenCalled();
  });
  it('an old actor ACK cannot close or focus a replacement editor', async () => {
    const props = fixture();
    let accept!: (value: boolean) => void;
    props.context.onSave = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    );
    const ui = mountAdvanced(props);
    const saving = ui.context().onSave([], { version: 7, sequence: 10, databaseRevision: 3 });
    ui.render({
      ...props,
      context: { ...props.context, userId: '00000000-0000-4000-8000-000000000099' },
    });
    accept(true);
    await saving;
    expect(ui.close).not.toHaveBeenCalled();
    expect(ui.focus).not.toHaveBeenCalled();
  });
  it('accepted advanced type save consumes only the matching source revision', async () => {
    const props = fixture();
    props.target.field = 'format';
    const key = nativeInlineKey(props.target);
    const source = {
      userId: props.context.userId,
      projectId: props.context.snapshot.project.id,
      key,
      revision: decorationUserId,
      expected: { version: 7, sequence: 10, databaseRevision: 3 },
      before: { value: 'postgresql:text' },
      values: { value: 'postgresql:integer' },
    };
    storeNativeEditorDraft(source);
    const ui = mountAdvanced(props);
    const commands = [nativeInlineTypeCommand(props.document, props.target, source.values.value)!];
    expect(await ui.context().onSave(commands, source.expected)).toBe(true);
    expect(loadNativeEditorDraft(source.userId, source.projectId, source.key)).toBeNull();
    storeNativeEditorDraft(source);
    let accept!: (value: boolean) => void;
    props.context.onSave = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    );
    ui.render(props);
    const saving = ui.context().onSave(commands, source.expected);
    storeNativeEditorDraft({
      ...source,
      revision: '00000000-0000-4000-8000-000000000077',
      values: { value: 'postgresql:bigint' },
    });
    accept(true);
    await saving;
    expect(loadNativeEditorDraft(source.userId, source.projectId, source.key)?.values.value).toBe(
      'postgresql:bigint',
    );
  });
  it('focuses the initial field, protects IME Escape/Enter, uses the latest onSave and returns focus on accepted save', async () => {
    const props = fixture();
    const close = vi.fn();
    const focus = vi.fn();
    class TestElement {
      isConnected = true;
      focus = focus;
    }
    vi.stubGlobal('HTMLElement', TestElement);
    vi.stubGlobal('document', { activeElement: new TestElement() });
    const initialFocus = vi.fn();
    let nodes: ReactElement<Record<string, unknown>>[] = [];
    const component = (
      NativeCanvasInlineEditor as unknown as { type: FunctionComponent<Record<string, unknown>> }
    ).type;
    function render(onSave = props.context.onSave) {
      driver.cursor = 0;
      nodes = elements(
        component({ ...props, context: { ...props.context, onSave }, onClose: close }),
      );
      (nodes[0]!.props.ref as { current: unknown }).current = {
        querySelector: () => ({ focus: initialFocus }),
      };
      driver.effects.splice(0).forEach((effect) => effect());
    }
    render();
    expect(initialFocus).toHaveBeenCalledOnce();
    const ime = keyboard('Enter', { nativeEvent: { isComposing: true } });
    call(nodes[0]!, 'onKeyDownCapture', ime);
    expect(ime.preventDefault).not.toHaveBeenCalled();
    const submit = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    call(nodes[0]!, 'onSubmitCapture', submit);
    expect(submit.preventDefault).toHaveBeenCalled();
    call(nodes[0]!, 'onKeyUpCapture');
    call(nodes[0]!, 'onCompositionStart');
    call(nodes[0]!, 'onKeyDownCapture', keyboard('Escape'));
    expect(close).not.toHaveBeenCalled();
    call(nodes[0]!, 'onCompositionEnd');
    const oldContext = nodes.find((node) => node.type === NativeEditorForm)!.props
      .context as typeof props.context;
    const latestSave = vi.fn().mockResolvedValue(true);
    render(latestSave);
    expect(await oldContext.onSave([], { version: 7, sequence: 10, databaseRevision: 3 })).toBe(
      true,
    );
    expect(latestSave).toHaveBeenCalledOnce();
    expect(props.context.onSave).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });
});
