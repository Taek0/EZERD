import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeERDCanvas } from './NativeERDCanvas.js';
import { NativeCanvasScene } from './NativeCanvasScene.js';
import { NativeCameraControls } from './NativeCanvasToolbar.js';
import { clipboardActor, clipboardSnapshot } from './native-clipboard-test-fixtures.js';
import { IDBFactory } from 'fake-indexeddb';
import { getNativeDurableQueue } from './native-durable-queue.js';
import type { NativeSceneActions } from './NativeCanvasScene.js';
import { extractPersonalState, type NodeLayout } from '@ezerd/model';
const personalApi = vi.hoisted(() => vi.fn());

// Run the actual component's event handlers and effect dependency graph without a browser.
const hooks = vi.hoisted(() => ({
  cursor: 0,
  dirty: false,
  slots: [] as {
    value?: unknown;
    deps?: readonly unknown[] | undefined;
    cleanup?: (() => void) | undefined;
  }[],
  layouts: [] as (() => void)[],
  effects: [] as (() => void)[],
}));
vi.mock('./native-export-state.js', () => ({ useNativeExportBlocker() {} }));
vi.mock('./native-actor-api.js', () => ({
  captureNativeActorApi: () => personalApi,
}));
vi.mock('../../shared/i18n/index.js', () => ({
  registerTranslations() {},
  useI18n: () => ({ t: (value: string) => value, locale: 'en' }),
}));
vi.mock('../../components/ui/ConfirmProvider.js', () => ({
  ConfirmProvider: ({ children }: { children: unknown }) => children,
  useConfirm: () => vi.fn(async () => true),
}));
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  function changed(previous: readonly unknown[] | undefined, next?: readonly unknown[]) {
    return (
      !previous ||
      !next ||
      previous.length !== next.length ||
      next.some((value, i) => !Object.is(value, previous[i]))
    );
  }
  function effect(
    callback: () => void | (() => void),
    deps: readonly unknown[] | undefined,
    layout: boolean,
  ) {
    const slot = (hooks.slots[hooks.cursor++] ??= {});
    if (changed(slot.deps, deps)) {
      (layout ? hooks.layouts : hooks.effects).push(() => {
        slot.cleanup?.();
        slot.cleanup = callback() || undefined;
      });
      slot.deps = deps;
    }
  }
  function memo(factory: () => unknown, deps: readonly unknown[]) {
    const slot = (hooks.slots[hooks.cursor++] ??= {});
    if (changed(slot.deps, deps)) {
      slot.value = factory();
      slot.deps = deps;
    }
    return slot.value;
  }
  return {
    ...react,
    useState(initial: unknown) {
      const slot = (hooks.slots[hooks.cursor++] ??= {
        value: typeof initial === 'function' ? initial() : initial,
      });
      return [
        slot.value,
        (value: unknown) => {
          const next = typeof value === 'function' ? value(slot.value) : value;
          if (!Object.is(slot.value, next)) hooks.dirty = true;
          slot.value = next;
        },
      ];
    },
    useRef(initial: unknown) {
      return (hooks.slots[hooks.cursor++] ??= { value: { current: initial } }).value;
    },
    useMemo: memo,
    useCallback: (callback: unknown, deps: readonly unknown[]) => memo(() => callback, deps),
    useEffect: (callback: () => void, deps?: readonly unknown[]) => effect(callback, deps, false),
    useLayoutEffect: (callback: () => void, deps?: readonly unknown[]) =>
      effect(callback, deps, true),
  };
});

const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
function flushFrame() {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(0));
}
class Target {
  constructor(private selector = '') {}
  closest(selector: string) {
    return this.selector && selector.split(',').includes(this.selector) ? this : null;
  }
}
function nodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
beforeEach(() => {
  personalApi.mockReset().mockImplementation(() => new Promise(() => {}));
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size;
    },
  });
  vi.stubGlobal('indexedDB', new IDBFactory());
  hooks.cursor = 0;
  hooks.dirty = false;
  hooks.slots = [];
  hooks.layouts = [];
  hooks.effects = [];
  vi.stubGlobal('Element', Target);
  frames.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(async () => {
  hooks.slots.forEach((slot) => slot.cleanup?.());
  await getNativeDurableQueue().close();
  vi.unstubAllGlobals();
});

