import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  defaultDatabaseContext,
  extractPersonalState,
  sharedDocument,
  type DatabaseKind,
} from '@ezerd/model';
import type { ProjectDocumentState } from '@ezerd/contracts';
import { nativeCanvasScene } from './NativeERDCanvas.js';
import { NativeCanvasPngExport } from './NativeCanvasPngExport.js';
import { nativeCanvasSvg } from './native-canvas-png.js';
import {
  decorationFixture,
  decorationSnapshot,
  decorationUserId,
} from './native-canvas-decoration-test-fixtures.js';
import {
  prepareNativePrivatePng,
  exportNativePrivateCanvasPng,
  type NativePngPersonalSnapshot,
} from './native-private-png.js';
import {
  NativeDurableQueue,
  type NativeDurablePending,
  type NativeDurableState,
} from './native-durable-queue.js';
import { request } from '../../shared/api/client.js';
import { setLocale } from '../../shared/i18n/index.js';

beforeEach(() => {
  setLocale('ko');
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function fixture(kind: DatabaseKind = 'postgresql') {
  const document = decorationFixture(kind);
  document.tables!.push({
    ...structuredClone(document.tables![0]!),
    id: 't2',
    domainId: 'b',
    physical: { ...document.tables![0]!.physical, name: 'audit' },
  });
  document.columns!.push({ ...structuredClone(document.columns![0]!), id: 'c2', tableId: 't2' });
  document.tableRelations = [
    {
      id: 'fk',
      sourceTableId: 't',
      targetTableId: 't2',
      scope: 'both',
      logical: { name: 'Audit relation', cardinality: 'one-to-many', required: false },
      physical: {
        name: 'fk_audit',
        sourceColumnIds: ['c'],
        targetColumnIds: ['c2'],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
    },
  ];
  // Foreign/source personal payload must be stripped rather than merged into this actor's saved view.
  document.views = [{ id: 'foreign', name: 'Other actor', domainIds: ['a'] }];
  document.notes.push({ id: 'foreign-note', viewId: 'foreign', text: 'FOREIGN PRIVATE INPUT' });
  document.layout.nodes.push({
    id: 'foreign-node',
    objectId: 'foreign-note',
    viewId: 'foreign',
    x: 1e6,
    y: 1e6,
    width: 200,
    height: 180,
  });
  const snapshot = decorationSnapshot(document);
  const personal: NativePngPersonalSnapshot = {
    version: 9,
    projectVersion: snapshot.project.version,
    syncSequence: snapshot.sequence,
    databaseRevision: snapshot.project.databaseRevision,
    state: {
      views: [{ id: 'private', name: 'Saved personal', domainIds: ['a', 'b'] }],
      notes: [{ id: 'pn', viewId: 'private', text: 'SAVED PRIVATE NOTE', color: '#112233' }],
      nodes: [
        { id: 'pt', objectId: 't', viewId: 'private', x: -120, y: 50, width: 400, height: 280 },
        { id: 'pt2', objectId: 't2', viewId: 'private', x: 800, y: 100, width: 400, height: 280 },
        { id: 'pnn', objectId: 'pn', viewId: 'private', x: 400, y: 500, width: 300, height: 180 },
      ],
      viewports: [{ viewId: 'private', x: 1e7, y: -1e7, zoom: 4 }],
      relations: [
        {
          relationId: 'fk',
          viewId: 'private',
          offset: 120,
          waypoints: [
            { x: 500, y: 350 },
            { x: 600, y: 350 },
          ],
        },
      ],
    },
  };
  return { snapshot, personal };
}
function writer(initial: NativeDurableState = 'empty', row: NativeDurablePending | null = null) {
  let state = initial;
  const queue = { read: vi.fn(async () => row), state: vi.fn(() => state) };
  return {
    queue,
    setState: (value: NativeDurableState) => {
      state = value;
    },
    setRow: (value: NativeDurablePending | null) => {
      row = value;
    },
  };
}
function transport(snapshot: ProjectDocumentState, personal: NativePngPersonalSnapshot) {
  let latestSnapshot = snapshot,
    latestPersonal = personal;
  const api = vi.fn(async (path: string) =>
    structuredClone(path.endsWith('/document-state') ? latestSnapshot : latestPersonal),
  ) as unknown as typeof request;
  return {
    api,
    shared: (value: ProjectDocumentState) => {
      latestSnapshot = value;
    },
    personal: (value: NativePngPersonalSnapshot) => {
      latestPersonal = value;
    },
  };
}
function browser(afterDecode: () => void = () => {}, afterBlob: () => void = () => {}) {
  const click = vi.fn(),
    createUrl = vi.fn(() => 'blob:private-png'),
    imageSources: string[] = [];
  const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ scale: vi.fn(), drawImage: vi.fn() }),
      toBlob: (consume: (blob: Blob) => void) => {
        afterBlob();
        consume(new Blob(['mock browser encoder'], { type: 'image/png' }));
      },
    },
    link = { href: '', download: '', click, remove: vi.fn() };
  vi.stubGlobal(
    'Image',
    class {
      set src(value: string) {
        imageSources.push(decodeURIComponent(value));
      }
      async decode() {
        afterDecode();
      }
    },
  );
  vi.stubGlobal('document', {
    createElement: (kind: string) => (kind === 'canvas' ? canvas : link),
    body: { append: vi.fn() },
  });
  vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
  return { click, createUrl, imageSources, canvas, link };
}
function exportSaved(
  snapshot: ProjectDocumentState,
  personal: NativePngPersonalSnapshot,
  api: typeof request,
  queue: ReturnType<typeof writer>['queue'],
  current = () => true,
) {
  return exportNativePrivateCanvasPng(
    decorationUserId,
    snapshot,
    personal,
    'private',
    'physical',
    nativeCanvasScene,
    current,
    { api, queue },
  );
}

