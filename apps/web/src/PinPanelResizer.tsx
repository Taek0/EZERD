import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';

type Props = {
  width: number;
  onWidthChange: (width: number) => void;
  onResizingChange?: (resizing: boolean) => void;
};
export function PinPanelResizer({ width, onWidthChange, onResizingChange }: Props) {
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
        ? width + step
        : event.key === 'ArrowRight'
          ? width - step
          : event.key === 'Home'
            ? 280
            : event.key === 'End'
              ? 560
              : null;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    onWidthChange(next);
  }
  return (
    <div
      className="pin-panel-resizer"
      role="separator"
      aria-label="핀 패널 너비 조절"
      aria-orientation="vertical"
      aria-valuemin={280}
      aria-valuemax={560}
      aria-valuenow={width}
      aria-valuetext={width + 'px'}
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
        onWidthChange(active.startWidth + active.startX - event.clientX);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    />
  );
}