function canvas(authenticated = false) {
  const snapshot = clipboardSnapshot();
  if (snapshot.native?.status !== 'available') throw Error('Expected native document');
  const props: Parameters<typeof NativeERDCanvas>[0] = {
    ...(authenticated ? { userId: clipboardActor } : {}),
    document: snapshot.native.document,
    snapshot,
    editable: true,
    busy: false,
    mode: 'logical',
    onSave: vi.fn(async () => true),
    onReload: vi.fn(),
    onSelect: (id) => {
      props.selectedTableId = id;
      hooks.dirty = true;
    },
    onCanvasScopeChange: vi.fn((scope) => {
      const id = scope.selectedObjectId ?? undefined;
      if (props.selectedTableId !== id) {
        if (id) props.selectedTableId = id;
        else delete props.selectedTableId;
        hooks.dirty = true;
      }
    }),
  };
  let tree: unknown;
  const overlay = { hidden: true, style: {} as Record<string, string> };
  function render() {
    let renders = 0;
    do {
      if (++renders > 30) throw Error('Canvas effects did not settle');
      hooks.cursor = 0;
      hooks.dirty = false;
      const workspace = nodes(NativeERDCanvas(props)).find(
        (node) => typeof node.type === 'function' && node.type.name === 'NativeCanvasWorkspace',
      )!;
      tree = (workspace.type as (props: typeof workspace.props) => unknown)(workspace.props);
      const box = nodes(tree).find((node) => node.props.className === 'canvas-selection-box')!;
      (box.props.ref as { current: unknown }).current = overlay;
      hooks.layouts.splice(0).forEach((effect) => effect());
      hooks.effects.splice(0).forEach((effect) => effect());
    } while (hooks.dirty);
    return tree;
  }
  const captured = new Set<number>();
  const surface = {
    setPointerCapture: vi.fn((id: number) => captured.add(id)),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: vi.fn((id: number) => captured.delete(id)),
  };
  function event(name: string, extra: Record<string, unknown> = {}) {
    const target = nodes(tree).find(
      (node) => typeof node.props.onPointerDownCapture === 'function',
    )!;
    (target.props[name] as (event: unknown) => void)({
      pointerId: 1,
      button: 0,
      clientX: 1000,
      clientY: 1000,
      shiftKey: false,
      target: new Target(),
      currentTarget: surface,
      preventDefault() {},
      stopPropagation() {},
      ...extra,
    });
    render();
  }
  render();
  return {
    props,
    event,
    tick() {
      flushFrame();
      render();
    },
    surface,
    render,
    scene: () => nodes(tree).find((node) => node.type === NativeCanvasScene)!.props,
    controls: () => nodes(tree).find((node) => node.type === NativeCameraControls)!.props,
    worldStyle: () =>
      nodes(tree).find((node) => node.props.className === 'native-erd-world canvas-world')!.props
        .style as { transform: string; willChange?: string },
    transform: () =>
      (
        nodes(tree).find((node) => node.props.className === 'native-erd-world canvas-world')!.props
          .style as { transform: string }
      ).transform,
    hasMarquee: () => !overlay.hidden,
  };
}

