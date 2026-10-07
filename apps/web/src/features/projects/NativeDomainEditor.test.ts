import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeDomainCommandSchema, type ProjectDocumentState } from '@ezerd/contracts';
import {
  addTableReference,
  createEmptyNativeDocument,
  createNativeTable,
  createNativeColumn,
  defaultDatabaseContext,
  moveNativeTableDomain,
  removeNativeDomain,
  inspectNativeLegacyChanges,
  type NativeDesignDocument,
} from '@ezerd/model';
import {
  NativeDomainEditor,
  NativeDomainDeletionImpact,
  nativeDomainUICommands,
  nativeDomainReviewToken,
  nativeDomainDeletionPreview,
} from './NativeDomainEditor.js';
import { NativeERDCanvas, nativeCanvasScene, nativeCanvasMoveCommand } from './NativeERDCanvas.js';
import { NativeProjectView } from './NativeProjectView.js';
import { storeNativeEditorDraft, loadNativeEditorDraft } from './native-editor-draft.js';
import { setLocale } from '../../shared/i18n/index.js';
import {
  stageNativeSave,
  loadNativePending,
  recoverNativePending,
  sendNativePending,
} from './native-save.js';
import { request } from '../../shared/api/client.js';
import {
  createNativeTestIndexedDB,
  nativeTestIndexedDBAvailable,
} from './native-durable-test-environment.js';

