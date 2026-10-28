import {
  nativeSceneRoutingKey,
  validNativeSceneRoutingResult,
  type NativeSceneRoutingInput,
  type NativeSceneGeometry,
} from './native-ghost-routing-core.js';
export * from './native-ghost-routing-core.js';

export type NativeSceneRoutingWorker = Pick<
  Worker,
  'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'
>;

/** One disposable worker: success, failure, abort, timeout and cloning failure all terminate it. */
export function routeNativeSceneInWorker(
  input: NativeSceneRoutingInput,
  signal: AbortSignal,
  createWorker: () => NativeSceneRoutingWorker = () =>
    new Worker(new URL('./native-ghost-routing.worker.ts', import.meta.url), {
      type: 'module',
      name: 'native-ghost',
    }),
  timeoutMs = 30000,
): Promise<NativeSceneGeometry[]> {
  if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  return new Promise((resolve, reject) => {
    const key = nativeSceneRoutingKey(input);
    const worker = createWorker();
    let settled = false;
    const finish = (error?: Error, geometries?: NativeSceneGeometry[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      if (error) reject(error);
      else resolve(geometries!);
    };
    const cancel = () => finish(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(Error('canvas.placement-invalid')), timeoutMs);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    worker.onmessage = (event) => {
      const data: unknown = event.data;
      if (
        !data ||
        typeof data !== 'object' ||
        !('key' in data) ||
        data.key !== key ||
        !('geometries' in data) ||
        !validNativeSceneRoutingResult(data.geometries, input.relations.length, input)
      )
        finish(Error('canvas.placement-invalid'));
      else finish(undefined, data.geometries);
    };
    worker.onerror = worker.onmessageerror = () => finish(Error('canvas.placement-invalid'));
    try {
      worker.postMessage({ key, input });
    } catch {
      finish(Error('canvas.placement-invalid'));
    }
  });
}
