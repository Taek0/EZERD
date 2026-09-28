/** A single pending application per frame. State reduction (e.g. wheel deltas) stays with the caller. */
export function createFrameQueue(
  request: (callback: () => void) => number = (callback) => requestAnimationFrame(callback),
  cancel: (id: number) => void = (id) => cancelAnimationFrame(id),
) {
  let frame: number | undefined;
  let pending: (() => void) | undefined;
  const flush = () => {
    if (frame !== undefined) cancel(frame);
    frame = undefined;
    const task = pending;
    pending = undefined;
    task?.();
  };
  return {
    enqueue(task: () => void) {
      pending = task;
      if (frame === undefined) frame = request(flush);
    },
    flush,
    cancel() {
      if (frame !== undefined) cancel(frame);
      frame = undefined;
      pending = undefined;
    },
  };
}
