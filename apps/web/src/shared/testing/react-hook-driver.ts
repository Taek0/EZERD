import type * as React from 'react';

type Runtime = typeof React;
export interface HookDriverState {
  slots: {
    value?: unknown;
    deps?: readonly unknown[] | undefined;
    cleanup?: (() => void) | undefined;
  }[];
  cursor: number;
  effects: (() => void)[];
}
export function createHookDriverState(): HookDriverState {
  return { slots: [], cursor: 0, effects: [] };
}
const sameDependencies = (
  before: readonly unknown[] | undefined,
  after: readonly unknown[] | undefined,
) =>
  before !== undefined &&
  after !== undefined &&
  before.length === after.length &&
  after.every((value, index) => Object.is(value, before[index]));

/** Test-only adapter for manually invoked components/hooks. The caller resets cursor per
 * render and flushes effects after committing. It does NOT simulate a DOM, automatic
 * rerenders, StrictMode, interrupted work, or layout/passive-effect scheduling.
 * With no active driver, delegate to React (e.g. renderToStaticMarkup).
 */
export function mockReactHooks(
  actual: Runtime,
  active: () => HookDriverState | null,
  options: { onStateChange?: () => void } = {},
): Runtime {
  const state = ((initial?: unknown) => {
    const driver = active();
    if (!driver) return actual.useState(initial);
    const slot = (driver.slots[driver.cursor++] ??= {
      value: typeof initial === 'function' ? initial() : initial,
    });
    return [
      slot.value,
      (next: unknown) => {
        const previous = slot.value;
        slot.value = typeof next === 'function' ? next(previous) : next;
        if (!Object.is(previous, slot.value)) options.onStateChange?.();
      },
    ];
  }) as Runtime['useState'];
  const ref = ((initial: unknown) => {
    const driver = active();
    if (!driver) return actual.useRef(initial);
    return (driver.slots[driver.cursor++] ??= { value: { current: initial } }).value;
  }) as Runtime['useRef'];
  const memo: Runtime['useMemo'] = (factory, deps) => {
    const driver = active();
    if (!driver) return actual.useMemo(factory, deps);
    const slot = (driver.slots[driver.cursor++] ??= {});
    if (!sameDependencies(slot.deps, deps)) {
      slot.value = factory();
      slot.deps = deps;
    }
    return slot.value as ReturnType<typeof factory>;
  };
  const callback: Runtime['useCallback'] = (fn, deps) => {
    if (!active()) return actual.useCallback(fn, deps);
    return memo(() => fn, deps);
  };
  const effect =
    (fallback: Runtime['useEffect']): Runtime['useEffect'] =>
    (run, deps) => {
      const driver = active();
      if (!driver) return fallback(run, deps);
      const slot = (driver.slots[driver.cursor++] ??= {});
      if (!sameDependencies(slot.deps, deps)) {
        driver.effects.push(() => {
          slot.cleanup?.();
          slot.cleanup = run() || undefined;
        });
        slot.deps = deps;
      }
    };
  return {
    ...actual,
    useState: state,
    useRef: ref,
    useMemo: memo,
    useCallback: callback,
    useEffect: effect(actual.useEffect),
    useLayoutEffect: effect(actual.useLayoutEffect),
  };
}
