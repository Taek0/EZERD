import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeCanvasInputForm, type NativeCanvasSubmit } from './NativeCanvasInputForm.js';
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
  };
});
function nodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
function fixture(
  onSave: Parameters<typeof NativeCanvasInputForm>[0]['context']['onSave'] = vi.fn(
    async () => true,
  ),
) {
  const state = {
    slots: [] as NonNullable<typeof hooks.active>['slots'],
    cursor: 0,
    effects: [] as (() => void)[],
  };
  const snapshot = decorationSnapshot();
  let submit: NativeCanvasSubmit;
  const ready = vi.fn((callback: NativeCanvasSubmit) => {
    submit = callback;
  });
  const props: Parameters<typeof NativeCanvasInputForm>[0] = {
    context: {
      userId: decorationUserId,
      snapshot,
      busy: false,
      affectsSharedDocument: true,
      onSave,
    },
    title: 'Route',
    draftKey: 'canvas:route:__tables__:r',
    disabled: false,
    initial: { route: 'saved', reset: 'false' },
    build: (values) => [
      {
        type: 'upsert_relation_layout',
        value: { viewId: '__tables__', relationId: 'r', offset: Number(values.route) },
      },
    ],
    onSubmitReady: ready,
    children: () => null,
  };
  let change!: (field: string, value: string) => void;
  props.children = (_values, update) => {
    change = update;
    return null;
  };
  return {
    props,
    snapshot,
    ready,
    onSave,
    render() {
      hooks.active = state;
      state.cursor = 0;
      try {
        const tree = NativeCanvasInputForm(props);
        state.effects.splice(0).forEach((effect) => effect());
        return tree;
      } finally {
        hooks.active = null;
      }
    },
    change(field: string, value: string) {
      change(field, value);
    },
    submit: () => submit!(),
    callback: () => submit!,
    draft: () => loadNativeEditorDraft(decorationUserId, snapshot.project.id, props.draftKey),
    unmount: () => state.slots.forEach((slot) => slot.cleanup?.()),
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('native canvas form gesture-submit registration', () => {
  it('registers after commit without saving and submits the latest same-frame draft once', async () => {
    let acknowledge!: (accepted: boolean) => void;
    const save = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          acknowledge = resolve;
        }),
    );
    const ui = fixture(save);
    const tree = ui.render();
    expect(ui.ready).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    ui.change('route', '42');
    const sentDraft = ui.draft();
    const pending = ui.submit();
    (nodes(tree).find((node) => node.type === 'form')!.props.onSubmit as (event: unknown) => void)({
      preventDefault() {},
    });
    await ui.submit();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      [
        {
          type: 'upsert_relation_layout',
          value: { viewId: '__tables__', relationId: 'r', offset: 42 },
        },
      ],
      sentDraft!.expected,
      sentDraft,
    );
    ui.change('route', '51');
    const newer = ui.draft();
    acknowledge(true);
    await pending;
    expect(ui.draft()).toEqual(newer);
    ui.render();
    expect(ui.ready).toHaveBeenCalledTimes(1);
    ui.unmount();
  });

  it('keeps rejected input and only consumes the exact accepted revision', async () => {
    const save = vi.fn(async () => false);
    const ui = fixture(save);
    ui.render();
    ui.change('route', '12');
    const captured = ui.draft();
    await ui.submit();
    expect(ui.draft()).toEqual(captured);
    save.mockResolvedValue(true);
    await ui.submit();
    expect(ui.draft()).toBeNull();
    ui.unmount();
  });

  it.each(['busy', 'disabled', 'sequence', 'version', 'databaseRevision'] as const)(
    'reads the latest %s guard through a retained callback',
    async (guard) => {
      const save = vi.fn(async () => true);
      const ui = fixture(save);
      ui.render();
      ui.change('route', '2');
      const callback = ui.callback();
      if (guard === 'busy') ui.props.context = { ...ui.props.context, busy: true };
      else if (guard === 'disabled') ui.props.disabled = true;
      else if (guard === 'sequence') ui.snapshot.sequence++;
      else ui.snapshot.project[guard]++;
      ui.render();
      await callback();
      expect(save).not.toHaveBeenCalled();
      expect(ui.draft()?.values.route).toBe('2');
      ui.unmount();
    },
  );

  it('invalidates old registrations on replacement and unmount', async () => {
    const save = vi.fn(async () => true);
    const ui = fixture(save);
    ui.render();
    ui.change('route', '3');
    const old = ui.callback();
    let replacement!: NativeCanvasSubmit;
    ui.props.onSubmitReady = (callback) => {
      replacement = callback;
    };
    ui.render();
    await old();
    expect(save).not.toHaveBeenCalled();
    ui.unmount();
    await replacement();
    expect(save).not.toHaveBeenCalled();
    expect(ui.draft()?.values.route).toBe('3');
  });

  it('does not bypass durable storage failure or command validation', async () => {
    const save = vi.fn(async () => true);
    const ui = fixture(save);
    ui.render();
    ui.change('route', '7');
    const preserved = ui.draft();
    ui.props.build = () => {
      throw Error('route.invalid');
    };
    ui.render();
    await ui.submit();
    expect(save).not.toHaveBeenCalled();
    expect(ui.draft()).toEqual(preserved);
    ui.props.build = () => [
      {
        type: 'upsert_relation_layout',
        value: { viewId: '__tables__', relationId: 'r', offset: 7 },
      },
    ];
    ui.render();
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw Error('storage.failed');
    });
    ui.change('route', '8');
    ui.render();
    await ui.submit();
    expect(save).not.toHaveBeenCalled();
    expect(ui.draft()?.values.route).toBe('8');
    ui.unmount();
  });
});
