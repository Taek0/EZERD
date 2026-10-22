// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement as h, StrictMode, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NativeERDCanvas } from './NativeERDCanvas.js';
import { clipboardActor, clipboardSnapshot } from './native-clipboard-test-fixtures.js';

vi.mock('./native-export-state.js', () => ({ useNativeExportBlocker() {} }));
vi.mock('./NativeCanvasScene.js', () => ({ NativeCanvasScene: () => null }));
vi.mock('../../components/ui/ConfirmProvider.js', () => ({
  ConfirmProvider: ({ children }: { children: import('react').ReactNode }) => children,
  useConfirm: () => vi.fn(),
}));
vi.mock('../../components/ui/index.js', async (original) => {
  const ui = await original<typeof import('../../components/ui/index.js')>();
  return {
    ...ui,
    ContextMenu: ({ position, items }: Parameters<typeof ui.ContextMenu>[0]) => {
      if (!position) return null;
      const action = items
        .flatMap((item) => item.children ?? [])
        .filter((item) => item.id === 'auto-layout-relations' || item.id === 'auto-layout-tables');
      return action.map((item) =>
        h(
          'button',
          { key: item.id, disabled: item.disabled, onClick: item.onAction },
          item.id === 'auto-layout-relations' ? 'arrange relations' : 'arrange tables',
        ),
      );
    },
  };
});

let root: Root;
let host: HTMLDivElement;
const workers: {
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  onmessage: Worker['onmessage'];
}[] = [];
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
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  workers.length = 0;
  localStorage.clear();
  vi.unstubAllGlobals();
});

it('starts an enabled relation arrangement after StrictMode replays effects and disposes its worker on unmount', async () => {
  const snapshot = clipboardSnapshot();
  if (snapshot.native.status !== 'available') throw Error('Expected native fixture');
  const document = snapshot.native.document;
  await act(async () =>
    root.render(
      h(
        StrictMode,
        null,
        h(NativeERDCanvas, {
          document,
          snapshot,
          userId: clipboardActor,
          editable: true,
          busy: false,
          mode: 'logical',
          onSave: vi.fn(async () => true),
          onReload: vi.fn(),
          onSelect: vi.fn(),
        }),
      ),
    ),
  );
  const surface = host.querySelector('.native-erd-surface')!;
  await act(async () =>
    surface.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 30, clientY: 30 }),
    ),
  );
  const button = [...host.querySelectorAll('button')].find(
    (item) => item.textContent === 'arrange relations',
  )!;
  expect(button).toBeTruthy();
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(workers).toHaveLength(1);
  expect(workers[0]!.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.objectContaining({
        relations: expect.arrayContaining([expect.objectContaining({ id: 'fk' })]),
      }),
    }),
  );
  expect(surface.getAttribute('data-arranging')).toBe('true');
  await act(async () => root.unmount());
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
});

it('saves a table Worker result once and discards results after a mode change', async () => {
  const snapshot = clipboardSnapshot();
  if (snapshot.native.status !== 'available') throw Error('Expected native fixture');
  const save = vi.fn(async (..._args: unknown[]) => true);
  const render = (mode: 'logical' | 'physical') =>
    root.render(
      h(
        StrictMode,
        null,
        h(NativeERDCanvas, {
          document:
            snapshot.native.status === 'available' ? snapshot.native.document : neverDocument(),
          snapshot,
          userId: clipboardActor,
          editable: true,
          busy: false,
          mode,
          onSave: save,
          onReload: vi.fn(),
          onSelect: vi.fn(),
        }),
      ),
    );
  await act(async () => render('logical'));
  const start = async () => {
    await act(async () =>
      host
        .querySelector('.native-erd-surface')!
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 30, clientY: 30 })),
    );
    const button = [...host.querySelectorAll('button')].find(
      (item) => item.textContent === 'arrange tables',
    )!;
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
  };
  await start();
  const first = workers[0]!;
  const payload = first.postMessage.mock.calls[0]![0];
  expect(payload).not.toHaveProperty('document');
  await act(async () =>
    first.onmessage!.call(
      first as unknown as Worker,
      { data: { nodes: payload.nodes } } as MessageEvent,
    ),
  );
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0]![0]).toHaveLength(payload.nodes.length);
  await start();
  const second = workers[1]!,
    late = second.onmessage!;
  await act(async () => render('physical'));
  await act(async () =>
    late.call(second as unknown as Worker, { data: { nodes: payload.nodes } } as MessageEvent),
  );
  expect(second.terminate).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledOnce();
});
function neverDocument(): never {
  throw Error('Expected native fixture');
}

async function panHarness() {
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const snapshot = clipboardSnapshot();
  if (snapshot.native.status !== 'available') throw Error('Expected native fixture');
  const props = {
    document: snapshot.native.document,
    snapshot,
    userId: clipboardActor,
    editable: true,
    busy: false,
    mode: 'logical' as const,
    onSave: vi.fn(async () => true),
    onReload: vi.fn(),
    onSelect: vi.fn(),
    requestedView: { id: '__tables__', nonce: 0 },
    selectedTableId: 'a',
    onCanvasScopeChange: vi.fn(),
  };
  const commits = vi.fn();
  const render = async () =>
    act(async () =>
      root.render(
        h(
          StrictMode,
          null,
          h(Profiler, { id: 'canvas', onRender: commits }, h(NativeERDCanvas, props)),
        ),
      ),
    );
  await render();
  const surface = host.querySelector<HTMLDivElement>('.native-erd-surface')!;
  surface.setPointerCapture = vi.fn();
  surface.hasPointerCapture = () => true;
  surface.releasePointerCapture = vi.fn();
  const pointer = async (type: string, x: number, y = 20, pointerId = 1) =>
    act(async () => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 1 });
      Object.defineProperty(event, 'pointerId', { value: pointerId });
      surface.dispatchEvent(event);
    });
  const tick = async () =>
    act(async () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(0));
    });
  const transform = () => host.querySelector<HTMLElement>('.native-erd-world')!.style.transform;
  return { frames, props, commits, render, pointer, tick, transform, surface };
}

