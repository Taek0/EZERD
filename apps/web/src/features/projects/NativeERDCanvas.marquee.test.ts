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

const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
function frame() {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(0));
}
class Target {
  parentElement: unknown;
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
  frames.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
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
    contains(target: unknown): boolean {
      let current = target;
      while (current instanceof Target) current = current.parentElement;
      return current === surface;
    },
    setPointerCapture: vi.fn((id: number) => captured.add(id)),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: vi.fn((id: number) => captured.delete(id)),
  };
  function event(name: string, extra: Record<string, unknown> = {}) {
    const eventTarget = extra.target ?? new Target();
    if (eventTarget instanceof Target && !eventTarget.parentElement)
      eventTarget.parentElement = surface;
    const target = nodes(tree).find(
      (node) => typeof node.props.onPointerDownCapture === 'function',
    )!;
    (target.props[name] as (event: unknown) => void)({
      pointerId: 1,
      button: 0,
      clientX: 1000,
      clientY: 1000,
      shiftKey: false,
      target: eventTarget,
      currentTarget: surface,
      preventDefault() {},
      stopPropagation() {},
      ...extra,
    });
    if (hooks.dirty) render();
  }
  render();
  return {
    props,
    event,
    overlay,
    unmount() {
      hooks.slots.forEach((slot) => slot.cleanup?.());
    },
    tick() {
      frame();
      if (hooks.dirty) render();
    },
    surface,
    render,
    scene: () => nodes(tree).find((node) => node.type === NativeCanvasScene)!.props,
    controls: () => nodes(tree).find((node) => node.type === NativeCameraControls)!.props,
    transform: () =>
      (
        nodes(tree).find((node) => node.props.className === 'native-erd-world canvas-world')!.props
          .style as { transform: string }
      ).transform,
    hasMarquee: () => !overlay.hidden,
  };
}

describe('frame-bounded marquee interaction', () => {
  it('keeps scene selection identity through 120 moves with unchanged hits', () => {
    const ui = canvas();
    ui.event('onPointerDownCapture', { clientX: 0, clientY: 0 });
    ui.event('onPointerMove', { clientX: 400, clientY: 350 });
    ui.tick();
    const selected = ui.scene().selectedObjectIds;
    expect(selected).toEqual(['a']);
    for (let i = 0; i < 120; i++) {
      ui.event('onPointerMove', { clientX: 400 + i / 100, clientY: 350 });
      ui.tick();
      expect(ui.scene().selectedObjectIds).toBe(selected);
    }
    expect(ui.overlay.style.left).toBe('-24px');
    expect(ui.overlay.style.width).toBe('401.19px');
    expect(ui.hasMarquee()).toBe(true);
  });
  it('coalesces a burst and flushes the final release coordinate before the next frame', () => {
    const ui = canvas();
    ui.event('onPointerDownCapture', { clientX: 0, clientY: 0 });
    for (let i = 0; i < 120; i++) ui.event('onPointerMove', { clientX: 400, clientY: 350 });
    expect(frames.size).toBe(1);
    ui.event('onPointerUp', { clientX: 810, clientY: 350 });
    expect(ui.scene().selectedObjectIds).toEqual(['a', 'b']);
    expect(frames.size).toBe(0);
    expect(ui.hasMarquee()).toBe(false);
    ui.tick();
    expect(ui.hasMarquee()).toBe(false);
  });
  it('preserves Shift selection and ignores capture loss from another pointer', () => {
    const ui = canvas();
    ui.event('onPointerDownCapture', { clientX: 0, clientY: 0 });
    ui.event('onPointerUp', { clientX: 400, clientY: 350 });
    ui.event('onPointerDownCapture', { clientX: 450, clientY: 40, shiftKey: true });
    ui.event('onLostPointerCapture', { pointerId: 2 });
    expect(ui.hasMarquee()).toBe(true);
    ui.event('onPointerMove', { clientX: 810, clientY: 350 });
    ui.tick();
    expect(ui.scene().selectedObjectIds).toEqual(['a', 'b']);
  });
  it.each(['onPointerCancel', 'onLostPointerCapture'])('cancels queued work on %s', (end) => {
    const ui = canvas();
    ui.event('onPointerDownCapture', { clientX: 0, clientY: 0 });
    ui.event('onPointerMove', { clientX: 810, clientY: 350 });
    ui.event(end);
    expect(frames.size).toBe(0);
    ui.tick();
    expect(ui.hasMarquee()).toBe(false);
    expect(ui.scene().selectedObjectIds).toEqual([]);
  });
});

describe('marquee navigation cleanup', () => {
  it('cancels pending work on unmount', () => {
    const ui = canvas();
    ui.event('onPointerDownCapture', { clientX: 0, clientY: 0 });
    ui.event('onPointerMove', { clientX: 810, clientY: 350 });
    ui.unmount();
    expect(frames.size).toBe(0);
  });
  it('cancels pending work when navigating to a different view', () => {
    const ui = canvas();
    ui.event('onPointerDownCapture', { clientX: 0, clientY: 0 });
    ui.event('onPointerMove', { clientX: 810, clientY: 350 });
    (ui.props as { requestedView?: { id: string; nonce: number } }).requestedView = {
      id: 'overview',
      nonce: 1,
    };
    ui.render();
    expect(frames.size).toBe(0);
    expect(ui.hasMarquee()).toBe(false);
  });
});
