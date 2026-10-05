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
    slots: { value?: unknown; deps?: readonly unknown[]; cleanup?: (() => void) | undefined }[];
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
        busy: false,
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
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal('navigator', {});
});
afterEach(() => vi.unstubAllGlobals());
describe('native clipboard menu real callback consumption without DOM', () => {
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
    let form = ui.renderForm();
    (nodes(form).find((node) => node.type === 'form')!.props.onSubmit as (event: unknown) => void)({
      preventDefault() {},
    });
    await flush();
    expect(save).not.toHaveBeenCalled();
    click(ui.renderForm(), '새 ID와 이름 검토');
    form = ui.renderForm();
    (nodes(form).find((node) => node.type === 'form')!.props.onSubmit as (event: unknown) => void)({
      preventDefault() {},
    });
    await flush();
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
    expect(loadNativeEditorDraft(clipboardActor, ui.snapshot.project.id, before.key)).toEqual(
      newer,
    );
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
