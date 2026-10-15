// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ContextMenu } from './index.js';
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it('opens nested actions with the keyboard, returns focus, and closes after an action', async () => {
  const action = vi.fn(),
    close = vi.fn();
  await act(async () =>
    root.render(
      h(ContextMenu, {
        position: { x: 30, y: 30 },
        onClose: close,
        items: [
          {
            id: 'layout',
            label: 'Arrange',
            onAction() {},
            children: [
              { id: 'tables', label: 'Tables', onAction: action },
              { id: 'relations', label: 'Relations', onAction: action, disabled: true },
            ],
          },
        ],
      }),
    ),
  );
  const parent = document.querySelector<HTMLElement>('[role="menuitem"]')!;
  expect(parent.getAttribute('aria-haspopup')).toBe('menu');
  await act(async () => {
    parent.focus();
    parent.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  expect(document.querySelectorAll('[role="menu"]').length).toBe(2);
  const child = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (el) => el.textContent === 'Tables',
  )!;
  expect(child).toBeTruthy();
  await act(async () =>
    child.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  expect(close).not.toHaveBeenCalled();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(document.activeElement).toBe(parent);
  await act(async () =>
    parent.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
  );
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (el) => el.textContent === 'Tables',
  )!;
  await act(async () => item.click());
  expect(action).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalled();
});
