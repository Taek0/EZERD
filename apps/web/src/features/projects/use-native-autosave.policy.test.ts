import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NATIVE_AUTOSAVE_QUIET_WINDOW_MS as QUIET,
  NATIVE_AUTOSAVE_MAX_WAIT_MS as MAX_WAIT,
  useNativeAutosave,
} from './use-native-autosave.js';

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

function fixture(save: (draining?: boolean) => Promise<unknown> = vi.fn(async () => {})) {
  let blocked = false;
  let api: ReturnType<typeof useNativeAutosave>;
  const render = () => {
    hooks.cursor = 0;
    api = useNativeAutosave({ blocked, save, getBlocked: () => blocked });
    hooks.effects.splice(0).forEach((effect) => effect());
    return api;
  };
  render();
  return {
    render,
    edit() {
      api.markChanged();
      render();
    },
    block(value: boolean) {
      blocked = value;
      render();
    },
    async advance(ms: number) {
      await vi.advanceTimersByTimeAsync(ms);
      render();
    },
    unmount() {
      hooks.slots.forEach((slot) => slot.cleanup?.());
    },
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  hooks.cursor = 0;
  hooks.slots = [];
  hooks.effects = [];
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

describe('native autosave save-call policy (not network measurements)', () => {
  it.each([1, 2, 5, 12])(
    'coalesces %i immediate local edits into one final-value save',
    async (count) => {
      let local = '';
      const save = vi.fn(async () => local);
      const ui = fixture(save);
      for (let index = 0; index < count; index++) {
        if (index) await ui.advance(100);
        local += 'x';
        ui.edit();
        expect(local.length).toBe(index + 1);
      }
      await ui.advance(QUIET - 1);
      expect(save).not.toHaveBeenCalled();
      await ui.advance(1);
      expect(save).toHaveBeenCalledTimes(1);
      await expect(save.mock.results[0]!.value).resolves.toBe('x'.repeat(count));
    },
  );

  it('bounds repeated continuous-input windows and finally saves the last edit', async () => {
    let local = 0;
    const saved: number[] = [];
    const ui = fixture(async () => {
      saved.push(local);
    });
    for (let index = 1; index <= 21; index++) {
      local = index;
      ui.edit();
      await ui.advance(200);
    }
    expect(saved).toEqual([10, 20]);
    await ui.advance(QUIET);
    expect(saved).toEqual([10, 20, 21]);
  });

  it('waits only the remaining quiet window after ACK, with no overlapping saves', async () => {
    const ack = deferred();
    let local = 'first';
    const values: string[] = [];
    const save = vi.fn(() => {
      values.push(local);
      return values.length === 1 ? ack.promise : Promise.resolve();
    });
    const ui = fixture(save);
    ui.edit();
    await ui.advance(QUIET);
    local = 'second';
    ui.edit();
    await ui.advance(200);
    local = 'latest';
    ui.edit();
    await ui.advance(200);
    expect(save).toHaveBeenCalledTimes(1);
    ack.resolve();
    await ui.advance(0);
    await ui.advance(QUIET - 200 - 1);
    expect(save).toHaveBeenCalledTimes(1);
    await ui.advance(1);
    expect(values).toEqual(['first', 'latest']);
  });

  it('saves immediately after a long ACK once the pending deadline has elapsed', async () => {
    const ack = deferred();
    const save = vi.fn().mockReturnValueOnce(ack.promise).mockResolvedValue(undefined);
    const ui = fixture(save);
    ui.edit();
    await ui.advance(QUIET);
    ui.edit();
    await ui.advance(MAX_WAIT * 2);
    expect(save).toHaveBeenCalledTimes(1);
    ack.resolve();
    await ui.advance(0);
    await ui.advance(0);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('never sends recovered mount input, including unmount', async () => {
    const save = vi.fn(async () => {});
    const ui = fixture(save);
    await ui.advance(MAX_WAIT * 3);
    ui.unmount();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).not.toHaveBeenCalled();
  });

  it.each(['rejection', 'false'] as const)(
    'does not auto-retry a failed %s revision',
    async (failure) => {
      const save = vi.fn(() =>
        failure === 'rejection' ? Promise.reject(Error('offline')) : Promise.resolve(false),
      );
      const ui = fixture(save);
      ui.edit();
      await ui.advance(QUIET);
      await ui.advance(MAX_WAIT * 3);
      ui.block(true);
      ui.block(false);
      ui.render().flush();
      await ui.advance(QUIET);
      expect(save).toHaveBeenCalledTimes(1);
      ui.edit();
      await ui.advance(QUIET);
      expect(save).toHaveBeenCalledTimes(2);
      ui.unmount();
      await vi.advanceTimersByTimeAsync(MAX_WAIT);
      expect(save).toHaveBeenCalledTimes(2);
    },
  );

  it('flushes a valid unmount edit and drains only the latest in-flight revision', async () => {
    const ack = deferred();
    let local = 1;
    const values: number[] = [];
    const save = vi.fn((draining?: boolean) => {
      values.push(local);
      return draining ? Promise.resolve() : ack.promise;
    });
    const ui = fixture(save);
    ui.edit();
    ui.render().flush();
    await ui.advance(0);
    local = 2;
    ui.edit();
    local = 3;
    ui.edit();
    ui.unmount();
    await vi.advanceTimersByTimeAsync(MAX_WAIT);
    expect(values).toEqual([1]);
    ack.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(values).toEqual([1, 3]);
    expect(save.mock.calls).toEqual([[false], [true]]);
  });

  it('flushes a pending quiet-window edit on unmount', async () => {
    const save = vi.fn(async () => {});
    const ui = fixture(save);
    ui.edit();
    ui.unmount();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('does not flush or drain unfinished IME even after the deadline', async () => {
    const save = vi.fn(async () => {});
    const ui = fixture(save);
    ui.render().compositionProps.onCompositionStart();
    ui.edit();
    await ui.advance(MAX_WAIT * 2);
    ui.render().flush();
    ui.unmount();
    await vi.advanceTimersByTimeAsync(MAX_WAIT);
    expect(save).not.toHaveBeenCalled();
  });
});
