import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createPanelWidthPreview } from './panel-width-preview.js';
const frames = new Map<number, FrameRequestCallback>();
let id = 0;
function tick() {
  const tasks = [...frames.values()];
  frames.clear();
  tasks.forEach((task) => task(0));
}
beforeEach(() => {
  frames.clear();
  vi.stubGlobal('requestAnimationFrame', (task: FrameRequestCallback) => {
    frames.set(++id, task);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const styles = new Map<string, string>(),
    attrs = new Map<string, string>();
  const commit = vi.fn();
  const preview = createPanelWidthPreview(
    {
      style: { setProperty: (k: string, v: string) => styles.set(k, v) },
    } as unknown as HTMLElement,
    '--width',
    { setAttribute: (k: string, v: string) => attrs.set(k, v) } as unknown as HTMLElement,
    240,
    commit,
  );
  return { styles, attrs, commit, preview };
}
describe('panel width preview lifecycle', () => {
  it('coalesces a pointer burst and commits once with the final width', () => {
    const s = setup();
    for (let n = 241; n <= 400; n++) s.preview.update(n);
    expect(frames.size).toBe(1);
    expect(s.commit).not.toHaveBeenCalled();
    tick();
    expect(s.styles.get('--width')).toBe('400px');
    expect(s.attrs.get('aria-valuenow')).toBe('400');
    s.preview.update(410);
    s.preview.finish();
    expect(frames.size).toBe(0);
    expect(s.styles.get('--width')).toBe('410px');
    expect(s.commit).toHaveBeenCalledExactlyOnceWith(410);
    s.preview.finish();
    s.preview.update(420);
    expect(s.commit).toHaveBeenCalledTimes(1);
  });
  it('cancels queued work and restores a preview without committing', () => {
    const s = setup();
    s.preview.update(320);
    tick();
    s.preview.update(400);
    s.preview.cancel();
    tick();
    expect(s.styles.get('--width')).toBe('240px');
    expect(s.attrs.get('aria-valuenow')).toBe('240');
    expect(s.commit).not.toHaveBeenCalled();
  });
});
