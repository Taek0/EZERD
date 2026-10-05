import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { NativeAutoTextarea } from './native-editor-form.js';
const harness = vi.hoisted(() => ({
  effect: null as (() => (() => void) | void) | null,
  ref: null as { current: unknown } | null,
}));
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useLayoutEffect: (effect: () => void) => {
    harness.effect = effect;
  },
}));
vi.mock('../../components/ui/index.js', async () => ({
  ...(await vi.importActual<typeof import('../../components/ui/index.js')>(
    '../../components/ui/index.js',
  )),
  Textarea: (props: Record<string, unknown>) => {
    harness.ref = props.ref as typeof harness.ref;
    const { ref, ...rest } = props;
    return createElement('textarea', rest);
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  harness.effect = null;
  harness.ref = null;
});
it('measures actual Korean description text and remeasures after inspector width changes with observer cleanup', () => {
  let resize: ResizeObserverCallback | undefined;
  const observe = vi.fn(),
    disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const area = {
    style: { height: '' },
    scrollHeight: 110,
    offsetHeight: 74,
    clientHeight: 72,
    getBoundingClientRect: () => ({ width: 300 }),
  };
  renderToStaticMarkup(
    createElement(NativeAutoTextarea, { value: '긴 한국어 업무 설명\n다음 줄', onChange() {} }),
  );
  harness.ref!.current = area;
  const cleanup = harness.effect!();
  expect(area.style.height).toBe('112px');
  expect(observe).toHaveBeenCalledWith(area);
  area.scrollHeight = 220;
  resize!([{ contentRect: { width: 220 } }] as ResizeObserverEntry[], {} as ResizeObserver);
  expect(area.style.height).toBe('222px');
  area.scrollHeight = 330;
  resize!([{ contentRect: { width: 220 } }] as ResizeObserverEntry[], {} as ResizeObserver);
  expect(area.style.height).toBe('222px');
  cleanup!();
  expect(disconnect).toHaveBeenCalledOnce();
});
