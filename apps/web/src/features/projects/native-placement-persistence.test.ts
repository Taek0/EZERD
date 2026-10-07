import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlacementPersistence } from './native-placement-persistence.js';

afterEach(() => vi.useRealTimers());
describe('placement durability coalescing', () => {
  it('waits for quiet time but checkpoints a continuous drag within one second', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const persistence = createPlacementPersistence(write, vi.fn(), vi.fn());
    for (let x = 0; x < 10; x++) {
      persistence.enqueue(x);
      vi.advanceTimersByTime(100);
    }
    expect(write).toHaveBeenCalledExactlyOnceWith(9);
    persistence.enqueue(10);
    vi.advanceTimersByTime(119);
    expect(write).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenLastCalledWith(10);
  });
  it('writes only the latest frame per interval and flushes the final pointer position', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const persistence = createPlacementPersistence(write, vi.fn(), vi.fn());
    for (let x = 0; x < 100; x++) persistence.enqueue({ x });
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(120);
    expect(write).toHaveBeenCalledExactlyOnceWith({ x: 99 });
    persistence.enqueue({ x: 120 });
    expect(persistence.flush()).toBe(true);
    expect(write).toHaveBeenLastCalledWith({ x: 120 });
    vi.runAllTimers();
    expect(write).toHaveBeenCalledTimes(2);
  });
  it('retains the latest in-memory value after quota failure and retries final flush', () => {
    vi.useFakeTimers();
    const failure = new Error('quota');
    const write = vi.fn().mockImplementationOnce(() => {
      throw failure;
    });
    const error = vi.fn(),
      success = vi.fn();
    const persistence = createPlacementPersistence(write, success, error);
    persistence.enqueue({ x: 1 });
    expect(persistence.flush()).toBe(false);
    expect(error).toHaveBeenCalledWith(failure);
    expect(success).not.toHaveBeenCalled();
    persistence.enqueue({ x: 2 });
    expect(persistence.flush()).toBe(true);
    expect(write).toHaveBeenLastCalledWith({ x: 2 });
    expect(success).toHaveBeenCalledOnce();
  });
});
