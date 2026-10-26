import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNativeTableCanvasMetrics,
  nativeTableCanvasMetrics,
  createEmptyNativeDocument,
  createNativeTable,
  createNativeColumn,
  defaultDatabaseContext,
  addTableReference,
  type NativeDesignDocument,
} from '@ezerd/model';
import type { ProjectDocumentState } from '@ezerd/contracts';
import {
  NativeERDCanvas,
  nativeCanvasScene,
  nativeCanvasSceneMetrics,
  nativeCanvasPlacementDraftScene,
  nativeCanvasDraftScene,
  nativeCanvasMoveCommand,
  nativeCanvasWheel,
  nativeCanvasExportBlocker,
} from './NativeERDCanvas.js';
import { loadNativeEditorDraft, storeNativeEditorDraft } from './native-editor-draft.js';
import { request } from '../../shared/api/client.js';
import { IDBFactory } from 'fake-indexeddb';
import { getNativeDurableQueue } from './native-durable-queue.js';
import { setLocale } from '../../shared/i18n/index.js';
import { NativePropertyEditor } from './NativePropertyEditor.js';
import { NativeEditorForm } from './native-editor-form.js';

describe('native scene measurement reuse', () => {
  it('measures each table once when several foreign keys reuse its column ports', () => {
    const { document } = fixture();
    const relation = document.tableRelations![0]!;
    document.tableRelations = Array.from({ length: 12 }, (_, index) => ({
      ...relation,
      id: `reused-port-${index}`,
    }));
    const columnsFilter = vi.spyOn(document.columns!, 'filter');
    const relationsFilter = vi.spyOn(document.tableRelations, 'filter');
    const scene = nativeCanvasScene(document, '__tables__', 'physical');
    expect(scene.relations).toHaveLength(12);
    expect(columnsFilter).not.toHaveBeenCalled();
    expect(relationsFilter).not.toHaveBeenCalled();
    columnsFilter.mockRestore();
    relationsFilter.mockRestore();
  });

  it('reuses measured rows across layout previews while rerouting edges', () => {
    const { document } = fixture();
    const scene = nativeCanvasScene(document, '__tables__', 'physical');
    const table = document.tables![0]!;
    const metrics = nativeCanvasSceneMetrics(scene)!(table);
    const drawn = nativeCanvasDraftScene(
      document,
      scene,
      '__tables__',
      'physical',
      table.id,
      '420',
      '300',
    );
    expect(nativeCanvasSceneMetrics(drawn)!(table)).toBe(metrics);
    expect(drawn.relations[0]!.geometry.path).not.toEqual(scene.relations[0]!.geometry.path);
    expect(metrics).toEqual(nativeTableCanvasMetrics(document, table, 'physical'));
  });

  it.each(['physical', 'logical'] as const)(
    'indexed metrics match standalone metrics in %s mode and refresh content',
    (mode) => {
      const { document } = fixture();
      const indexed = createNativeTableCanvasMetrics(document, mode);
      for (const table of document.tables!) {
        expect(indexed(table)).toEqual(nativeTableCanvasMetrics(document, table, mode));
        expect(indexed(table)).toBe(indexed(table));
      }
      const table = document.tables![0]!;
      const before = indexed(table);
      document.columns![0]!.physical.comment = 'long comment '.repeat(70);
      document.columns![0]!.logical.definition = 'long definition '.repeat(70);
      const after = createNativeTableCanvasMetrics(document, mode)(table);
      expect(after.height).toBeGreaterThan(before.height);
      table.canvasDisplay = { showComment: false, showNullable: false };
      const hidden = createNativeTableCanvasMetrics(document, mode)(table);
      expect(hidden.widths).toHaveLength(3);
      expect(hidden.height).toBeLessThan(after.height);
    },
  );

  it('builds a group draft once and falls back to single placement for malformed groups', () => {
    const { document } = fixture();
    const scene = nativeCanvasScene(document, '__tables__', 'physical');
    const placements = scene.nodes.map((node) => ({ ...node, x: node.x + 100, y: node.y + 200 }));
    const values = {
      objectId: 'a',
      x: String(placements[0]!.x),
      y: String(placements[0]!.y),
      nodesJSON: JSON.stringify(placements),
    };
    const routing = vi.spyOn(document.tableRelations!, 'flatMap');
    const drawn = nativeCanvasPlacementDraftScene(
      document,
      scene,
      '__tables__',
      'physical',
      values,
    );
    expect(routing).toHaveBeenCalledTimes(1);
    expect(drawn.nodes).toEqual(placements);
    expect(nativeCanvasSceneMetrics(drawn)).toBe(nativeCanvasSceneMetrics(scene));
    routing.mockRestore();
    const expected = nativeCanvasDraftScene(
      document,
      scene,
      '__tables__',
      'physical',
      'a',
      values.x,
      values.y,
    );
    for (const nodesJSON of ['{', '{}', '[{}]']) {
      expect(
        nativeCanvasPlacementDraftScene(document, scene, '__tables__', 'physical', {
          ...values,
          nodesJSON,
        }),
      ).toEqual(expected);
    }
  });

  it('refreshes key and visibility changes and separates display modes', () => {
    const { document } = fixture();
    const table = document.tables![0]!;
    const original = createNativeTableCanvasMetrics(document, 'physical')(table);
    expect(original.rows[0]!.keys).toBe('FK');
    const changed = {
      ...document,
      keys: [
        ...document.keys!,
        {
          id: 'new-key',
          tableId: table.id,
          kind: 'unique' as const,
          scope: 'physical' as const,
          name: 'uq',
          columnIds: ['c'],
        },
      ],
    };
    expect(createNativeTableCanvasMetrics(changed, 'physical')(table).rows[0]!.keys).toBe('FK UQ');
    expect(createNativeTableCanvasMetrics(changed, 'logical')(table).rows[0]!.keys).toBe('FK');
    const hidden = {
      ...changed,
      columns: changed.columns!.map((column) => ({ ...column, scope: 'logical' as const })),
    };
    expect(createNativeTableCanvasMetrics(hidden, 'physical')(table).rows).toHaveLength(0);
    expect(createNativeTableCanvasMetrics(hidden, 'logical')(table).rows).toHaveLength(1);
  });

  it('refreshes enum display names and column types with new content', () => {
    const { document } = fixture();
    const table = document.tables![0]!;
    document.columns![0]!.physical.type = {
      kind: 'projectEnum',
      database: 'postgresql',
      enumId: 'e',
    };
    document.enums = [{ id: 'e', name: 'state', values: ['open'], schema: 'public' }];
    const before = createNativeTableCanvasMetrics(document, 'physical')(table);
    const renamed = { ...document, enums: [{ ...document.enums[0]!, name: 'renamed_state' }] };
    expect(createNativeTableCanvasMetrics(renamed, 'physical')(table).rows[0]!.type).toBe(
      'renamed_state',
    );
    expect(before.rows[0]!.type).toBe('state');
    const changed = {
      ...renamed,
      columns: renamed.columns!.map((column) => ({
        ...column,
        physical: {
          ...column.physical,
          type: {
            kind: 'projectEnum' as const,
            database: 'postgresql' as const,
            enumId: 'e',
            array: { dimensions: 2 },
          },
        },
      })),
    };
    expect(createNativeTableCanvasMetrics(changed, 'physical')(table).rows[0]!.type).toBe(
      'renamed_state[][]',
    );
  });

  it('remeasures mutated column data on the next build', () => {
    const { document } = fixture();
    const before = nativeCanvasScene(document, '__tables__', 'physical');
    document.columns![0]!.physical.comment = 'A much longer description '.repeat(40);
    const after = nativeCanvasScene(document, '__tables__', 'physical');
    expect(after.nodes.find((node) => node.objectId === 'a')!.height).toBeGreaterThan(
      before.nodes.find((node) => node.objectId === 'a')!.height,
    );
  });
});
const exportBlocker = vi.hoisted(() => vi.fn());
vi.mock('./native-export-state.js', () => ({ useNativeExportBlocker: exportBlocker }));
beforeEach(() => {
  vi.stubGlobal('localStorage', memory());
  vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(async () => {
  await getNativeDurableQueue().close();
  vi.unstubAllGlobals();
  exportBlocker.mockClear();
});
const userId = '00000000-0000-4000-8000-000000000001',
  projectId = '00000000-0000-4000-8000-000000000002';
function fixture(kind: 'postgresql' | 'mysql' | 'sqlite' = 'postgresql') {
  const database = defaultDatabaseContext(kind);
  const a = createNativeTable(database, 'a', 'd'),
    b = createNativeTable(database, 'b', 'd');
  a.physical.name = 'records';
  a.logical.name = 'Records';
  b.physical.name = 'owners';
  const c = createNativeColumn(database, a, 'c'),
    c2 = createNativeColumn(database, b, 'c2');
  c.physical.name = 'owner_id';
  c.physical.defaultValue = { kind: 'literal', literalType: 'number', value: '9007199254740993' };
  c2.physical.name = 'id';
  let document: NativeDesignDocument = {
    ...createEmptyNativeDocument(database),
    domains: [{ id: 'd', name: 'Domain', description: '' }],
    tables: [a, b],
    columns: [c, c2],
    keys: [
      { id: 'k', tableId: 'b', kind: 'primary', scope: 'both', name: 'pk', columnIds: ['c2'] },
    ],
    tableRelations: [
      {
        id: 'r',
        sourceTableId: 'a',
        targetTableId: 'b',
        scope: 'both',
        logical: { name: 'owns', cardinality: 'one-to-many', required: false },
        physical: {
          name: 'fk_owner',
          sourceColumnIds: ['c'],
          targetColumnIds: ['c2'],
          onDelete: 'NO ACTION',
          onUpdate: 'NO ACTION',
        },
      },
    ],
  };
  document = addTableReference(document, 'a', '__tables__', { x: -40, y: 20 });
  document = addTableReference(document, 'b', '__tables__', { x: 500, y: 30 });
  const snapshot: ProjectDocumentState = {
    protocolVersion: 2,
    project: {
      id: projectId,
      workspaceId: projectId,
      name: 'Native',
      status: 'active',
      version: 7,
      databaseKind: kind,
      databaseProfileId: database.profileId,
      databaseRevision: 3,
      createdAt: '2026-10-02T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
    },
    sequence: 10,
    sourceDocument: document,
    native: { status: 'available', document, issues: [], migrationIssues: [] },
  };
  return { document, snapshot };
}
function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
describe('native canvas IDs on HTTP LAN crypto', () => {
  it('renders recovered canvas action and fresh input revisions with only getRandomValues', () => {
    const f = fixture(),
      before = structuredClone(f.document);
    const getRandomValues = vi.fn(crypto.getRandomValues.bind(crypto));
    vi.stubGlobal('crypto', { getRandomValues });
    vi.stubGlobal('isSecureContext', false);
    const save = vi.fn(async () => true);
    const html = renderToStaticMarkup(
      createElement(NativeERDCanvas, {
        ...f,
        userId,
        recoverySelection: { action: { action: 'note', target: '' } },
        editable: true,
        busy: false,
        mode: 'physical',
        onSave: save,
        onReload() {},
        onSelect() {},
      }),
    );
    expect(html).toContain('native-erd-actions');
    expect(html).toContain('<form');
    expect(html).not.toContain('type="submit"');
    expect(crypto.randomUUID).toBeUndefined();
    expect(crypto.subtle).toBeUndefined();
    expect(getRandomValues).toHaveBeenCalled();
    const ids = getRandomValues.mock.results.map((result, index) => {
      if (result.type !== 'return' || !(result.value instanceof Uint8Array))
        throw Error('Expected generated bytes');
      const value = result.value,
        argument = getRandomValues.mock.calls[index]?.[0];
      if (!(argument instanceof Uint8Array)) throw Error('Expected random byte request');
      expect([...value]).toEqual([...argument]);
      expect(value.length).toBe(16);
      const hex = [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20),
      ].join('-');
    });
    for (const id of ids)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(ids).size).toBe(ids.length);
    expect(save).not.toHaveBeenCalled();
    expect(f.document).toEqual(before);
  });
});
describe('native ERD consumes raw native payloads', () => {
  it('does not expose legacy combined views as canvas screens', () => {
    const { document } = fixture();
    const legacy: NativeDesignDocument = {
      ...document,
      views: [{ id: 'legacy-private', name: 'Retired', domainIds: ['d'] }],
      layout: {
        ...document.layout,
        nodes: [
          ...document.layout.nodes,
          ...document.layout.nodes
            .filter((node) => document.tables?.some((table) => table.id === node.objectId))
            .map((node) => ({ ...node, id: `legacy:${node.id}`, viewId: 'legacy-private' })),
        ],
      },
    };
    const scene = nativeCanvasScene(legacy, 'legacy-private', 'physical');
    expect(scene.viewId).toBe('__tables__');
    expect(scene.nodes.every((node) => node.viewId === '__tables__')).toBe(true);
    expect(legacy.views).toHaveLength(1);
  });

  it.each(['ko', 'en'] as const)(
    'simplifies editable tools while preserving domain filters in %s',
    (locale) => {
      setLocale(locale);
      const f = fixture();
      const before = structuredClone(f.document);
      const html = renderToStaticMarkup(
        createElement(NativeERDCanvas, {
          document: f.document,
          snapshot: f.snapshot,
          userId,
          editable: true,
          busy: false,
          mode: 'physical',
          onSave: async () => true,
          onReload() {},
          onSelect() {},
        }),
      );
      expect(html).toContain(locale === 'ko' ? '도메인 필터' : 'Domain filter');
      expect(html).not.toMatch(
        /카메라 저장|Save camera|카메라 초기화|Reset camera|테이블 복사·붙여넣기|Copy and paste tables|보기 선택|Choose view|자동 배치|Automatic layout/,
      );
      expect(html).not.toContain('native-erd-actions');
      expect(html).not.toContain('Shared canvas / Personal view');
      expect(html).toContain('native-camera-controls');
      expect(f.document).toEqual(before);
      setLocale('ko');
    },
  );

  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'renders %s native labels, keys and FK lines without rewriting the document',
    (kind) => {
      setLocale('ko');
      const f = fixture(kind),
        before = structuredClone(f.document);
      const scene = nativeCanvasScene(f.document, '__tables__', 'physical');
      expect(scene.nodes).toHaveLength(2);
      expect(scene.relations).toHaveLength(1);
      expect(scene.relations[0]!.geometry.path).toMatch(/^M /);
      const html = renderToStaticMarkup(
        createElement(NativeERDCanvas, {
          ...f,
          editable: false,
          busy: false,
          onSave: async () => true,
          onReload() {},
          mode: 'physical',
          onSelect() {},
        }),
      );
      expect(html).toContain('data-relation-id="r"');
      expect(html).toContain('fk_owner');
      expect(html).toContain('data-column-id="c2"');
      expect(html).toContain('PK');
      expect(html).toContain('9007199254740993');
      expect(html).not.toContain('카메라 저장');
      expect(f.document).toEqual(before);
    },
  );
  it('filters logical scope and domain views without projecting a physical column type', () => {
    const f = fixture();
    f.document.tables![0]!.scope = 'logical';
    expect(
      nativeCanvasScene(f.document, '__tables__', 'physical').nodes.map((node) => node.objectId),
    ).toEqual(['b']);
    expect(nativeCanvasScene(f.document, 'd', 'logical').nodes).toHaveLength(2);
    f.document.tables![1]!.domainId = null;
    expect(
      nativeCanvasScene(f.document, 'd', 'logical').nodes.map((node) => node.objectId),
    ).toEqual(['a']);
  });
  it('uses raw node identity, and materializes reader-only table references before a move', () => {
    const f = fixture(),
      node = f.document.layout.nodes[0]!;
    expect(
      nativeCanvasMoveCommand(f.document, { ...node, id: 'preview-id' }, { x: 120, y: 90 }),
    ).toEqual({ type: 'update_node_layout', nodeId: node.id, patch: { x: 120, y: 90 } });
    const source = { ...f.document, layout: { ...f.document.layout, nodes: [] } };
    expect(nativeCanvasMoveCommand(source, node, { x: 10, y: 20 })).toMatchObject({
      type: 'add_table_reference',
      tableId: 'a',
      viewId: '__tables__',
      placement: { x: 10, y: 20 },
    });
    expect(() => nativeCanvasMoveCommand(f.document, node, { x: NaN, y: 0 })).toThrow();
  });
  it('keeps viewport zoom and pan in the shared structural bounds, including zoom above legacy canvas limit', () => {
    const event = {
      deltaX: 0,
      deltaY: -200,
      deltaMode: 0,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    };
    const camera = { viewId: '__tables__', x: -10, y: 5, zoom: 3.9 };
    expect(nativeCanvasWheel(camera, event, { x: 40, y: 40 }, 500).zoom).toBe(4);
    expect(
      nativeCanvasWheel({ ...camera, zoom: 0.1 }, { ...event, deltaY: 200 }, { x: 40, y: 40 }, 500)
        .zoom,
    ).toBe(0.1);
    expect(
      nativeCanvasWheel(camera, { ...event, ctrlKey: false, deltaX: -1e12 }, { x: 0, y: 0 }, 500).x,
    ).toBe(1e7);
  });
});
describe('native input registers export blockers even without a durable storage record', () => {
  it('excludes local cameras and personal placement input while retaining shared drafts and storage failures', () => {
    const f = fixture();
    const zoomed = {
      ...f.document,
      layout: {
        ...f.document.layout,
        viewports: [{ viewId: '__tables__', x: 600, y: -20, zoom: 4 }],
      },
    };
    expect(nativeCanvasExportBlocker(zoomed, null, false)).toEqual({
      dirty: false,
      storageFailure: false,
    });
    const sharedDraft = {
      userId,
      projectId,
      key: 'canvas:placement:__tables__',
      revision: crypto.randomUUID(),
      expected: { version: 7, sequence: 10, databaseRevision: 3 },
      before: { x: '10' },
      values: { x: '20', viewId: '__tables__' },
    };
    expect(nativeCanvasExportBlocker(zoomed, sharedDraft, false).dirty).toBe(true);
    const privateDraft = {
      ...sharedDraft,
      key: 'canvas:placement:v',
      values: { ...sharedDraft.values, viewId: 'v' },
    };
    expect(nativeCanvasExportBlocker(zoomed, privateDraft, false).dirty).toBe(false);
    expect(nativeCanvasExportBlocker(zoomed, null, true)).toEqual({
      dirty: false,
      storageFailure: true,
    });
  });
  it('omits passive personal-view notices and leaves unchanged structured forms clean', () => {
    setLocale('ko');
    const f = fixture();
    const html = renderToStaticMarkup(
      createElement(NativeERDCanvas, {
        ...f,
        userId,
        editable: true,
        busy: false,
        onSave: async () => true,
        onReload() {},
        mode: 'physical',
        onSelect() {},
      }),
    );
    expect(html).not.toContain(
      '개인 화면 저장은 아직 지원하지 않습니다. 이 프로젝트에서는 공유 캔버스를 사용해 주세요.',
    );
    expect(html).not.toContain('개인 화면을 불러오는 중입니다.');
    expect(html).not.toContain('DB 문맥 보호가 아직 연결되지');
    const onSave = vi.fn(async () => true);
    const cleanForm = renderToStaticMarkup(
      createElement(NativeEditorForm, {
        context: { userId, snapshot: f.snapshot, busy: false, onSave },
        draftKey: 'clean',
        title: 'Form',
        initial: { name: 'same' },
        build: () => [],
        children: () => null,
      }),
    );
    expect(cleanForm).not.toContain('type="submit"');
    expect(exportBlocker.mock.calls).toContainEqual([
      userId,
      projectId,
      false,
      false,
      'editor:clean',
    ]);
    expect(onSave).not.toHaveBeenCalled();
  });
  it('blocks basic property export when storage cannot load, even though fresh values are clean', () => {
    const f = fixture();
    vi.stubGlobal('localStorage', {
      ...memory(),
      getItem() {
        throw new Error('Storage denied');
      },
    });
    renderToStaticMarkup(
      createElement(NativePropertyEditor, {
        table: f.document.tables![0]!,
        userId,
        snapshot: f.snapshot,
        busy: false,
        onSave: async () => true,
      }),
    );
    expect(exportBlocker.mock.calls).toContainEqual([
      userId,
      projectId,
      false,
      true,
      'property:table:a',
    ]);
  });
  it('blocks structured form export on loaded dirty input and isolates the actor/project scope', () => {
    const f = fixture(),
      store = memory();
    storeNativeEditorDraft(
      {
        userId,
        projectId,
        key: 'form',
        revision: crypto.randomUUID(),
        expected: { version: 7, sequence: 10, databaseRevision: 3 },
        before: { name: 'old' },
        values: { name: 'unsaved' },
      },
      store,
    );
    vi.stubGlobal('localStorage', store);
    const onSave = vi.fn(async () => true);
    const html = renderToStaticMarkup(
      createElement(NativeEditorForm, {
        context: { userId, snapshot: f.snapshot, busy: false, onSave },
        draftKey: 'form',
        title: 'Form',
        initial: { name: 'old' },
        build: () => [],
        children: () => null,
      }),
    );
    expect(exportBlocker.mock.calls).toContainEqual([
      userId,
      projectId,
      true,
      false,
      'editor:form',
    ]);
    expect(html).not.toContain('type="submit"');
    expect(loadNativeEditorDraft(userId, projectId, 'form')?.values).toEqual({ name: 'unsaved' });
    expect(onSave).not.toHaveBeenCalled();
  });
  it('blocks canvas form export on storage failure and rejects pending staging before any PUT', async () => {
    const f = fixture(),
      store = {
        ...memory(),
        getItem() {
          throw new Error('Storage denied');
        },
      };
    vi.stubGlobal('localStorage', store);
    renderToStaticMarkup(
      createElement(NativeERDCanvas, {
        ...f,
        userId,
        recoverySelection: { action: { action: 'note', target: '' } },
        editable: true,
        busy: false,
        onSave: async () => true,
        onReload() {},
        mode: 'physical',
        onSelect() {},
      }),
    );
    expect(exportBlocker.mock.calls).toContainEqual([
      userId,
      projectId,
      false,
      true,
      'canvas:canvas:action:__tables__:note:',
    ]);
  });
});

