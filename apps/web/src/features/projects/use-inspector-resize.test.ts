import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useInspectorResize } from './use-inspector-resize.js';
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  cleanups: [] as (() => void)[],
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useRef(initial: unknown) {
    const i = hooks.cursor++;
    return hooks.slots[i] ?? (hooks.slots[i] = { current: initial });
  },
  useEffect(effect: () => () => void) {
    if (!hooks.cleanups.length) hooks.cleanups.push(effect());
  },
}));
const frames = new Map<number, FrameRequestCallback>();
let id = 0;
beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.cleanups = [];
  frames.clear();
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => {
    frames.set(++id, f);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (i: number) => frames.delete(i));
});
afterEach(() => {
  hooks.cleanups.forEach((f) => f());
  vi.unstubAllGlobals();
});
function setup(workspaceWidth = 940) {
  const commit = vi.fn(),
    resizing = vi.fn(),
    styles = new Map<string, string>();
  const host = {
    current: { style: { setProperty: (k: string, v: string) => styles.set(k, v) } },
  } as unknown as { current: HTMLDivElement };
  const target = {
    focus: vi.fn(),
    setAttribute: vi.fn(),
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  };
  const render = () => {
    hooks.cursor = 0;
    return useInspectorResize(host, 320, workspaceWidth, commit, resizing);
  };
  let handlers = render();
  return {
    commit,
    resizing,
    styles,
    target,
    rerender() {
      handlers = render();
    },
    event(name: keyof typeof handlers, x = 800, pointerId = 1) {
      (handlers[name] as Function)({
        button: 0,
        pointerId,
        clientX: x,
        currentTarget: target,
        preventDefault() {},
      });
    },
    key(key: string, shiftKey = false) {
      handlers.onKeyDown!({ key, shiftKey, preventDefault() {} } as never);
    },
  };
}
function tick() {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((f) => f(0));
}
describe('inspector resize preview', () => {
  it('coalesces moves without width commits, survives rerender and includes release coordinate', () => {
    const ui = setup();
    ui.event('onPointerDown');
    ui.rerender();
    for (let x = 799; x >= 700; x--) ui.event('onPointerMove', x);
    expect(ui.commit).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    tick();
    expect(ui.styles.get('--native-inspector-width')).toBe('420px');
    ui.event('onPointerUp', 680);
    expect(ui.commit).toHaveBeenCalledExactlyOnceWith(440);
    ui.event('onLostPointerCapture');
    expect(ui.commit).toHaveBeenCalledTimes(1);
    expect(ui.resizing.mock.calls).toEqual([[true], [false]]);
    expect(frames.size).toBe(0);
  });
  it.each(['onPointerCancel', 'onLostPointerCapture'] as const)(
    'ignores other pointers and commits last preview on %s',
    (name) => {
      const ui = setup();
      ui.event('onPointerDown');
      ui.event('onPointerMove', 600, 2);
      ui.event(name, 600, 2);
      expect(ui.commit).not.toHaveBeenCalled();
      ui.event('onPointerMove', 700);
      ui.event(name, 0);
      expect(ui.commit).toHaveBeenCalledExactlyOnceWith(420);
      expect(frames.size).toBe(0);
    },
  );
  it('clamps to current workspace and preserves keyboard controls', () => {
    const ui = setup(750);
    ui.key('End');
    expect(ui.commit).toHaveBeenLastCalledWith(330);
    ui.key('Home');
    expect(ui.commit).toHaveBeenLastCalledWith(280);
    ui.key('ArrowRight', true);
    expect(ui.commit).toHaveBeenLastCalledWith(280);
    ui.event('onPointerDown');
    ui.event('onPointerMove', 0);
    tick();
    expect(ui.styles.get('--native-inspector-width')).toBe('330px');
    ui.event('onPointerUp', 0);
    expect(ui.commit).toHaveBeenLastCalledWith(330);
  });
  it('cancels pending paint on unmount without committing state', () => {
    const ui = setup();
    ui.event('onPointerDown');
    ui.event('onPointerMove', 700);
    hooks.cleanups.forEach((f) => f());
    expect(frames.size).toBe(0);
    expect(ui.commit).not.toHaveBeenCalled();
    expect(ui.styles.get('--native-inspector-width')).toBe('320px');
  });
});