describe('saved actor personal PNG source and encoder consumption', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'renders saved %s nodes, notes and FK routes, preserves raw fields and excludes foreign/local previews',
    async (kind) => {
      const { snapshot, personal } = fixture(kind),
        before = structuredClone({ snapshot, personal }),
        saved = prepareNativePrivatePng(snapshot, personal, 'private');
      const scene = nativeCanvasScene(saved.document, 'private', 'physical');
      expect(scene.nodes.map((node) => node.id)).toEqual(['pt', 'pt2', 'pnn']);
      expect(scene.nodes[0]!.x).toBe(-120);
      expect(scene.relations).toHaveLength(1);
      expect(saved.document.layout.relations).toContainEqual(personal.state.relations[0]);
      expect(sharedDocument(saved.document)).toEqual(sharedDocument(snapshot.sourceDocument));
      expect(extractPersonalState(saved.document)).toEqual(personal.state);
      const platform = browser(),
        network = transport(snapshot, personal),
        queue = writer();
      const result = await exportSaved(snapshot, personal, network.api, queue.queue);
      expect(result.type).toBe('image/png');
      expect(platform.click).toHaveBeenCalledTimes(1);
      expect(platform.canvas.width).toBe(result.width * 2);
      expect(platform.imageSources[0]).toContain('SAVED PRIVATE NOTE');
      expect(platform.imageSources[0]).toContain('fk_audit');
      expect(platform.imageSources[0]).toContain('ORIGINAL_TYPE');
      expect(platform.imageSources[0]).not.toContain('FOREIGN PRIVATE INPUT');
      expect(platform.link.download).toContain('Saved personal');
      expect(network.api).toHaveBeenCalledTimes(4);
      expect(queue.queue.read).toHaveBeenCalledTimes(4);
      for (const [, init] of vi.mocked(network.api).mock.calls)
        expect(init).toEqual({ cache: 'no-store' });
      // A local preview is deliberately not an argument to exportSaved.
      const preview = structuredClone(saved.document);
      preview.layout.nodes.find((node) => node.id === 'pt')!.x = 9000;
      preview.notes.find((note) => note.id === 'pn')!.text = 'UNSAVED INPUT';
      expect(platform.imageSources[0]).not.toContain('UNSAVED INPUT');
      personal.state.viewports = [];
      expect(
        nativeCanvasSvg(
          prepareNativePrivatePng(snapshot, personal, 'private').document,
          scene,
          'physical',
        ),
      ).toEqual(nativeCanvasSvg(saved.document, scene, 'physical'));
      expect(snapshot).toEqual(before.snapshot);
    },
  );
  it('allows readonly saved private export but disables missing/revisionless/unknown/sending personal state', () => {
    const { snapshot, personal } = fixture();
    const valid = renderToStaticMarkup(
      createElement(NativeCanvasPngExport, {
        snapshot,
        personal,
        userId: decorationUserId,
        viewId: 'private',
        mode: 'physical',
        sceneFor: nativeCanvasScene,
        writerState: 'empty',
      }),
    );
    expect(valid).not.toContain('disabled=""');
    expect(valid).toContain('저장된 개인 화면만 내보냅니다.');
    for (const props of [
      {},
      { personal },
      { personal, writerState: 'sending' as const },
      { personal, writerState: 'empty' as const, personalBusy: true },
      { personal: { ...personal, databaseRevision: undefined }, writerState: 'empty' as const },
    ]) {
      const html = renderToStaticMarkup(
        createElement(NativeCanvasPngExport, {
          snapshot,
          userId: decorationUserId,
          viewId: 'private',
          mode: 'physical',
          sceneFor: nativeCanvasScene,
          ...props,
        }),
      );
      expect(html).toContain('disabled=""');
    }
  });
  it('fails closed before encoder/API on a real active writer lease and leaves the pending unchanged', async () => {
    vi.useRealTimers();
    const { snapshot, personal } = fixture(),
      queue = new NativeDurableQueue(new IDBFactory(), 'private-png-lease'),
      pending: NativeDurablePending = {
        userId: decorationUserId,
        projectId: snapshot.project.id,
        operationId: crypto.randomUUID(),
        kind: 'privateCanvas',
        payload: { savedElsewhere: true },
      };
    await queue.claim(pending);
    const token = await queue.beginTransmission(pending),
      api = vi.fn(),
      platform = browser();
    try {
      await expect(
        exportNativePrivateCanvasPng(
          decorationUserId,
          snapshot,
          personal,
          'private',
          'physical',
          nativeCanvasScene,
          () => true,
          { api: api as typeof request, queue },
        ),
      ).rejects.toThrow('canvas.export-private-writer-changed');
      expect(api).not.toHaveBeenCalled();
      expect(platform.imageSources).toEqual([]);
      expect(await queue.read(decorationUserId, snapshot.project.id)).toEqual(pending);
    } finally {
      await queue.endTransmission(pending, token);
      await queue.close();
    }
  });
});