describe('native scene reuse', () => {
  function previousDraw(
    document: NativeDesignDocument,
    view: string,
    mode: 'physical' | 'logical',
    objectId?: string,
    x?: string,
    y?: string,
  ) {
    const scene = nativeCanvasScene(document, view, mode);
    const displayed = scene.nodes.map((node) =>
      node.objectId === objectId ? { ...node, x: Number(x), y: Number(y) } : node,
    );
    return nativeCanvasScene(
      {
        ...document,
        layout: {
          ...document.layout,
          nodes: document.layout.nodes.map(
            (node) => displayed.find((shown) => shown.id === node.id) ?? node,
          ),
        },
      },
      view,
      mode,
    );
  }
  it.each(['physical', 'logical'] as const)(
    'preserves existing geometry with and without placement drafts in %s mode',
    (mode) => {
      const { document } = fixture();
      const original = structuredClone(document);
      for (const view of ['__tables__', 'd', 'overview']) {
        const scene = nativeCanvasScene(document, view, mode);
        for (const [id, x, y] of [
          [undefined, undefined, undefined],
          ['a', '140', '220'],
          ['missing', '1', '2'],
          ['d', '100', '300'],
        ] as const) {
          expect(nativeCanvasDraftScene(document, scene, view, mode, id, x, y)).toEqual(
            previousDraw(document, view, mode, id, x, y),
          );
        }
      }
      expect(document).toEqual(original);
    },
  );
  it('returns the same scene for absent, hidden, generated or unchanged placement targets', () => {
    const { document } = fixture();
    const scene = nativeCanvasScene(document, '__tables__', 'physical');
    expect(nativeCanvasDraftScene(document, scene, '__tables__', 'physical')).toBe(scene);
    expect(
      nativeCanvasDraftScene(document, scene, '__tables__', 'physical', 'missing', '0', '0'),
    ).toBe(scene);
    const node = scene.nodes.find((node) => node.objectId === 'a')!;
    expect(
      nativeCanvasDraftScene(
        document,
        scene,
        '__tables__',
        'physical',
        'a',
        String(node.x),
        String(node.y),
      ),
    ).toBe(scene);
    const overview = nativeCanvasScene(document, 'overview', 'physical');
    expect(nativeCanvasDraftScene(document, overview, 'overview', 'physical', 'a', '5', '6')).toBe(
      overview,
    );
    expect(nativeCanvasDraftScene(document, overview, 'overview', 'physical', 'd', '5', '6')).toBe(
      overview,
    );
  });
  it('moves the draft node and recomputes its FK without changing the original scene', () => {
    const { document } = fixture();
    const scene = nativeCanvasScene(document, '__tables__', 'physical');
    const before = structuredClone(scene);
    const drawn = nativeCanvasDraftScene(
      document,
      scene,
      '__tables__',
      'physical',
      'a',
      '140',
      '220',
    );
    expect(drawn.nodes.find((node) => node.objectId === 'a')).toMatchObject({ x: 140, y: 220 });
    expect(drawn.relations[0]!.geometry.path).not.toEqual(scene.relations[0]!.geometry.path);
    expect(scene).toEqual(before);
    expect(nativeCanvasDraftScene(document, scene, '__tables__', 'physical')).toBe(scene);
  });
});

