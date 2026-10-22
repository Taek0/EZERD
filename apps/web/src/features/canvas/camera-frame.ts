import type { Viewport } from '@ezerd/model';

/** Pan samples track input immediately; React only needs the last camera each frame. */
export function createCameraFrame(
  commit: (camera: Viewport) => void,
  request: (callback: FrameRequestCallback) => number = (callback) =>
    requestAnimationFrame(callback),
  cancel: (id: number) => void = (id) => cancelAnimationFrame(id),
) {
  let frame: number | null = null;
  let pending: Viewport | null = null;
  let generation = 0;
  const clear = () => {
    generation++;
    if (frame !== null) cancel(frame);
    frame = null;
  };
  const flush = () => {
    clear();
    const camera = pending;
    pending = null;
    if (camera) commit(camera);
  };
  return {
    schedule(camera: Viewport) {
      pending = camera;
      if (frame !== null) return;
      const scheduledGeneration = generation;
      frame = request(() => {
        if (scheduledGeneration === generation) flush();
      });
    },
    flush,
    cancel() {
      clear();
      pending = null;
    },
  };
}
