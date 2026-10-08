import { NATIVE_AUTOSAVE_QUIET_WINDOW_MS } from './use-native-autosave.js';
import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeCanvasStyleEditor } from './NativeCanvasStyleEditor.js';
import {
  NativeDomainRelationEditor,
  nativeDomainRelationCommands,
} from './NativeDomainRelationEditor.js';
import { NativeClipboardMenu } from './native-clipboard.js';
import {
  decorationFixture,
  decorationSnapshot,
  decorationUserId,
} from './native-canvas-decoration-test-fixtures.js';
import { loadNativeEditorDraft, storeNativeEditorDraft } from './native-editor-draft.js';
import { requestFingerprint } from '@ezerd/model';
import { setLocale } from '../../shared/i18n/index.js';
import { NativeEditorForm } from './native-editor-form.js';
import { DomainColorPicker } from '../domains/DomainColorPicker.js';

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
    useState(initial: unknown) {
      if (!hooks.active) return react.useState(initial);
      const slot = (hooks.active.slots[hooks.active.cursor++] ??= {
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
      if (!hooks.active) return react.useRef(initial);
      return (hooks.active.slots[hooks.active.cursor++] ??= { value: { current: initial } }).value;
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      return hooks.active ? effectHook(effect, deps) : react.useEffect(effect, deps);
    },
    useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      return hooks.active ? effectHook(effect, deps) : react.useLayoutEffect(effect, deps);
    },
    useSyncExternalStore(...args: Parameters<typeof react.useSyncExternalStore>) {
      return hooks.active ? args[1]() : react.useSyncExternalStore(...args);
    },
  };
});
function nodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
function root() {
  const state: NonNullable<typeof hooks.active> = { slots: [], cursor: 0, effects: [] };
  return {
    render<T>(render: () => T): T {
      hooks.active = state;
      state.cursor = 0;
      try {
        const tree = render();
        state.effects.splice(0).forEach((effect) => effect());
        return tree;
      } finally {
        hooks.active = null;
      }
    },
    unmount() {
      state.slots.forEach((slot) => slot.cleanup?.());
    },
  };
}

const exportBlocker = vi.hoisted(() => vi.fn());
vi.mock('./native-export-state.js', () => ({ useNativeExportBlocker: exportBlocker }));
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  setLocale('ko');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  exportBlocker.mockClear();
});
function fixture() {
  const document = decorationFixture();
  const snapshot = decorationSnapshot(document);
  const context = {
    userId: decorationUserId,
    snapshot,
    busy: false,
    onSave: vi.fn(async () => true),
  };
  return { document, snapshot, context };
}

