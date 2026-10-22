import { expect, it, vi } from 'vitest';
import { createCameraFrame } from './camera-frame.js';

it('coalesces 100 samples, flushes only the latest, and rejects cancelled callbacks across reuse', () => {
  const callbacks: FrameRequestCallback[] = [];
  const commit = vi.fn();
  const cancel = vi.fn();
  const frame = createCameraFrame(commit, (callback) => callbacks.push(callback), cancel);
  const camera = (x: number) => ({ viewId: '__tables__', x, y: 24, zoom: 1 });
  for (let x = 1; x <= 100; x++) frame.schedule(camera(x));
  expect(callbacks).toHaveLength(1);
  expect(commit).not.toHaveBeenCalled();
  callbacks[0]!(0);
  expect(commit).toHaveBeenCalledExactlyOnceWith(camera(100));
  frame.schedule(camera(110));
  frame.schedule(camera(120));
  frame.flush();
  expect(commit).toHaveBeenLastCalledWith(camera(120));
  callbacks[1]!(0);
  expect(commit).toHaveBeenCalledTimes(2);
  frame.schedule(camera(130));
  frame.cancel();
  frame.schedule(camera(140));
  callbacks[2]!(0);
  expect(commit).toHaveBeenCalledTimes(2);
  callbacks[3]!(0);
  expect(commit).toHaveBeenLastCalledWith(camera(140));
});
