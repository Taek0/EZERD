import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@ezerd/model';
import type { SyncOperationInput, SyncOperationResult } from '@ezerd/contracts';
import { MemorySyncOperationStore, type StoredSyncOperation } from './sync-storage.js';
import { mergePersonalState, ProjectSyncRuntime, stableClientId, type SyncSnapshot } from './sync-client.js';

const ids = {
  project: '00000000-0000-4000-8000-000000000001',
  user: '00000000-0000-4000-8000-000000000002',
  client: '00000000-0000-4000-8000-000000000003',
  baseline: '00000000-0000-4000-8000-000000000004',
  nextBaseline: '00000000-0000-4000-8000-000000000005',
  actor: '00000000-0000-4000-8000-000000000006',
};
const issuedAt = '2026-09-15T00:00:00.000Z';

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function socketStub() {
  const socket = {
    onopen: null, onmessage: null, onclose: null, onerror: null,
    send: () => {}, close: () => {},
  };
  return socket as unknown as WebSocket;
}

function operationItem(baselineId = ids.baseline): StoredSyncOperation<SyncOperationInput> {
  const document = createEmptyDocument();
  return {
    projectId: `${ids.user}:${ids.project}`, operationId: '00000000-0000-4000-8000-000000000010',
    createdAt: 1, baselineAt: 1, order: 1, state: 'sending',
    operation: {
      operationId: '00000000-0000-4000-8000-000000000010', groupId: '00000000-0000-4000-8000-000000000011',
      clientId: ids.client, baselineId, baseSequence: 0, baselineIssuedAt: issuedAt,
      kind: 'online', dependencyPaths: [], changes: [{ path: '/domains/domain', before: null, after: { id: 'domain', name: 'x', description: '' }, beforeExists: false }],
      baselineDocument: document, document,
    },
  };
}

function acceptedResult(sequence: number, name: string, baselineId: string): SyncOperationResult {
  const document = createEmptyDocument();
  document.domains = [{ id: 'domain', name, description: '' }];
  return {
    operationId: '00000000-0000-4000-8000-000000000010', groupId: '00000000-0000-4000-8000-000000000011',
    sequence, status: 'accepted', actor: { id: ids.actor, username: 'tester', color: '#112233' },
    changedPaths: ['/domains/domain'], createdAt: issuedAt, document,
    nextBaseline: { baselineId, baseSequence: sequence, baselineIssuedAt: issuedAt },
  };
}

