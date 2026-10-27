// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { NodeLayout } from '@ezerd/model';
import { createGhostDragPrototype } from './ghost-drag-prototype.js';

const node = (id: string, x = 100, y = 200): NodeLayout => ({
  id,
  objectId: id,
  viewId: 'overview',
  x,
  y,
  width: 240,
  height: 180,
});
function fixture(nodes = [node('a')], zoom = 2) {
  const original = document.createElement('div');
  original.style.transform = 'translate(100px, 200px)';
  original.innerHTML = '<button>Original interactive card</button>';
  const before = original.outerHTML;
  const ghost = document.createElement('div');
  ghost.textContent = 'Table preview';
  document.body.append(original, ghost);
  const frames = new Map<number, () => void>();
  let serial = 0;
  const commit = vi.fn();
  const transform = vi.fn((x: number, y: number) => {
    ghost.style.transform = `translate(${x}px, ${y}px)`;
  });
  const remove = vi.fn(() => ghost.remove());
  const start = {
    pointerId: 7,
    clientX: 50 + (nodes[0]!.x + 12) * zoom,
    clientY: 30 + (nodes[0]!.y + 18) * zoom,
  };
  const controller = createGhostDragPrototype({
    nodes,
    zoom,
    origin: { x: 50, y: 30 },
    start,
    commit,
    transform,
    remove,
    requestFrame: (cb) => {
      frames.set(++serial, cb);
      return serial;
    },
    cancelFrame: (id) => {
      frames.delete(id);
    },
  });
  return {
    controller,
    original,
    before,
    ghost,
    frames,
    commit,
    transform,
    remove,
    event: (x: number, y: number, pointerId = 7) => ({
      pointerId,
      clientX: start.clientX + x * zoom,
      clientY: start.clientY + y * zoom,
    }),
    flush: () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((cb) => cb());
    },
  };
}

describe('lab ghost preview contract (not a React scene performance baseline)', () => {
  it.each([0.1, 0.15, 0.25, 1, 2, 4])(
    'tracks measured coordinates and grab offset at zoom %s, coalesces RAF and commits final release once',
    (zoom) => {
      const nodes = [node('a'), node('b', 450, 320)];
      const snapshot = structuredClone(nodes);
      const f = fixture(nodes, zoom);
      for (let i = 4; i <= 120; i++) f.controller.move(f.event(i, i / 2));
      expect(f.frames.size).toBe(1);
      expect(f.commit).not.toHaveBeenCalled();
      expect(f.transform).not.toHaveBeenCalled();
      f.flush();
      expect(f.ghost.style.transform).toBe('translate(120px, 60px)');
      f.controller.move(f.event(130, 65));
      f.controller.up(f.event(150, 80));
      f.controller.up(f.event(170, 90));
      f.flush();
      expect(f.commit).toHaveBeenCalledTimes(1);
      const placements = f.commit.mock.calls[0]![0] as NodeLayout[];
      for (const [index, expected] of [node('a', 250, 280), node('b', 600, 400)].entries()) {
        expect(placements[index]!.x).toBeCloseTo(expected.x, 10);
        expect(placements[index]!.y).toBeCloseTo(expected.y, 10);
        expect({ ...placements[index], x: expected.x, y: expected.y }).toEqual(expected);
      }
      expect(f.transform).toHaveBeenCalledTimes(1);
      expect(f.remove).toHaveBeenCalledTimes(1);
      expect(f.ghost.isConnected).toBe(false);
      expect(f.original.outerHTML).toBe(f.before);
      expect(nodes).toEqual(snapshot);
    },
  );
  it.each(['pointerCancel', 'lostCapture', 'escape', 'scope'] as const)(
    'removes ghost and pending frame without commit on %s',
    (reason) => {
      const f = fixture();
      f.controller.move(f.event(100, 50));
      if (reason === 'escape') f.controller.keydown('Escape');
      else if (reason === 'scope') f.controller.invalidateScope();
      else f.controller[reason]({ pointerId: 7 });
      f.flush();
      f.controller.up(f.event(120, 60));
      expect(f.commit).not.toHaveBeenCalled();
      expect(f.transform).not.toHaveBeenCalled();
      expect(f.remove).toHaveBeenCalledTimes(1);
      expect(f.original.outerHTML).toBe(f.before);
    },
  );
  it('ignores other pointers and preserves the four-world-unit Manhattan threshold', () => {
    const f = fixture();
    f.controller.move(f.event(100, 100, 8));
    f.controller.up(f.event(100, 100, 8));
    f.controller.lostCapture({ pointerId: 8 });
    f.controller.move(f.event(1, 2));
    expect(f.frames.size).toBe(0);
    f.controller.up(f.event(1, 2));
    expect(f.commit).not.toHaveBeenCalled();
    const g = fixture();
    g.controller.up(g.event(2, 2));
    expect(g.commit).toHaveBeenCalledTimes(1);
  });
  it('clamps the whole group at coordinate bounds without changing spacing', () => {
    const f = fixture([node('a', 1e7 - 500, -1e7 + 100), node('b', 1e7 - 50, -1e7 + 300)]);
    f.controller.move(f.event(1000, -1000));
    f.flush();
    expect(f.ghost.style.transform).toBe('translate(50px, -100px)');
    f.controller.up(f.event(2000, -2000));
    expect(f.commit.mock.calls[0]![0]).toEqual([
      node('a', 1e7 - 450, -1e7),
      node('b', 1e7, -1e7 + 200),
    ]);
  });
  it('does not commit when returned to origin after crossing threshold', () => {
    const f = fixture();
    f.controller.move(f.event(20, 20));
    f.controller.up(f.event(0, 0));
    expect(f.commit).not.toHaveBeenCalled();
  });
});