it('commits 100 pan samples once per frame, then flushes the release coordinates', async () => {
  const ui = await panHarness();
  await ui.pointer('pointerdown', 10);
  ui.commits.mockClear();
  for (let x = 11; x <= 110; x++) await ui.pointer('pointermove', x);
  expect(ui.transform()).toBe('translate(24px, 24px) scale(1)');
  expect(ui.commits).not.toHaveBeenCalled();
  expect(ui.frames.size).toBe(1);
  await ui.tick();
  expect(ui.commits).toHaveBeenCalledOnce();
  expect(ui.transform()).toBe('translate(124px, 24px) scale(1)');
  await ui.pointer('pointermove', 120);
  await ui.pointer('pointerup', 140, 50);
  expect(ui.transform()).toBe('translate(154px, 54px) scale(1)');
  expect(ui.commits).toHaveBeenCalledTimes(2);
  expect(ui.frames.size).toBe(0);
  await ui.tick();
  expect(ui.commits).toHaveBeenCalledTimes(2);
});

it.each(['pointercancel', 'lostpointercapture'])(
  'flushes pending pan on %s and starts the next gesture from it',
  async (ending) => {
    const ui = await panHarness();
    await ui.pointer('pointerdown', 10);
    await ui.pointer('pointermove', 60);
    await ui.pointer(ending, 0);
    expect(ui.transform()).toBe('translate(74px, 24px) scale(1)');
    expect(ui.frames.size).toBe(0);
    await ui.pointer('pointerdown', 60);
    await ui.pointer('pointerup', 80);
    expect(ui.transform()).toBe('translate(94px, 24px) scale(1)');
  },
);

it('uses latest pending camera for a new pan and keeps wheel updates immediate after release', async () => {
  const ui = await panHarness();
  await ui.pointer('pointerdown', 10);
  await ui.pointer('pointermove', 60);
  await ui.pointer('pointerdown', 60);
  await ui.pointer('pointerup', 80);
  expect(ui.transform()).toBe('translate(94px, 24px) scale(1)');
  await act(async () =>
    ui.surface.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        deltaY: 10,
        clientX: 100,
        clientY: 100,
      }),
    ),
  );
  expect(ui.transform()).not.toBe('translate(94px, 24px) scale(1)');
  expect(ui.frames.size).toBe(0);
});

it.each(['user', 'project', 'view', 'unmount'])(
  'discards queued pan on %s changes under StrictMode',
  async (scope) => {
    const ui = await panHarness();
    await ui.pointer('pointerdown', 10);
    await ui.pointer('pointermove', 90);
    const staleCallbacks = [...ui.frames.values()];
    if (scope === 'user') ui.props.userId = 'other-user';
    if (scope === 'project')
      ui.props.snapshot = {
        ...ui.props.snapshot,
        project: { ...ui.props.snapshot.project, id: 'other-project' },
      };
    if (scope === 'view') ui.props.requestedView = { id: 'overview', nonce: 1 };
    if (scope === 'unmount') await act(async () => root.unmount());
    else await ui.render();
    expect(ui.frames.size).toBe(0);
    ui.commits.mockClear();
    await act(async () => staleCallbacks.forEach((callback) => callback(0)));
    expect(ui.commits).not.toHaveBeenCalled();
    if (scope !== 'unmount') {
      expect(ui.transform()).toBe('translate(24px, 24px) scale(1)');
      await ui.pointer('pointermove', 200);
      expect(ui.transform()).toBe('translate(24px, 24px) scale(1)');
    }
  },
);

it('anchors toolbar zoom to the latest pending pan and cancels its stale frame', async () => {
  const ui = await panHarness();
  ui.surface.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON() {},
  });
  await ui.pointer('pointerdown', 10);
  await ui.pointer('pointermove', 60);
  const stale = [...ui.frames.values()];
  const buttons = host.querySelectorAll<HTMLButtonElement>('.native-camera-controls button');
  // The camera controls place zoom-in directly after the percentage/reset button.
  const reset = [...buttons].findIndex((button) => button.textContent?.includes('100%'));
  expect(reset).toBeGreaterThanOrEqual(0);
  await act(async () => buttons[reset + 1]!.click());
  const values = ui
    .transform()
    .match(/-?\d+(?:\.\d+)?/g)!
    .map(Number);
  expect(values[2]).toBe(1.2);
  expect((400 - values[0]!) / values[2]!).toBeCloseTo(400 - 74);
  expect((300 - values[1]!) / values[2]!).toBeCloseTo(300 - 24);
  const zoomed = ui.transform();
  expect(ui.frames.size).toBe(0);
  await act(async () => stale.forEach((callback) => callback(0)));
  await ui.pointer('pointerup', 200);
  expect(ui.transform()).toBe(zoomed);
});

it('retains visible scope array identity when only selected table changes', async () => {
  const ui = await panHarness();
  const before = ui.props.onCanvasScopeChange.mock.lastCall![0];
  expect(before.selectedObjectId).toBe('a');
  ui.props.selectedTableId = 'b';
  await ui.render();
  const after = ui.props.onCanvasScopeChange.mock.lastCall![0];
  expect(after.selectedObjectId).toBe('b');
  expect(after.visibleObjectIds).toBe(before.visibleObjectIds);
  expect(after.visibleObjectIds).toEqual(['a', 'b']);
});
