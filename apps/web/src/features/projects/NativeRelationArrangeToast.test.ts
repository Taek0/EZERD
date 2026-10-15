// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NativeRelationArrangeToast } from './NativeRelationArrangeToast.js';
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('delays computing feedback, keeps cancellation available, and replaces it with undo', async () => {
  const cancel = vi.fn(),
    undo = vi.fn();
  await act(async () =>
    root.render(
      h(NativeRelationArrangeToast, {
        status: { phase: 'computing', canUndo: false },
        onCancel: cancel,
        onUndo: undo,
      }),
    ),
  );
  expect(host.querySelector('button')).toBeNull();
  await act(async () => vi.advanceTimersByTime(250));
  expect(host.querySelector('[role="status"]')?.textContent).toContain('관계선 정리 중');
  await act(async () => vi.advanceTimersByTime(20000));
  await act(async () => host.querySelector('button')!.click());
  expect(cancel).toHaveBeenCalledOnce();
  await act(async () =>
    root.render(
      h(NativeRelationArrangeToast, {
        status: { phase: 'saved', canUndo: true },
        onCancel: cancel,
        onUndo: undo,
      }),
    ),
  );
  expect(host.querySelector('[role="status"]')?.textContent).toContain('관계선을 정리했어요');
  expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
  await act(async () => host.querySelector('button')!.click());
  expect(undo).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTime(8000));
  expect(host.querySelector('button')).toBeNull();
});
