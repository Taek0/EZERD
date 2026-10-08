import { NATIVE_AUTOSAVE_QUIET_WINDOW_MS } from './use-native-autosave.js';
import { isValidElement, type ReactElement } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NativeClipboardMenu } from './native-clipboard.js';
import { NativeEditorForm } from './native-editor-form.js';
import {
  clipboardActor,
  clipboardSnapshot,
  clipboardCommand,
} from './native-clipboard-test-fixtures.js';
import { loadNativeEditorDraft } from './native-editor-draft.js';
import { Textarea } from '../../components/ui/index.js';

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
  function effectHook(effect: () => void | (() => void), deps?: readonly unknown[]) {
    const active = hooks.active!,
      slot = (active.slots[active.cursor++] ??= {});
    if (!deps || !slot.deps || deps.some((value, index) => !Object.is(value, slot.deps![index]))) {
      active.effects.push(() => {
        slot.cleanup?.();
        slot.cleanup = effect() || undefined;
      });
      slot.deps = deps;
    }
  }
  return {
    ...react,
    useLayoutEffect: effectHook,
    useEffect: effectHook,
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
function menu(save = vi.fn(async () => true)) {
  const state = { busy: false };
  const snapshot = clipboardSnapshot(),
    menuRoot = root(),
    pasteRoot = root(),
    formRoot = root();
  const renderMenu = () =>
    menuRoot.render(() =>
      NativeClipboardMenu({
        snapshot,
        userId: clipboardActor,
        editable: true,
        busy: state.busy,
        onSave: save,
        selectedTableId: 'a',
      }),
    );
  const renderForm = () => {
    const paste = nodes(renderMenu()).find(
      (node) => typeof node.type === 'function' && node.type.name === 'NativeClipboardPasteForm',
    )!;
    const inner = pasteRoot.render(() =>
      (paste.type as (props: Record<string, unknown>) => ReactElement<Record<string, unknown>>)(
        paste.props,
      ),
    );
    return formRoot.render(() =>
      NativeEditorForm(inner.props as unknown as Parameters<typeof NativeEditorForm>[0]),
    );
  };
  return {
    state,
    snapshot,
    renderMenu,
    renderForm,
    save,
    unmount() {
      menuRoot.unmount();
      pasteRoot.unmount();
      formRoot.unmount();
    },
  };
}
const click = (tree: unknown, text: string) => {
  const button = nodes(tree).find(
    (node) => node.props.children === text && typeof node.props.onClick === 'function',
  )!;
  (button.props.onClick as () => void)();
};
const text = (tree: unknown, value: string) => {
  const textarea = nodes(tree).find((node) => node.type === Textarea)!;
  (textarea.props.onChange as (event: unknown) => void)({ target: { value } });
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
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
describe('native clipboard menu real callback consumption without DOM', () => {
  it('preserves reviewed input while externally busy and does not autosave a recovered draft on mount', async () => {
    const ui = menu();
    ui.renderForm();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ui.save).not.toHaveBeenCalled();
    text(ui.renderForm(), JSON.stringify(clipboardCommand().clipboard));
    click(ui.renderForm(), '새 ID와 이름 검토');
    ui.renderForm();
    ui.state.busy = true;
    const busyForm = ui.renderForm();
    expect(nodes(busyForm).find((node) => node.type === 'fieldset')!.props.disabled).toBe(true);
    const draft = loadNativeEditorDraft(
      clipboardActor,
      ui.snapshot.project.id,
      'canvas:clipboard:paste',
    )!;
    await vi.advanceTimersByTimeAsync(1000);
    expect(ui.save).not.toHaveBeenCalled();
    expect(loadNativeEditorDraft(clipboardActor, ui.snapshot.project.id, draft.key)).toEqual(draft);
    ui.unmount();
    await flush();
    expect(ui.save).not.toHaveBeenCalled();
    const recovered = menu();
    recovered.renderForm();
    await vi.advanceTimersByTimeAsync(1000);
    expect(recovered.save).not.toHaveBeenCalled();
    expect(loadNativeEditorDraft(clipboardActor, recovered.snapshot.project.id, draft.key)).toEqual(
      draft,
    );
    recovered.unmount();
    await flush();
    expect(recovered.save).not.toHaveBeenCalled();
  });
  it('copies a reviewed shared fragment to the manual textarea when device clipboard is unavailable', async () => {
    const ui = menu();
    click(ui.renderMenu(), '테이블 복사');
    const copied = nodes(ui.renderMenu()).find((node) => node.type === Textarea)!;
    const envelope = JSON.parse(copied.props.value as string);
    expect(envelope.formatVersion).toBe(2);
    expect(envelope.document.tables).toHaveLength(1);
    expect(envelope.document.tableRelations).toEqual([]);
    expect(nodes(ui.renderMenu()).some((node) => node.props.children === 'Audits')).toBe(true);
    click(ui.renderMenu(), '클립보드로 복사');
    await flush();
    expect(
      nodes(ui.renderMenu()).some(
        (node) => node.props.children === '직접 복사하거나 붙여넣어 주세요.',
      ),
    ).toBe(true);
    expect(ui.save).not.toHaveBeenCalled();
    ui.unmount();
  });
  it('sends one frozen native command only after review and retains a newer manual draft after delayed ACK', async () => {
    let resolve!: (value: boolean) => void;
    const save = vi.fn(
        () =>
          new Promise<boolean>((done) => {
            resolve = done;
          }),
      ),
      ui = menu(save);
    const sourceText = JSON.stringify(clipboardCommand().clipboard);
    text(ui.renderForm(), sourceText);
    ui.renderForm();
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    expect(save).not.toHaveBeenCalled();
    click(ui.renderForm(), '새 ID와 이름 검토');
    ui.renderForm();
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    const sent = save.mock.calls[0] as unknown as [
      unknown[],
      unknown,
      { key: string; revision: string },
    ];
    expect(sent[0]).toEqual([
      expect.objectContaining({ type: 'paste_native_clipboard', newIds: expect.any(Array) }),
    ]);
    const before = loadNativeEditorDraft(
      clipboardActor,
      ui.snapshot.project.id,
      'canvas:clipboard:paste',
    )!;
    expect(sent[2].revision).toBe(before.revision);
    text(ui.renderForm(), sourceText + ' ');
    const newer = loadNativeEditorDraft(clipboardActor, ui.snapshot.project.id, before.key)!;
    expect(newer.revision).not.toBe(before.revision);
    resolve(true);
    await flush();
    ui.renderForm();
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    expect(loadNativeEditorDraft(clipboardActor, ui.snapshot.project.id, before.key)).toEqual({
      ...newer,
      before: before.values,
    });
    expect(save).toHaveBeenCalledTimes(1);
    ui.unmount();
  });
  it('does not let a late Clipboard API read overwrite typed input or an unmounted actor/project form', async () => {
    let resolve!: (value: string) => void;
    vi.stubGlobal('navigator', {
      clipboard: {
        readText: () =>
          new Promise<string>((done) => {
            resolve = done;
          }),
      },
    });
    const ui = menu();
    click(ui.renderForm(), '기기 클립보드에서 읽기');
    text(ui.renderForm(), 'manual draft');
    resolve('late clipboard');
    await flush();
    expect(nodes(ui.renderForm()).find((node) => node.type === Textarea)!.props.value).toBe(
      'manual draft',
    );
    click(ui.renderForm(), '기기 클립보드에서 읽기');
    ui.unmount();
    resolve('other actor clipboard');
    await flush();
    const draft = loadNativeEditorDraft(
      clipboardActor,
      ui.snapshot.project.id,
      'canvas:clipboard:paste',
    )!;
    expect(draft.values.clipboard0JSON).toBe('manual draft');
    expect(ui.save).not.toHaveBeenCalled();
  });
});
