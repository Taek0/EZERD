import { isValidElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeProjectView } from './NativeProjectView.js';
import {
  NativeDraftRecoveryPanel,
  type NativeDraftRecoveryPanelProps,
} from './NativeDraftRecoveryPanel.js';
import { NativePropertyEditor } from './NativePropertyEditor.js';
import { NativeStructureEditor } from './native-editor-structure.js';
import { NativeAdvancedEditor } from './NativeAdvancedEditor.js';
import { NativeDomainEditor } from './NativeDomainEditor.js';
import { NativeERDCanvas } from './NativeERDCanvas.js';
import {
  clipboardSnapshot,
  clipboardActor,
  clipboardProject,
} from './native-clipboard-test-fixtures.js';
import {
  NativeDraftArchive,
  nativeDraftArchive,
  type NativeDraftArchiveEntry,
} from './native-draft-archive.js';
const hooks = vi.hoisted(() => ({
  active: null as null | {
    slots: { value?: unknown; deps?: readonly unknown[]; cleanup?: (() => void) | undefined }[];
    cursor: number;
    effects: (() => void)[];
  },
  actor: '00000000-0000-4000-8000-000000000001',
  stage: vi.fn(),
  send: vi.fn(),
}));
vi.mock('../../shared/i18n/index.js', () => ({
  registerTranslations() {},
  useI18n: () => ({ t: (s: string) => s }),
}));
vi.mock('./project-transfer.js', () => ({ currentTransferUserId: () => hooks.actor }));
vi.mock('./native-save.js', async (original) => ({
  ...(await original<typeof import('./native-save.js')>()),
  loadNativePending: async () => null,
  stageNativeSave: hooks.stage,
  sendNativePending: hooks.send,
}));
vi.mock('./native-export-state.js', () => ({ useNativeDurableState: () => 'empty' }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState(initial: unknown) {
    const state = hooks.active!,
      i = state.cursor++,
      slot = (state.slots[i] ??= { value: typeof initial === 'function' ? initial() : initial });
    return [
      slot.value,
      (value: unknown) => {
        slot.value = typeof value === 'function' ? value(slot.value) : value;
      },
    ];
  },
  useRef(initial: unknown) {
    const state = hooks.active!;
    return (state.slots[state.cursor++] ??= { value: { current: initial } }).value;
  },
  useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
    const state = hooks.active!,
      slot = (state.slots[state.cursor++] ??= {});
    if (!slot.deps || deps.some((value, i) => !Object.is(value, slot.deps![i]))) {
      state.effects.push(() => {
        slot.cleanup?.();
        slot.cleanup = effect() || undefined;
      });
      slot.deps = deps;
    }
  },
}));
function renderer() {
  const state = {
    slots: [] as NonNullable<typeof hooks.active>['slots'],
    cursor: 0,
    effects: [] as (() => void)[],
  };
  return {
    render<T>(render: () => T): T {
      hooks.active = state;
      state.cursor = 0;
      try {
        const result = render();
        state.effects.splice(0).forEach((effect) => effect());
        return result;
      } finally {
        hooks.active = null;
      }
    },
    unmount() {
      state.slots.forEach((slot) => slot.cleanup?.());
    },
  };
}
function nodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
function child(tree: unknown, type: unknown) {
  return nodes(tree).find((node) => node.type === type)!;
}
function click(tree: unknown, text: string) {
  (
    nodes(tree).find((node) => node.props.children === text && node.props.onClick)!.props
      .onClick as () => void
  )();
}
function fixture(canEdit = true, canPersonalEdit = canEdit) {
  const snapshot = clipboardSnapshot();
  if (snapshot.sourceDocument.schemaVersion !== 2) throw Error('native expected');
  const doc = snapshot.sourceDocument;
  snapshot.native = { status: 'available', document: doc, migrationIssues: [], issues: [] };
  doc.views = [{ id: 'v', name: 'Private', domainIds: ['d'] }];
  doc.layout.nodes.push({
    id: 'pn',
    objectId: 'a',
    viewId: 'v',
    x: 1,
    y: 2,
    width: 320,
    height: 260,
  });
  return {
    entry: { kind: 'native' as const, snapshot, document: doc, personalUnavailable: false },
    userId: clipboardActor,
    canEdit,
    canPersonalEdit,
    onLeave() {},
    onReload: vi.fn(),
  };
}
function input(key: string): NativeDraftArchiveEntry {
  return {
    formatVersion: 1,
    entryId: clipboardActor,
    writerId: clipboardProject,
    userId: clipboardActor,
    projectId: clipboardProject,
    category: 'editor',
    logicalKey: key,
    revision: clipboardActor,
    savedAt: '',
    draft: {
      userId: clipboardActor,
      projectId: clipboardProject,
      key,
      revision: clipboardActor,
      expected: { version: 0, sequence: 0, databaseRevision: 3 },
      before: { id: 'fresh' },
      values: { id: 'fresh', raw: '-unfinished' },
    },
  };
}
function openPanel(root: ReturnType<typeof renderer>, props: ReturnType<typeof fixture>) {
  const render = () => root.render(() => NativeProjectView(props));
  click(render(), '보관된 입력 복구');
  return {
    render,
    panel: child(render(), NativeDraftRecoveryPanel)
      .props as unknown as NativeDraftRecoveryPanelProps,
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  hooks.actor = clipboardActor;
});
describe('native root explicit recovery connection', () => {
  it.each([
    ['format:column:ca', NativePropertyEditor, undefined],
    ['create:column:a', NativeStructureEditor, { action: 'column', target: '' }],
    ['constraint:keys:k', NativeStructureEditor, { action: 'patch', target: '["keys","k"]' }],
    ['delete:columns:ca', NativeStructureEditor, { action: 'delete', target: '["columns","ca"]' }],
    ['create:domain:project', NativeDomainEditor, 'create'],
    ['move:domain:a', NativeDomainEditor, 'move'],
    ['advanced:expression:a:computed:ca', NativeAdvancedEditor, '["computed","ca"]'],
    [
      'canvas:action:v:note:',
      NativeERDCanvas,
      { viewId: 'v', action: { action: 'note', target: '' } },
    ],
    ['canvas:style:table:a', NativeERDCanvas, { style: 'table:a' }],
  ])(
    'explicitly selects/remounts %s and never stages during selection',
    (key, component, selection) => {
      const root = renderer(),
        props = fixture(),
        { render, panel } = openPanel(root, props),
        entry = input(String(key));
      const before = structuredClone(entry.draft);
      expect(panel.canRecover!(entry)).toBe(true);
      const oldKey = child(render(), component)?.key;
      panel.onRecovered(entry);
      const form = child(render(), component);
      expect(form).toBeDefined();
      expect(form.key).not.toBe(oldKey);
      if (component === NativeStructureEditor || component === NativeAdvancedEditor)
        expect(form.props.initialSelection).toEqual(selection);
      if (component === NativeDomainEditor) expect(form.props.initialAction).toBe(selection);
      if (component === NativeERDCanvas) expect(form.props.recoverySelection).toEqual(selection);
      if (component === NativePropertyEditor) expect(form.props.column).toMatchObject({ id: 'ca' });
      expect(entry.draft).toEqual(before);
      expect(hooks.stage).not.toHaveBeenCalled();
      expect(hooks.send).not.toHaveBeenCalled();
      root.unmount();
    },
  );
  it('fresh project create never inherits the previously selected table owner', () => {
    const root = renderer(),
      { render, panel } = openPanel(root, fixture());
    panel.onRecovered(input('create:table:project'));
    expect(child(render(), NativeStructureEditor).props.table).toBeUndefined();
    root.unmount();
  });
  it('preserves separate personal permission for a shared-readonly actor', () => {
    const root = renderer(),
      props = fixture(false, true),
      { render, panel } = openPanel(root, props);
    expect(panel.canRecover!(input('format:column:ca'))).toBe(false);
    expect(panel.canRecover!(input('canvas:action:v:note:'))).toBe(true);
    panel.onRecovered(input('canvas:action:v:note:'));
    const canvas = child(render(), NativeERDCanvas);
    expect(canvas.props.editable).toBe(false);
    expect(canvas.props.personalEditable).toBe(true);
    props.entry.snapshot.project.status = 'archived';
    render();
    expect(panel.canRecover!(input('canvas:action:v:note:'))).toBe(false);
    root.unmount();
  });
  it('live account, root generation cycle, and unmount invalidate old actions', () => {
    const root = renderer(),
      props = fixture(),
      { panel } = openPanel(root, props),
      entry = input('format:column:ca');
    hooks.actor = clipboardProject;
    expect(panel.isActorCurrent(clipboardActor)).toBe(false);
    expect(() => panel.onRecovered(entry)).toThrow('native.draft-recovery-unavailable');
    hooks.actor = clipboardActor;
    const another = fixture();
    another.entry.snapshot.project.id = clipboardActor;
    root.render(() => NativeProjectView(another));
    root.render(() => NativeProjectView(props));
    expect(panel.isActorCurrent(clipboardActor)).toBe(false);
    expect(() => panel.onRecovered(entry)).toThrow();
    root.unmount();
    expect(panel.isActorCurrent(clipboardActor)).toBe(false);
  });
  it('rejects removed/unknown/clipboard targets and rechecks live document before changing local heads', () => {
    const root = renderer(),
      props = fixture(),
      { render, panel } = openPanel(root, props);
    expect(panel.canRecover!(input('clipboard:paste:a'))).toBe(false);
    expect(panel.canRecover!(input('format:column:gone'))).toBe(false);
    props.entry.document.columns = [];
    render();
    expect(panel.canRecover!(input('format:column:ca'))).toBe(false);
    root.unmount();
  });
  it('actual panel copy opens the form with a new epoch, original source and expected preserved', () => {
    const values = new Map<string, string>(),
      store = {
        get length() {
          return values.size;
        },
        key: (i: number) => [...values.keys()][i] ?? null,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
        removeItem: (key: string) => {
          values.delete(key);
        },
      };
    vi.stubGlobal('localStorage', store);
    const entry = input('format:column:ca');
    const original = new NativeDraftArchive(store, 'other-tab').store(
      'editor',
      entry.logicalKey,
      entry.draft,
    );
    const root = renderer(),
      panelRoot = renderer(),
      { panel, render } = openPanel(root, fixture());
    const tree = panelRoot.render(() => NativeDraftRecoveryPanel(panel));
    click(tree, '복구 사본 만들기');
    const current = nativeDraftArchive(store).read(
      clipboardActor,
      clipboardProject,
      'editor',
      entry.logicalKey,
    )!;
    expect(current.recoveredFrom).toBe(original.entryId);
    expect(current.draft.expected).toEqual(entry.draft.expected);
    expect(nativeDraftArchive(store).entries(clipboardActor, clipboardProject)).toHaveLength(2);
    expect(child(render(), NativePropertyEditor).props.column).toMatchObject({ id: 'ca' });
    expect(hooks.stage).not.toHaveBeenCalled();
    root.unmount();
    panelRoot.unmount();
  });
  it('a removed target between render and click keeps the source download-only and creates no copy', () => {
    const values = new Map<string, string>(),
      store = {
        get length() {
          return values.size;
        },
        key: (i: number) => [...values.keys()][i] ?? null,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
        removeItem: (key: string) => {
          values.delete(key);
        },
      };
    vi.stubGlobal('localStorage', store);
    const entry = input('format:column:ca');
    new NativeDraftArchive(store, 'other-tab').store('editor', entry.logicalKey, entry.draft);
    const root = renderer(),
      panelRoot = renderer(),
      props = fixture(),
      { panel, render } = openPanel(root, props);
    const old = panelRoot.render(() => NativeDraftRecoveryPanel(panel));
    props.entry.document.columns = [];
    render();
    click(old, '복구 사본 만들기');
    expect(nativeDraftArchive(store).entries(clipboardActor, clipboardProject)).toHaveLength(1);
    expect(
      nativeDraftArchive(store).read(clipboardActor, clipboardProject, 'editor', entry.logicalKey),
    ).toBeNull();
    expect(hooks.stage).not.toHaveBeenCalled();
    root.unmount();
    panelRoot.unmount();
  });
});
