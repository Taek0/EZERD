import type { SelectionPoint } from './canvas-selection.js';

/** One latest pointer sample per frame; release can synchronously consume it. */
export function createSelectionFrame(
  apply: (point: SelectionPoint) => void,
  request: (callback: FrameRequestCallback) => number = (callback) =>
    requestAnimationFrame(callback),
  cancel: (id: number) => void = (id) => cancelAnimationFrame(id),
) {
  let frame: number | null = null;
  let pending: SelectionPoint | null = null;
  const flush = () => {
    if (frame !== null) cancel(frame);
    frame = null;
    const point = pending;
    pending = null;
    if (point) apply(point);
  };
  return {
    schedule(point: SelectionPoint) {
      pending = point;
      if (frame === null) frame = request(flush);
    },
    flush,
    cancel() {
      if (frame !== null) cancel(frame);
      frame = null;
      pending = null;
    },
  };
}

export function retainSelection(previous: string[], next: string[]) {
  return previous.length === next.length && previous.every((id, i) => id === next[i])
    ? previous
    : next;
}
