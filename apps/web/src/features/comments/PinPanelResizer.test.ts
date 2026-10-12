import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PinPanelResizer } from './PinPanelResizer.js';
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  cleanups: [] as (() => void)[],
}));
vi.mock('../../shared/i18n/index.js', async (original) => ({
  ...(await original<object>()),
  useI18n: () => ({ t: (s: string) => s }),
  translate: (s: string) => s,
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState(initial: unknown) {
    const i = hooks.cursor++;
    if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [
      hooks.slots[i],
      (v: unknown) => {
        hooks.slots[i] = v;
      },
    ];
  },
  useRef(initial: unknown) {
    const i = hooks.cursor++;
    return hooks.slots[i] ?? (hooks.slots[i] = { current: initial });
  },
  useEffect(effect: () => void | (() => void)) {
    const cleanup = effect();
    if (cleanup) hooks.cleanups.push(cleanup);
  },
}));
const frames = new Map<number, FrameRequestCallback>();
let nextId = 0;
beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.cleanups = [];
  frames.clear();
  vi.stubGlobal('requestAnimationFrame', (task: FrameRequestCallback) => {
    frames.set(++nextId, task);
    return nextId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => {
  hooks.cleanups.forEach((fn) => fn());
  vi.unstubAllGlobals();
});
function setup() {
  const onWidthChange = vi.fn(),
    onResizingChange = vi.fn(),
    styles = new Map<string, string>();
  const tree = PinPanelResizer({ width: 320, onWidthChange, onResizingChange });
  const target = {
    parentElement: {
      getBoundingClientRect: () => ({ width: 320 }),
      style: { setProperty: (k: string, v: string) => styles.set(k, v) },
    },
    focus: vi.fn(),
    setAttribute: vi.fn(),
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  };
  const props = tree.props as Record<string, (event: unknown) => void>;
  return {
    onWidthChange,
    onResizingChange,
    styles,
    event(name: string, x: number, id = 1) {
      props[name]!({
        type: name === 'onPointerUp' ? 'pointerup' : name,
        isPrimary: true,
        button: 0,
        pointerId: id,
        clientX: x,
        currentTarget: target,
        preventDefault() {},
        stopPropagation() {},
      });
    },
  };
}
describe('pin width drag commit', () => {
  it('does not emit width updates during a burst and includes the release position', () => {
    const ui = setup();
    ui.event('onPointerDown', 1000);
    for (let x = 999; x >= 900; x--) ui.event('onPointerMove', x);
    expect(ui.onWidthChange).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    ui.event('onPointerUp', 850);
    expect(ui.onWidthChange).toHaveBeenCalledExactlyOnceWith(470);
    expect(ui.styles.get('--comments-panel-width')).toBe('470px');
    expect(frames.size).toBe(0);
    expect(ui.onResizingChange.mock.calls).toEqual([[true], [false]]);
  });
  it('ignores another pointer and retains the last preview on cancellation', () => {
    const ui = setup();
    ui.event('onPointerDown', 1000);
    ui.event('onPointerMove', 0, 2);
    ui.event('onPointerMove', 900);
    ui.event('onPointerCancel', 0, 2);
    expect(ui.onWidthChange).not.toHaveBeenCalled();
    ui.event('onPointerCancel', 0);
    expect(ui.onWidthChange).toHaveBeenCalledExactlyOnceWith(420);
    expect(frames.size).toBe(0);
  });
  it('flushes the latest width and clears the pending frame on unmount', () => {
    const ui = setup();
    ui.event('onPointerDown', 1000);
    ui.event('onPointerMove', 900);
    hooks.cleanups.forEach((fn) => fn());
    expect(frames.size).toBe(0);
    expect(ui.onWidthChange).toHaveBeenCalledExactlyOnceWith(420);
  });
});