describe('private PNG stale head, actor and transmission guards', () => {
  it.each([
    'project-version',
    'sequence',
    'database-revision',
    'database-kind',
    'database-profile',
    'source-content',
    'project-id',
  ] as const)('rejects changed shared %s before encoding', async (field) => {
    const { snapshot, personal } = fixture(),
      latest = structuredClone(snapshot),
      network = transport(snapshot, personal),
      platform = browser();
    if (field === 'project-version') latest.project.version++;
    if (field === 'sequence') latest.sequence++;
    if (field === 'database-revision') latest.project.databaseRevision++;
    if (field === 'database-kind') latest.project.databaseKind = 'mysql';
    if (field === 'database-profile')
      latest.project.databaseProfileId = defaultDatabaseContext('mysql').profileId;
    if (field === 'source-content') latest.sourceDocument.domains[0]!.name = 'Changed';
    if (field === 'project-id') latest.project.id = '00000000-0000-4000-8000-000000000099';
    network.shared(latest);
    await expect(exportSaved(snapshot, personal, network.api, writer().queue)).rejects.toThrow(
      'canvas.export-context-changed',
    );
    expect(platform.imageSources).toEqual([]);
    expect(platform.createUrl).not.toHaveBeenCalled();
  });
  it.each(['personal-version', 'personal-content', 'removed-view'] as const)(
    'rejects changed %s after image encoding and before creating a download URL',
    async (field) => {
      const { snapshot, personal } = fixture(),
        network = transport(snapshot, personal),
        latest = structuredClone(personal);
      if (field === 'personal-version') latest.version++;
      if (field === 'personal-content') latest.state.notes[0]!.text = 'Other saved version';
      if (field === 'removed-view') latest.state.views = [];
      const platform = browser(
        () => {},
        () => network.personal(latest),
      );
      await expect(exportSaved(snapshot, personal, network.api, writer().queue)).rejects.toThrow(
        'canvas.export-personal-changed',
      );
      expect(platform.createUrl).not.toHaveBeenCalled();
      expect(platform.click).not.toHaveBeenCalled();
    },
  );
  it('rejects shared source changes during decode, even without a version increment', async () => {
    const { snapshot, personal } = fixture(),
      network = transport(snapshot, personal),
      latest = structuredClone(snapshot);
    latest.sourceDocument.domains[0]!.name = 'Unannounced source change';
    const platform = browser(() => network.shared(latest));
    await expect(exportSaved(snapshot, personal, network.api, writer().queue)).rejects.toThrow(
      'canvas.export-context-changed',
    );
    expect(platform.createUrl).not.toHaveBeenCalled();
  });
  it.each(['unknown', 'sending'] as const)(
    'cancels a queue transition to %s during image decode',
    async (status) => {
      const { snapshot, personal } = fixture(),
        network = transport(snapshot, personal),
        queue = writer(),
        platform = browser(() => queue.setState(status));
      await expect(exportSaved(snapshot, personal, network.api, queue.queue)).rejects.toThrow(
        'canvas.export-context-changed',
      );
      expect(platform.createUrl).not.toHaveBeenCalled();
    },
  );
  it('detects a different pending row at the same non-sending queue state without altering either row', async () => {
    const { snapshot, personal } = fixture(),
      first: NativeDurablePending = {
        userId: decorationUserId,
        projectId: snapshot.project.id,
        operationId: 'first',
        kind: 'privateCanvas',
        payload: { unsaved: 'first' },
      },
      second = { ...first, operationId: 'second' },
      queue = writer('pending', first),
      network = transport(snapshot, personal),
      platform = browser(
        () => {},
        () => queue.setRow(second),
      );
    await expect(exportSaved(snapshot, personal, network.api, queue.queue)).rejects.toThrow(
      'canvas.export-private-writer-changed',
    );
    expect(platform.createUrl).not.toHaveBeenCalled();
    expect(first.payload).toEqual({ unsaved: 'first' });
  });
  it.each(['other-actor', 'replacement-session'] as const)(
    'pins real request auth and cancels %s during decode',
    async (change) => {
      const { snapshot, personal } = fixture();
      let session = JSON.stringify({
        userId: decorationUserId,
        token: 'pinned-token',
        expiresAt: '2099-01-01T00:00:00Z',
      });
      vi.stubGlobal('sessionStorage', { getItem: () => session });
      const fetcher = vi.fn(
        async (path: string | URL | Request) =>
          new Response(
            JSON.stringify(String(path).endsWith('/document-state') ? snapshot : personal),
          ),
      );
      vi.stubGlobal('fetch', fetcher);
      const platform = browser(() => {
        session = JSON.stringify({
          userId:
            change === 'other-actor' ? '00000000-0000-4000-8000-000000000099' : decorationUserId,
          token: 'changed-token',
          expiresAt: '2099-01-01T00:00:00Z',
        });
      });
      await expect(
        exportNativePrivateCanvasPng(
          decorationUserId,
          snapshot,
          personal,
          'private',
          'physical',
          nativeCanvasScene,
          () => true,
          { queue: writer().queue },
        ),
      ).rejects.toThrow('canvas.export-context-changed');
      expect(fetcher).toHaveBeenCalledTimes(2);
      for (const call of fetcher.mock.calls)
        expect(
          new Headers((call as unknown as [unknown, RequestInit])[1].headers).get('Authorization'),
        ).toBe('Bearer pinned-token');
      expect(platform.createUrl).not.toHaveBeenCalled();
      expect(platform.click).not.toHaveBeenCalled();
    },
  );
  it('cancels a UI actor/project/view/mode generation change before queue awaits complete', async () => {
    const { snapshot, personal } = fixture(),
      network = transport(snapshot, personal),
      queue = writer(),
      platform = browser();
    let current = true;
    queue.queue.read.mockImplementationOnce(async () => {
      current = false;
      return null;
    });
    await expect(
      exportSaved(snapshot, personal, network.api, queue.queue, () => current),
    ).rejects.toThrow('canvas.export-context-changed');
    expect(network.api).not.toHaveBeenCalled();
    expect(platform.imageSources).toEqual([]);
  });
});
