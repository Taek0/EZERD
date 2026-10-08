import { isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeLogicalModeProvider } from './NativeLogicalMode.js';
import { NativePropertyEditor } from './NativePropertyEditor.js';
import { NativeProjectView } from './NativeProjectView.js';
import { NativeERDCanvas } from './NativeERDCanvas.js';
import { NativeStructureEditor } from './native-editor-structure.js';
import { NativeEditorField } from './native-editor-form.js';
import { projectEntry } from './project-entry.js';
import { clipboardActor, clipboardSnapshot } from './native-clipboard-test-fixtures.js';
import { createNativeTable } from '@ezerd/model';
import { nativeSaveIntents } from './native-save-intents.js';
import type { NativeWebCommand } from './native-save.js';

const transport = vi.hoisted(() => ({ flush: vi.fn() }));
vi.mock('./native-save-intents.js', async (original) => ({
  ...(await original<typeof import('./native-save-intents.js')>()),
  flushNativeSaveIntent: (...args: unknown[]) => transport.flush(...args),
}));

const parent = vi.hoisted(() => ({ active: false, cursor: 0, slots: [] as unknown[] }));
vi.mock('./NativeLogicalMode.js', async (original) => ({
  ...(await original<typeof import('./NativeLogicalMode.js')>()),
  useNativeLogicalMode: () => ({ enabled: false, onEnabledChange() {} }),
}));
vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>();
  return {
    ...actual,
    useState(initial: unknown) {
      if (!parent.active) return actual.useState(initial);
      const index = parent.cursor++;
      if (!(index in parent.slots))
        parent.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [
        parent.slots[index],
        (value: unknown) => {
          parent.slots[index] = typeof value === 'function' ? value(parent.slots[index]) : value;
        },
      ];
    },
    useRef(initial: unknown) {
      if (!parent.active) return actual.useRef(initial);
      const index = parent.cursor++;
      return (parent.slots[index] ??= { current: initial });
    },
    useEffect: (...args: Parameters<typeof actual.useEffect>) => {
      if (!parent.active) actual.useEffect(...args);
    },
  };
});
vi.mock('../../shared/i18n/index.js', async (original) => ({
  ...(await original<typeof import('../../shared/i18n/index.js')>()),
  useI18n: () => ({ t: (value: string) => value, locale: 'ko' }),
}));
vi.mock('./native-export-state.js', () => ({
  useNativeExportBlocker() {},
  useNativeExportBlocked: () => false,
  useNativeDurableState: () => 'empty',
  registerNativeExportBlocker() {},
  clearNativeExportBlocker() {},
}));
function nodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
beforeEach(() => {
  parent.active = false;
  parent.cursor = 0;
  parent.slots = [];
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  transport.flush.mockReset();
});

