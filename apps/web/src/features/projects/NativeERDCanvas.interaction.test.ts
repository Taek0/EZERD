import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeERDCanvas } from './NativeERDCanvas.js';
import { NativeCanvasScene } from './NativeCanvasScene.js';
import { NativeCameraControls } from './NativeCanvasToolbar.js';
import { clipboardSnapshot } from './native-clipboard-test-fixtures.js';

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
  hooks.cursor = 0;
  hooks.dirty = false;
  hooks.slots = [];
  hooks.layouts = [];
  hooks.effects = [];
  vi.stubGlobal('Element', Target);
});
afterEach(() => {
  hooks.slots.forEach((slot) => slot.cleanup?.());
  vi.unstubAllGlobals();
});

function canvas() {
  const snapshot = clipboardSnapshot();
  if (snapshot.native?.status !== 'available') throw Error('Expected native document');
  const props: Parameters<typeof NativeERDCanvas>[0] = {
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
    surface,
    render,
    scene: () => nodes(tree).find((node) => node.type === NativeCanvasScene)!.props,
    controls: () => nodes(tree).find((node) => node.type === NativeCameraControls)!.props,
    transform: () =>
      (
        nodes(tree).find((node) => node.props.className === 'native-erd-world canvas-world')!.props
          .style as { transform: string }
      ).transform,
    hasMarquee: () => nodes(tree).some((node) => node.props.className === 'canvas-selection-box'),
  };
}

describe('native blank canvas pointer interaction', () => {
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
