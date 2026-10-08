import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeERDCanvas, NativeCanvasActions, NativeCanvasInputForm } from './NativeERDCanvas.js';
import { NativeCanvasScene } from './NativeCanvasScene.js';
import { NativeRelationEditor } from './NativeRelationEditor.js';
import { NativeCameraControls, NativeCanvasToolbar } from './NativeCanvasToolbar.js';
import { NativeCanvasTableRows } from './NativeCanvasTableRows.js';
import {
  clipboardActor,
  clipboardSnapshot,
  clipboardFixture,
} from './native-clipboard-test-fixtures.js';
import { IDBFactory } from 'fake-indexeddb';
import { getNativeDurableQueue } from './native-durable-queue.js';
import type { NativeSceneActions } from './NativeCanvasScene.js';
import {
  extractPersonalState,
  createNativeColumn,
  addTableReference,
  type NativeDesignDocument,
  type NodeLayout,
} from '@ezerd/model';
import { nativeInlineKey } from './native-inline-edit.js';
import * as editorDrafts from './native-editor-draft.js';
import {
  nativeTableCreationPreview,
  withNativeTableCreationPreviews,
} from './native-table-creation-preview.js';
import {
  readLocalTableClipboard,
  rememberTableClipboard,
} from '../../shared/clipboard/table-clipboard-store.js';
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
  rememberTableClipboard('');
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
  rememberTableClipboard('');
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
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
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

