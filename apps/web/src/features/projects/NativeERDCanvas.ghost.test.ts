// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NativeERDCanvas } from './NativeERDCanvas.js';
import { clipboardActor, clipboardSnapshot } from './native-clipboard-test-fixtures.js';
import { routeNativeScene } from './native-ghost-routing.js';
import * as routing from '../relations/relation-routing.js';
import * as drafts from './native-editor-draft.js';
vi.mock('./native-export-state.js', () => ({ useNativeExportBlocker() {} }));
vi.mock('../../components/ui/ConfirmProvider.js', () => ({
  ConfirmProvider: ({ children }: { children: import('react').ReactNode }) => children,
  useConfirm: () => vi.fn(),
}));
let root: Root;
let host: HTMLDivElement;
const workers: any[] = [];
const save = vi.fn(() => new Promise<boolean>(() => {}));
let snapshot = clipboardSnapshot();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'Worker',
    class {
      postMessage = vi.fn();
      terminate = vi.fn();
      onmessage = null;
      onerror = null;
      constructor() {
        workers.push(this);
      }
    },
  );
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => true;
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  snapshot = clipboardSnapshot();
  save.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  workers.length = 0;
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(editable = true) {
  if (snapshot.native.status !== 'available') throw Error('fixture');
  const document = snapshot.native.document;
  await act(async () =>
    root.render(
      h(NativeERDCanvas, {
        document,
        snapshot,
        userId: clipboardActor,
        editable,
        busy: false,
        mode: 'logical',
        onSave: save,
        onReload: vi.fn(),
        onSelect: vi.fn(),
      }),
    ),
  );
}
async function pointer(type: string, x: number, y: number) {
  const card = host.querySelector<HTMLElement>('.table-node')!;
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  await act(async () => card.dispatchEvent(event));
}
async function finishWorker() {
  const worker = workers[0];
  const { key, input } = worker.postMessage.mock.calls[0][0];
  const geometries = routeNativeScene(input);
  const spy = vi.spyOn(routing, 'relationGeometry');
  spy.mockClear();
  await act(async () => worker.onmessage({ data: { key, geometries } }));
  expect(spy).not.toHaveBeenCalled();
}
it('holds a simple ghost without draft writes, then saves release coordinates once without rerouting or waiting for ACK', async () => {
  await render();
  const card = host.querySelector<HTMLElement>('.table-node')!;
  const x = parseFloat(card.style.left),
    y = parseFloat(card.style.top);
  const store = vi.spyOn(drafts, 'storeNativeEditorDraft');
  await pointer('pointerdown', 100, 100);
  await pointer('pointermove', 130, 140);
  expect(workers).toHaveLength(0);
  expect(save).not.toHaveBeenCalled();
  expect(store).not.toHaveBeenCalled();
  expect(card.style.left).toBe(x + 'px');
  expect(host.querySelector('.native-ghost-card')).toBeTruthy();
  await pointer('pointerup', 170, 180);
  expect(workers).toHaveLength(1);
  expect(save).not.toHaveBeenCalled();
  expect(host.querySelector('[role="status"]')).toBeTruthy();
  await pointer('lostpointercapture', 170, 180);
  expect(workers[0].terminate).not.toHaveBeenCalled();
  await finishWorker();
  expect(save).toHaveBeenCalledTimes(1);
  expect(host.querySelector('.native-ghost-overlay')).toBeNull();
  expect(parseFloat(host.querySelector<HTMLElement>('.table-node')!.style.left)).toBe(x + 70);
  expect(parseFloat(host.querySelector<HTMLElement>('.table-node')!.style.top)).toBe(y + 80);
});
it.each(['pointercancel', 'lostpointercapture'])(
  'cancels %s during drag with zero writes',
  async (type) => {
    await render();
    await pointer('pointerdown', 100, 100);
    await pointer('pointermove', 130, 140);
    await pointer(type, 130, 140);
    expect(workers).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
    expect(host.querySelector('.native-ghost-overlay')).toBeNull();
  },
);
it('Escape and permission changes abort pending calculation without writes', async () => {
  await render();
  await pointer('pointerdown', 100, 100);
  await pointer('pointerup', 130, 140);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
  await pointer('pointerdown', 100, 100);
  await pointer('pointerup', 130, 140);
  await render(false);
  expect(workers[1].terminate).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
});
it('no-op does not start a worker and failure leaves no draft or save', async () => {
  await render();
  await pointer('pointerdown', 100, 100);
  await pointer('pointerup', 100, 100);
  expect(workers).toHaveLength(0);
  await pointer('pointerdown', 100, 100);
  await pointer('pointerup', 130, 140);
  await act(async () => workers[0].onerror(new Event('error')));
  expect(save).not.toHaveBeenCalled();
  expect(host.querySelector('.native-ghost-overlay')).toBeNull();
});