describe('native blank canvas pointer interaction', () => {
  it.each([
    [0.1, 'auto'],
    [0.15, 'auto'],
    [0.16, 'auto'],
    [1, 'auto'],
  ] as const)('selects the world promotion hint at zoom %s', (zoom, hint) => {
    const ui = canvas();
    (ui.controls().onZoom as (factor: number) => void)(zoom);
    ui.render();
    expect(ui.worldStyle().willChange).toBe(hint);
  });

  it('keeps the world promotion hint disabled across pan and zoom round trips', () => {
    const ui = canvas();
    expect(ui.worldStyle().willChange).toBe('auto');
    (ui.controls().onZoom as (factor: number) => void)(0.1);
    ui.render();
    expect(ui.worldStyle().willChange).toBe('auto');
    const before = ui.transform();
    (ui.controls().onTool as (tool: string) => void)('hand');
    ui.render();
    ui.event('onPointerDownCapture');
    ui.event('onPointerMove', { clientX: 1100, clientY: 1050 });
    ui.event('onPointerUp');
    expect(ui.transform()).not.toBe(before);
    expect(ui.worldStyle().willChange).toBe('auto');
    (ui.controls().onZoom as (factor: number) => void)(1.4);
    ui.render();
    expect(ui.worldStyle().willChange).toBe('auto');
    (ui.controls().onZoom as (factor: number) => void)(2);
    ui.render();
    expect(ui.worldStyle().willChange).toBe('auto');
  });

  it('does not restore a saved camera when personal state refreshes after local navigation', async () => {
    const ui = canvas(true);
    const response = (version: number) => ({
      databaseRevision: ui.props.snapshot.project.databaseRevision,
      projectVersion: ui.props.snapshot.project.version,
      syncSequence: ui.props.snapshot.sequence,
      version,
      state: {
        ...extractPersonalState(ui.props.document),
        viewports: [{ viewId: '__tables__', x: 300, y: 200, zoom: 0.5 }],
      },
    });
    (ui.controls().onZoom as (factor: number) => void)(1.2);
    ui.render();
    const position = ui.transform();
    ui.props.snapshot = { ...ui.props.snapshot, sequence: ui.props.snapshot.sequence + 1 };
    personalApi.mockResolvedValueOnce(response(2));
    ui.render();
    await Promise.resolve();
    ui.render();
    expect(ui.transform()).toBe(position);
    ui.props.snapshot = { ...ui.props.snapshot, sequence: ui.props.snapshot.sequence + 1 };
    personalApi.mockResolvedValueOnce(response(3));
    ui.render();
    await Promise.resolve();
    ui.render();
    expect(ui.transform()).toBe(position);
  });
  it('preserves pan and zoom across server snapshots and database revisions', () => {
    const ui = canvas();
    (ui.controls().onZoom as (factor: number) => void)(1.2);
    ui.render();
    (ui.controls().onTool as (tool: string) => void)('hand');
    ui.render();
    ui.event('onPointerDownCapture');
    ui.event('onPointerMove', { clientX: 1180, clientY: 1050 });
    ui.event('onPointerUp');
    const position = ui.transform();
    ui.props.snapshot = {
      ...ui.props.snapshot,
      sequence: ui.props.snapshot.sequence + 1,
      project: {
        ...ui.props.snapshot.project,
        version: ui.props.snapshot.project.version + 1,
        databaseRevision: ui.props.snapshot.project.databaseRevision + 1,
      },
    };
    ui.render();
    expect(ui.transform()).toBe(position);
  });
  it('moves the same object again before ACK and preserves its latest position when the earlier save settles', async () => {
    const ui = canvas(true);
    const acknowledgements: ((saved: boolean) => void)[] = [];
    ui.props.onSave = vi.fn(
      () => new Promise<boolean>((resolve) => acknowledgements.push(resolve)),
    );
    ui.render();
    const actions = () => (ui.scene().actions as { current: NativeSceneActions }).current;
    const drawn = () => (ui.scene().drawn as { nodes: NodeLayout[] }).nodes;
    const first = drawn()[0]!;
    function drag(x: number, y: number) {
      const node = drawn().find((candidate) => candidate.id === first.id)!;
      actions().begin(
        {
          button: 0,
          pointerId: 1,
          clientX: 0,
          clientY: 0,
          target: new Target(),
          currentTarget: ui.surface,
        } as never,
        node,
      );
      ui.render();
      actions().preserve(node, x, y);
      ui.render();
      const saving = actions().savePlacement();
      ui.render();
      return saving;
    }
    const earlier = drag(first.x + 80, first.y + 30);
    const later = drag(first.x + 160, first.y + 60);
    expect(ui.props.onSave).toHaveBeenCalledTimes(2);
    acknowledgements[0]!(true);
    await earlier;
    ui.render();
    expect(drawn().find((node) => node.id === first.id)?.x).toBe(first.x + 160);
    acknowledgements[1]!(true);
    await later;
    ui.render();
    expect(drawn().find((node) => node.id === first.id)?.x).toBe(first.x + 160);
  });
  it('keeps earlier placements visible and accepts a second drag before the first ACK', async () => {
    const ui = canvas(true);
    let acknowledge!: (saved: boolean) => void;
    ui.props.onSave = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          acknowledge = resolve;
        }),
    );
    ui.render();
    const actions = () => (ui.scene().actions as { current: NativeSceneActions }).current;
    const drawn = () => (ui.scene().drawn as { nodes: NodeLayout[] }).nodes;
    const first = drawn()[0]!;
    actions().begin(
      {
        button: 0,
        pointerId: 1,
        clientX: 0,
        clientY: 0,
        target: new Target(),
        currentTarget: ui.surface,
      } as never,
      first,
    );
    ui.render();
    actions().preserve(first, first.x + 80, first.y + 30);
    ui.render();
    const saving = actions().savePlacement();
    ui.render();
    const second = drawn().find((node) => node.id !== first.id)!;
    actions().begin(
      {
        button: 0,
        pointerId: 2,
        clientX: 0,
        clientY: 0,
        target: new Target(),
        currentTarget: ui.surface,
      } as never,
      second,
    );
    ui.render();
    actions().preserve(second, second.x + 50, second.y + 10);
    ui.render();
    expect(drawn().find((node) => node.id === first.id)?.x).toBe(first.x + 80);
    expect(drawn().find((node) => node.id === second.id)?.x).toBe(second.x + 50);
    const activeGesture = (ui.scene().gesture as { current: unknown }).current;
    ui.props.document = {
      ...ui.props.document,
      layout: {
        ...ui.props.document.layout,
        nodes: ui.props.document.layout.nodes.map((node) =>
          // Another writer moved the first node again before the refresh completed.
          node.id === first.id ? { ...node, x: first.x + 100, y: first.y + 30 } : node,
        ),
      },
    };
    ui.props.snapshot = { ...ui.props.snapshot, sequence: ui.props.snapshot.sequence + 1 };
    ui.render();
    expect((ui.scene().gesture as { current: unknown }).current).toBe(activeGesture);
    acknowledge(true);
    await saving;
    ui.render();
    expect(drawn().find((node) => node.id === second.id)?.x).toBe(second.x + 50);
    // An unrelated snapshot before ACK cannot roll back the accepted local position.
    expect(drawn().find((node) => node.id === first.id)?.x).toBe(first.x + 80);
    ui.props.snapshot = { ...ui.props.snapshot, sequence: ui.props.snapshot.sequence + 1 };
    ui.render();
    expect(drawn().find((node) => node.id === second.id)?.x).toBe(second.x + 50);
    expect(drawn().find((node) => node.id === first.id)?.x).toBe(first.x + 100);
  });
  it('keeps an active gesture across remote edits but resets it on DB context change', () => {
    const ui = canvas();
    const gesture = ui.scene().gesture as { current: unknown };
    const active = { pointerId: 1, nodeId: 'a', x: 40, y: 60 };
    gesture.current = active;
    ui.props.snapshot = {
      ...ui.props.snapshot,
      sequence: ui.props.snapshot.sequence + 1,
      project: { ...ui.props.snapshot.project, version: ui.props.snapshot.project.version + 1 },
    };
    ui.render();
    expect((ui.scene().gesture as typeof gesture).current).toBe(active);
    ui.props.snapshot = {
      ...ui.props.snapshot,
      project: {
        ...ui.props.snapshot.project,
        databaseRevision: ui.props.snapshot.project.databaseRevision + 1,
      },
    };
    ui.render();
    expect((ui.scene().gesture as typeof gesture).current).toBeNull();
  });
  it('settles a blank click after a table selection and permits another selection', () => {
    const ui = canvas();
    const node = (ui.scene().drawn as { nodes: unknown[] }).nodes[0];
    (ui.scene().onNodeSelect as (node: unknown, event: unknown) => void)(node, {
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
    });
    ui.render();
    expect(ui.props.selectedTableId).toBe('a');
    ui.event('onPointerDownCapture');
    ui.event('onPointerUp');
    expect(ui.props.selectedTableId).toBeUndefined();
    expect(ui.hasMarquee()).toBe(false);
    (ui.scene().onNodeSelect as (node: unknown, event: unknown) => void)(node, {
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
    });
    ui.render();
    expect(ui.props.selectedTableId).toBe('a');
  });
  it('ends marquee interaction when pointer capture is lost before pointerup', () => {
    const ui = canvas();
    ui.event('onPointerDownCapture');
    expect(ui.hasMarquee()).toBe(true);
    ui.event('onLostPointerCapture');
    expect(ui.hasMarquee()).toBe(false);
    ui.event('onPointerMove', { clientX: 1200, clientY: 1200 });
    expect(ui.hasMarquee()).toBe(false);
  });
  it('keeps drag marquee and Shift additive selection, ignoring other pointers losing capture', () => {
    const ui = canvas();
    const node = (ui.scene().drawn as { nodes: unknown[] }).nodes[0];
    (ui.scene().onNodeSelect as (node: unknown, event: unknown) => void)(node, {
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
    });
    ui.render();
    ui.event('onPointerDownCapture', { clientX: 450, clientY: 40, shiftKey: true });
    ui.event('onLostPointerCapture', { pointerId: 2 });
    expect(ui.hasMarquee()).toBe(true);
    ui.event('onPointerMove', { clientX: 810, clientY: 350 });
    ui.tick();
    expect(ui.scene().selectedObjectIds).toEqual(['a', 'b']);
    ui.event('onPointerUp');
    expect(ui.hasMarquee()).toBe(false);
    expect(ui.scene().selectedObjectIds).toEqual(['a', 'b']);
  });
  it.each(['onPointerCancel', 'onLostPointerCapture'])(
    'ends panning on %s and accepts another gesture',
    (end) => {
      const ui = canvas();
      (ui.controls().onTool as (tool: string) => void)('hand');
      ui.render();
      const start = ui.transform();
      ui.event('onPointerDownCapture');
      ui.event('onPointerMove', { clientX: 1100 });
      const moved = ui.transform();
      expect(moved).not.toBe(start);
      expect(ui.hasMarquee()).toBe(false);
      ui.event(end);
      ui.event('onPointerMove', { clientX: 1200 });
      expect(ui.transform()).toBe(moved);
      ui.event('onPointerDownCapture');
      ui.event('onPointerMove', { clientX: 1100 });
      expect(ui.transform()).not.toBe(moved);
      ui.event('onPointerUp');
    },
  );
  it('ends a cancelled marquee and leaves inline inputs interactive', () => {
    const ui = canvas();
    ui.event('onPointerDownCapture', { target: new Target('.native-inline-editor') });
    expect(ui.surface.setPointerCapture).not.toHaveBeenCalled();
    expect(ui.hasMarquee()).toBe(false);
    ui.event('onPointerDownCapture');
    ui.event('onPointerCancel');
    ui.event('onPointerMove', { clientX: 1200 });
    expect(ui.hasMarquee()).toBe(false);
  });
});
