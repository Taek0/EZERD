import type { NodeLayout } from '@ezerd/model';
import type { nativeTableLayoutInput } from './native-canvas-selection.js';

type Input = ReturnType<typeof nativeTableLayoutInput>;
type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;

/** One isolated computation; cancellation, timeout and every completion release the worker. */
export function runNativeTableLayout(
  input: Input,
  signal: AbortSignal,
  createWorker: () => WorkerLike = () =>
    new Worker(new URL('./native-table-auto-layout.worker.ts', import.meta.url), {
      type: 'module',
    }),
): Promise<NodeLayout[]> {
  if (input.nodes.length > 100) return Promise.reject(Error('canvas.placement-invalid'));
  if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    let settled = false;
    const finish = (error?: Error, nodes?: NodeLayout[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      worker.terminate();
      worker.onmessage = null;
      worker.onerror = null;
      if (error) reject(error);
      else resolve(nodes!);
    };
    const cancel = () => finish(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(Error('canvas.placement-invalid')), 30000);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event) => {
      const data: unknown = event.data;
      const nodes = data && typeof data === 'object' && 'nodes' in data ? data.nodes : null;
      if (
        !Array.isArray(nodes) ||
        nodes.length !== input.nodes.length ||
        nodes.some((node, index) => {
          const original = input.nodes[index]!;
          return (
            !node ||
            typeof node !== 'object' ||
            node.id !== original.id ||
            node.objectId !== original.objectId ||
            node.viewId !== original.viewId ||
            node.width !== original.width ||
            node.height !== original.height ||
            !Number.isFinite(node.x) ||
            !Number.isFinite(node.y) ||
            Math.abs(node.x) > 1e7 ||
            Math.abs(node.y) > 1e7
          );
        })
      )
        finish(Error('canvas.placement-invalid'));
      else finish(undefined, nodes);
    };
    worker.onerror = () => finish(Error('canvas.placement-invalid'));
    try {
      worker.postMessage(input);
    } catch {
      finish(Error('canvas.placement-invalid'));
    }
  });
}