describe('native canvas clipboard storage integration', () => {
  it.each([1, 2])('keeps a newly created table visible with %s selected domains', (count) => {
    const ui = canvas(true);
    const toolbar = () => nodes(ui.render()).find((node) => node.type === NativeCanvasToolbar)!;
    const filter = { domainIds: count === 1 ? ['d'] : ['d', 'other'], unassigned: false };
    (toolbar().props.onFilter as (filter: unknown) => void)(filter);
    (toolbar().props.onCreate as (kind: string) => void)('table');
    expect(toolbar().props.filter).toEqual(count === 1 ? filter : null);
    const add = vi
      .mocked(ui.props.onSave)
      .mock.calls[0]![0].find((command) => command.type === 'add_table');
    expect(add?.type === 'add_table' && add.value.domainId).toBe(count === 1 ? 'd' : null);
  });
  it('renders and selects the parent create preview before ACK without changing the snapshot or later selection', async () => {
    const ui = canvas(true);
    const snapshot = structuredClone(ui.props.snapshot);
    let acknowledge!: (value: boolean) => void;
    let created = '';
    ui.props.onSave = vi.fn((commands) => {
      const preview = nativeTableCreationPreview(ui.props.document, commands, 'create-operation')!;
      created = preview.table.id;
      ui.props.document = withNativeTableCreationPreviews(ui.props.document, [preview]);
      ui.props.optimisticSourceDocument = ui.props.document;
      ui.props.selectedTableId = created;
      return new Promise<boolean>((resolve) => {
        acknowledge = resolve;
      });
    });
    const toolbar = nodes(ui.render()).find((node) => node.type === NativeCanvasToolbar)!;
    (toolbar.props.onCreate as (kind: string) => void)('table');
    ui.render();
    expect(
      (ui.scene().drawn as { nodes: NodeLayout[] }).nodes.some((node) => node.objectId === created),
    ).toBe(true);
    expect(
      (ui.scene().sharedSource as NativeDesignDocument).tables?.some(
        (table) => table.id === created,
      ),
    ).toBe(true);
    expect(ui.scene().selectedTableId).toBe(created);
    expect(ui.props.snapshot).toEqual(snapshot);
    const other = (ui.scene().drawn as { nodes: NodeLayout[] }).nodes.find(
      (node) => node.objectId !== created,
    )!;
    (ui.scene().onNodeSelect as (node: NodeLayout, event: unknown) => void)(other, {
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
    });
    ui.render();
    acknowledge(true);
    await Promise.resolve();
    await Promise.resolve();
    ui.render();
    expect(ui.scene().selectedTableId).not.toBe(created);
  });
  it('creates an empty table directly from the toolbar', async () => {
    const ui = canvas(true);
    const toolbar = nodes(ui.render()).find((node) => node.type === NativeCanvasToolbar)!;
    (toolbar.props.onCreate as (kind: string) => void)('table');
    await Promise.resolve();
    expect(ui.props.onSave).toHaveBeenCalledOnce();
    const commands = vi.mocked(ui.props.onSave).mock.calls[0]![0];
    const add = commands.find((command) => command.type === 'add_table');
    expect(add?.type === 'add_table' && add.value.logical.name).toBe('');
    expect(add?.type === 'add_table' && add.value.physical.name).toBe('');
  });
  it('opens the app column menu for a name/type input right click but preserves editing keys', () => {
    const ui = canvas(true);
    const document = ui.props.document;
    const table = document.tables![0]!;
    const onSelect = vi.fn();
    const wrapper = NativeCanvasTableRows({ document, table, mode: 'logical', onSelect });
    const tree = (wrapper.type as (props: typeof wrapper.props) => unknown)(wrapper.props);
    const row = {
      getAttribute: () => document.columns!.find((column) => column.tableId === table.id)!.id,
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    };
    const target = new Target('input');
    target.closest = ((selector: string) =>
      selector === '[data-column-id]'
        ? row
        : selector.includes('input')
          ? target
          : null) as typeof target.closest;
    const event = {
      target,
      clientX: 40,
      clientY: 50,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    const handler = nodes(tree).find((node) => typeof node.props.onContextMenu === 'function')!;
    (handler.props.onContextMenu as (event: unknown) => void)(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledOnce();
    event.preventDefault.mockClear();
    (handler.props.onKeyDownCapture as (event: unknown) => void)({ ...event, key: 'ContextMenu' });
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it('renders 100 moves immediately with one final archive write and one server request', async () => {
    vi.useFakeTimers();
    const store = vi.spyOn(editorDrafts, 'storeNativeEditorDraft');
    try {
      const ui = canvas(true);
      const actions = () => (ui.scene().actions as { current: NativeSceneActions }).current;
      const drawn = () => (ui.scene().drawn as { nodes: NodeLayout[] }).nodes;
      const node = drawn()[0]!;
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
      store.mockClear();
      for (let x = 1; x <= 100; x++) {
        actions().preserve(node, node.x + x, node.y);
        ui.render();
        expect(drawn().find((item) => item.id === node.id)?.x).toBe(node.x + x);
      }
      expect(store).not.toHaveBeenCalled();
      expect(ui.props.onSave).not.toHaveBeenCalled();
      await actions().savePlacement();
      expect(store).toHaveBeenCalledOnce();
      expect(ui.props.onSave).toHaveBeenCalledOnce();
      vi.runAllTimers();
      expect(store).toHaveBeenCalledOnce();
    } finally {
      store.mockRestore();
      vi.useRealTimers();
    }
  });
  it('switches tools outside surface focus while protecting editors, IME and handled keys', () => {
    const listeners = new Map<string, (event: unknown) => void>();
    vi.stubGlobal('window', {
      addEventListener: (name: string, listener: (event: unknown) => void) =>
        listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
    });
    const ui = canvas();
    const key = (extra: Record<string, unknown> = {}) => {
      const event = {
        key: 'h',
        code: 'KeyH',
        target: new Target(),
        preventDefault: vi.fn(),
        ...extra,
      };
      listeners.get('keydown')!(event);
      ui.render();
      return event;
    };
    key();
    expect(ui.controls().tool).toBe('hand');
    key({ key: 'ㅍ', code: 'KeyV' });
    expect(ui.controls().tool).toBe('select');
    // Escape restores focus to the non-editing inline span.
    key({ target: new Target('[data-inline-cell]') });
    expect(ui.controls().tool).toBe('hand');
    key({ key: 'v', code: 'KeyV', target: new Target('[data-inline-cell]') });
    expect(ui.controls().tool).toBe('select');
    for (const extra of [
      { target: new Target('input') },
      { target: new Target('textarea') },
      { isComposing: true },
      { keyCode: 229 },
      { defaultPrevented: true },
      { ctrlKey: true },
    ]) {
      expect(key(extra).preventDefault).not.toHaveBeenCalled();
      expect(ui.controls().tool).toBe('select');
    }
  });
  it.each(['select', 'hand'])(
    'ignores a portal option in %s mode without capturing its pointer',
    (tool) => {
      const ui = canvas();
      (ui.controls().onTool as (tool: string) => void)(tool);
      ui.render();
      const start = ui.transform();
      const portalOption = new Target();
      portalOption.parentElement = {}; // Body portal, outside the canvas DOM subtree.
      ui.event('onPointerDownCapture', { target: portalOption });
      ui.event('onPointerMove', { target: portalOption, clientX: 1200 });
      expect(ui.surface.setPointerCapture).not.toHaveBeenCalled();
      expect(ui.hasMarquee()).toBe(false);
      expect(ui.transform()).toBe(start);
      // Normal canvas descendants remain interactive after the ignored portal event.
      ui.event('onPointerDownCapture');
      expect(ui.surface.setPointerCapture).toHaveBeenCalledOnce();
      expect(ui.hasMarquee()).toBe(tool === 'select');
      ui.event('onPointerMove', { clientX: 1100 });
      if (tool === 'hand') expect(ui.transform()).not.toBe(start);
      ui.event('onPointerUp');
    },
  );
  it.each([false, true])(
    'updates reference coordinates after add ACK (private=%s), including delayed snapshots',
    async (privateView) => {
      const snapshot = clipboardSnapshot();
      const document = clipboardFixture();
      const viewId = privateView ? 'combined' : '__tables__';
      if (privateView) document.views = [{ id: viewId, name: 'Combined', domainIds: ['d'] }];
      document.layout.nodes = document.layout.nodes.filter((node) => node.viewId !== viewId);
      const props: Parameters<typeof NativeCanvasActions>[0] = {
        document,
        source: document,
        snapshot,
        userId: clipboardActor,
        viewId,
        busy: false,
        sharedEditable: true,
        initialSelection: { action: 'reference', target: 'a' },
        onSave: vi.fn(async () => true),
        onSharedSave: vi.fn(async () => true),
      };
      const render = () => {
        hooks.cursor = 0;
        const tree = NativeCanvasActions(props);
        hooks.layouts.splice(0).forEach((effect) => effect());
        return nodes(tree).find((node) => node.type === NativeCanvasInputForm)!.props as Parameters<
          typeof NativeCanvasInputForm
        >[0];
      };
      let form = render();
      const values: Record<string, string> = { ...form.initial, x: '70', y: '80' };
      const first = form.build(values);
      expect(first[0]?.type).toBe('add_table_reference');
      const expected = {
        version: snapshot.project.version,
        sequence: snapshot.sequence,
        databaseRevision: snapshot.project.databaseRevision,
      };
      expect(
        await form.context.onSave(first, expected, {
          key: form.draftKey,
          revision: clipboardActor,
        }),
      ).toBe(true);
      form = render();
      const nodeId = privateView
        ? addTableReference(document, 'a', viewId, { x: 70, y: 80 }).layout.nodes.find(
            (node) => node.objectId === 'a' && node.viewId === viewId,
          )!.id
        : values.id;
      expect(form.build({ ...values, x: '120' })).toEqual([
        { type: 'update_node_layout', nodeId, patch: { x: 120, y: 80 } },
      ]);
      const updated = addTableReference(document, 'a', viewId, { x: 70, y: 80 });
      updated.layout.nodes = updated.layout.nodes.map((node) =>
        node.objectId === 'a' && node.viewId === viewId ? { ...node, id: nodeId! } : node,
      );
      props.document = updated;
      form = render();
      expect(form.initial).toMatchObject({ x: '70', y: '80' });
      expect(form.build({ ...values, y: '200' })).toEqual([
        { type: 'update_node_layout', nodeId, patch: { x: 70, y: 200 } },
      ]);
      props.document = document;
      form = render();
      expect(form.build(values)[0]?.type).toBe('add_table_reference');
    },
  );
  it('does not remember a rejected reference creation', async () => {
    const snapshot = clipboardSnapshot(),
      document = clipboardFixture();
    document.layout.nodes = [];
    hooks.cursor = 0;
    const tree = NativeCanvasActions({
      document,
      source: document,
      snapshot,
      userId: clipboardActor,
      viewId: 'd',
      busy: false,
      sharedEditable: true,
      initialSelection: { action: 'reference', target: 'a' },
      onSave: vi.fn(async () => false),
      onSharedSave: vi.fn(async () => false),
    });
    const form = nodes(tree).find((node) => node.type === NativeCanvasInputForm)!
      .props as Parameters<typeof NativeCanvasInputForm>[0];
    const expected = {
      version: snapshot.project.version,
      sequence: snapshot.sequence,
      databaseRevision: snapshot.project.databaseRevision,
    };
    await form.context.onSave(form.build(form.initial), expected, {
      key: form.draftKey,
      revision: clipboardActor,
    });
    expect(form.build({ ...form.initial, x: '100' })[0]?.type).toBe('add_table_reference');
  });
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'creates native %s column types over HTTP without randomUUID',
    async (kind) => {
      const ui = canvas(true);
      const document = clipboardFixture(kind);
      ui.props.document = document;
      if (ui.props.snapshot.native?.status === 'available')
        ui.props.snapshot.native.document = document;
      const random = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
      vi.stubGlobal('crypto', { getRandomValues: random });
      ui.render();
      await (ui.scene().onAddColumn as (id: string) => Promise<void>)('a');
      ui.render();
      const column = (ui.scene().base as NativeDesignDocument).columns!.at(-1)!;
      expect(column).toEqual(
        createNativeColumn(document.database, document.tables![0]!, column.id),
      );
      expect(column.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(column.physical.type).toMatchObject({ database: kind, kind: 'builtin' });
    },
  );
  it('adds a blank card column immediately, preserves DB defaults and focuses its name', async () => {
    const ui = canvas(true);
    let accept!: (saved: boolean) => void;
    ui.props.onSave = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    );
    ui.render();
    const save = (ui.scene().onAddColumn as (id: string) => Promise<void>)('a');
    const tree = ui.render();
    const base = ui.scene().base as NativeDesignDocument;
    const column = base.columns!.at(-1)!;
    expect(column).toEqual(
      createNativeColumn(
        base.database,
        base.tables!.find((table) => table.id === 'a')!,
        column.id,
      ),
    );
    expect(column.logical.name).toBe('');
    expect(ui.props.onSave).toHaveBeenCalledWith(
      [{ type: 'add_column', value: column }],
      expect.anything(),
    );
    const focus = vi.fn();
    const world = nodes(tree).find(
      (node) => node.props.className === 'native-erd-world canvas-world',
    )!;
    (world.props.ref as (element: unknown) => void)({
      querySelectorAll: () => [
        {
          dataset: {
            inlineKey: nativeInlineKey({
              tableId: 'a',
              columnId: column.id,
              mode: 'logical',
              field: 'name',
            }),
          },
          focus,
        },
      ],
    });
    ui.render();
    expect(focus).toHaveBeenCalledOnce();
    accept(false);
    await save;
    ui.render();
    expect(
      (ui.scene().base as NativeDesignDocument).columns?.some((item) => item.id === column.id),
    ).toBe(false);
  });
  function selectTable(ui: ReturnType<typeof canvas>, id: string) {
    const scene = ui.scene();
    const node = (scene.drawn as { nodes: NodeLayout[] }).nodes.find(
      (item) => item.objectId === id,
    )!;
    (
      scene.onNodeSelect as (
        node: NodeLayout,
        event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
      ) => void
    )(node, { shiftKey: false, ctrlKey: false, metaKey: false });
    ui.render();
  }
  function copiedCanvas() {
    const ui = canvas();
    selectTable(ui, 'a');
    const setData = vi.fn();
    ui.event('onCopy', { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith('text/plain', readLocalTableClipboard());
    expect(JSON.parse(readLocalTableClipboard())).toMatchObject({
      format: 'ezerd/tables',
      formatVersion: 2,
      document: { schemaVersion: 2 },
    });
    return ui;
  }

  it('uses the last copied Native text for keyboard paste while leaving source and text inputs unchanged', () => {
    const ui = copiedCanvas();
    const source = structuredClone(ui.props.snapshot.sourceDocument);
    const first = readLocalTableClipboard();
    selectTable(ui, 'b');
    ui.event('onCopy', { clipboardData: { setData: vi.fn() } });
    const text = readLocalTableClipboard();
    expect(text).not.toBe(first);
    expect(JSON.parse(text).document.tables.map((table: { id: string }) => table.id)).toEqual([
      'b',
    ]);
    ui.event('onKeyDownCapture', { key: 'v', ctrlKey: true, nativeEvent: { isComposing: false } });
    expect(ui.props.onSave).toHaveBeenCalledWith(
      [expect.objectContaining({ type: 'paste_native_clipboard', clipboard: JSON.parse(text) })],
      expect.objectContaining({
        version: ui.props.snapshot.project.version,
        sequence: ui.props.snapshot.sequence,
      }),
    );
    expect(ui.props.snapshot.sourceDocument).toEqual(source);
    vi.mocked(ui.props.onSave).mockClear();
    ui.event('onCopy', { target: new Target('input'), clipboardData: { setData: vi.fn() } });
    ui.event('onKeyDownCapture', {
      target: new Target('input'),
      key: 'v',
      ctrlKey: true,
      nativeEvent: { isComposing: false },
    });
    expect(readLocalTableClipboard()).toBe(text);
    expect(ui.props.onSave).not.toHaveBeenCalled();
    ui.props.editable = false;
    ui.render();
    ui.event('onKeyDownCapture', { key: 'v', ctrlKey: true, nativeEvent: { isComposing: false } });
    expect(ui.props.onSave).not.toHaveBeenCalled();
  });

  it('falls back to copied Native text when the context menu cannot read the device clipboard', async () => {
    const ui = copiedCanvas();
    const text = readLocalTableClipboard();
    const readText = vi.fn(async () => {
      throw Error('permission denied');
    });
    vi.stubGlobal('navigator', { clipboard: { readText } });
    vi.stubGlobal('window', { innerWidth: 1600, innerHeight: 1000 });
    ui.event('onContextMenu');
    const items = nodes(ui.render()).flatMap((node) =>
      Array.isArray(node.props.items)
        ? (node.props.items as { id: string; onAction?: () => void }[])
        : [],
    );
    const paste = items.find((item) => item.id === 'paste-tables');
    expect(paste).toBeDefined();
    paste!.onAction!();
    await Promise.resolve();
    await Promise.resolve();
    expect(readText).toHaveBeenCalledTimes(1);
    expect(ui.props.onSave).toHaveBeenCalledWith(
      [expect.objectContaining({ type: 'paste_native_clipboard', clipboard: JSON.parse(text) })],
      expect.any(Object),
    );
    expect(readLocalTableClipboard()).toBe(text);
  });
});

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
    const firstRequest = vi.mocked(ui.props.onSave).mock.calls[0]!;
    const immutableRequest = structuredClone(firstRequest);
    const later = drag(first.x + 160, first.y + 60);
    expect(firstRequest).toEqual(immutableRequest);
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
    const camera = ui.transform();
    // Remote property updates preserve submitted placement and the active drag.
    const remoteDocument = structuredClone(ui.props.document);
    remoteDocument.tables![0]!.physical.name = 'remote_table_name';
    ui.props.document = remoteDocument;
    ui.props.snapshot = {
      ...ui.props.snapshot,
      sourceDocument: remoteDocument,
      native: { status: 'available', document: remoteDocument, migrationIssues: [], issues: [] },
      sequence: ui.props.snapshot.sequence + 1,
      project: { ...ui.props.snapshot.project, version: ui.props.snapshot.project.version + 1 },
    };
    ui.render();
    expect((ui.scene().gesture as { current: unknown }).current).toBe(activeGesture);
    expect(ui.transform()).toBe(camera);
    expect(drawn().find((node) => node.id === first.id)?.x).toBe(first.x + 80);
    expect(drawn().find((node) => node.id === second.id)?.x).toBe(second.x + 50);
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
  it('keeps the recovered action editor mounted across shared snapshots', () => {
    const ui = canvas(true);
    ui.props.recoverySelection = { action: { action: 'reference', target: 'a' } };
    const action = () =>
      nodes(ui.render()).find(
        (node) => node.props.initialSelection === ui.props.recoverySelection?.action,
      )!;
    const original = action();
    expect(original).toBeDefined();
    ui.props.snapshot = {
      ...ui.props.snapshot,
      sequence: ui.props.snapshot.sequence + 1,
      project: { ...ui.props.snapshot.project, version: ui.props.snapshot.project.version + 1 },
    };
    expect(action().key).toBe(original.key);
    ui.props.snapshot = {
      ...ui.props.snapshot,
      project: {
        ...ui.props.snapshot.project,
        databaseRevision: ui.props.snapshot.project.databaseRevision + 1,
      },
    };
    expect(action().key).not.toBe(original.key);
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
  it.each(
    ['select', 'hand', 'space', 'pin'].flatMap((mode) =>
      [false, true].map((filtered) => ({ mode, filtered })),
    ),
  )(
    'leaves route gestures to the editor ($mode, domain filter=$filtered)',
    ({ mode, filtered }) => {
      const ui = canvas(true);
      const createPin = vi.fn();
      if (filtered) {
        const toolbar = nodes(ui.render()).find((node) => node.type === NativeCanvasToolbar)!;
        (toolbar.props.onFilter as (filter: unknown) => void)({
          domainIds: ['d'],
          unassigned: false,
        });
      }
      if (mode === 'hand') (ui.controls().onTool as (tool: string) => void)('hand');
      if (mode === 'space')
        ui.event('onKeyDownCapture', {
          key: ' ',
          code: 'Space',
          nativeEvent: { key: ' ', code: 'Space' },
        });
      if (mode === 'pin') {
        ui.props.pinMode = true;
        ui.props.onCreatePin = createPin;
      }
      (ui.scene().onSelectRelation as (id: string) => void)('fk');
      ui.render();
      const editor = () => nodes(ui.render()).find((node) => node.type === NativeRelationEditor);
      expect(editor()?.props.relationId).toBe('fk');
      const transform = ui.transform();
      ui.event('onPointerDownCapture', { target: new Target('.native-route-controls') });
      ui.event('onPointerMove', { clientX: 1100, clientY: 1100 });
      expect(editor()?.props.relationId).toBe('fk');
      expect(ui.surface.setPointerCapture).not.toHaveBeenCalled();
      expect(ui.hasMarquee()).toBe(false);
      expect(ui.transform()).toBe(transform);
      expect(createPin).not.toHaveBeenCalled();
    },
  );
});
