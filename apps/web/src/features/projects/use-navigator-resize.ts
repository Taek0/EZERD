import { useEffect, useRef, useState, type HTMLAttributes } from 'react';

export const navigatorBounds = { min: 200, max: 420, default: 240 };
export function navigatorWidth(value: number) {
  return Number.isFinite(value)
    ? Math.max(navigatorBounds.min, Math.min(navigatorBounds.max, value))
    : navigatorBounds.default;
}
export function useNavigatorResize() {
  const [width, setWidth] = useState(() => {
    try {
      const stored = localStorage.getItem('ezerd.navigatorWidth');
      return stored ? navigatorWidth(Number(stored)) : navigatorBounds.default;
    } catch {
      return navigatorBounds.default;
    }
  });
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ pointer: number; x: number; width: number } | null>(null);
  useEffect(() => {
    if (resizing) return;
    try {
      localStorage.setItem('ezerd.navigatorWidth', String(width));
    } catch {
      /* Optional preference. */
    }
  }, [width, resizing]);
  const finish = () => {
    drag.current = null;
    setResizing(false);
  };
  const separator: HTMLAttributes<HTMLDivElement> = {
    role: 'separator',
    tabIndex: 0,
    'aria-orientation': 'vertical',
    'aria-valuemin': navigatorBounds.min,
    'aria-valuemax': navigatorBounds.max,
    'aria-valuenow': width,
    onPointerDown(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointer: event.pointerId, x: event.clientX, width };
      setResizing(true);
    },
    onPointerMove(event) {
      if (drag.current?.pointer !== event.pointerId) return;
      setWidth(navigatorWidth(drag.current.width + event.clientX - drag.current.x));
    },
    onPointerUp(event) {
      if (drag.current?.pointer !== event.pointerId) return;
      finish();
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: finish,
    onLostPointerCapture: finish,
    onDoubleClick: () => setWidth(navigatorBounds.default),
    onKeyDown(event) {
      const step = event.shiftKey ? 40 : 10;
      const next =
        event.key === 'Home'
          ? navigatorBounds.min
          : event.key === 'End'
            ? navigatorBounds.max
            : event.key === 'ArrowLeft'
              ? width - step
              : event.key === 'ArrowRight'
                ? width + step
                : null;
      if (next !== null) {
        event.preventDefault();
        setWidth(navigatorWidth(next));
      }
    },
  };
  return { width, resizing, separator };
}