describe('native auxiliary original UI compositions', () => {
  it('autosaves a palette callback once, keeping dirty export blocked until its ACK', async () => {
    vi.useFakeTimers();
    const { document, context } = fixture(),
      original = structuredClone(document);
    let acknowledge!: (value: boolean) => void;
    context.onSave = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          acknowledge = resolve;
        }),
    );
    const editor = root(),
      form = root();
    const render = () => {
      const tree = editor.render(() =>
        NativeCanvasStyleEditor({
          document,
          context,
          editable: true,
          selectedNoteId: 'n',
        }),
      );
      const element = nodes(tree).find((node) => node.type === NativeEditorForm)!;
      return form.render(() =>
        NativeEditorForm(element.props as Parameters<typeof NativeEditorForm>[0]),
      );
    };
    render();
    await vi.advanceTimersByTimeAsync(1000);
    expect(context.onSave).not.toHaveBeenCalled();
    const palette = nodes(render()).find((node) => node.type === DomainColorPicker)!;
    (palette.props.onChange as (value: string) => void)('#112233');
    render();
    expect(exportBlocker).toHaveBeenLastCalledWith(
      decorationUserId,
      context.snapshot.project.id,
      true,
      false,
      'editor:canvas:style:note:n',
    );
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS - 1);
    expect(context.onSave).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    render();
    const draft = loadNativeEditorDraft(
      decorationUserId,
      context.snapshot.project.id,
      'canvas:style:note:n',
    )!;
    expect(context.onSave).toHaveBeenCalledExactlyOnceWith(
      [
        {
          type: 'patch_canvas_style',
          target: { kind: 'note', id: 'n' },
          patch: { color: '#112233' },
        },
      ],
      { version: 7, sequence: 10, databaseRevision: 3 },
      { key: draft.key, revision: draft.revision },
    );
    expect(draft.values.color).toBe('#112233');
    expect(exportBlocker).toHaveBeenLastCalledWith(
      decorationUserId,
      context.snapshot.project.id,
      true,
      false,
      'editor:canvas:style:note:n',
    );
    acknowledge(true);
    await vi.advanceTimersByTimeAsync(1000);
    render();
    expect(
      loadNativeEditorDraft(decorationUserId, context.snapshot.project.id, draft.key),
    ).toBeNull();
    expect(exportBlocker).toHaveBeenLastCalledWith(
      decorationUserId,
      context.snapshot.project.id,
      false,
      false,
      'editor:canvas:style:note:n',
    );
    expect(context.onSave).toHaveBeenCalledTimes(1);
    expect(document).toEqual(original);
    form.unmount();
    editor.unmount();
  });
  it.each([
    ['note', '#FFF3C4'],
    ['domain', '#8993A3'],
    ['table', '#654321'],
  ])(
    'shows the original %s fallback color without changing the source or submitting',
    (kind, color) => {
      const { document, context } = fixture();
      delete document.notes[0]!.color;
      delete document.tables![0]!.color;
      const before = structuredClone(document);
      const html = renderToStaticMarkup(
        createElement(NativeCanvasStyleEditor, {
          document,
          context,
          editable: true,
          initialSelection: kind === 'note' ? 'note:n' : kind === 'domain' ? 'domain:b' : 'table:t',
        }),
      );
      expect(html).toContain('animated-details');
      expect(html).toContain('panel-section');
      expect(html).toContain(color);
      expect(html).toContain('domain-color-trigger');
      expect(html).toContain('자동 색상으로 되돌리기');
      if (kind === 'table') expect(html).toContain('ui-checkbox-root');
      if (kind === 'note') expect(html).toContain('메모 색상 선택');
      expect(document).toEqual(before);
      expect(context.onSave).not.toHaveBeenCalled();
    },
  );

  it('prefers explicitly recovered note style over current shell selection and preserves invalid HEX drafts', () => {
    const { document, context } = fixture();
    const key = 'canvas:style:note:n';
    const draft = {
      userId: decorationUserId,
      projectId: context.snapshot.project.id,
      key,
      revision: decorationUserId,
      expected: {
        version: context.snapshot.project.version,
        sequence: context.snapshot.sequence,
        databaseRevision: context.snapshot.project.databaseRevision,
      },
      before: { color: '#abcdef', showNullable: 'true', showComment: 'true' },
      values: { color: '#12', showNullable: 'true', showComment: 'true' },
    };
    storeNativeEditorDraft(draft);
    const html = renderToStaticMarkup(
      createElement(NativeCanvasStyleEditor, {
        document,
        context,
        editable: true,
        initialSelection: 'note:n',
        selectedTableId: 't',
        selectedNoteId: 'other',
      }),
    );
    expect(html).toContain('<legend>Note</legend>');
    expect(html).toContain('value="#12"');
    expect(html).toContain('메모 색상 선택');
    expect(loadNativeEditorDraft(decorationUserId, context.snapshot.project.id, key)).toEqual(
      draft,
    );
    expect(context.onSave).not.toHaveBeenCalled();
  });

  it('accepts a selected note and keeps its palette unavailable when read-only or busy', () => {
    const { document, context } = fixture();
    const props = { document, context, editable: true, selectedNoteId: 'n', selectedTableId: 't' };
    const note = renderToStaticMarkup(createElement(NativeCanvasStyleEditor, props));
    expect(note).toContain('<legend>Note</legend>');
    const busy = renderToStaticMarkup(
      createElement(NativeCanvasStyleEditor, { ...props, context: { ...context, busy: true } }),
    );
    expect(busy).toContain('<fieldset disabled=""');
    expect(busy).toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="메모 색상 선택"|<button[^>]*aria-label="메모 색상 선택"[^>]*disabled=""/,
    );
    const readonly = renderToStaticMarkup(
      createElement(NativeCanvasStyleEditor, { ...props, editable: false }),
    );
    expect(readonly).toContain('조회 전용');
    expect(readonly).not.toContain('domain-color-trigger');
    expect(context.onSave).not.toHaveBeenCalled();
  });

  it('uses the common clipboard accordion, checkbox and multiline paste field without writing', () => {
    const { document, snapshot, context } = fixture();
    const before = structuredClone(document);
    const html = renderToStaticMarkup(
      createElement(NativeClipboardMenu, {
        snapshot,
        userId: decorationUserId,
        editable: true,
        busy: true,
        onSave: context.onSave,
      }),
    );
    expect(html).toContain('animated-details');
    expect(html).toContain('ui-checkbox-root');
    expect(html).toContain('ui-textarea');
    expect(html).toContain('<fieldset disabled=""');
    expect(document).toEqual(before);
    expect(context.onSave).not.toHaveBeenCalled();
  });

  it('shows contextual readonly relationship direction and keeps deletion review tied to the baseline', () => {
    const { document, context } = fixture();
    document.domainRelations.push({
      ...document.domainRelations[0]!,
      id: 'other',
      name: 'Hidden relation',
    });
    const readonly = renderToStaticMarkup(
      createElement(NativeDomainRelationEditor, {
        document,
        context,
        editable: false,
        selectedId: 'r',
      }),
    );
    expect(readonly).toContain('도메인 관계 수정');
    expect(readonly).toContain('↔');
    expect(readonly).not.toContain('Hidden relation');
    const deletion = renderToStaticMarkup(
      createElement(NativeDomainRelationEditor, {
        document,
        context,
        editable: true,
        selectedId: 'r',
        initialAction: 'delete',
      }),
    );
    expect(deletion).toContain('ui-checkbox-root');
    const review = requestFingerprint({
      id: 'r',
      version: context.snapshot.project.version,
      sequence: context.snapshot.sequence,
      databaseRevision: context.snapshot.project.databaseRevision,
    });
    expect(nativeDomainRelationCommands(document, context, 'delete', 'r', { review }, {})).toEqual([
      { type: 'delete_domain_relation', id: 'r' },
    ]);
    context.snapshot.sequence++;
    expect(() =>
      nativeDomainRelationCommands(document, context, 'delete', 'r', { review }, {}),
    ).toThrow('canvas.domain-relation-review-required');
    expect(context.onSave).not.toHaveBeenCalled();
  });
});