vi.mock('./native-export-state.js', () => ({
  useNativeExportBlocker: vi.fn(),
  useNativeDurableState: () => 'empty',
  useNativeExportBlocked: () => false,
}));
const userId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
function fixture(kind: 'postgresql' | 'mysql' | 'sqlite' = 'postgresql') {
  const database = defaultDatabaseContext(kind);
  const a = createNativeTable(database, 'a', 'd1'),
    b = createNativeTable(database, 'b', 'd2');
  a.physical.name = 'orders';
  b.physical.name = 'audit';
  const ca = createNativeColumn(database, a, 'ca'),
    cb = createNativeColumn(database, b, 'cb');
  ca.physical.name = 'amount';
  cb.physical.name = 'copy';
  ca.physical.type = {
    kind: 'legacy',
    source: 'document-v1',
    original: { name: 'opaque', isArray: false },
  };
  ca.physical.defaultValue = { kind: 'legacyExpression', source: 'document-v1', original: 'old()' };
  a.physical.namespace = { kind: 'legacyNamespace', source: 'document-v1', original: 'public' };
  let document: NativeDesignDocument = {
    ...createEmptyNativeDocument(database),
    domains: [
      { id: 'd1', name: 'Orders', description: '<domain>', color: '#123456' },
      { id: 'd2', name: 'Audit', description: '' },
    ],
    tables: [a, b],
    columns: [ca, cb],
    keys: [
      {
        id: 'k',
        tableId: 'a',
        kind: 'primary',
        name: 'pk_orders',
        columnIds: ['ca'],
        scope: 'both',
      },
    ],
    tableRelations: [
      {
        id: 'fk',
        sourceTableId: 'b',
        targetTableId: 'a',
        scope: 'both',
        logical: { name: 'audits', cardinality: 'one-to-many', required: false },
        physical: {
          name: 'fk_audit',
          sourceColumnIds: ['cb'],
          targetColumnIds: ['ca'],
          onDelete: 'NO ACTION',
          onUpdate: 'NO ACTION',
        },
      },
    ],
    layout: {
      nodes: [
        { id: 'nd1', objectId: 'd1', viewId: 'overview', x: -30, y: 10, width: 240, height: 210 },
      ],
      viewports: [],
    },
  };
  document = addTableReference(document, 'a', '__tables__', { x: 5, y: 6 });
  document = addTableReference(document, 'b', '__tables__', { x: 400, y: 6 });
  document = addTableReference(document, 'a', 'd1', { x: 20, y: 30 });
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
afterEach(() => vi.unstubAllGlobals());
const confirmed = (
  snapshot: ProjectDocumentState,
  action: 'delete' | 'move',
  id: string,
  values: Record<string, string>,
): Record<string, string> => ({
  ...values,
  reviewToken: nativeDomainReviewToken(snapshot, action, id, values),
});

describe('native domain UI command consumption', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'creates and patches %s metadata without changing native or legacy fields',
    (kind) => {
      const { document, snapshot } = fixture(kind),
        before = structuredClone(document);
      const create = nativeDomainUICommands(
        document,
        snapshot,
        'create',
        '',
        {
          id: 'new',
          nodeId: 'new-node',
          name: 'New',
          description: '',
          color: '',
          x: '-100',
          y: '200',
        },
        {},
      );
      expect(create).toEqual([
        {
          type: 'add_domain',
          value: { id: 'new', name: 'New', description: '' },
          nodeId: 'new-node',
          placement: { x: -100, y: 200 },
        },
      ]);
      create.forEach((command) =>
        expect(nativeDomainCommandSchema.safeParse(command).success).toBe(true),
      );
      const baseline = { name: 'Orders', description: '<domain>', color: '#123456' };
      expect(
        nativeDomainUICommands(
          document,
          snapshot,
          'edit',
          'd1',
          { ...baseline, name: 'Sales', color: '' },
          baseline,
        ),
      ).toEqual([{ type: 'patch_domain', id: 'd1', patch: { name: 'Sales', color: null } }]);
      expect(nativeDomainUICommands(document, snapshot, 'edit', 'd1', baseline, baseline)).toEqual(
        [],
      );
      expect(document).toEqual(before);
    },
  );
  it('requires explicit deletion policy, full impact confirmation and generated-column cascade', () => {
    const { document, snapshot } = fixture();
    expect(nativeDomainDeletionPreview(document, 'd1', { policy: 'rejectNonempty' }).code).toBe(
      'domain.not-empty',
    );
    expect(nativeDomainDeletionPreview(document, 'd1', { policy: 'unknown' }).code).toBe(
      'domain.removal-policy-invalid',
    );
    expect(() =>
      nativeDomainUICommands(document, snapshot, 'delete', 'd1', { policy: 'deleteTables' }, {}),
    ).toThrow('domain.review-required');
    document.columns![1]!.physical.generation = {
      kind: 'computed',
      database: 'postgresql',
      storage: 'stored',
      expression: { kind: 'column', columnId: 'ca' },
    };
    const blocked = nativeDomainDeletionPreview(document, 'd1', {
      policy: 'deleteTables',
      cascade: 'false',
    });
    expect(blocked.code).toBe('deletion.expression-dependent');
    expect(blocked.plan!.document).toEqual(document);
    const values = confirmed(snapshot, 'delete', 'd1', { policy: 'deleteTables', cascade: 'true' });
    const command = nativeDomainUICommands(document, snapshot, 'delete', 'd1', values, {})[0]!;
    expect(command).toEqual({
      type: 'delete_domain',
      id: 'd1',
      policy: { kind: 'deleteTables', cascadeGeneratedColumns: true },
    });
    const plan = nativeDomainDeletionPreview(document, 'd1', values).plan!;
    expect(plan.deletion!.cascadedColumnIds).toEqual(['cb']);
    expect(plan.deletion!.removed).toEqual(
      expect.arrayContaining([
        { collection: 'tables', id: 'a' },
        { collection: 'tableRelations', id: 'fk' },
        { collection: 'keys', id: 'k' },
      ]),
    );
    expect(plan.document).toEqual(
      removeNativeDomain(document, 'd1', { kind: 'deleteTables', cascadeGeneratedColumns: true }),
    );
  });
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'moves %s tables or dissolves the domain without copying legacy data',
    (kind) => {
      const { document, snapshot } = fixture(kind),
        before = structuredClone(document);
      const values = confirmed(snapshot, 'move', 'a', { targetDomainId: 'd2' });
      expect(nativeDomainUICommands(document, snapshot, 'move', 'a', values, {})).toEqual([
        { type: 'move_table_domain', tableId: 'a', targetDomainId: 'd2' },
      ]);
      const moved = moveNativeTableDomain(document, 'a', 'd2');
      expect(inspectNativeLegacyChanges(moved, document)).toEqual([]);
      for (const key of ['columns', 'keys', 'tableRelations'] as const)
        expect(moved[key]).toEqual(document[key]);
      expect(moved.tables![0]!.physical).toEqual(document.tables![0]!.physical);
      expect(
        moved.layout.nodes.find((node) => node.objectId === 'a' && node.viewId === '__tables__'),
      ).toEqual(
        document.layout.nodes.find((node) => node.objectId === 'a' && node.viewId === '__tables__'),
      );
      expect(
        nativeDomainUICommands(document, snapshot, 'move', 'a', { targetDomainId: 'd1' }, {}),
      ).toEqual([]);
      const deletion = confirmed(snapshot, 'delete', 'd1', {
        policy: 'moveTables',
        targetDomainId: '',
      });
      expect(nativeDomainUICommands(document, snapshot, 'delete', 'd1', deletion, {})).toEqual([
        { type: 'delete_domain', id: 'd1', policy: { kind: 'moveTables', targetDomainId: null } },
      ]);
      expect(nativeDomainDeletionPreview(document, 'd1', deletion).plan!.movedTableIds).toEqual([
        'a',
      ]);
      expect(document).toEqual(before);
    },
  );
  it.each(['version', 'sequence', 'databaseRevision', 'policy', 'target', 'cascade'])(
    'invalidates review after %s changes',
    (field) => {
      const { document, snapshot } = fixture();
      const values = confirmed(snapshot, 'delete', 'd1', {
        policy: 'moveTables',
        targetDomainId: 'd2',
        cascade: 'false',
      });
      if (field === 'sequence') snapshot.sequence++;
      else if (field === 'version' || field === 'databaseRevision') snapshot.project[field]++;
      else if (field === 'policy') values.policy = 'deleteTables';
      else if (field === 'target') values.targetDomainId = '';
      else values.cascade = 'true';
      expect(() => nativeDomainUICommands(document, snapshot, 'delete', 'd1', values, {})).toThrow(
        'domain.review-required',
      );
    },
  );
  it('rejects missing targets, unconfirmed moves, duplicate creation and ownership in metadata patches', () => {
    const { document, snapshot } = fixture();
    expect(() =>
      nativeDomainUICommands(document, snapshot, 'move', 'a', { targetDomainId: 'missing' }, {}),
    ).toThrow();
    expect(() =>
      nativeDomainUICommands(document, snapshot, 'move', 'a', { targetDomainId: 'd2' }, {}),
    ).toThrow('domain.move-review-required');
    expect(() =>
      nativeDomainUICommands(
        document,
        snapshot,
        'create',
        '',
        { id: 'd1', nodeId: 'fresh', name: 'copy', description: '', x: '0', y: '0' },
        {},
      ),
    ).toThrow();
    expect(
      nativeDomainCommandSchema.safeParse({
        type: 'patch_domain',
        id: 'd1',
        patch: { tableIds: ['b'] },
      }).success,
    ).toBe(false);
    expect(() =>
      nativeDomainUICommands(
        document,
        snapshot,
        'create',
        '',
        { id: 'fresh', nodeId: 'fresh-node', name: '', description: '', x: 'NaN', y: '0' },
        {},
      ),
    ).toThrow();
  });
});

