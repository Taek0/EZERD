import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import {
  createHookDriverState,
  mockReactHooks,
  type HookDriverState,
} from './react-hook-driver.js';
import { elementNodes } from './react-element-tree.js';

it('retains lazy state/ref values across manual renders and isolates component instances', () => {
  let current = createHookDriverState();
  const hooks = mockReactHooks(React, () => current);
  const initialize = vi.fn(() => 1);
  const render = () => {
    current.cursor = 0;
    return [hooks.useState(initialize), hooks.useRef('value')] as const;
  };
  const [first, ref] = render();
  first[1]((n) => n + 2);
  const [second, sameRef] = render();
  expect(second[0]).toBe(3);
  expect(sameRef).toBe(ref);
  expect(initialize).toHaveBeenCalledOnce();
  current = createHookDriverState();
  expect(render()[0][0]).toBe(1);
  expect(initialize).toHaveBeenCalledTimes(2);
});
it('invalidates memo and callback on value or dependency length changes', () => {
  const state = createHookDriverState(),
    hooks = mockReactHooks(React, () => state);
  const factory = vi.fn(() => ({}));
  const render = (deps: unknown[]) => {
    state.cursor = 0;
    return [hooks.useMemo(factory, deps), hooks.useCallback(() => deps, deps)];
  };
  const first = render([NaN]);
  const second = render([NaN]);
  expect(second[0]).toBe(first[0]);
  expect(second[1]).toBe(first[1]);
  expect(factory).toHaveBeenCalledOnce();
  expect(render([NaN, undefined])[0]).not.toBe(first[0]);
  expect(factory).toHaveBeenCalledTimes(2);
  const positive = render([0]);
  expect(render([-0])[0]).not.toBe(positive[0]);
});
it('defers effects to explicit commit and runs cleanup before a replacement', () => {
  const state = createHookDriverState(),
    hooks = mockReactHooks(React, () => state),
    calls: string[] = [];
  const render = (value: string) => {
    state.cursor = 0;
    hooks.useEffect(() => {
      calls.push(value);
      return () => {
        calls.push('cleanup:' + value);
      };
    }, [value]);
  };
  render('a');
  expect(calls).toEqual([]);
  state.effects.splice(0).forEach((run) => run());
  expect(calls).toEqual(['a']);
  render('a');
  expect(state.effects).toHaveLength(0);
  render('b');
  state.effects.splice(0).forEach((run) => run());
  state.slots.forEach((slot) => slot.cleanup?.());
  expect(calls).toEqual(['a', 'cleanup:a', 'b', 'cleanup:b']);
});
it('schedules no-dependency layout effects each render without pretending to model layout order', () => {
  const state = createHookDriverState(),
    hooks = mockReactHooks(React, () => state),
    run = vi.fn();
  for (let i = 0; i < 2; i++) {
    state.cursor = 0;
    hooks.useLayoutEffect(run);
    state.effects.splice(0).forEach((effect) => effect());
  }
  expect(run).toHaveBeenCalledTimes(2);
});
it('delegates inactive drivers to the real React renderer', () => {
  const hooks = mockReactHooks(React, () => null as HookDriverState | null);
  function Component() {
    const [value] = hooks.useState('real');
    const ref = hooks.useRef(value);
    const text = hooks.useMemo(() => ref.current, []);
    return React.createElement('span', null, hooks.useCallback(() => text, [])());
  }
  expect(renderToStaticMarkup(React.createElement(Component))).toBe('<span>real</span>');
});
it('walks fragments/arrays without running child components or render props', () => {
  const render = vi.fn(() => React.createElement('input'));
  const tree = React.createElement(React.Fragment, null, [
    null,
    React.createElement('span', { key: 'a' }, 'text'),
    React.createElement(render, { key: 'b' }),
  ]);
  expect(elementNodes(tree).map((node) => node.type)).toEqual([React.Fragment, 'span', render]);
  expect(render).not.toHaveBeenCalled();
});

it('notifies an explicit manual rerender loop only when state changes', () => {
  const state = createHookDriverState(),
    notify = vi.fn(),
    hooks = mockReactHooks(React, () => state, { onStateChange: notify });
  const [, set] = hooks.useState(1);
  set(1);
  expect(notify).not.toHaveBeenCalled();
  set((n) => n + 1);
  expect(notify).toHaveBeenCalledOnce();
});