describe('sync client personal state', () => {
  it('keeps a stable client id in browser storage', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(stableClientId(storage)).toBe(stableClientId(storage));
  });

  it('reattaches personal cameras and combined layout to a new shared base', () => {
    const shared = createEmptyDocument();
    const personal = createEmptyDocument();
    personal.views = [{ id: 'combined', name: '함께 보기', domainIds: [] }];
    personal.layout.viewports = [{ viewId: 'overview', x: 12, y: 34, zoom: 1.2 }];
    personal.layout.nodes.push({ id: 'combined-node', objectId: 'missing', viewId: 'combined', x: 1, y: 2, width: 3, height: 4 });
    const merged = mergePersonalState(shared, personal);
    expect(merged.views).toEqual(personal.views);
    expect(merged.layout.viewports).toEqual(personal.layout.viewports);
    expect(merged.layout.nodes.map(node => node.id)).toContain('combined-node');
  });

  it('does not continue startup after stop wins a pending baseline request', async () => {
    let finishBaseline!: (response: Response) => void;
    const baseline = new Promise<Response>(resolve => { finishBaseline = resolve; });
    let sockets = 0;
    const runtime = new ProjectSyncRuntime({
      projectId: ids.project, userId: ids.user, clientId: ids.client,
      session: { token: 'token', expiresAt: issuedAt, baselineIssuedAt: issuedAt },
      initialDocument: createEmptyDocument(), onChange: () => {},
      fetcher: (() => baseline) as unknown as typeof fetch,
      socketFactory: () => { sockets++; return socketStub(); },
      store: new MemorySyncOperationStore(),
    });
    const starting = runtime.start();
    runtime.stop();
    finishBaseline(json({ baselineId: ids.baseline, sequence: 0, baselineIssuedAt: issuedAt, document: createEmptyDocument() }));
    await starting;
    expect(sockets).toBe(0);
  });

  it('binds the browser fetch receiver when starting with the default transport', async () => {
    const originalFetch = globalThis.fetch;
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { protocol: 'http:', host: 'test.local' } });
    let baselineRequests = 0;
    globalThis.fetch = function (this: unknown, input: RequestInfo | URL) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      const path = String(input);
      if (path.endsWith('/sync-baseline')) {
        baselineRequests++;
        return Promise.resolve(json({ baselineId: ids.baseline, sequence: 0, baselineIssuedAt: issuedAt, document: createEmptyDocument() }));
      }
      return Promise.resolve(json([]));
    } as typeof fetch;
    const runtime = new ProjectSyncRuntime({
      projectId: ids.project, userId: ids.user, clientId: ids.client,
      session: { token: 'token', expiresAt: issuedAt, baselineIssuedAt: issuedAt },
      initialDocument: createEmptyDocument(), onChange: () => {}, socketFactory: socketStub,
      store: new MemorySyncOperationStore(),
    });
    try {
      await runtime.start();
      expect(baselineRequests).toBe(1);
    } finally {
      runtime.stop();
      globalThis.fetch = originalFetch;
      Object.defineProperty(globalThis, 'location', { configurable: true, value: originalLocation });
    }
  });

  it('keeps the newest accepted document and baseline when an older ACK arrives late', () => {
    const snapshots: Array<ReturnType<typeof createEmptyDocument>> = [];
    const runtime = new ProjectSyncRuntime({
      projectId: ids.project, userId: ids.user, clientId: ids.client,
      session: { token: 'token', expiresAt: issuedAt, baselineIssuedAt: issuedAt },
      initialDocument: createEmptyDocument(), onChange: snapshot => snapshots.push(snapshot.document),
      fetcher: (() => Promise.resolve(json({}, 500))) as unknown as typeof fetch,
    });
    const dispatch = (runtime as unknown as { queueEvent(event: unknown): void }).queueEvent.bind(runtime);
    const item = operationItem();
    dispatch({ type: 'ack', item, result: acceptedResult(10, 'newest', ids.nextBaseline) });
    dispatch({ type: 'ack', item, result: acceptedResult(5, 'stale', ids.baseline) });
    expect(snapshots.at(-1)?.domains[0]?.name).toBe('newest');
    expect((runtime as unknown as { baselineSequence: number }).baselineSequence).toBe(10);
    expect((runtime as unknown as { baselineId: string }).baselineId).toBe(ids.nextBaseline);
  });

  it('rebases a dependent edit onto its predecessor ACK while preserving the original age', async () => {
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { protocol: 'http:', host: 'test.local' } });
    const store = new MemorySyncOperationStore<SyncOperationInput>();
    let releaseFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>(resolve => { releaseFirst = resolve; });
    let firstStarted!: (operation: SyncOperationInput) => void;
    const firstStartedPromise = new Promise<SyncOperationInput>(resolve => { firstStarted = resolve; });
    let secondStarted!: (operation: SyncOperationInput) => void;
    const secondStartedPromise = new Promise<SyncOperationInput>(resolve => { secondStarted = resolve; });
    let submitCount = 0;
    const resultFor = (operation: SyncOperationInput, sequence: number, baselineId: string): SyncOperationResult => ({
      operationId: operation.operationId, groupId: operation.groupId, sequence, status: 'accepted',
      actor: { id: ids.actor, username: 'tester', color: '#112233' },
      changedPaths: operation.changes.map(change => change.path), createdAt: issuedAt,
      nextBaseline: { baselineId, baseSequence: sequence, baselineIssuedAt: '2026-09-15T01:00:00.000Z' },
      document: operation.document,
    });
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/sync-baseline')) return json({ baselineId: ids.baseline, sequence: 0, baselineIssuedAt: issuedAt, document: createEmptyDocument() });
      if (path.includes('/history?') || path.includes('/events?')) return json([]);
      if (path.endsWith('/operations') && init?.method === 'POST') {
        const operation = JSON.parse(String(init.body)) as SyncOperationInput;
        submitCount++;
        if (submitCount === 1) {
          firstStarted(operation);
          return firstResponse;
        }
        secondStarted(operation);
        return json(resultFor(operation, 2, '00000000-0000-4000-8000-000000000007'));
      }
      return json({}, 404);
    }) as typeof fetch;
    const runtime = new ProjectSyncRuntime({
      projectId: ids.project, userId: ids.user, clientId: ids.client,
      session: { token: 'token', expiresAt: issuedAt, baselineIssuedAt: issuedAt },
      initialDocument: createEmptyDocument(), onChange: () => {}, fetcher,
      socketFactory: socketStub, store,
    });
    try {
      await runtime.start();
      const created = createEmptyDocument();
      created.domains = [{ id: 'domain', name: 'first', description: '' }];
      await runtime.edit(created);
      const first = await firstStartedPromise;
      const renamed = structuredClone(created);
      renamed.domains[0]!.name = 'second';
      await runtime.edit(renamed);
      releaseFirst(json(resultFor(first, 1, ids.nextBaseline)));
      const second = await secondStartedPromise;
      expect(second.baselineId).toBe(ids.nextBaseline);
      expect(second.baselineDocument.domains[0]?.name).toBe('first');
      expect(second.document.domains[0]?.name).toBe('second');
      const persisted = (await store.list(`${ids.user}:${ids.project}`)).find(item => item.operationId === second.operationId);
      expect(persisted?.baselineAt).toBe(Date.parse(issuedAt));
      expect(Date.parse(second.baselineIssuedAt)).toBeGreaterThan(persisted!.baselineAt);
    } finally {
      runtime.stop();
      Object.defineProperty(globalThis, 'location', { configurable: true, value: originalLocation });
    }
  });

  it('captures edit intent before startup and preserves disjoint fields from the fetched baseline', async () => {
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { protocol: 'http:', host: 'test.local' } });
    const initial = createEmptyDocument();
    initial.domains = [
      { id: 'mine', name: 'old', description: '' },
      { id: 'remote', name: 'remote', description: 'old' },
    ];
    const edited = structuredClone(initial);
    edited.domains[0]!.name = 'my edit';
    const server = structuredClone(initial);
    server.domains[1]!.description = 'server edit';
    let finishBaseline!: (response: Response) => void;
    const baselineResponse = new Promise<Response>(resolve => { finishBaseline = resolve; });
    let submitted!: (operation: SyncOperationInput) => void;
    const submittedPromise = new Promise<SyncOperationInput>(resolve => { submitted = resolve; });
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/sync-baseline')) return baselineResponse;
      if (path.includes('/history?') || path.includes('/events?')) return json([]);
      if (path.endsWith('/operations') && init?.method === 'POST') {
        const operation = JSON.parse(String(init.body)) as SyncOperationInput;
        submitted(operation);
        return json({
          operationId: operation.operationId, groupId: operation.groupId, sequence: 2, status: 'accepted',
          actor: { id: ids.actor, username: 'tester', color: '#112233' }, changedPaths: operation.changes.map(change => change.path),
          createdAt: issuedAt, nextBaseline: { baselineId: ids.nextBaseline, baseSequence: 2, baselineIssuedAt: issuedAt }, document: operation.document,
        });
      }
      return json({}, 404);
    }) as typeof fetch;
    const runtime = new ProjectSyncRuntime({
      projectId: ids.project, userId: ids.user, clientId: ids.client,
      session: { token: 'token', expiresAt: issuedAt, baselineIssuedAt: issuedAt },
      initialDocument: initial, onChange: () => {}, fetcher,
      socketFactory: socketStub, store: new MemorySyncOperationStore(),
    });
    try {
      const starting = runtime.start();
      const editing = runtime.edit(edited);
      finishBaseline(json({ baselineId: ids.baseline, sequence: 1, baselineIssuedAt: issuedAt, document: server }));
      const operation = await submittedPromise;
      await Promise.all([starting, editing]);
      expect(operation.baselineDocument.domains.find(domain => domain.id === 'remote')?.description).toBe('server edit');
      expect(operation.document.domains.find(domain => domain.id === 'mine')?.name).toBe('my edit');
      expect(operation.document.domains.find(domain => domain.id === 'remote')?.description).toBe('server edit');
    } finally {
      runtime.stop();
      Object.defineProperty(globalThis, 'location', { configurable: true, value: originalLocation });
    }
  });

  it('does not publish a polling failure that settles after stop', async () => {
    let fail!: (error: Error) => void;
    const response = new Promise<Response>((_, reject) => { fail = reject; });
    const snapshots: unknown[] = [];
    const runtime = new ProjectSyncRuntime({
      projectId: ids.project, userId: ids.user, clientId: ids.client,
      session: { token: 'token', expiresAt: issuedAt, baselineIssuedAt: issuedAt },
      initialDocument: createEmptyDocument(), onChange: snapshot => snapshots.push(snapshot),
      fetcher: (() => response) as unknown as typeof fetch,
    });
    const polling = (runtime as unknown as { pollHead(): Promise<void> }).pollHead();
    runtime.stop();
    fail(new Error('offline'));
    await polling;
    expect(snapshots).toEqual([]);
  });

  it('reapplies an unresolved edit on the current baseline and removes the old durable item', async () => {
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { protocol: 'http:', host: 'test.local' } });
    const oldDocument = createEmptyDocument();
    oldDocument.domains = [{ id: 'domain', name: 'old', description: '' }];
    const desired = structuredClone(oldDocument);
    desired.domains[0]!.name = 'desired';
    const current = structuredClone(oldDocument);
    current.domains[0]!.description = 'kept from server';
    const source = operationItem();
    source.createdAt = Date.now();
    source.baselineAt = Date.parse(issuedAt);
    source.state = 'unresolved';
    source.reason = 'conflict';
    source.operation.baselineDocument = oldDocument;
    source.operation.document = desired;
    source.operation.changes = [{ path: '/domains/domain/name', before: 'old', after: 'desired' }];
    const store = new MemorySyncOperationStore<SyncOperationInput>();
    await store.put(source);
    let submitted!: (operation: SyncOperationInput) => void;
    const submittedPromise = new Promise<SyncOperationInput>(resolve => { submitted = resolve; });
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/sync-baseline')) return json({ baselineId: ids.nextBaseline, sequence: 3, baselineIssuedAt: issuedAt, document: current });
      if (path.includes('/history?') || path.includes('/events?')) return json([]);
      if (path.endsWith('/operations') && init?.method === 'POST') {
        const operation = JSON.parse(String(init.body)) as SyncOperationInput;
        submitted(operation);
        return json({
          operationId: operation.operationId, groupId: operation.groupId, sequence: 4, status: 'accepted',
          actor: { id: ids.actor, username: 'tester', color: '#112233' }, changedPaths: operation.changes.map(change => change.path),
          createdAt: issuedAt, nextBaseline: { baselineId: ids.baseline, baseSequence: 4, baselineIssuedAt: issuedAt }, document: operation.document,
        });
      }
      return json({}, 404);
    }) as typeof fetch;
    const runtime = new ProjectSyncRuntime({
      projectId: ids.project, userId: ids.user, clientId: ids.client,
      session: { token: 'token', expiresAt: issuedAt, baselineIssuedAt: issuedAt },
      initialDocument: oldDocument, onChange: () => {}, fetcher,
      socketFactory: socketStub, store,
    });
    try {
      await runtime.start();
      await runtime.reapply(source.operationId);
      const replay = await submittedPromise;
      expect(replay.operationId).not.toBe(source.operationId);
      expect(replay.baselineId).toBe(ids.nextBaseline);
      expect(replay.document.domains[0]).toMatchObject({ name: 'desired', description: 'kept from server' });
      expect((await store.list(`${ids.user}:${ids.project}`)).some(item => item.operationId === source.operationId)).toBe(false);
    } finally {
      runtime.stop();
      Object.defineProperty(globalThis, 'location', { configurable: true, value: originalLocation });
    }
  });

  it('discards an unresolved edit from durable storage', async () => {
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { protocol: 'http:', host: 'test.local' } });
    const source = operationItem();
    source.createdAt = Date.now();
    source.baselineAt = Date.parse(issuedAt);
    source.state = 'unresolved';
    const store = new MemorySyncOperationStore<SyncOperationInput>();
    await store.put(source);
    const fetcher = (async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/sync-baseline')) return json({ baselineId: ids.baseline, sequence: 0, baselineIssuedAt: issuedAt, document: createEmptyDocument() });
      return json([]);
    }) as typeof fetch;
    const runtime = new ProjectSyncRuntime({
      projectId: ids.project, userId: ids.user, clientId: ids.client,
      session: { token: 'token', expiresAt: issuedAt, baselineIssuedAt: issuedAt },
      initialDocument: createEmptyDocument(), onChange: () => {}, fetcher,
      socketFactory: socketStub, store,
    });
    try {
      await runtime.start();
      await runtime.discard(source.operationId);
      expect(await store.list(`${ids.user}:${ids.project}`)).toEqual([]);
    } finally {
      runtime.stop();
      Object.defineProperty(globalThis, 'location', { configurable: true, value: originalLocation });
    }
  });

  it('uses guarded server undo and undoes that command for redo while preserving unrelated remote state', async () => {
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { protocol: 'http:', host: 'test.local' } });
    const initial = createEmptyDocument();
    initial.domains = [{ id: 'domain', name: 'old', description: '' }];
    const edited = structuredClone(initial);
    edited.domains[0]!.name = 'mine';
    const snapshots: SyncSnapshot[] = [];
    let acceptedOperationId = '';
    const undoSources: string[] = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/sync-baseline')) return json({ baselineId: ids.baseline, sequence: 0, baselineIssuedAt: issuedAt, document: initial });
      if (path.includes('/history?') || path.includes('/events?')) return json([]);
      if (path.endsWith('/operations') && init?.method === 'POST') {
        const operation = JSON.parse(String(init.body)) as SyncOperationInput;
        acceptedOperationId = operation.operationId;
        return json({
          operationId: operation.operationId, groupId: operation.groupId, sequence: 1, status: 'accepted',
          actor: { id: ids.actor, username: 'tester', color: '#112233' }, changedPaths: operation.changes.map(change => change.path),
          createdAt: issuedAt, nextBaseline: { baselineId: ids.nextBaseline, baseSequence: 1, baselineIssuedAt: issuedAt }, document: operation.document,
        });
      }
      const undo = path.match(/\/operations\/([^/]+)\/undo$/);
      if (undo && init?.method === 'POST') {
        undoSources.push(decodeURIComponent(undo[1]!));
        const command = JSON.parse(String(init.body)) as { operationId: string; groupId: string };
        const document = structuredClone(initial);
        document.domains[0]!.description = 'remote stays';
        if (undoSources.length === 2) document.domains[0]!.name = 'mine';
        return json({
          operationId: command.operationId, groupId: command.groupId, sequence: undoSources.length + 1, status: 'accepted',
          actor: { id: ids.actor, username: 'tester', color: '#112233' }, changedPaths: ['/domains/domain/name'],
          createdAt: issuedAt, nextBaseline: { baselineId: ids.baseline, baseSequence: undoSources.length + 1, baselineIssuedAt: issuedAt }, document,
        });
      }
      return json({}, 404);
    }) as typeof fetch;
    const runtime = new ProjectSyncRuntime({
      projectId: ids.project, userId: ids.user, clientId: ids.client,
      session: { token: 'token', expiresAt: issuedAt, baselineIssuedAt: issuedAt }, initialDocument: initial,
      onChange: snapshot => snapshots.push(snapshot), fetcher, socketFactory: socketStub, store: new MemorySyncOperationStore(),
    });
    try {
      await runtime.start();
      await runtime.edit(edited);
      await new Promise(resolve => setTimeout(resolve, 0));
      await runtime.undo();
      const undoOperationId = undoSources.length ? (runtime as unknown as { ownFuture: Array<{ commandSourceId?: string }> }).ownFuture[0]?.commandSourceId : undefined;
      expect(undoSources).toEqual([acceptedOperationId]);
      expect(snapshots.at(-1)?.document.domains[0]).toMatchObject({ name: 'old', description: 'remote stays' });
      expect(snapshots.at(-1)).toMatchObject({ canUndo: false, canRedo: true });

      await runtime.redo();
      expect(undoSources).toEqual([acceptedOperationId, undoOperationId]);
      expect(snapshots.at(-1)?.document.domains[0]).toMatchObject({ name: 'mine', description: 'remote stays' });
      expect(snapshots.at(-1)).toMatchObject({ canUndo: true, canRedo: false });
    } finally {
      runtime.stop();
      Object.defineProperty(globalThis, 'location', { configurable: true, value: originalLocation });
    }
  });

  it('keeps an in-flight edit discoverable until its ACK and then executes guarded undo', async () => {
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { protocol: 'http:', host: 'test.local' } });
    const initial = createEmptyDocument();
    initial.domains = [{ id: 'domain', name: 'old', description: '' }];
    const edited = structuredClone(initial);
    edited.domains[0]!.name = 'mine';
    let submitted!: (operation: SyncOperationInput) => void;
    const submittedOperation = new Promise<SyncOperationInput>(resolve => { submitted = resolve; });
    let releaseSubmit!: (response: Response) => void;
    const submitResponse = new Promise<Response>(resolve => { releaseSubmit = resolve; });
    const undoSources: string[] = [];
    const snapshots: SyncSnapshot[] = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/sync-baseline')) return json({ baselineId: ids.baseline, sequence: 0, baselineIssuedAt: issuedAt, document: initial });
      if (path.includes('/history?') || path.includes('/events?')) return json([]);
      if (path.endsWith('/operations') && init?.method === 'POST') {
        submitted(JSON.parse(String(init.body)) as SyncOperationInput);
        return submitResponse;
      }
      const undo = path.match(/\/operations\/([^/]+)\/undo$/);
      if (undo && init?.method === 'POST') {
        undoSources.push(decodeURIComponent(undo[1]!));
        const command = JSON.parse(String(init.body)) as { operationId: string; groupId: string };
        return json({ operationId: command.operationId, groupId: command.groupId, sequence: 2, status: 'accepted', actor: { id: ids.actor, username: 'tester', color: '#112233' }, changedPaths: ['/domains/domain/name'], createdAt: issuedAt, nextBaseline: { baselineId: ids.nextBaseline, baseSequence: 2, baselineIssuedAt: issuedAt }, document: initial });
      }
      return json({}, 404);
    }) as typeof fetch;
    const runtime = new ProjectSyncRuntime({ projectId: ids.project, userId: ids.user, clientId: ids.client, session: { token: 'token', expiresAt: issuedAt, baselineIssuedAt: issuedAt }, initialDocument: initial, onChange: snapshot => snapshots.push(snapshot), fetcher, socketFactory: socketStub, store: new MemorySyncOperationStore() });
    try {
      await runtime.start();
      await runtime.edit(edited);
      const operation = await submittedOperation;
      const undoing = runtime.undo();
      releaseSubmit(json({ operationId: operation.operationId, groupId: operation.groupId, sequence: 1, status: 'accepted', actor: { id: ids.actor, username: 'tester', color: '#112233' }, changedPaths: operation.changes.map(change => change.path), createdAt: issuedAt, nextBaseline: { baselineId: ids.nextBaseline, baseSequence: 1, baselineIssuedAt: issuedAt }, document: operation.document }));
      await undoing;
      expect(undoSources).toEqual([operation.operationId]);
      expect(snapshots.at(-1)).toMatchObject({ canUndo: false, canRedo: true });
      expect(snapshots.at(-1)?.document.domains[0]?.name).toBe('old');
    } finally {
      runtime.stop();
      Object.defineProperty(globalThis, 'location', { configurable: true, value: originalLocation });
    }
  });

  it('keeps an accepted edit undoable when the server rejects undo after a foreign overlapping edit', async () => {
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { protocol: 'http:', host: 'test.local' } });
    const initial = createEmptyDocument();
    initial.domains = [{ id: 'domain', name: 'old', description: '' }];
    const edited = structuredClone(initial);
    edited.domains[0]!.name = 'mine';
    const snapshots: SyncSnapshot[] = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/sync-baseline')) return json({ baselineId: ids.baseline, sequence: 0, baselineIssuedAt: issuedAt, document: initial });
      if (path.includes('/history?') || path.includes('/events?')) return json([]);
      if (path.endsWith('/operations') && init?.method === 'POST') {
        const operation = JSON.parse(String(init.body)) as SyncOperationInput;
        return json({ operationId: operation.operationId, groupId: operation.groupId, sequence: 1, status: 'accepted', actor: { id: ids.actor, username: 'tester', color: '#112233' }, changedPaths: operation.changes.map(change => change.path), createdAt: issuedAt, nextBaseline: { baselineId: ids.nextBaseline, baseSequence: 1, baselineIssuedAt: issuedAt }, document: operation.document });
      }
      if (/\/operations\/[^/]+\/undo$/.test(path)) return json({ message: '다른 사용자가 같은 필드를 변경했습니다.' }, 409);
      return json({}, 404);
    }) as typeof fetch;
    const runtime = new ProjectSyncRuntime({ projectId: ids.project, userId: ids.user, clientId: ids.client, session: { token: 'token', expiresAt: issuedAt, baselineIssuedAt: issuedAt }, initialDocument: initial, onChange: snapshot => snapshots.push(snapshot), fetcher, socketFactory: socketStub, store: new MemorySyncOperationStore() });
    try {
      await runtime.start();
      await runtime.edit(edited);
      await new Promise(resolve => setTimeout(resolve, 0));
      await expect(runtime.undo()).rejects.toThrow('409');
      expect(snapshots.at(-1)).toMatchObject({ canUndo: true, canRedo: false });
      expect(snapshots.at(-1)?.document.domains[0]?.name).toBe('mine');
    } finally {
      runtime.stop();
      Object.defineProperty(globalThis, 'location', { configurable: true, value: originalLocation });
    }
  });
});