describe('domain forms and overview static UI', () => {
  it('creates domain/node IDs and a fresh input revision without secure-context randomUUID', () => {
    vi.stubGlobal('localStorage', memory());
    const getRandomValues = vi.fn(crypto.getRandomValues.bind(crypto));
    vi.stubGlobal('crypto', { getRandomValues });
    vi.stubGlobal('isSecureContext', false);
    const f = fixture(),
      before = structuredClone(f.document);
    const save = vi.fn(async () => true);
    const html = renderToStaticMarkup(
      createElement(NativeDomainEditor, {
        ...f,
        userId,
        editable: true,
        busy: false,
        onSave: save,
      }),
    );
    expect(crypto.randomUUID).toBeUndefined();
    expect(html).toContain('type="submit"');
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
  it.each([false, true])(
    'keeps readonly/archived domain metadata visible without write controls (%s)',
    (archived) => {
      setLocale('ko');
      const f = fixture();
      if (archived) f.snapshot.project.status = 'archived';
      const html = renderToStaticMarkup(
        createElement(NativeDomainEditor, {
          ...f,
          userId,
          editable: archived,
          busy: false,
          onSave: async () => true,
        }),
      );
      expect(html).toContain('Orders');
      expect(html).toContain('&lt;domain&gt;');
      expect(html).toContain('조회 전용');
      expect(html).not.toContain('<form');
      expect(html).not.toContain('type="submit"');
    },
  );
  it('preserves a stored draft across a remote revision without blocking its save', () => {
    setLocale('ko');
    vi.stubGlobal('localStorage', memory());
    const f = fixture();
    const props = {
      ...f,
      userId,
      editable: true,
      busy: true,
      selectedDomainId: 'd1',
      onSave: async () => true,
    };
    const clean = renderToStaticMarkup(createElement(NativeDomainEditor, props));
    expect(clean).toContain('<fieldset disabled=""');
    expect(clean.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0]).toContain('disabled=""');
    const draft = {
      userId,
      projectId,
      key: 'edit:domain:d1',
      revision: crypto.randomUUID(),
      expected: { version: 7, sequence: 10, databaseRevision: 3 },
      before: { name: 'Orders' },
      values: { name: 'Unsaved domain' },
    };
    storeNativeEditorDraft(draft);
    f.snapshot.project.version++;
    const changed = renderToStaticMarkup(
      createElement(NativeDomainEditor, { ...props, busy: false }),
    );
    expect(changed).toContain('Unsaved domain');
    expect(changed).not.toContain('저장 기준이 변경되었습니다.');
    expect(loadNativeEditorDraft(userId, projectId, draft.key)).toEqual(draft);
    expect(changed.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0]).not.toContain('disabled=""');
    f.snapshot.project.databaseRevision++;
    const changedDatabase = renderToStaticMarkup(
      createElement(NativeDomainEditor, { ...props, busy: false }),
    );
    expect(changedDatabase).toContain('DB 설정이 변경되었습니다.');
    expect(changedDatabase.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0]).toContain(
      'disabled=""',
    );
  });
  it('shows table/FK/key/cascaded-column impact and human blocker labels', () => {
    setLocale('ko');
    const f = fixture();
    const full = renderToStaticMarkup(
      createElement(NativeDomainDeletionImpact, {
        document: f.document,
        domainId: 'd1',
        values: { policy: 'deleteTables' },
      }),
    );
    for (const label of ['orders', 'amount', 'fk_audit', 'pk_orders', '삭제 영향'])
      expect(full).toContain(label);
    f.document.columns![1]!.physical.generation = {
      kind: 'computed',
      database: 'postgresql',
      storage: 'stored',
      expression: { kind: 'column', columnId: 'ca' },
    };
    const blocked = renderToStaticMarkup(
      createElement(NativeDomainDeletionImpact, {
        document: f.document,
        domainId: 'd1',
        values: { policy: 'deleteTables' },
      }),
    );
    expect(blocked).toContain('삭제 대상 컬럼을 사용하는 식');
    expect(blocked).toContain('copy');
  });
  it('consumes the editor in the native project view and keeps the shared menu slot', () => {
    setLocale('ko');
    const f = fixture();
    const html = renderToStaticMarkup(
      createElement(NativeProjectView, {
        entry: { kind: 'native', ...f, personalUnavailable: false },
        onLeave() {},
        onReload() {},
        projectActions: () => createElement('span', null, 'Main actions'),
      }),
    );
    expect(html).toContain('새 도메인 만들기');
    // The shared menu now belongs to the toolbar portal, whose host is not mounted in SSR.
    expect(html).toContain('editor-toolbar-host');
    expect(html).not.toContain('Main actions');
    expect(html).not.toContain('도메인 관리와 테이블 소속 변경은 아직 지원하지');
  });
  it('selects raw and unplaced domains in overview without saving synthetic nodes or projecting v1 data', () => {
    setLocale('ko');
    const f = fixture(),
      before = structuredClone(f.document);
    const scene = nativeCanvasScene(f.document, 'overview', 'physical');
    expect(scene.nodes.map((node) => node.objectId)).toEqual(['d1', 'd2']);
    expect(scene.nodes[0]!.id).toBe('nd1');
    expect(() =>
      nativeCanvasMoveCommand(f.document, scene.nodes[1]!, { x: 100, y: 200 }),
    ).toThrow();
    expect(nativeCanvasMoveCommand(f.document, scene.nodes[0]!, { x: 100, y: 200 })).toEqual({
      type: 'update_node_layout',
      nodeId: 'nd1',
      patch: { x: 100, y: 200 },
    });
    const html = renderToStaticMarkup(
      createElement(NativeERDCanvas, {
        ...f,
        editable: false,
        busy: false,
        mode: 'physical',
        selectedDomainId: 'd2',
        onSelect() {},
        onSelectDomain() {},
        onSave: async () => true,
        onReload() {},
      }),
    );
    expect(html).toContain('data-object-id="d2"');
    expect(html).toContain('data-preview="true"');
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('저장된 배치가 없는 도메인');
    expect(html).not.toContain('data-object-id="a"');
    expect(f.document).toEqual(before);
  });
});

