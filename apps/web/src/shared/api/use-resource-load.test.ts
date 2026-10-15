import { afterEach, expect, it, vi } from 'vitest';
import { createResourceLoader } from './use-resource-load.js';
afterEach(() => vi.useRealTimers());
it('coalesces bursts and serializes a trailing refresh during an in-flight request', async () => {
  vi.useFakeTimers();
  let finish: (() => void) | undefined;
  const load = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const loader = createResourceLoader(load);
  loader.invalidate();
  loader.invalidate();
  loader.invalidate();
  await vi.advanceTimersByTimeAsync(30);
  expect(load).toHaveBeenCalledOnce();
  loader.invalidate();
  loader.invalidate();
  await vi.advanceTimersByTimeAsync(100);
  expect(load).toHaveBeenCalledOnce();
  finish?.();
  await vi.advanceTimersByTimeAsync(30);
  expect(load).toHaveBeenCalledTimes(2);
  loader.stop();
  finish?.();
  await vi.advanceTimersByTimeAsync(30);
  expect(vi.getTimerCount()).toBe(0);
});
it('aborts obsolete identity requests and cancels queued refreshes on cleanup', async () => {
  vi.useFakeTimers();
  let finish: (() => void) | undefined;
  let signal: AbortSignal | undefined;
  const load = vi.fn((value: AbortSignal) => {
    signal = value;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const loader = createResourceLoader(load);
  loader.invalidate();
  await vi.advanceTimersByTimeAsync(30);
  loader.invalidate();
  loader.stop();
  expect(signal?.aborted).toBe(true);
  finish?.();
  await vi.advanceTimersByTimeAsync(100);
  expect(load).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('reports rejected or synchronously thrown loads and remains available for recovery', async () => {
  vi.useFakeTimers();
  const failure = Error('network');
  const load = vi
    .fn<(signal: AbortSignal) => Promise<void>>()
    .mockRejectedValueOnce(failure)
    .mockImplementationOnce(() => {
      throw failure;
    })
    .mockResolvedValueOnce();
  const onError = vi.fn();
  const loader = createResourceLoader(load, onError);
  for (let n = 0; n < 3; n++) {
    loader.invalidate();
    await vi.advanceTimersByTimeAsync(30);
  }
  expect(onError).toHaveBeenCalledTimes(2);
  expect(load).toHaveBeenCalledTimes(3);
  loader.stop();
});
