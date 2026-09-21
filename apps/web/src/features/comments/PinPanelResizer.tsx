import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { commentsPanelBounds } from './comments-panel-size.js';

type Props = {
  width: number;
  onWidthChange: (width: number) => void;
  onResizingChange?: (resizing: boolean) => void;
};
export function PinPanelResizer({ width, onWidthChange, onResizingChange }: Props) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(1400);
  const bounds = commentsPanelBounds(workspaceWidth);
  const displayedWidth = Math.min(bounds.max, Math.max(bounds.min, width));
  const changeWidth = (next: number) =>
    onWidthChange(Math.min(bounds.max, Math.max(bounds.min, next)));
  useEffect(() => {
    const workspace = elementRef.current?.parentElement?.parentElement;
    if (!workspace) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWorkspaceWidth(entry.contentRect.width);
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const resizingCallback = useRef(onResizingChange);
  resizingCallback.current = onResizingChange;
  useEffect(
    () => () => {
      if (drag.current) {
        drag.current = null;
        resizingCallback.current?.(false);
      }
    },
    [],
  );
  function finish(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    onResizingChange?.(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function keydown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 40 : 10;
    const next =
      event.key === 'ArrowLeft'
        ? displayedWidth + step
        : event.key === 'ArrowRight'
          ? displayedWidth - step
          : event.key === 'Home'
            ? bounds.min
            : event.key === 'End'
              ? bounds.max
              : null;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    changeWidth(next);
  }
  return (
    <div
      ref={elementRef}
      className="pin-panel-resizer"
      role="separator"
      aria-label="핀 패널 너비 조절"
      aria-orientation="vertical"
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={displayedWidth}
      aria-valuetext={displayedWidth + 'px'}
      tabIndex={0}
      onKeyDown={keydown}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0 || drag.current) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: event.currentTarget.parentElement?.getBoundingClientRect().width ?? width,
        };
        onResizingChange?.(true);
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        changeWidth(active.startWidth + active.startX - event.clientX);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    />
  );
}