describe.runIf(nativeTestIndexedDBAvailable)(
  'domain commands use the durable draft/ACK path',
  () => {
    it('keeps domain input after a lost ACK and consumes only the captured revision after read-only old-ACK recovery', async () => {
      vi.stubGlobal('indexedDB', createNativeTestIndexedDB());
      const { document, snapshot } = fixture(),
        store = memory();
      vi.stubGlobal('localStorage', store);
      const draft = {
        userId,
        projectId,
        key: 'edit:domain:d1',
        revision: crypto.randomUUID(),
        expected: { version: 7, sequence: 10, databaseRevision: 3 },
        before: { name: 'Orders', description: '<domain>', color: '#123456' },
        values: { name: 'Sales', description: '<domain>', color: '#123456' },
      };
      storeNativeEditorDraft(draft, store);
      const commands = nativeDomainUICommands(
        document,
        snapshot,
        'edit',
        'd1',
        draft.values,
        draft.before,
      );
      const pending = await stageNativeSave(userId, snapshot, commands, store, draft.expected, {
        key: draft.key,
        revision: draft.revision,
      });
      expect(await loadNativePending(userId, projectId, store)).toEqual(pending);
      const transport = vi.fn(async (_url: string, init?: RequestInit) => {
        expect(JSON.parse(init!.body as string).commands).toEqual(commands);
        throw Error('Lost ACK');
      });
      await expect(sendNativePending(pending, store, transport as typeof request)).rejects.toThrow(
        'Lost ACK',
      );
      expect(loadNativeEditorDraft(userId, projectId, draft.key, store)).toEqual(draft);
      const newer = {
        ...draft,
        revision: crypto.randomUUID(),
        values: { ...draft.values, name: 'Newer input' },
      };
      storeNativeEditorDraft(newer, store);
      const response = {
        protocolVersion: 2,
        database: document.database,
        databaseRevision: 3,
        operationId: pending.request.operationId,
        groupId: pending.request.groupId,
        sequence: 11,
        status: 'accepted',
        actor: { id: userId, username: 'actor', color: '#123456' },
        changedPaths: ['/domains/d1/name'],
        createdAt: '2026-10-02T00:00:01Z',
        nextBaseline: {
          baselineId: projectId,
          baseSequence: 11,
          baselineIssuedAt: '2026-10-02T00:00:01Z',
          databaseRevision: 3,
        },
      };
      const lookup = vi.fn().mockResolvedValue(response);
      const changed = {
        ...snapshot,
        project: { ...snapshot.project, status: 'archived' as const, databaseRevision: 4 },
      };
      await recoverNativePending(pending, changed, store, lookup as typeof request, false);
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(lookup.mock.calls[0]![0]).toContain('/operations/');
      expect(await loadNativePending(userId, projectId, store)).toBeNull();
      expect(loadNativeEditorDraft(userId, projectId, draft.key, store)).toEqual(newer);
    });
  },
);
