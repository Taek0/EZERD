import { afterEach, expect, it, vi } from 'vitest';
import { relationGeometry } from '../relations/relation-routing.js';
import {
  routeNativeScene,
  routeNativeSceneInWorker,
  nativeSceneRoutingKey,
  validNativeSceneRoutingResult,
  type NativeSceneRoutingInput,
} from './native-ghost-routing.js';
const input: NativeSceneRoutingInput = {
  bounds: [
    { x: 0, y: 0, width: 300, height: 200 },
    { x: 700, y: 400, width: 300, height: 200 },
    { x: 350, y: 100, width: 200, height: 100 },
  ],
  relations: [
    {
      source: 0,
      target: 1,
      labelWidth: 100,
      lane: 2,
      offset: 30,
      bend: { x: 500, y: 300 },
      options: {
        sourceAnchor: { side: 'right', ratio: 0.4 },
        targetAnchor: { side: 'left', ratio: 0.7 },
      },
    },
  ],
};
function worker() {
  return {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null as Worker['onmessage'],
    onerror: null as Worker['onerror'],
    onmessageerror: null as Worker['onmessageerror'],
  };
}
function reply(w: ReturnType<typeof worker>, data: unknown) {
  w.onmessage!.call(w as unknown as Worker, { data } as MessageEvent);
}
afterEach(() => vi.useRealTimers());
it('uses the ordinary relationGeometry algorithm and shared obstacle order', () => {
  const r = input.relations[0]!;
  expect(routeNativeScene(structuredClone(input))).toEqual([
    relationGeometry(
      input.bounds[0]!,
      input.bounds[1]!,
      r.labelWidth,
      r.lane,
      r.offset,
      r.bend,
      [input.bounds[2]!],
      r.options,
    ),
  ]);
});
it('returns the matching finite result and always releases its Worker', async () => {
  const w = worker();
  const promise = routeNativeSceneInWorker(input, new AbortController().signal, () => w);
  const geometries = routeNativeScene(input);
  reply(w, { key: nativeSceneRoutingKey(input), geometries });
  await expect(promise).resolves.toEqual(geometries);
  expect(w.postMessage).toHaveBeenCalledExactlyOnceWith({
    key: nativeSceneRoutingKey(input),
    input,
  });
  expect(w.terminate).toHaveBeenCalledOnce();
  expect(w.onmessage).toBeNull();
});
it.each([
  null,
  {},
  { key: 'wrong', geometries: [] },
  { key: nativeSceneRoutingKey(input), geometries: [] },
  {
    key: nativeSceneRoutingKey(input),
    geometries: [{ ...routeNativeScene(input)[0], labelX: Infinity }],
  },
  {
    key: nativeSceneRoutingKey(input),
    geometries: [{ ...routeNativeScene(input)[0], path: 'M 0 0' }],
  },
])('rejects malformed or mismatched responses', async (data) => {
  const w = worker();
  const promise = routeNativeSceneInWorker(input, new AbortController().signal, () => w);
  reply(w, data);
  await expect(promise).rejects.toThrow('canvas.placement-invalid');
  expect(w.terminate).toHaveBeenCalledOnce();
});
it('rejects diagonal and nonfinite geometry', () => {
  const g = routeNativeScene(input)[0]!;
  expect(
    validNativeSceneRoutingResult(
      [
        {
          ...g,
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
          path: 'M 0 0 L 1 1',
        },
      ],
      1,
    ),
  ).toBe(false);
  expect(validNativeSceneRoutingResult([{ ...g, handle: { x: NaN, y: 1 } }], 1)).toBe(false);
});
it('aborts, ignores late replies, and skips already aborted work', async () => {
  const w = worker(),
    controller = new AbortController();
  const promise = routeNativeSceneInWorker(input, controller.signal, () => w),
    late = w.onmessage!;
  controller.abort();
  late.call(
    w as unknown as Worker,
    {
      data: { key: nativeSceneRoutingKey(input), geometries: routeNativeScene(input) },
    } as MessageEvent,
  );
  await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  expect(w.terminate).toHaveBeenCalledOnce();
  const create = vi.fn(worker);
  await expect(routeNativeSceneInWorker(input, controller.signal, create)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(create).not.toHaveBeenCalled();
});
it('terminates on timeout, Worker error, message decode failure and postMessage failure', async () => {
  vi.useFakeTimers();
  for (const kind of ['timeout', 'error', 'messageerror', 'postMessage']) {
    const w = worker();
    if (kind === 'postMessage')
      w.postMessage.mockImplementation(() => {
        throw Error('clone');
      });
    const promise = routeNativeSceneInWorker(input, new AbortController().signal, () => w, 50),
      rejected = expect(promise).rejects.toThrow();
    if (kind === 'timeout') await vi.advanceTimersByTimeAsync(50);
    if (kind === 'error') w.onerror!.call(w as unknown as Worker, {} as ErrorEvent);
    if (kind === 'messageerror') w.onmessageerror!.call(w as unknown as Worker, {} as MessageEvent);
    await rejected;
    expect(w.terminate).toHaveBeenCalledOnce();
  }
});

it('rejects a valid-looking response with endpoints from another input', async () => {
  const w = worker(),
    promise = routeNativeSceneInWorker(input, new AbortController().signal, () => w);
  const other = structuredClone(input);
  other.bounds[0]!.x += 123;
  reply(w, { key: nativeSceneRoutingKey(input), geometries: routeNativeScene(other) });
  await expect(promise).rejects.toThrow();
  expect(w.terminate).toHaveBeenCalledOnce();
});
it('handles abort during Worker creation without posting or retaining the Worker', async () => {
  const controller = new AbortController(),
    w = worker();
  await expect(
    routeNativeSceneInWorker(input, controller.signal, () => {
      controller.abort();
      return w;
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(w.terminate).toHaveBeenCalledOnce();
  expect(w.postMessage).not.toHaveBeenCalled();
});
