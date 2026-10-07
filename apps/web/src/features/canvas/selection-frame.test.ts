import { describe, expect, it, vi } from 'vitest';
import { createSelectionFrame, retainSelection } from './selection-frame.js';

describe('selection frame lifecycle', () => {
  it('uses the latest point and allows scheduling after flush and cancellation', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let id = 0;
    const apply = vi.fn();
    const frame = createSelectionFrame(
      apply,
      (callback) => {
        callbacks.set(++id, callback);
        return id;
      },
      (id) => {
        callbacks.delete(id);
      },
    );
    frame.schedule({ x: 1, y: 2 });
    frame.schedule({ x: 3, y: 4 });
    expect(callbacks.size).toBe(1);
    frame.flush();
    expect(apply).toHaveBeenCalledExactlyOnceWith({ x: 3, y: 4 });
    expect(callbacks.size).toBe(0);
    frame.schedule({ x: 5, y: 6 });
    frame.cancel();
    frame.flush();
    expect(apply).toHaveBeenCalledTimes(1);
    frame.schedule({ x: 7, y: 8 });
    [...callbacks.values()][0]!(0);
    expect(apply).toHaveBeenLastCalledWith({ x: 7, y: 8 });
    expect(callbacks.size).toBe(0);
  });
  it('retains identity only for the same ordered selection', () => {
    const previous = ['a', 'b'];
    expect(retainSelection(previous, ['a', 'b'])).toBe(previous);
    expect(retainSelection(previous, ['b', 'a'])).not.toBe(previous);
    expect(retainSelection(previous, ['a'])).toEqual(['a']);
  });
});
