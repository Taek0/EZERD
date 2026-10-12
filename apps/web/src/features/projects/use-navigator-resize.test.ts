import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { navigatorWidth, useNavigatorResize } from './use-navigator-resize.js';
const host = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState(initial: unknown) {
    const i = host.cursor++;
    if (!(i in host.slots)) host.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [
      host.slots[i],
      (value: unknown) => {
        host.slots[i] = value;
      },
    ];
  },
  useRef(initial: unknown) {
    const i = host.cursor++;
    return host.slots[i] ?? (host.slots[i] = { current: initial });
  },
  useEffect(effect: () => void) {
    effect();
  },
}));
let stored: string | null = null;
function render() {
  host.cursor = 0;
  return useNavigatorResize();
}
function pointer(x: number, id = 1) {
  return {
    button: 0,
    clientX: x,
    pointerId: id,
    preventDefault: vi.fn(),
    currentTarget: {
      focus: vi.fn(),
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => true,
      releasePointerCapture: vi.fn(),
    },
  } as unknown as Parameters<
    NonNullable<ReturnType<typeof useNavigatorResize>['separator']['onPointerDown']>
  >[0];
}
beforeEach(() => {
  host.slots = [];
  stored = null;
  vi.stubGlobal('localStorage', {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
describe('explorer resizing', () => {
  it('tracks the grabbed offset, ignores other pointers, clamps and persists on release', () => {
    render().separator.onPointerDown!(pointer(238));
    render().separator.onPointerMove!(pointer(300, 2));
    expect(render().width).toBe(240);
    render().separator.onPointerMove!(pointer(318));
    expect(render().width).toBe(320);
    expect(stored).toBe('240');
    render().separator.onPointerMove!(pointer(900));
    expect(render().width).toBe(420);
    render().separator.onPointerUp!(pointer(900));
    expect(render().resizing).toBe(false);
    expect(stored).toBe('420');
  });
  it('stops tracking on cancellation and supports keyboard/reset', () => {
    render().separator.onPointerDown!(pointer(238));
    render().separator.onPointerCancel!(pointer(238));
    render().separator.onPointerMove!(pointer(350));
    expect(render().width).toBe(240);
    const key = (key: string, shiftKey = false) =>
      render().separator.onKeyDown!({ key, shiftKey, preventDefault() {} } as never);
    key('ArrowRight', true);
    expect(render().width).toBe(280);
    key('Home');
    expect(render().width).toBe(200);
    key('End');
    expect(render().width).toBe(420);
    render().separator.onDoubleClick!({} as never);
    expect(render().width).toBe(240);
  });
  it('recovers invalid preferences and tolerates blocked storage', () => {
    stored = 'invalid';
    expect(render().width).toBe(240);
    expect(navigatorWidth(-100)).toBe(200);
    host.slots = [];
    vi.stubGlobal('localStorage', {
      getItem() {
        throw Error();
      },
      setItem() {
        throw Error();
      },
    });
    expect(render().width).toBe(240);
  });
});
