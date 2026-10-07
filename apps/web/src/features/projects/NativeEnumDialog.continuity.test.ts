import { createElement, isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NativeEnumDialog } from './NativeEnumDialog.js';
import { NativeStructureEditor, NativeCreateForm } from './native-editor-structure.js';
import {
  NativeEditorForm,
  NativeEditorField,
  type NativeEditorContext,
} from './native-editor-form.js';
import { NativeLabelFields } from './NativeLabelFields.js';
import { advancedFixture } from './native-advanced-test-fixtures.js';
import { NATIVE_AUTOSAVE_QUIET_WINDOW_MS } from './use-native-autosave.js';
import type { NativeWebCommand } from './native-save.js';

// Walk the actual dialog -> structure -> create -> durable form -> label-field chain.
// Hook state is keyed by element type/key/path, so an ACK-dependent React key really remounts.
const hooks = vi.hoisted(() => ({
  active: null as null | {
    slots: {
      value?: any;
      deps?: readonly unknown[] | undefined;
      cleanup?: (() => void) | undefined;
    }[];
    cursor: number;
  },
  dirty: false,
  effects: [] as (() => void)[],
}));
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  const effect = (callback: () => void | (() => void), deps?: readonly unknown[]) => {
    const state = hooks.active!;
    const slot = (state.slots[state.cursor++] ??= {});
    if (!deps || !slot.deps || deps.some((item, i) => !Object.is(item, slot.deps![i]))) {
      hooks.effects.push(() => {
        slot.cleanup?.();
        slot.cleanup = callback() || undefined;
      });
      slot.deps = deps;
    }
  };
  return {
    ...react,
    useState(initial: unknown) {
      const state = hooks.active!;
      const slot = (state.slots[state.cursor++] ??= {
        value: typeof initial === 'function' ? initial() : initial,
      });
      return [
        slot.value,
        (value: any) => {
          const next = typeof value === 'function' ? value(slot.value) : value;
          if (!Object.is(next, slot.value)) hooks.dirty = true;
          slot.value = next;
        },
      ];
    },
    useRef(initial: unknown) {
      const state = hooks.active!;
      return (state.slots[state.cursor++] ??= { value: { current: initial } }).value;
    },
    useEffect: effect,
    useLayoutEffect: effect,
  };
});
vi.mock('./NativeLogicalMode.js', () => ({ useNativeLogicalMode: () => ({ enabled: true }) }));
vi.mock('./native-export-state.js', () => ({ useNativeExportBlocker() {} }));
vi.mock('../../shared/i18n/index.js', () => ({
  registerTranslations() {},
  useI18n: () => ({
    t: (text: string, values?: Record<string, unknown>) =>
      text.replace(/\{(\w+)\}/g, (_, key: string) => String(values?.[key] ?? key)),
  }),
}));
vi.mock('react-dom', () => ({ createPortal: (content: unknown) => content }));

beforeEach(() => {
  vi.useFakeTimers();
  hooks.dirty = false;
  hooks.effects = [];
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal('document', { body: {}, activeElement: null });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  hooks.active = null;
});

it.each([false, true])(
  'retains the ENUM input identity across delayed creation ACK (typing during ACK: %s)',
  async (duringAck) => {
    const fixture = advancedFixture();
    const context: NativeEditorContext = { ...fixture.context };
    const saves: NativeWebCommand[][] = [];
    const accept: (() => void)[] = [];
    context.onSave = vi.fn(
      (commands) =>
        new Promise<boolean>((resolve) => {
          saves.push(commands);
          accept.push(() => {
            const command = commands[0]!;
            if (command.type === 'add_enum')
              fixture.document.enums = [...(fixture.document.enums ?? []), command.value];
            if (command.type === 'patch_enum')
              fixture.document.enums = fixture.document.enums!.map((item) =>
                item.id === command.id ? { ...item, ...command.patch } : item,
              );
            context.snapshot = {
              ...context.snapshot,
              project: {
                ...context.snapshot.project,
                version: context.snapshot.project.version + 1,
              },
              sequence: context.snapshot.sequence + 1,
              sourceDocument: fixture.document,
            };
            resolve(true);
          });
        }),
    );
    const states = new Map<string, NonNullable<typeof hooks.active>>();
    let nodes: { element: ReactElement<any>; path: string }[] = [];
    const executable = new Set<unknown>([
      NativeEnumDialog,
      NativeStructureEditor,
      NativeCreateForm,
      NativeEditorForm,
      NativeLabelFields,
      NativeEditorField,
    ]);
    function walk(node: unknown, parent: string) {
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${parent}/${index}`));
        return;
      }
      if (!isValidElement<any>(node)) return;
      const type = node.type;
      const path = `${parent}/${typeof type === 'function' ? type.name : String(type)}:${node.key ?? ''}`;
      nodes.push({ element: node, path });
      if (executable.has(type)) {
        const state = states.get(path) ?? { slots: [], cursor: 0 };
        states.set(path, state);
        state.cursor = 0;
        hooks.active = state;
        walk((type as (props: any) => unknown)(node.props), path);
        hooks.active = null;
      } else walk(node.props.children, path);
    }
    function render() {
      let count = 0;
      do {
        if (++count > 20) throw Error('Unsettled ENUM effects');
        hooks.dirty = false;
        nodes = [];
        walk(
          createElement(NativeEnumDialog, { document: fixture.document, context, onClose() {} }),
          'root',
        );
        hooks.effects.splice(0).forEach((effect) => effect());
      } while (hooks.dirty);
    }
    const click = (text: string) => {
      nodes
        .find(({ element }) => element.props.children === text && element.props.onClick)!
        .element.props.onClick();
      render();
    };
    const field = (label: string) =>
      nodes.find(
        ({ element }) => element.type === NativeEditorField && element.props.label === label,
      )!;
    const change = (label: string, value: string) => {
      field(label).element.props.onChange(value);
      render();
    };
    render();
    click('ENUM 추가');
    change('물리 이름', 'qa_status');
    click('값 추가');
    const inputPath = field('값 1').path;
    const instance = states.get(
      nodes.find(({ element }) => element.type === NativeCreateForm)!.path,
    );
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    render();
    expect(saves).toHaveLength(1);
    expect(saves[0]![0]).toMatchObject({
      type: 'add_enum',
      value: { name: 'qa_status', values: [''] },
    });
    if (duringAck) change('값 1', 'pending');
    await vi.advanceTimersByTimeAsync(800);
    accept.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    render();
    expect(field('물리 이름').element.props.value).toBe('qa_status');
    expect(field('값 1').element.props.value).toBe(duringAck ? 'pending' : '');
    expect(field('값 1').path).toBe(inputPath);
    expect(states.get(nodes.find(({ element }) => element.type === NativeCreateForm)!.path)).toBe(
      instance,
    );
    change('값 1', 'ready');
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    render();
    const created = saves[0]![0];
    if (created?.type !== 'add_enum') throw Error('Expected ENUM creation');
    expect(saves).toHaveLength(2);
    expect(saves[1]![0]).toMatchObject({
      type: 'patch_enum',
      id: created.value.id,
      patch: { values: ['ready'] },
    });
    accept.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    render();
    expect(field('값 1').element.props.value).toBe('ready');
    expect(field('값 1').path).toBe(inputPath);
  },
);
