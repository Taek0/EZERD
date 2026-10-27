import type { NodeLayout } from '@ezerd/model';
import { nativeSelectionPlacements } from '../../features/projects/native-canvas-selection.js';

type Sample = { pointerId: number; clientX: number; clientY: number };
/** Lab only: host supplies measured world nodes and a frozen world-to-client origin. */
export function createGhostDragPrototype(options: {
  nodes: NodeLayout[];
  start: Sample;
  zoom: number;
  origin: { x: number; y: number };
  requestFrame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
  transform: (dx: number, dy: number) => void;
  remove: () => void;
  commit: (placements: NodeLayout[]) => void;
}) {
  if (!options.nodes.length || !Number.isFinite(options.zoom) || options.zoom <= 0)
    throw Error('Invalid ghost drag inputs');
  const nodes = options.nodes.map((node) => ({ ...node }));
  const anchor = nodes[0]!;
  const offset = {
    x: (options.start.clientX - options.origin.x) / options.zoom - anchor.x,
    y: (options.start.clientY - options.origin.y) / options.zoom - anchor.y,
  };
  let active = true;
  let crossedThreshold = false;
  let frame: number | undefined;
  let delta = { x: 0, y: 0 };
  function sample(event: Sample) {
    if (!active || event.pointerId !== options.start.pointerId) return false;
    const x = (event.clientX - options.origin.x) / options.zoom - offset.x - anchor.x;
    const y = (event.clientY - options.origin.y) / options.zoom - offset.y - anchor.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (!crossedThreshold && Math.abs(x) + Math.abs(y) < 4) return true;
    crossedThreshold = true;
    const placement = nativeSelectionPlacements(nodes, x, y)[0]!;
    delta = { x: placement.x - anchor.x, y: placement.y - anchor.y };
    return true;
  }
  function cleanup() {
    active = false;
    if (frame !== undefined) options.cancelFrame(frame);
    frame = undefined;
    options.remove();
  }
  function cancel() {
    if (active) cleanup();
  }
  return {
    move(event: Sample) {
      if (!sample(event) || !crossedThreshold || frame !== undefined) return;
      frame = options.requestFrame(() => {
        frame = undefined;
        if (active) options.transform(delta.x, delta.y);
      });
    },
    up(event: Sample) {
      if (!sample(event)) return;
      cleanup();
      if (crossedThreshold && (delta.x !== 0 || delta.y !== 0))
        options.commit(nativeSelectionPlacements(nodes, delta.x, delta.y));
    },
    pointerCancel(event: Pick<Sample, 'pointerId'>) {
      if (event.pointerId === options.start.pointerId) cancel();
    },
    lostCapture(event: Pick<Sample, 'pointerId'>) {
      if (event.pointerId === options.start.pointerId) cancel();
    },
    keydown(key: string) {
      if (key === 'Escape') cancel();
    },
    invalidateScope: cancel,
  };
}
