import { useEffect, useRef, type HTMLAttributes, type RefObject } from 'react';
import { createPanelWidthPreview } from '../../shared/editor/panel-width-preview.js';
import { clampInspectorWidth, inspectorBounds } from '../canvas/inspector-state.js';

export function useInspectorResize(
  host: RefObject<HTMLDivElement | null>,
  width: number,
  workspaceWidth: number,
  commit: (width: number) => void,
  setResizing: (resizing: boolean) => void,
): HTMLAttributes<HTMLDivElement> {
  const drag = useRef<{
    pointer: number;
    x: number;
    width: number;
    preview: ReturnType<typeof createPanelWidthPreview>;
  } | null>(null);
  useEffect(() => () => drag.current?.preview.cancel(), []);
  const update = (x: number) => {
    const current = drag.current;
    if (current)
      current.preview.update(clampInspectorWidth(current.width + current.x - x, workspaceWidth));
  };
  const finish = () => {
    const current = drag.current;
    drag.current = null;
    current?.preview.finish();
    setResizing(false);
  };
  return {
    onPointerDown(event) {
      if (event.button !== 0 || drag.current || !host.current) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        pointer: event.pointerId,
        x: event.clientX,
        width,
        preview: createPanelWidthPreview(
          host.current,
          '--native-inspector-width',
          event.currentTarget,
          width,
          commit,
        ),
      };
      setResizing(true);
    },
    onPointerMove(event) {
      if (drag.current?.pointer === event.pointerId) update(event.clientX);
    },
    onPointerUp(event) {
      if (drag.current?.pointer !== event.pointerId) return;
      update(event.clientX);
      finish();
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel(event) {
      if (drag.current?.pointer === event.pointerId) finish();
    },
    onLostPointerCapture(event) {
      if (drag.current?.pointer === event.pointerId) finish();
    },
    onKeyDown(event) {
      if (drag.current) return;
      const bounds = inspectorBounds(workspaceWidth),
        step = event.shiftKey ? 40 : 10;
      const next =
        event.key === 'Home'
          ? bounds.min
          : event.key === 'End'
            ? bounds.max
            : event.key === 'ArrowLeft'
              ? width + step
              : event.key === 'ArrowRight'
                ? width - step
                : null;
      if (next !== null) {
        event.preventDefault();
        commit(clampInspectorWidth(next, workspaceWidth));
      }
    },
  };
}
