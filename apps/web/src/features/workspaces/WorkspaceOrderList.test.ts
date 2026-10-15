import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { WorkspaceOrderList } from './WorkspaceOrderList.js';
import type { Workspace } from './workspace-policy.js';
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../shared/api/client.js', () => ({
  request: api.request,
  body: (method: string, value: unknown) => ({ method, body: JSON.stringify(value) }),
  message: (error: Error) => error.message,
}));
vi.mock('../../shared/i18n/index.js', () => ({
  registerTranslations() {},
  useI18n: () => ({ t: (text: string) => text }),
}));
const driver = vi.hoisted(() => ({
  slots: [] as {
    value?: unknown;
    deps?: readonly unknown[] | undefined;
    cleanup?: (() => void) | undefined;
  }[],
  cursor: 0,
  effects: [] as (() => void)[],
}));
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return {
    ...react,
    useState(initial: unknown) {
      const slot = (driver.slots[driver.cursor++] ??= {
        value: typeof initial === 'function' ? initial() : initial,
      });
      return [
        slot.value,
        (next: unknown) => {
          slot.value = typeof next === 'function' ? next(slot.value) : next;
        },
      ];
    },
    useRef(initial: unknown) {
      return (driver.slots[driver.cursor++] ??= { value: { current: initial } }).value;
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      const slot = (driver.slots[driver.cursor++] ??= {});
      if (!deps || !slot.deps || deps.some((item, index) => !Object.is(item, slot.deps![index]))) {
        driver.effects.push(() => {
          slot.cleanup?.();
          slot.cleanup = effect() || undefined;
        });
        slot.deps = deps;
      }
    },
    useLayoutEffect() {},
    useMemo(factory: () => unknown, deps: readonly unknown[]) {
      const slot = (driver.slots[driver.cursor++] ??= {});
      if (!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps![index]))) {
        slot.value = factory();
        slot.deps = deps;
      }
      return slot.value;
    },
  };
});

function elements(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...elements(tree.props.children)];
}
const spaces: Workspace[] = ['a', 'b', 'c'].map((id) => ({
  id,
  name: id,
  role: 'owner',
  status: 'active',
  createdAt: '',
  updatedAt: '',
}));
function mount() {
  let props = {
    workspaces: spaces,
    selectedId: 'a',
    onSelect: vi.fn(),
    onRefresh: vi.fn(),
    refreshKey: '',
  };
  let nodes: ReactElement<Record<string, unknown>>[];
  const render = () => {
    driver.cursor = 0;
    nodes = elements(WorkspaceOrderList(props));
    driver.effects.splice(0).forEach((effect) => effect());
  };
  render();
  const key = (key: string) => {
    const handles = nodes.filter((node) => node.props.className === 'workspace-drag-handle');
    (handles.find((node) => node.key === null)!.props.onKeyDown as Function)({
      key,
      preventDefault() {},
      stopPropagation() {},
    });
    render();
  };
  const order = () => nodes.filter((node) => node.type === 'li').map((node) => node.key);
  return {
    props,
    render,
    key,
    order,
    nodes: () => nodes,
    update: (workspaces: Workspace[]) => {
      props = { ...props, workspaces };
      render();
      render();
    },
  };
}
beforeEach(() => {
  driver.slots = [];
  driver.cursor = 0;
  driver.effects = [];
  api.request.mockReset();
});
afterEach(() => {
  driver.slots.forEach((slot) => slot.cleanup?.());
});
it('keyboard reorder previews without selecting and saves the complete order once', async () => {
  api.request.mockResolvedValue([spaces[1], spaces[0], spaces[2]]);
  const ui = mount();
  ui.key(' ');
  ui.key('ArrowDown');
  expect(ui.order()).toEqual(['b', 'a', 'c']);
  // Keep acting on the grabbed handle after it moves.
  const handle = ui
    .nodes()
    .find(
      (node) =>
        node.props.className === 'workspace-drag-handle' && node.props['aria-pressed'] === true,
    )!;
  (handle.props.onKeyDown as Function)({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
  await Promise.resolve();
  ui.render();
  expect(api.request).toHaveBeenCalledTimes(1);
  expect(JSON.parse(api.request.mock.calls[0]![1].body)).toEqual({ workspaceIds: ['b', 'a', 'c'] });
  expect(ui.props.onSelect).not.toHaveBeenCalled();
  expect(ui.props.onRefresh).toHaveBeenCalledTimes(1);
});
it('escape restores order without a request', () => {
  const ui = mount();
  ui.key(' ');
  ui.key('End');
  const handle = ui.nodes().find((node) => node.props['aria-pressed'] === true)!;
  (handle.props.onKeyDown as Function)({
    key: 'Escape',
    preventDefault() {},
    stopPropagation() {},
  });
  ui.render();
  expect(ui.order()).toEqual(['a', 'b', 'c']);
  expect(api.request).not.toHaveBeenCalled();
});
it('failed save rolls back and exposes the error', async () => {
  api.request.mockRejectedValue(new Error('Offline'));
  const ui = mount();
  ui.key(' ');
  ui.key('ArrowDown');
  const handle = ui.nodes().find((node) => node.props['aria-pressed'] === true)!;
  (handle.props.onKeyDown as Function)({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
  await Promise.resolve();
  ui.render();
  expect(ui.order()).toEqual(['a', 'b', 'c']);
  expect(ui.nodes().find((node) => node.props.role === 'alert')?.props.children).toBe('Offline');
});
it('remote membership updates cancel in-flight save acknowledgements', async () => {
  let resolve!: (value: Workspace[]) => void;
  api.request.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const ui = mount();
  ui.key(' ');
  ui.key('ArrowDown');
  const handle = ui.nodes().find((node) => node.props['aria-pressed'] === true)!;
  (handle.props.onKeyDown as Function)({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
  ui.update([spaces[2]!, spaces[0]!]);
  resolve([spaces[1]!, spaces[0]!, spaces[2]!]);
  await Promise.resolve();
  ui.render();
  expect(ui.order()).toEqual(['c', 'a']);
  expect(ui.props.onRefresh).not.toHaveBeenCalled();
  expect(api.request.mock.calls[0]![1].signal.aborted).toBe(false);
});

it('pointer capture moves only via the handle and cancellation restores the saved order', () => {
  const ui = mount();
  ui.nodes()
    .filter((node) => node.type === 'li')
    .forEach((node, index) => {
      (node.props.ref as Function)({
        style: { transform: '' },
        offsetTop: index * 60,
        offsetHeight: 60,
        offsetParent: { getBoundingClientRect: () => ({ top: 0 }) },
        getBoundingClientRect: () => ({ top: index * 60, height: 60 }),
      });
    });
  const handle = ui.nodes().find((node) => node.props.className === 'workspace-drag-handle')!;
  const capture = vi.fn();
  const list = ui.nodes().find((node) => node.type === 'ol')!;
  (list.props.ref as { current: unknown }).current = { setPointerCapture: capture };
  (handle.props.onPointerDown as Function)({
    button: 0,
    pointerId: 7,
    clientY: 20,
    preventDefault() {},
    currentTarget: { setPointerCapture: capture },
  });
  (list.props.onPointerMove as Function)({ pointerId: 7, clientY: 170 });
  ui.render();
  expect(capture).toHaveBeenCalledWith(7);
  expect(ui.order()).toEqual(['b', 'c', 'a']);
  expect(ui.props.onSelect).not.toHaveBeenCalled();
  (list.props.onPointerCancel as Function)();
  ui.render();
  expect(ui.order()).toEqual(['a', 'b', 'c']);
  expect(api.request).not.toHaveBeenCalled();
});
