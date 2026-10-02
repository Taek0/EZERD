import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyNativeDocument,
  createNativeTable,
  createNativeColumn,
  defaultDatabaseContext,
  addTableReference,
  upsertCombinedView,
  mergeStoredPersonalState,
  extractPersonalState,
  type NativeDesignDocument,
} from '@ezerd/model';
import type { ProjectDocumentState } from '@ezerd/contracts';
import {
  NativeERDCanvas,
  nativeCanvasScene,
  nativeCanvasMoveCommand,
  nativeCanvasPersonalCandidate,
  nativeCanvasWheel,
  nativeCanvasExportBlocker,
  stageNativeCanvasPersonal,
  recoverNativeCanvasPersonal,
  loadNativeCanvasPersonalPending,
} from './NativeERDCanvas.js';
import { loadNativeEditorDraft, storeNativeEditorDraft } from './native-editor-draft.js';
import { request } from '../../shared/api/client.js';
import { setLocale } from '../../shared/i18n/index.js';
import { NativePropertyEditor } from './NativePropertyEditor.js';
import { NativeEditorForm } from './native-editor-form.js';
const exportBlocker = vi.hoisted(() => vi.fn());
vi.mock('./native-export-state.js', () => ({ useNativeExportBlocker: exportBlocker }));
afterEach(() => {
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
function personalFixture() {
  const f = fixture();
  const candidate = upsertCombinedView(f.document, { id: 'v', name: 'Private', domainIds: ['d'] });
  const personal = {
    version: 2,
    projectVersion: 7,
    syncSequence: 10,
    state: extractPersonalState(candidate),
  };
  return { ...f, candidate, personal };
}
describe('native ERD consumes raw native payloads', () => {
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
describe('native private canvas stays separate from shared state', () => {
  it('allows only private layouts/notes/references, preserves native data, and keeps shared cameras personal', () => {
    const f = personalFixture(),
      before = structuredClone(f.document);
    const node = f.candidate.layout.nodes.find((node) => node.viewId === 'v')!;
    const moved = nativeCanvasPersonalCandidate(f.candidate, {
      type: 'update_node_layout',
      nodeId: node.id,
      patch: { x: 99 },
    });
    expect(moved.layout.nodes.find((item) => item.id === node.id)!.x).toBe(99);
    expect(moved.columns).toEqual(before.columns);
    expect(moved.tables).toEqual(before.tables);
    expect(() =>
      nativeCanvasPersonalCandidate(f.candidate, {
        type: 'update_node_layout',
        nodeId: before.layout.nodes[0]!.id,
        patch: { x: 99 },
      }),
    ).toThrow('canvas.personal-view-required');
    const camera = nativeCanvasPersonalCandidate(f.candidate, {
      type: 'set_viewport',
      value: { viewId: '__tables__', x: 80, y: 30, zoom: 4 },
    });
    expect(
      extractPersonalState(camera).viewports.find((viewport) => viewport.viewId === '__tables__')!
        .zoom,
    ).toBe(4);
    expect(camera.columns).toEqual(before.columns);
  });
  it('persists personal pending before PUT, isolates users and confirms a lost ACK without sending twice', async () => {
    const f = personalFixture(),
      store = memory();
    const changed = nativeCanvasPersonalCandidate(f.candidate, {
      type: 'set_viewport',
      value: { viewId: 'v', x: 70, y: 90, zoom: 2 },
    });
    const pending = stageNativeCanvasPersonal(userId, f.snapshot, f.personal, changed, store);
    expect(loadNativeCanvasPersonalPending(userId, projectId, store)).toEqual(pending);
    expect(loadNativeCanvasPersonalPending(projectId, projectId, store)).toBeNull();
    const saved = { ...f.personal, version: 3, state: pending.state };
    const api = vi.fn().mockResolvedValue(saved);
    const archived = {
      ...f.snapshot,
      project: { ...f.snapshot.project, status: 'archived' as const, databaseRevision: 4 },
    };
    await recoverNativeCanvasPersonal(pending, archived, false, store, api as typeof request);
    expect(api).toHaveBeenCalledTimes(1);
    expect(loadNativeCanvasPersonalPending(userId, projectId, store)).toBeNull();
  });
  it('only replays an unchanged personal baseline and includes the expected native DB revision', async () => {
    const f = personalFixture(),
      store = memory();
    const changed = nativeCanvasPersonalCandidate(f.candidate, {
      type: 'set_viewport',
      value: { viewId: 'v', x: 12, y: 20, zoom: 1.5 },
    });
    const pending = stageNativeCanvasPersonal(userId, f.snapshot, f.personal, changed, store);
    const api = vi
      .fn()
      .mockResolvedValueOnce(f.personal)
      .mockResolvedValueOnce({ ...f.personal, version: 3, state: pending.state });
    await recoverNativeCanvasPersonal(pending, f.snapshot, true, store, api as typeof request);
    expect(JSON.parse((api.mock.calls[1]![1] as RequestInit).body as string)).toMatchObject({
      expectedVersion: 2,
      expectedDatabaseRevision: 3,
      state: pending.state,
    });
  });
  it.each(['context', 'sequence', 'version', 'personal', 'readonly'])(
    'keeps unconfirmed input and refuses a %s replay',
    async (reason) => {
      const f = personalFixture(),
        store = memory();
      const changed = nativeCanvasPersonalCandidate(f.candidate, {
        type: 'set_viewport',
        value: { viewId: 'v', x: 12, y: 20, zoom: 1.5 },
      });
      const pending = stageNativeCanvasPersonal(userId, f.snapshot, f.personal, changed, store);
      const current = structuredClone(f.personal),
        snapshot = structuredClone(f.snapshot);
      if (reason === 'context') snapshot.project.databaseRevision++;
      if (reason === 'sequence') snapshot.sequence++;
      if (reason === 'version') snapshot.project.version++;
      if (reason === 'personal') current.version++;
      const api = vi.fn().mockResolvedValue(current);
      await expect(
        recoverNativeCanvasPersonal(
          pending,
          snapshot,
          reason !== 'readonly',
          store,
          api as typeof request,
        ),
      ).rejects.toThrow();
      expect(api).toHaveBeenCalledTimes(1);
      expect(loadNativeCanvasPersonalPending(userId, projectId, store)).toEqual(pending);
    },
  );
  it('clears only the captured canvas draft revision when a delayed personal ACK is confirmed', async () => {
    const f = personalFixture(),
      store = memory(),
      revision = crypto.randomUUID();
    const draft = {
      userId,
      projectId,
      key: 'canvas:placement:v',
      revision,
      expected: { version: 7, sequence: 10, databaseRevision: 3 },
      before: { x: '0' },
      values: { x: '100' },
    };
    storeNativeEditorDraft(draft, store);
    const changed = nativeCanvasPersonalCandidate(f.candidate, {
      type: 'set_viewport',
      value: { viewId: 'v', x: 12, y: 20, zoom: 1.5 },
    });
    const pending = stageNativeCanvasPersonal(userId, f.snapshot, f.personal, changed, store, {
      key: draft.key,
      revision,
    });
    const newer = { ...draft, revision: crypto.randomUUID(), values: { x: '150' } };
    storeNativeEditorDraft(newer, store);
    await recoverNativeCanvasPersonal(
      pending,
      f.snapshot,
      true,
      store,
      vi
        .fn()
        .mockResolvedValue({ ...f.personal, version: 3, state: pending.state }) as typeof request,
    );
    expect(loadNativeEditorDraft(userId, projectId, draft.key, store)).toEqual(newer);
  });
  it('keeps private pending after a malformed ACK and never overwrites a newer personal revision', async () => {
    const f = personalFixture(),
      store = memory();
    const changed = nativeCanvasPersonalCandidate(f.candidate, {
      type: 'set_viewport',
      value: { viewId: 'v', x: 12, y: 20, zoom: 1.5 },
    });
    const pending = stageNativeCanvasPersonal(userId, f.snapshot, f.personal, changed, store);
    const api = vi
      .fn()
      .mockResolvedValueOnce(f.personal)
      .mockResolvedValueOnce({ ...f.personal, version: 4, state: pending.state });
    await expect(
      recoverNativeCanvasPersonal(pending, f.snapshot, true, store, api as typeof request),
    ).rejects.toThrow('native.ack-mismatch');
    expect(loadNativeCanvasPersonalPending(userId, projectId, store)).toEqual(pending);
    expect(() => stageNativeCanvasPersonal(userId, f.snapshot, f.personal, changed, store)).toThrow(
      'native.pending-exists',
    );
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
  it('uses a feature availability message and disables unchanged structured form saves', () => {
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
    expect(html).toContain(
      '개인 화면 저장은 아직 지원하지 않습니다. 이 프로젝트에서는 공유 캔버스를 사용해 주세요.',
    );
    expect(html).not.toContain('DB 문맥 보호가 아직 연결되지');
    const cleanForm = renderToStaticMarkup(
      createElement(NativeEditorForm, {
        context: { userId, snapshot: f.snapshot, busy: false, onSave: async () => true },
        draftKey: 'clean',
        title: 'Form',
        initial: { name: 'same' },
        build: () => [],
        children: () => null,
      }),
    );
    expect(cleanForm.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0]).toContain('disabled=""');
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
    expect(exportBlocker.mock.calls).toContainEqual([userId, projectId, false, true]);
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
    const html = renderToStaticMarkup(
      createElement(NativeEditorForm, {
        context: { userId, snapshot: f.snapshot, busy: false, onSave: async () => true },
        draftKey: 'form',
        title: 'Form',
        initial: { name: 'old' },
        build: () => [],
        children: () => null,
      }),
    );
    expect(exportBlocker.mock.calls).toContainEqual([userId, projectId, true, false]);
    expect(html.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0]).not.toContain('disabled=""');
  });
  it('blocks canvas form export on storage failure and rejects pending staging before any PUT', () => {
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
        editable: true,
        busy: false,
        onSave: async () => true,
        onReload() {},
        mode: 'physical',
        onSelect() {},
      }),
    );
    expect(exportBlocker.mock.calls).toContainEqual([userId, projectId, false, true]);
    const privateF = personalFixture();
    expect(() =>
      stageNativeCanvasPersonal(
        userId,
        privateF.snapshot,
        privateF.personal,
        privateF.candidate,
        store,
      ),
    ).toThrow('Storage denied');
  });
});
