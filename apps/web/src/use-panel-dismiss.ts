import { useEffect, useRef, useState } from 'react';

export function usePanelDismiss(onClose: () => void, enabled = true) {
  const ref = useRef<HTMLElement>(null);
  const callback = useRef(onClose);
  callback.current = onClose;
  const [closing, setClosing] = useState(false);
  const close = () => setClosing(true);
  useEffect(() => {
    if (!enabled) {
      setClosing(false);
      return;
    }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current && !ref.current.contains(event.target))
        setClosing(true);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setClosing(true);
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [enabled]);
  useEffect(() => {
    if (!closing || !enabled) return;
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160;
    const timer = window.setTimeout(() => callback.current(), delay);
    return () => window.clearTimeout(timer);
  }, [closing, enabled]);
  return { ref, closing, close };
}
