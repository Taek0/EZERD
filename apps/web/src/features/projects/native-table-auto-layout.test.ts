import { afterEach, expect, it, vi } from 'vitest';
import { runNativeTableLayout } from './native-table-auto-layout.js';

const node = { id: 'n', objectId: 't', viewId: '__tables__', x: 0, y: 0, width: 300, height: 200 };
const input = { nodes: [node], relations: [] };
function worker() {
  return {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null as Worker['onmessage'],
    onerror: null as Worker['onerror'],
  };
}
afterEach(() => vi.useRealTimers());
it('returns one result and releases the worker', async () => {
  const w = worker();
  const promise = runNativeTableLayout(input, new AbortController().signal, () => w);
  w.onmessage!.call(w as unknown as Worker, { data: { nodes: [node] } } as MessageEvent);
  await expect(promise).resolves.toEqual([node]);
  expect(w.postMessage).toHaveBeenCalledExactlyOnceWith(input);
  expect(w.terminate).toHaveBeenCalledOnce();
});
it('discards canceled and late results without retaining handlers', async () => {
  const w = worker(),
    abort = new AbortController();
  const promise = runNativeTableLayout(input, abort.signal, () => w);
  const late = w.onmessage!;
  abort.abort();
  late.call(w as unknown as Worker, { data: { nodes: [node] } } as MessageEvent);
  await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  expect(w.terminate).toHaveBeenCalledOnce();
  expect(w.onmessage).toBeNull();
});
it('rejects over-limit work before allocating a worker', async () => {
  const create = vi.fn(worker);
  await expect(
    runNativeTableLayout(
      { nodes: Array(101).fill(node), relations: [] },
      new AbortController().signal,
      create,
    ),
  ).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
});
it('terminates a timed-out computation', async () => {
  vi.useFakeTimers();
  const w = worker();
  const promise = runNativeTableLayout(input, new AbortController().signal, () => w);
  const rejected = expect(promise).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(30000);
  await rejected;
  expect(w.terminate).toHaveBeenCalledOnce();
});

it.each([
  null,
  { nodes: [] },
  { nodes: [{ ...node, objectId: 'other' }] },
  { nodes: [{ ...node, x: Infinity }] },
  { nodes: [{ ...node, width: 1 }] },
])('rejects malformed or mismatched Worker results: %j', async (data) => {
  const w = worker();
  const promise = runNativeTableLayout(input, new AbortController().signal, () => w);
  w.onmessage!.call(w as unknown as Worker, { data } as MessageEvent);
  await expect(promise).rejects.toThrow();
  expect(w.terminate).toHaveBeenCalledOnce();
});
