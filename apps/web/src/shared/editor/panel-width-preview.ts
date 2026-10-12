/** Paint a drag preview without re-rendering the editor owning the width state. */
export function createPanelWidthPreview(
  host: HTMLElement,
  property: string,
  separator: HTMLElement,
  initial: number,
  commit: (width: number) => void,
) {
  let width = initial;
  let frame: number | null = null;
  let ended = false;
  const paint = () => {
    frame = null;
    host.style.setProperty(property, `${width}px`);
    separator.setAttribute('aria-valuenow', String(width));
    separator.setAttribute('aria-valuetext', `${width}px`);
  };
  return {
    update(next: number) {
      if (ended || next === width) return;
      width = next;
      if (frame === null) frame = requestAnimationFrame(paint);
    },
    finish() {
      if (ended) return;
      ended = true;
      if (frame !== null) cancelAnimationFrame(frame);
      paint();
      commit(width);
    },
    cancel() {
      if (ended) return;
      ended = true;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      host.style.setProperty(property, `${initial}px`);
      separator.setAttribute('aria-valuenow', String(initial));
      separator.setAttribute('aria-valuetext', `${initial}px`);
    },
  };
}
