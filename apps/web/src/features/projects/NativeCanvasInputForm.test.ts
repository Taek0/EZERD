import { NATIVE_AUTOSAVE_QUIET_WINDOW_MS } from './use-native-autosave.js';
import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeCanvasInputForm, type NativeCanvasSubmit } from './NativeCanvasInputForm.js';
import { decorationSnapshot, decorationUserId } from './native-canvas-decoration-test-fixtures.js';
import { loadNativeEditorDraft, storeNativeEditorDraft } from './native-editor-draft.js';

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
  let values!: Record<string, string>;
  props.children = (currentValues, update) => {
    values = currentValues;
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
    values: () => values,
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('native canvas form gesture-submit registration', () => {
  it('preserves a long route drag beyond max-wait and submits only its final input on release', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (..._args: unknown[]) => true);
    const ui = fixture(save);
    ui.props.pauseAutosave = true;
    ui.render();
    for (const value of ['10', '20', '30']) {
      ui.change('route', value);
      ui.render();
      await vi.advanceTimersByTimeAsync(2500);
      expect(save).not.toHaveBeenCalled();
      expect(ui.draft()?.values.route).toBe(value);
    }
    ui.props.pauseAutosave = false;
    // Pointer-up submits immediately, before React commits the resumed autosave state.
    await ui.submit();
    ui.render();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toEqual([
      {
        type: 'upsert_relation_layout',
        value: { viewId: '__tables__', relationId: 'r', offset: 30 },
      },
    ]);
  });
  it('retains interrupted drag input without draining it on unmount', async () => {
    vi.useFakeTimers();
    const ui = fixture();
    ui.props.pauseAutosave = true;
    ui.render();
    ui.change('route', '42');
    ui.render();
    ui.unmount();
    await vi.advanceTimersByTimeAsync(5000);
    expect(ui.onSave).not.toHaveBeenCalled();
    expect(ui.draft()?.values.route).toBe('42');
  });
  it('submits another revision of the same route while its earlier save is in flight', async () => {
    const acknowledgements: ((saved: boolean) => void)[] = [];
    const save = vi.fn(() => new Promise<boolean>((resolve) => acknowledgements.push(resolve)));
    const ui = fixture(save);
    ui.render();
    ui.change('route', '42');
    const first = ui.submit();
    ui.render();
    ui.change('route', '51');
    const second = ui.submit();
    expect(save).toHaveBeenCalledTimes(2);
    await ui.submit();
    expect(save).toHaveBeenCalledTimes(2);
    const latest = ui.draft();
    acknowledgements[0]!(true);
    await first;
    expect(ui.draft()).toEqual(latest);
    acknowledgements[1]!(false);
    await second;
    expect(ui.draft()).toEqual(latest);
  });
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

  it.each(['version', 'sequence'] as const)(
    'retains private canvas CAS guards when %s advances',
    async (guard) => {
      const save = vi.fn(async () => true);
      const ui = fixture(save);
      ui.props.context.affectsSharedDocument = false;
      ui.render();
      ui.change('route', '2');
      if (guard === 'sequence') ui.snapshot.sequence++;
      else ui.snapshot.project.version++;
      ui.render();
      await ui.submit();
      expect(save).not.toHaveBeenCalled();
      expect(ui.draft()?.values.route).toBe('2');
      ui.unmount();
    },
  );
  it.each(['busy', 'disabled', 'databaseRevision'] as const)(
    'reads the latest %s guard through a retained callback',
    async (guard) => {
      const save = vi.fn(async () => true);
      const ui = fixture(save);
      ui.render();
      ui.change('route', '2');
      const callback = ui.callback();
      if (guard === 'busy') ui.props.context = { ...ui.props.context, busy: true };
      else if (guard === 'disabled') ui.props.disabled = true;
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
    // The invalidated registration does nothing; pending valid input is flushed by cleanup.
    expect(save).toHaveBeenCalledTimes(1);
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

  it('keeps the selected form reusable for successive ACKs with current route values and baselines', async () => {
    const save = vi.fn(async () => true);
    const ui = fixture(save);
    ui.render();
    ui.change('route', '10');
    await ui.submit();
    expect(ui.draft()).toBeNull();
    ui.snapshot.sequence++;
    ui.snapshot.project.version++;
    ui.props.initial = { ...ui.props.initial, route: '10' };
    ui.render();
    ui.render(); // Model the state update queued by the committed clean-refresh effect.
    expect(ui.values().route).toBe('10');
    ui.change('route', '20');
    const second = ui.draft()!;
    await ui.submit();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]).toEqual([
      [
        {
          type: 'upsert_relation_layout',
          value: { viewId: '__tables__', relationId: 'r', offset: 20 },
        },
      ],
      { version: 8, sequence: 11, databaseRevision: 3 },
      second,
    ]);
    ui.snapshot.sequence++;
    ui.props.initial = { ...ui.props.initial, route: '20' };
    ui.render();
    ui.render();
    expect(ui.values().route).toBe('20');
    expect(ui.draft()).toBeNull();
    ui.unmount();
  });

  it('waits for an in-flight ACK then refreshes the clean form when the newer snapshot arrived first', async () => {
    let acknowledge!: (accepted: boolean) => void;
    const save = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          acknowledge = resolve;
        }),
    );
    const ui = fixture(save);
    ui.render();
    ui.change('route', '14');
    const pending = ui.submit();
    const sent = ui.draft();
    ui.snapshot.sequence++;
    ui.props.initial = { ...ui.props.initial, route: '14' };
    ui.render();
    expect(ui.draft()).toEqual(sent);
    await ui.submit();
    expect(save).toHaveBeenCalledTimes(1);
    acknowledge(true);
    await pending;
    ui.render();
    ui.render();
    expect(ui.values().route).toBe('14');
    ui.change('route', '15');
    expect(ui.draft()!.expected.sequence).toBe(11);
    ui.unmount();
  });

  it('preserves newer input typed while waiting for ACK and submits against the advanced shared baseline', async () => {
    let acknowledge!: (accepted: boolean) => void;
    const save = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          acknowledge = resolve;
        }),
    );
    const ui = fixture(save);
    ui.render();
    ui.change('route', '16');
    const pending = ui.submit();
    ui.change('route', '17');
    const newer = ui.draft();
    ui.snapshot.sequence++;
    ui.props.initial = { ...ui.props.initial, route: '16' };
    ui.render();
    acknowledge(true);
    await pending;
    ui.render();
    const tree = ui.render();
    expect(ui.draft()).toEqual(newer);
    expect(ui.values().route).toBe('17');
    expect(
      nodes(tree).some(
        (node) =>
          node.props.children ===
          '저장 기준이 변경되었습니다. 보관된 입력을 최신 내용과 비교해 주세요.',
      ),
    ).toBe(false);
    const next = ui.submit();
    expect(save).toHaveBeenCalledTimes(2);
    acknowledge(true);
    await next;
    ui.unmount();
  });

  it('does not refresh even clean input until its in-flight submission settles', async () => {
    let acknowledge!: (accepted: boolean) => void;
    const save = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          acknowledge = resolve;
        }),
    );
    const ui = fixture(save);
    ui.props.initial = { ...ui.props.initial, route: '0' };
    ui.render();
    const pending = ui.submit();
    const captured = ui.draft();
    ui.snapshot.sequence++;
    ui.props.initial = { ...ui.props.initial, route: '5' };
    ui.render();
    ui.render();
    expect(ui.values().route).toBe('0');
    expect(ui.draft()).toEqual(captured);
    acknowledge(true);
    await pending;
    ui.render();
    ui.render();
    expect(ui.values().route).toBe('5');
    expect(ui.draft()).toBeNull();
    ui.unmount();
  });

  it.each(['version', 'sequence', 'databaseRevision'] as const)(
    'refreshes only fresh clean input after %s changes',
    (field) => {
      const ui = fixture();
      ui.render();
      if (field === 'sequence') ui.snapshot.sequence++;
      else ui.snapshot.project[field]++;
      ui.props.initial = { ...ui.props.initial, route: '30' };
      ui.render();
      const tree = ui.render();
      expect(ui.values().route).toBe('30');
      expect(
        nodes(tree).some(
          (node) =>
            node.props.children ===
            '저장 기준이 변경되었습니다. 보관된 입력을 최신 내용과 비교해 주세요.',
        ),
      ).toBe(false);
      expect(ui.draft()).toBeNull();
      ui.change('route', '31');
      expect(ui.draft()!.expected).toEqual({
        version: ui.snapshot.project.version,
        sequence: ui.snapshot.sequence,
        databaseRevision: ui.snapshot.project.databaseRevision,
      });
      ui.unmount();
    },
  );

  it('preserves recovered clean input without exposing a reset action', () => {
    const ui = fixture();
    const recovered = {
      userId: decorationUserId,
      projectId: ui.snapshot.project.id,
      key: ui.props.draftKey,
      revision: decorationUserId,
      expected: { version: 7, sequence: 10, databaseRevision: 3 },
      before: { ...ui.props.initial },
      values: { ...ui.props.initial },
    };
    storeNativeEditorDraft(recovered);
    ui.snapshot.sequence++;
    ui.props.initial = { ...ui.props.initial, route: 'current' };
    ui.render();
    const tree = ui.render();
    expect(ui.values().route).toBe('saved');
    expect(ui.draft()).toEqual(recovered);
    expect(nodes(tree).some((node) => node.props.children === '입력 초기화')).toBe(false);
    ui.unmount();
  });

  it.each(['personalVersion', 'privateVersion'])(
    'preserves clean %s mismatch evidence when the shared baseline also advances',
    (field) => {
      const ui = fixture();
      ui.props.initial = { ...ui.props.initial, [field]: '5' };
      ui.render();
      ui.snapshot.sequence++;
      ui.props.initial = { ...ui.props.initial, route: 'new route', [field]: '6' };
      ui.render();
      ui.render();
      expect(ui.values()[field]).toBe('5');
      expect(ui.values().route).toBe('saved');
      expect(ui.draft()).toBeNull();
      ui.change('route', '32');
      expect(ui.draft()!.expected.sequence).toBe(10);
      ui.unmount();
    },
  );

  it('retains clean-but-unarchived storage failure evidence across a new baseline', () => {
    const ui = fixture();
    ui.render();
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw Error('storage.failed');
    });
    ui.change('route', 'temporary');
    ui.change('route', 'saved');
    const evidence = ui.draft();
    ui.snapshot.sequence++;
    ui.props.initial = { ...ui.props.initial, route: 'server changed' };
    ui.render();
    ui.render();
    expect(ui.values().route).toBe('saved');
    expect(ui.draft()).toEqual(evidence);
    ui.unmount();
  });
});

