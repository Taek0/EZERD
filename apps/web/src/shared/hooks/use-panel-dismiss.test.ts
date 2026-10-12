import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { usePanelDismiss } from './use-panel-dismiss.js';

const host = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, jobs: [] as (() => void)[] }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useRef(initial: unknown) {
    const i = host.cursor++;
    return host.slots[i] ?? (host.slots[i] = { current: initial });
  },
  useState(initial: unknown) {
    const i = host.cursor++;
    if (!(i in host.slots)) host.slots[i] = initial;
    return [
      host.slots[i],
      (value: unknown) => {
        host.slots[i] = value;
      },
    ];
  },
  useEffect(effect: () => void | (() => void), deps: unknown[]) {
    const i = host.cursor++;
    const previous = host.slots[i] as
      { deps: unknown[]; cleanup?: (() => void) | undefined } | undefined;
    if (previous && deps.every((value, index) => Object.is(value, previous.deps[index]))) return;
    host.jobs.push(() => {
      previous?.cleanup?.();
      const cleanup = effect();
      host.slots[i] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
    });
  },
}));
let reduced = false;
function render(callback: () => void, enabled = true) {
  host.cursor = 0;
  host.jobs = [];
  const result = usePanelDismiss(callback, enabled);
  host.jobs.forEach((job) => job());
  return result;
}
function unmount() {
  for (const slot of host.slots) (slot as { cleanup?: () => void } | undefined)?.cleanup?.();
}
beforeEach(() => {
  vi.useFakeTimers();
  host.slots = [];
  host.cursor = 0;
  reduced = false;
  vi.stubGlobal('window', { setTimeout, clearTimeout, matchMedia: () => ({ matches: reduced }) });
  vi.stubGlobal('document', new EventTarget());
});
afterEach(() => {
  unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('interruptible panel dismissal', () => {
  it('cancels a close after 50ms and permits a later independent close', () => {
    const close = vi.fn();
    render(close).close();
    const closing = render(close);
    expect(closing.closing).toBe(true);
    vi.advanceTimersByTime(50);
    closing.cancelClose();
    expect(render(close).closing).toBe(false);
    vi.advanceTimersByTime(200);
    expect(close).not.toHaveBeenCalled();
    render(close).close();
    render(close);
    vi.advanceTimersByTime(160);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('does not keep a motion delay for reduced motion', () => {
    reduced = true;
    const close = vi.fn();
    render(close).close();
    render(close);
    vi.advanceTimersByTime(0);
    expect(close).toHaveBeenCalledOnce();
  });
  it('cancels pending callbacks when disabled or unmounted and calls the latest callback', () => {
    const old = vi.fn(),
      latest = vi.fn();
    render(old).close();
    render(old);
    render(latest);
    vi.advanceTimersByTime(160);
    expect(latest).toHaveBeenCalledOnce();
    expect(old).not.toHaveBeenCalled();
    render(latest, false);
    render(latest, false);
    render(latest).close();
    render(latest);
    render(latest, false);
    vi.advanceTimersByTime(160);
    expect(latest).toHaveBeenCalledTimes(1);
    render(latest, false);
    render(latest).close();
    render(latest);
    unmount();
    vi.advanceTimersByTime(160);
    expect(latest).toHaveBeenCalledTimes(1);
  });
  it('does not dismiss the containing panel when an inner control handled Escape', () => {
    const close = vi.fn();
    render(close);
    const handled = new Event('keydown', { cancelable: true });
    Object.defineProperty(handled, 'key', { value: 'Escape' });
    handled.preventDefault();
    document.dispatchEvent(handled);
    expect(render(close).closing).toBe(false);
    const escape = new Event('keydown', { cancelable: true });
    Object.defineProperty(escape, 'key', { value: 'Escape' });
    document.dispatchEvent(escape);
    expect(render(close).closing).toBe(true);
    vi.advanceTimersByTime(160);
    expect(close).toHaveBeenCalledOnce();
  });
});
