// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement as h, StrictMode } from 'react';
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