describe('canvas automatic saving', () => {
  it('debounces user input, waits for busy and IME, and never retries rejected input', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => false);
    const ui = fixture(save);
    ui.render();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
    ui.props.context.busy = true;
    ui.change('route', '1');
    ui.render();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
    ui.props.context.busy = false;
    let tree = ui.render();
    (nodes(tree).find((n) => n.type === 'form')!.props.onCompositionStart as () => void)();
    ui.change('route', '12');
    ui.render();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
    (nodes(tree).find((n) => n.type === 'form')!.props.onCompositionEnd as () => void)();
    ui.render();
    expect(save).not.toHaveBeenCalled();
    // The max-wait deadline elapsed during IME; save only after composition ends.
    await vi.advanceTimersByTimeAsync(0);
    ui.render();
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    ui.render();
    expect(save).toHaveBeenCalledTimes(1);
    expect(ui.draft()?.values.route).toBe('12');
    ui.change('route', '13');
    ui.render();
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    expect(save).toHaveBeenCalledTimes(2);
    ui.unmount();
  });
  it('requires a separate confirmation for destructive commands and cancels pending saves on unmount', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => true);
    const ui = fixture(save);
    ui.props.build = () => [{ type: 'delete_note', id: 'note' }];
    ui.render();
    ui.change('route', '1');
    ui.render();
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    const tree = ui.render();
    expect(save).not.toHaveBeenCalled();
    const confirmation = nodes(tree).find((n) => n.props.children === '삭제 실행 확인')!;
    await (confirmation.props.onClick as () => Promise<void>)();
    expect(save).toHaveBeenCalledTimes(1);
    ui.change('route', '2');
    ui.render();
    ui.unmount();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('canvas accepted values', () => {
  it('keeps acknowledged input visible and autosaves subsequent input without blur', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => true);
    const ui = fixture(save);
    ui.render();
    ui.change('route', '10');
    ui.render();
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    ui.render();
    expect(ui.values().route).toBe('10');
    expect(ui.draft()).toBeNull();
    ui.change('route', '11');
    ui.render();
    await vi.advanceTimersByTimeAsync(NATIVE_AUTOSAVE_QUIET_WINDOW_MS);
    ui.render();
    expect(save).toHaveBeenCalledTimes(2);
    expect(ui.values().route).toBe('11');
    ui.unmount();
  });
});