describe('native blank selection on HTTP LAN', () => {
  it('mounts the newly revealed table form without the secure-context-only randomUUID API', () => {
    const snapshot = clipboardSnapshot();
    if (snapshot.native?.status !== 'available') throw Error('Expected native snapshot');
    snapshot.native.document.tables?.forEach((table) => {
      table.scope = 'both';
    });
    const entry = projectEntry(snapshot);
    if (entry.kind !== 'native') throw Error('Expected native project');
    const render = () => {
      parent.active = true;
      parent.cursor = 0;
      try {
        return NativeProjectView({
          entry,
          userId: clipboardActor,
          canEdit: true,
          onLeave() {},
          onReload() {},
        });
      } finally {
        parent.active = false;
      }
    };
    const getRandomValues = vi.fn(crypto.getRandomValues.bind(crypto));
    vi.stubGlobal('crypto', { getRandomValues });
    vi.stubGlobal('isSecureContext', false);
    const before = nodes(render());
    const canvas = before.find((node) => node.type === NativeERDCanvas)!;
    expect(canvas.props.selectedTableId).toBe('a');
    expect(
      before.some(
        (node) => node.type === NativeStructureEditor && node.key?.startsWith('new-table:'),
      ),
    ).toBe(false);
    // This is the scope notification sent by the real canvas's blank-click handler.
    (canvas.props.onCanvasScopeChange as (scope: unknown) => void)({
      viewId: '__tables__',
      filter: null,
      visibleObjectIds: ['a', 'b'],
      selectedObjectId: null,
      selectedNode: null,
    });
    const after = nodes(render());
    expect(
      after.find((node) => node.type === NativeERDCanvas)!.props.selectedTableId,
    ).toBeUndefined();
    const creation = after.find(
      (node) => node.type === NativeStructureEditor && node.key?.startsWith('new-table:'),
    )!;
    expect(creation).toBeDefined();
    expect(creation.props.defaultOpen).toBe(false);
    expect(renderToStaticMarkup(creation)).toContain('새 테이블 만들기');
    expect(getRandomValues).toHaveBeenCalled();
  });
  it('generates distinct UUIDs for derived foreign-key columns on the same HTTP environment', () => {
    const snapshot = clipboardSnapshot();
    if (snapshot.native?.status !== 'available') throw Error('Expected native snapshot');
    const document = snapshot.native.document;
    document.tables!.forEach((table) => {
      table.scope = 'both';
    });
    document.keys![0]!.scope = 'both';
    document.keys![0]!.columnIds = ['ca', 'cb'];
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    vi.stubGlobal('isSecureContext', false);
    parent.active = true;
    let form: ReactElement<Record<string, unknown>>;
    try {
      const structure = NativeStructureEditor({
        context: { userId: clipboardActor, snapshot, busy: false, onSave: vi.fn(async () => true) },
        document,
        table: document.tables![1]!,
        initialSelection: { action: 'foreignKey', target: '' },
      });
      const create = nodes(structure).find(
        (node) => typeof node.type === 'function' && node.type.name === 'NativeCreateForm',
      )!;
      parent.slots = [];
      parent.cursor = 0;
      form = (create.type as (props: typeof create.props) => ReactElement<Record<string, unknown>>)(
        create.props,
      );
    } finally {
      parent.active = false;
    }
    const changes: Record<string, string> = {};
    const fields = (
      form.props.children as (
        values: Record<string, string>,
        change: (key: string, value: string) => void,
      ) => unknown
    )(
      {
        ...(form.props.initial as Record<string, string>),
        foreignMode: 'derived',
        targetTableId: 'a',
      },
      (key, value) => {
        changes[key] = value;
      },
    );
    const keyField = nodes(fields).find(
      (node) => node.type === NativeEditorField && node.props.label === '참조 키',
    )!;
    (keyField.props.onChange as (value: string) => void)('k');
    const ids = changes.generatedColumnIds!.split('\n');
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    (keyField.props.onChange as (value: string) => void)('');
    expect(changes.generatedColumnIds).toBe('');
  });
});

it('switches logical-only selection and editing on, then hides it without changing the document', () => {
  const snapshot = clipboardSnapshot();
  if (snapshot.native?.status !== 'available') throw Error('Expected native snapshot');
  const document = snapshot.native.document;
  document.tables![0]!.scope = 'logical';
  const original = JSON.stringify(document);
  const entry = projectEntry(snapshot);
  if (entry.kind !== 'native') throw Error('Expected native project');
  const render = () => {
    parent.active = true;
    parent.cursor = 0;
    try {
      return nodes(
        NativeProjectView({
          entry,
          userId: clipboardActor,
          canEdit: true,
          onLeave() {},
          onReload() {},
        }),
      );
    } finally {
      parent.active = false;
    }
  };
  let tree = render();
  const provider = tree.find((node) => node.type === NativeLogicalModeProvider)!;
  expect(provider.props.enabled).toBe(false);
  expect(tree.find((node) => node.type === NativeERDCanvas)!.props.mode).toBe('physical');
  expect(tree.some((node) => node.type === NativePropertyEditor)).toBe(false);
  (provider.props.onEnabledChange as (enabled: boolean) => void)(true);
  tree = render();
  expect(tree.find((node) => node.type === NativeERDCanvas)!.props.mode).toBe('logical');
  expect(tree.find((node) => node.type === NativePropertyEditor)!.props.mode).toBe('logical');
  expect(tree.find((node) => node.type === NativePropertyEditor)!.props.table).toEqual(
    document.tables![0],
  );
  (
    tree.find((node) => node.type === NativeLogicalModeProvider)!.props.onEnabledChange as (
      enabled: boolean,
    ) => void
  )(false);
  tree = render();
  expect(tree.find((node) => node.type === NativeERDCanvas)!.props.mode).toBe('physical');
  expect(tree.some((node) => node.type === NativePropertyEditor)).toBe(false);
  expect(JSON.stringify(document)).toBe(original);
});

