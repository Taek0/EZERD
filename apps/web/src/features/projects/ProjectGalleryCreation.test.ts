import { isValidElement, type ReactElement, type ComponentProps } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectGallery, type GalleryHandle } from './ProjectGallery.js';
const driver = vi.hoisted(() => ({
  slots: [] as { value?: unknown; deps?: readonly unknown[] }[],
  cursor: 0,
  effects: [] as (() => void)[],
}));
vi.mock('../../shared/i18n/index.js', () => ({
  registerTranslations() {},
  useI18n: () => ({ t: (value: string) => value, locale: 'ko' }),
}));
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  const effect = (run: () => void, deps: readonly unknown[]) => {
    const slot = (driver.slots[driver.cursor++] ??= {});
    if (!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps![index]))) {
      slot.deps = deps;
      driver.effects.push(run);
    }
  };
  return {
    ...react,
    useState(initial: unknown) {
      const slot = (driver.slots[driver.cursor++] ??= {
        value: typeof initial === 'function' ? initial() : initial,
      });
      return [
        slot.value,
        (value: unknown) => {
          slot.value = typeof value === 'function' ? value(slot.value) : value;
        },
      ];
    },
    useRef(initial: unknown) {
      return (driver.slots[driver.cursor++] ??= { value: { current: initial } }).value;
    },
    useEffect: effect,
    useLayoutEffect: effect,
    useImperativeHandle(ref: { current: unknown }, create: () => unknown) {
      ref.current = create();
    },
  };
});
function nodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
function harness() {
  const onCreate = vi.fn(async (_name: string, _kind: string, _options: unknown) => {}),
    onEdit = vi.fn(async () => true);
  const handle = { current: null as GalleryHandle | null };
  const props: ComponentProps<typeof ProjectGallery> = {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    projects: [],
    loading: false,
    busy: false,
    canEdit: true,
    canDelete: true,
    status: 'active',
    search: '',
    onSearch: vi.fn(),
    onStatus: vi.fn(),
    onCreate,
    onEdit,
    onOpen() {},
    onExport() {},
    onArchive() {},
    onDelete() {},
    onImported() {},
  };
  function render() {
    driver.cursor = 0;
    const tree = (
      ProjectGallery as unknown as {
        render: (input: ComponentProps<typeof ProjectGallery>, target: typeof handle) => unknown;
      }
    ).render(props, handle);
    driver.effects.splice(0).forEach((effect) => effect());
    return nodes(tree);
  }
  async function begin() {
    const create = render().find((node) => node.props.className === 'erd-new-card')!;
    (create.props.onClick as () => void)();
    await Promise.resolve();
    await Promise.resolve();
  }
  return { props, render, begin, handle, onCreate, onEdit };
}
beforeEach(() => {
  driver.slots = [];
  driver.cursor = 0;
  driver.effects = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
describe('gallery native creation callback consumption', () => {
  it('defaults to native, preserves DB selection and auto-flushes the explicit creation option', async () => {
    const h = harness();
    await h.begin();
    expect(
      h.render().find((node) => node.type === 'select' && node.props['aria-label'] === '설계 형식')!
        .props.value,
    ).toBe(2);
    const database = h.render().find((node) => node.props.label === '데이터베이스 선택')!;
    (database.props.items as { id: string; onAction: () => void }[])
      .find((item) => item.id === 'mysql')!
      .onAction();
    const tree = h.render();
    (tree.find((node) => node.type === 'main')!.props.onClickCapture as (event: unknown) => void)({
      target: { closest: () => null },
    });
    await h.handle.current!.flush();
    expect(h.onCreate).toHaveBeenCalledTimes(1);
    expect(h.onCreate).toHaveBeenCalledWith('', 'mysql', { formatVersion: 2 });
    expect(h.props.onStatus).toHaveBeenCalledWith('active');
    expect(h.props.onSearch).toHaveBeenCalledWith('');
    expect(h.handle.current!.hasDraft()).toBe(false);
  });
  it('sends explicit v1 compatibility selection and keeps the name input lifecycle', async () => {
    const h = harness();
    await h.begin();
    const format = h.render().find((node) => node.type === 'select')!;
    (format.props.onChange as (event: unknown) => void)({ target: { value: '1' } });
    const name = h.render().find((node) => node.props.className === 'inline-name')!;
    (name.props.onChange as (event: unknown) => void)({ target: { value: '  Legacy design  ' } });
    await h.handle.current!.flush();
    expect(h.onCreate).toHaveBeenCalledWith('Legacy design', 'postgresql', { formatVersion: 1 });
    expect(h.onEdit).not.toHaveBeenCalled();
  });
  it('retains failed native creation input for retry without creating a second simultaneous request', async () => {
    const h = harness();
    await h.begin();
    let reject!: (error: Error) => void;
    h.onCreate.mockImplementationOnce(
      () =>
        new Promise((_done, fail) => {
          reject = fail;
        }),
    );
    const first = h.handle.current!.flush(),
      second = h.handle.current!.flush();
    expect(h.onCreate).toHaveBeenCalledTimes(1);
    reject(Error('Create failed'));
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(h.handle.current!.hasDraft()).toBe(true);
    expect(h.render().some((node) => node.props.role === 'alert')).toBe(true);
    expect(await h.handle.current!.flush()).toBe(true);
    expect(h.onCreate).toHaveBeenCalledTimes(2);
  });
});
