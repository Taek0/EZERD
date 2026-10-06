import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommittedEvent } from './use-committed-event.js';
const host = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void)[],
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useRef(initial: unknown) {
    const slot = host.cursor++;
    return host.slots[slot] ?? (host.slots[slot] = { current: initial });
  },
  useState(initial: () => unknown) {
    const slot = host.cursor++;
    if (!(slot in host.slots)) host.slots[slot] = initial();
    return [host.slots[slot], () => {}];
  },
  useLayoutEffect(effect: () => void) {
    host.effects.push(effect);
  },
}));
beforeEach(() => {
  host.slots = [];
  host.cursor = 0;
  host.effects = [];
});
function render<A extends unknown[], R>(callback: ((...args: A) => R) | undefined, commit = true) {
  host.cursor = 0;
  host.effects = [];
  const event = useCommittedEvent(callback);
  if (commit) host.effects.forEach((effect) => effect());
  return event;
}
describe('committed event identity', () => {
  it('retains identity but never exposes an abandoned render implementation', () => {
    const first = vi.fn((n: number) => n + 1),
      next = vi.fn((n: number) => n + 2);
    const event = render(first)!;
    expect(render(next, false)).toBe(event);
    expect(event(10)).toBe(11);
    expect(next).not.toHaveBeenCalled();
    expect(render(next)).toBe(event);
    expect(event(10)).toBe(12);
  });
  it('uses current permission/save implementation and preserves the returned promise', async () => {
    const accepted = Promise.resolve(true),
      rejected = Promise.resolve(false);
    const allowed = vi.fn((_id: string) => accepted),
      blocked = vi.fn((_id: string) => rejected);
    const save = render(allowed)!;
    expect(save('old')).toBe(accepted);
    expect(render(blocked)).toBe(save);
    expect(save('new')).toBe(rejected);
    expect(blocked).toHaveBeenCalledWith('new');
    expect(allowed).toHaveBeenCalledTimes(1);
  });
  it('removes optional callbacks and safely ignores previously retained handlers', () => {
    const fn = vi.fn((n: number) => n);
    const event = render(fn)!;
    expect(render<[number], number>(undefined)).toBeUndefined();
    expect(event(3)).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
    expect(render(fn)).toBe(event);
    expect(event(4)).toBe(4);
  });
});