function creationFixture() {
  const snapshot = clipboardSnapshot();
  const entry = projectEntry(snapshot);
  if (entry.kind !== 'native' || !entry.document) throw Error('Expected native project');
  const render = () => {
    parent.active = true;
    parent.cursor = 0;
    try {
      return nodes(
        NativeProjectView({
          entry,
          userId: clipboardActor,
          canEdit: true,
          onLeave() {},
          onReload() {},
        }),
      );
    } finally {
      parent.active = false;
    }
  };
  const table = createNativeTable(entry.document.database, 'instant', null, 'physical');
  const commands: NativeWebCommand[] = [
    { type: 'add_table', value: table },
    {
      type: 'add_table_reference',
      tableId: table.id,
      viewId: '__tables__',
      nodeId: 'instant-node',
      placement: { x: 120, y: 240 },
    },
  ];
  const canvas = () => render().find((node) => node.type === NativeERDCanvas)!;
  const save = (commands: NativeWebCommand[]) =>
    (canvas().props.onSave as (commands: NativeWebCommand[]) => Promise<boolean>)(commands);
  return { snapshot, entry, table, commands, render, canvas, save };
}

it('shows and selects a durable blank table before a delayed ACK and queues its edit after creation', async () => {
  vi.useFakeTimers();
  const ui = creationFixture();
  let resolveCreate!: (result: { operationId: string; accepted: boolean }) => void;
  transport.flush
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    )
    .mockResolvedValue(null);
  let completed = false;
  const creation = ui.save(ui.commands).then((accepted) => {
    completed = true;
    return accepted;
  });
  const canvas = ui.canvas();
  expect(canvas.props.selectedTableId).toBe('instant');
  const document = canvas.props.document as typeof ui.entry.document;
  expect(document!.tables!.find((table) => table.id === 'instant')!.physical.name).toBe('');
  expect(document!.layout.nodes.find((node) => node.id === 'instant-node')).toMatchObject({
    x: 120,
    y: 240,
  });
  expect(ui.render().find((node) => node.type === NativePropertyEditor)!.props.table).toMatchObject(
    { id: 'instant' },
  );
  expect(ui.entry.document!.tables!.some((table) => table.id === 'instant')).toBe(false);
  const patch = {
    type: 'patch_table',
    id: 'instant',
    patch: { physical: { name: 'typed' } },
  } as const;
  void ui.save([patch]);
  const intents = nativeSaveIntents(clipboardActor, ui.snapshot.project.id);
  expect(intents.map((intent) => intent.pending.request.commands[0]!.type)).toEqual([
    'add_table',
    'patch_table',
  ]);
  expect(intents[0]!.pending.request.commands).toEqual(ui.commands);
  await vi.advanceTimersByTimeAsync(0);
  expect(completed).toBe(false);
  resolveCreate({ operationId: intents[0]!.pending.request.operationId, accepted: true });
  expect(await creation).toBe(true);
  expect(ui.canvas().props.selectedTableId).toBe('instant');
});

it('rolls back a rejected creation preview while preserving the authoritative document', async () => {
  vi.useFakeTimers();
  const ui = creationFixture();
  const original = JSON.stringify(ui.entry.document);
  transport.flush
    .mockImplementationOnce(async () => ({
      operationId: nativeSaveIntents(clipboardActor, ui.snapshot.project.id)[0]!.pending.request
        .operationId,
      accepted: false,
    }))
    .mockResolvedValue(null);
  const saved = ui.save(ui.commands);
  expect(ui.canvas().props.selectedTableId).toBe('instant');
  await vi.advanceTimersByTimeAsync(0);
  expect(await saved).toBe(false);
  expect(ui.canvas().props.selectedTableId).toBeUndefined();
  expect(
    (ui.canvas().props.document as typeof ui.entry.document)!.tables!.some(
      (table) => table.id === 'instant',
    ),
  ).toBe(false);
  expect(JSON.stringify(ui.entry.document)).toBe(original);
});

it('does not show or select a preview when durable enqueue fails', async () => {
  vi.useFakeTimers();
  const ui = creationFixture();
  const selection = ui.canvas().props.selectedTableId;
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw Error('quota');
  });
  expect(await ui.save(ui.commands)).toBe(false);
  expect(ui.canvas().props.selectedTableId).toBe(selection);
  expect(
    (ui.canvas().props.document as typeof ui.entry.document)!.tables!.some(
      (table) => table.id === 'instant',
    ),
  ).toBe(false);
});
