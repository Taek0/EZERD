import { useLayoutEffect, useRef, useState } from 'react';

/** Retain a closing grid's contents until its existing CSS transition completes. */
export function retainClosingNavigator(element: HTMLElement, release: () => void) {
  const focused = element.ownerDocument.activeElement;
  if (focused && element.contains(focused)) {
    const trigger = Array.from(
      element.parentElement?.querySelectorAll<HTMLButtonElement>('button[aria-controls]') ?? [],
    ).find((button) => button.getAttribute('aria-controls') === element.id);
    trigger?.focus({ preventScroll: true });
  }
  const style = getComputedStyle(element);
  const milliseconds = (value: string) =>
    value.split(',').map((part) => parseFloat(part) * (part.trim().endsWith('ms') ? 1 : 1000) || 0);
  const durations = milliseconds(style.transitionDuration),
    delays = milliseconds(style.transitionDelay);
  const duration = Math.max(
    0,
    ...durations.map((value, index) => value + delays[index % delays.length]!),
  );
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    active = false;
    if (timer !== undefined) clearTimeout(timer);
    element.removeEventListener('transitionend', end);
  };
  const finish = () => {
    if (!active) return;
    cleanup();
    release();
  };
  const end = (event: TransitionEvent) => {
    if (event.target === element && event.propertyName === 'grid-template-rows') finish();
  };
  if (duration === 0) {
    finish();
    return cleanup;
  }
  element.addEventListener('transitionend', end);
  // Hidden/background surfaces may not deliver transitionend. Never retain the tree forever.
  timer = setTimeout(finish, duration + 50);
  return cleanup;
}

export function useNavigatorPresence(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [retained, setRetained] = useState(open);
  useLayoutEffect(() => {
    if (open) {
      setRetained(true);
      return;
    }
    if (!ref.current) {
      setRetained(false);
      return;
    }
    return retainClosingNavigator(ref.current, () => setRetained(false));
  }, [open]);
  return { ref, present: open || retained };
}
