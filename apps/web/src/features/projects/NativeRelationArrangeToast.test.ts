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

it('keeps pending save cancellation reachable beyond the transient notice timeout', async () => {
  const cancel = vi.fn();
  await act(async () =>
    root.render(
      h(NativeRelationArrangeToast, {
        status: { phase: 'saving', canUndo: false, canCancel: true },
        onCancel: cancel,
        onUndo() {},
      }),
    ),
  );
  await act(async () => vi.advanceTimersByTime(30000));
  expect(host.querySelector('[role="status"]')?.textContent).toContain('저장 중');
  await act(async () => host.querySelector('button')!.click());
  expect(cancel).toHaveBeenCalledOnce();
});
it('shows verified crowded table names after successful arrangement without a failure reason', async () => {
  await act(async () =>
    root.render(
      h(NativeRelationArrangeToast, {
        status: { phase: 'saved', canUndo: true, crowdedTableIds: ['orders', 'items', 'users'] },
        crowdedTableNames: ['주문', '주문 항목', '사용자'],
        onCancel() {},
        onUndo() {},
      }),
    ),
  );
  expect(host.querySelector('[role="status"]')?.textContent).toContain(
    '주문 외 2개 테이블 주변 공간이 부족해요',
  );
  expect(host.querySelector('button')?.textContent).toBe('실행 취소');
});

it('announces successful undo as a restored arrangement', async () => {
  await act(async () =>
    root.render(
      h(NativeRelationArrangeToast, {
        status: { phase: 'saved', reason: 'undo', canUndo: false },
        onCancel() {},
        onUndo() {},
      }),
    ),
  );
  expect(host.querySelector('[role="status"]')?.textContent).toBe('관계선 정리를 되돌렸어요');
  expect(host.querySelector('button')).toBeNull();
});
