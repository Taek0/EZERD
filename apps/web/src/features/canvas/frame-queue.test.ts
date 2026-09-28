import { expect, it } from 'vitest';
import { createFrameQueue } from './frame-queue.js';
import { wheelCamera } from './canvas-wheel.js';
import { createTestDocument } from '../../test-utils/diagram-fixture.js';
import { updateNodeLayout } from '@ezerd/model';

function clock() {
  let id = 0;
  const jobs = new Map<number, () => void>();
  return {
    jobs,
    request: (fn: () => void) => {
      jobs.set(++id, fn);
      return id;
    },
    cancel: (key: number) => {
      jobs.delete(key);
    },
    tick: () => {
      const batch = [...jobs.values()];
      jobs.clear();
      batch.forEach((fn) => fn());
    },
  };
}
it('reduces 120 absolute moves to one preview and preserves the committed document', () => {
  const timer = clock(),
    queue = createFrameQueue(timer.request, timer.cancel);
  let doc = createTestDocument(),
    previews = 0;
  const original = doc;
  for (let x = 1; x <= 120; x++)
    queue.enqueue(() => {
      doc = updateNodeLayout(doc, 'node-t0', { x });
      previews++;
    });
  expect(timer.jobs.size).toBe(1);
  expect(previews).toBe(0);
  queue.flush(); // pointerup before the first animation frame
  const committed = doc;
  expect(previews).toBe(1);
  expect(timer.jobs.size).toBe(0);
  expect(committed).toEqual(updateNodeLayout(original, 'node-t0', { x: 120 }));
  timer.tick();
  expect(previews).toBe(1);
});
it('keeps ordered wheel reductions while only publishing once', () => {
  const timer = clock(),
    queue = createFrameQueue(timer.request, timer.cancel);
  let pending = { x: 20, y: 30, zoom: 1 },
    published = pending,
    updates = 0;
  const inputs = Array.from({ length: 120 }, (_, i) => ({
    deltaX: i % 3,
    deltaY: i % 2 ? 3 : -2,
    deltaMode: 0,
    ctrlKey: i % 4 === 0,
    metaKey: false,
    shiftKey: false,
  }));
  const expected = inputs.reduce(
    (camera, event) => wheelCamera(camera, event, { x: 400, y: 200 }, 600),
    pending,
  );
  for (const event of inputs) {
    pending = wheelCamera(pending, event, { x: 400, y: 200 }, 600);
    queue.enqueue(() => {
      published = pending;
      updates++;
    });
  }
  timer.tick();
  expect(updates).toBe(1);
  expect(published).toEqual(expected);
});
it('cancels stale work, accepts later frames and does not swallow reentrant tasks', () => {
  const timer = clock(),
    queue = createFrameQueue(timer.request, timer.cancel),
    result: number[] = [];
  queue.enqueue(() => result.push(0));
  queue.cancel();
  timer.tick();
  expect(result).toEqual([]);
  queue.enqueue(() => {
    result.push(1);
    queue.enqueue(() => result.push(2));
  });
  timer.tick();
  expect(result).toEqual([1]);
  timer.tick();
  expect(result).toEqual([1, 2]);
  queue.flush();
  expect(result).toEqual([1, 2]);
});

it('applies the pending movement to the latest document instead of overwriting intervening edits', () => {
  const timer = clock(),
    queue = createFrameQueue(timer.request, timer.cancel);
  let doc = createTestDocument();
  queue.enqueue(() => {
    doc = updateNodeLayout(doc, 'node-t0', { x: 120 });
  });
  doc = {
    ...doc,
    columns: doc.columns!.map((column, index) =>
      index ? column : { ...column, physical: { ...column.physical, name: 'remote_edit' } },
    ),
  };
  queue.flush();
  expect(doc.columns![0]!.physical.name).toBe('remote_edit');
  expect(doc.layout.nodes[0]!.x).toBe(120);
});