describe('native display-only domain filtering', () => {
  it('filters shared nodes and routes without altering the source, including draft preview', () => {
    const { document } = fixture();
    document.domains.push({ id: 'second', name: 'Second', description: '' });
    document.tables![1]!.domainId = 'second';
    const before = structuredClone(document),
      filter = { domainIds: ['d'], unassigned: false };
    const scene = nativeCanvasScene(document, '__tables__', 'physical', filter);
    expect(scene.nodes.map((node) => node.objectId)).toEqual(['a']);
    expect(scene.relations).toEqual([]);
    const drawn = nativeCanvasDraftScene(
      document,
      scene,
      '__tables__',
      'physical',
      'a',
      '200',
      '100',
      filter,
    );
    expect(drawn.nodes.map((node) => node.objectId)).toEqual(['a']);
    expect(drawn.nodes[0]).toMatchObject({ x: 200, y: 100 });
    expect(
      nativeCanvasScene(document, '__tables__', 'physical', { domainIds: [], unassigned: false })
        .nodes,
    ).toEqual([]);
    expect(nativeCanvasScene(document, '__tables__', 'physical', null).nodes).toHaveLength(2);
    expect(document).toEqual(before);
  });
});

describe('native resize draft', () => {
  it('previews size and reroutes edges without changing the saved document', () => {
    const { document } = fixture();
    const before = structuredClone(document),
      scene = nativeCanvasScene(document, '__tables__', 'physical');
    const node = scene.nodes.find((item) => item.objectId === 'a')!;
    const width = node.width + 150,
      height = node.height + 120;
    const drawn = nativeCanvasDraftScene(
      document,
      scene,
      '__tables__',
      'physical',
      'a',
      String(node.x),
      String(node.y),
      null,
      String(width),
      String(height),
    );
    expect(drawn.nodes.find((item) => item.objectId === 'a')).toMatchObject({ width, height });
    expect(drawn.relations[0]!.geometry.path).not.toEqual(scene.relations[0]!.geometry.path);
    expect(
      nativeCanvasMoveCommand(document, node, { x: node.x, y: node.y, width, height }),
    ).toMatchObject({ type: 'update_node_layout', patch: { width, height } });
    expect(document).toEqual(before);
  });
});
