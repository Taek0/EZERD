import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { retainClosingNavigator } from './use-navigator-presence.js';
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('getComputedStyle', () => ({
    transitionDuration: '180ms, 140ms, 180ms',
    transitionDelay: '0s',
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function setup(focused = false) {
  const listeners = new Map<string, Function>();
  const focus = vi.fn(),
    release = vi.fn();
  const element = {
    id: 'columns',
    ownerDocument: { activeElement: focused ? {} : null },
    contains: () => focused,
    parentElement: { querySelectorAll: () => [{ getAttribute: () => 'columns', focus }] },
    addEventListener: (name: string, fn: Function) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  } as unknown as HTMLElement;
  return { element, listeners, focus, release };
}
describe('closing explorer presence', () => {
  it('retains content until grid transition ends and restores focus to its trigger', () => {
    const ui = setup(true);
    retainClosingNavigator(ui.element, ui.release);
    expect(ui.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(ui.release).not.toHaveBeenCalled();
    ui.listeners.get('transitionend')!({ target: ui.element, propertyName: 'opacity' });
    expect(ui.release).not.toHaveBeenCalled();
    ui.listeners.get('transitionend')!({ target: {}, propertyName: 'grid-template-rows' });
    expect(ui.release).not.toHaveBeenCalled();
    ui.listeners.get('transitionend')!({ target: ui.element, propertyName: 'grid-template-rows' });
    expect(ui.release).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(ui.release).toHaveBeenCalledOnce();
  });
  it('cancels a pending close when reopened or unmounted', () => {
    const ui = setup();
    const cancel = retainClosingNavigator(ui.element, ui.release);
    cancel();
    vi.runAllTimers();
    expect(ui.release).not.toHaveBeenCalled();
    expect(ui.listeners.size).toBe(0);
  });
  it('releases when a hidden surface omits transitionend', () => {
    const ui = setup();
    retainClosingNavigator(ui.element, ui.release);
    vi.advanceTimersByTime(179);
    expect(ui.release).not.toHaveBeenCalled();
    vi.advanceTimersByTime(51);
    expect(ui.release).toHaveBeenCalledOnce();
  });
  it('releases immediately with reduced motion and leaves unrelated focus alone', () => {
    vi.stubGlobal('getComputedStyle', () => ({ transitionDuration: '0s', transitionDelay: '0s' }));
    const ui = setup();
    retainClosingNavigator(ui.element, ui.release);
    expect(ui.release).toHaveBeenCalledOnce();
    expect(ui.focus).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
