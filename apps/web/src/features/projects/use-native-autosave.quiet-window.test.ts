import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNativeAutosave } from './use-native-autosave.js';

// Committed hook lifecycle driver; exercises timers and async completion without a DOM.
const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as { value?: unknown; deps?: readonly unknown[]; cleanup?: (() => void) | undefined }[],
  effects: [] as (() => void)[],
}));
vi.mock('react', () => ({
  useState(initial: unknown) {
    const slot = (hooks.slots[hooks.cursor++] ??= { value: initial });
    return [
      slot.value,
      (value: unknown) => {
        slot.value = value;
      },
    ];
  },
  useRef(initial: unknown) {
    return (hooks.slots[hooks.cursor++] ??= { value: { current: initial } }).value;
  },
  useLayoutEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
    const slot = (hooks.slots[hooks.cursor++] ??= {});
    if (!deps || !slot.deps || deps.some((value, index) => !Object.is(value, slot.deps![index]))) {
      hooks.effects.push(() => {
        slot.cleanup?.();
        slot.cleanup = callback() || undefined;
      });
      if (deps) slot.deps = deps;
    }
  },
}));

function fixture(save = vi.fn(async () => {})) {
  let blocked = false;
  let api: ReturnType<typeof useNativeAutosave>;
  const render = () => {
    hooks.cursor = 0;
    api = useNativeAutosave({ blocked, save });
    hooks.effects.splice(0).forEach((effect) => effect());
    return api;
  };
  render();
  return {
    save,
    render,
    edit() {
      api.markChanged();
      render();
    },
    block(value: boolean) {
      blocked = value;
      render();
    },
    unmount() {
      hooks.slots.forEach((slot) => slot.cleanup?.());
    },
  };
}
beforeEach(() => {
  hooks.cursor = 0;
  hooks.slots = [];
  hooks.effects = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('native autosave quiet window', () => {
  it('keeps five immediate local edits and submits only the final value after 750ms quiet', async () => {
    let localValue = '';
    const values: string[] = [];
    const ui = fixture(
      vi.fn(async () => {
        values.push(localValue);
      }),
    );
    for (const value of ['a', 'ab', 'abc', 'abcd', 'abcde']) {
      localValue = value;
      ui.edit();
      expect(localValue).toBe(value);
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(649);
    expect(ui.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(values).toEqual(['abcde']);
  });
  it('bounds continuous typing by two seconds', async () => {
    const ui = fixture();
    ui.edit();
    for (let index = 0; index < 3; index++) {
      await vi.advanceTimersByTimeAsync(600);
      ui.edit();
    }
    await vi.advanceTimersByTimeAsync(199);
    expect(ui.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ui.save).toHaveBeenCalledOnce();
  });
  it('never interrupts IME at the deadline and flushes only after composition ends', async () => {
    const ui = fixture();
    ui.render().compositionProps.onCompositionStart();
    ui.edit();
    await vi.advanceTimersByTimeAsync(3000);
    expect(ui.save).not.toHaveBeenCalled();
    ui.render().compositionProps.onCompositionEnd();
    ui.render();
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.save).toHaveBeenCalledOnce();
  });
  it('keeps explicit flush immediate and drains later edits after an in-flight ACK', async () => {
    let ack!: () => void;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          ack = resolve;
        }),
    );
    const ui = fixture(save);
    ui.edit();
    ui.render().flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    ui.edit();
    ui.unmount();
    await vi.advanceTimersByTimeAsync(3000);
    expect(save).toHaveBeenCalledTimes(1);
    ack();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    ack();
    await vi.advanceTimersByTimeAsync(0);
  });
  it('preserves blocked edits without bypassing the blocker at the deadline', async () => {
    const ui = fixture();
    ui.block(true);
    ui.edit();
    await vi.advanceTimersByTimeAsync(3000);
    expect(ui.save).not.toHaveBeenCalled();
    ui.block(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.save).toHaveBeenCalledOnce();
  });
});