it('persists reader-generated cards using explicit final placements', async () => {
  if (snapshot.native.status !== 'available') throw Error('fixture');
  snapshot.sourceDocument = {
    ...snapshot.native.document,
    layout: { ...snapshot.native.document.layout, nodes: [] },
  };
  await render();
  const x = parseFloat(host.querySelector<HTMLElement>('.table-node')!.style.left);
  await pointer('pointerdown', 100, 100);
  await pointer('pointerup', 170, 180);
  await finishWorker();
  expect(save).toHaveBeenCalledTimes(1);
  expect(parseFloat(host.querySelector<HTMLElement>('.table-node')!.style.left)).toBe(x + 70);
  expect(JSON.stringify(save.mock.calls[0])).toContain('add');
});
it('preserves selected group offsets and saves a single operation', async () => {
  await render();
  const cards = [...host.querySelectorAll<HTMLElement>('.table-node')];
  const original = cards.map((card) => parseFloat(card.style.left));
  await act(async () => cards[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await act(async () =>
    cards[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })),
  );
  await pointer('pointerdown', 100, 100);
  await pointer('pointerup', 170, 180);
  expect(host.querySelectorAll('.native-ghost-card')).toHaveLength(2);
  await finishWorker();
  expect(save).toHaveBeenCalledTimes(1);
  expect(
    [...host.querySelectorAll<HTMLElement>('.table-node')].map((card) =>
      parseFloat(card.style.left),
    ),
  ).toEqual(original.map((x) => x + 70));
});

it('ignores wheel during dragging and cancels a toolbar camera change before saving', async () => {
  await render();
  await pointer('pointerdown', 100, 100);
  await pointer('pointermove', 130, 140);
  await act(async () =>
    host
      .querySelector('.native-erd-surface')!
      .dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100, ctrlKey: true })),
  );
  expect(host.querySelector('.native-ghost-overlay')).toBeTruthy();
  const zoom = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
    ['Zoom in', '확대'].includes(button.getAttribute('aria-label') ?? ''),
  )!;
  expect(zoom).toBeTruthy();
  await act(async () => zoom.click());
  expect(host.querySelector('.native-ghost-overlay')).toBeNull();
  await pointer('pointerup', 170, 180);
  expect(workers).toHaveLength(0);
  expect(save).not.toHaveBeenCalled();
});

it('ignores a queued animation callback from a cancelled drag after a new drag starts', async () => {
  await render();
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  await pointer('pointerdown', 100, 100);
  await pointer('pointermove', 140, 150);
  const oldFrame = frames[frames.length - 1]!;
  await pointer('pointercancel', 140, 150);
  await pointer('pointerdown', 100, 100);
  await pointer('pointermove', 180, 190);
  const layer = host.querySelector<HTMLElement>('.native-ghost-layer')!;
  const before = layer.style.transform;
  await act(async () => oldFrame(0));
  expect(layer.style.transform).toBe(before);
  await act(async () => frames[frames.length - 1]!(0));
  expect(layer.style.transform).not.toBe(before);
  expect(save).not.toHaveBeenCalled();
});

it('discards a pending drop when only the project version changes', async () => {
  await render();
  await pointer('pointerdown', 100, 100);
  await pointer('pointerup', 140, 150);
  const worker = workers[0];
  const lateResult = worker.onmessage;
  const request = worker.postMessage.mock.calls[0][0];
  const geometries = routeNativeScene(request.input);
  snapshot = {
    ...snapshot,
    project: { ...snapshot.project, version: snapshot.project.version + 1 },
  };
  await render();
  expect(worker.terminate).toHaveBeenCalledOnce();
  await act(async () => lateResult({ data: { key: request.key, geometries } }));
  expect(save).not.toHaveBeenCalled();
  expect(host.querySelector('.native-ghost-overlay')).toBeNull();
});
