import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  createEmptyNativeDocument,
  defaultDatabaseContext,
  upsertCombinedView,
  extractPersonalState,
} from '@ezerd/model';
import { savePersonalStateSchema, type ProjectDocumentState } from '@ezerd/contracts';
import { request } from '../../shared/api/client.js';
import { captureNativeActorApi } from './native-actor-api.js';
import { loadNativeEditorDraft, storeNativeEditorDraft } from './native-editor-draft.js';
import { NativeDurableQueue } from './native-durable-queue.js';
import {
  nativePrivateSnapshotSchema,
  stageNativePrivateCanvas,
  recoverNativePrivateCanvas,
  loadNativePrivatePending,
  discardNativePrivatePending,
  nativePrivateCanvasGuardAvailable,
} from './native-private-canvas.js';

const userId = '00000000-0000-4000-8000-000000000001',
  projectId = '00000000-0000-4000-8000-000000000002';
const queues: NativeDurableQueue[] = [];
function store() {
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
function factory() {
  const idb = new IDBFactory(),
    name = 'private-test';
  const queue = new NativeDurableQueue(idb, name),
    second = new NativeDurableQueue(idb, name);
  queues.push(queue, second);
  return { queue, second };
}
function fixture() {
  const source = createEmptyNativeDocument(defaultDatabaseContext('mysql'));
  source.domains = [{ id: 'd', name: 'Domain', description: '' }];
  const candidate = upsertCombinedView(source, { id: 'v', name: 'Private', domainIds: ['d'] });
  const snapshot: ProjectDocumentState = {
    protocolVersion: 2,
    project: {
      id: projectId,
      workspaceId: projectId,
      name: 'Native',
      status: 'active',
      version: 7,
      databaseKind: 'mysql',
      databaseProfileId: source.database.profileId,
      databaseRevision: 3,
      createdAt: '2026-10-02T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
    },
    sequence: 10,
    sourceDocument: source,
    native: { status: 'available', document: source, issues: [], migrationIssues: [] },
  };
  const personal = {
    databaseRevision: 3,
    version: 2,
    projectVersion: 7,
    syncSequence: 10,
    state: extractPersonalState(source),
  };
  return { snapshot, candidate, personal };
}
afterEach(async () => {
  await Promise.all(queues.splice(0).map((q) => q.close()));
  vi.unstubAllGlobals();
});
describe('native private REST is guarded version-CAS, not a cached operation ledger', () => {
  it('normalizes the full draft object supplied by Canvas forms into a strict reference', async () => {
    const f = fixture(),
      { queue } = factory(),
      storage = store(),
      draft = {
        userId,
        projectId,
        key: 'canvas:action:view',
        revision: crypto.randomUUID(),
        expected: { version: 7, sequence: 10, databaseRevision: 3 },
        before: { name: '' },
        values: { name: 'Private' },
      };
    storeNativeEditorDraft(draft, storage);
    const pending = await stageNativePrivateCanvas(
      userId,
      f.snapshot,
      f.personal,
      f.candidate,
      { queue, storage },
      draft,
    );
    expect(pending.editorDraft).toEqual({ key: draft.key, revision: draft.revision });
    expect(pending.editorDraft).not.toHaveProperty('values');
  });
  it('uses the default actor-bound GET/PUT transport with the updated contracts barrel', async () => {
    expect(nativePrivateCanvasGuardAvailable()).toBe(true);
    const f = fixture(),
      { queue } = factory(),
      options = { queue, storage: store() },
      pending = await stageNativePrivateCanvas(
        userId,
        f.snapshot,
        f.personal,
        f.candidate,
        options,
      ),
      sessionStorage = store();
    sessionStorage.setItem(
      'ezerd.sync.session',
      JSON.stringify({ userId, token: 'private-actor-token', expiresAt: '2099-01-01T00:00:00Z' }),
    );
    vi.stubGlobal('sessionStorage', sessionStorage);
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer private-actor-token');
      expect(new Headers(init?.headers).has('If-Match')).toBe(false);
      const result =
        init?.method === 'PUT' ? { ...f.personal, version: 3, state: pending.state } : f.personal;
      if (init?.method === 'PUT')
        expect(savePersonalStateSchema.parse(JSON.parse(init.body as string))).toMatchObject({
          expectedVersion: 2,
          expectedDatabaseRevision: 3,
          expectedProjectVersion: 7,
          expectedSyncSequence: 10,
        });
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetcher);
    await recoverNativePrivateCanvas(pending, f.snapshot, true, options);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await queue.read(userId, projectId)).toBeNull();
  });
  it('retains failed typed input and refuses to stage before draft storage recovery', async () => {
    const f = fixture(),
      { queue } = factory(),
      storage = {
        ...store(),
        setItem() {
          throw Error('quota');
        },
      },
      draft = {
        userId,
        projectId,
        key: 'canvas:action:v:view',
        revision: crypto.randomUUID(),
        expected: { version: 7, sequence: 10, databaseRevision: 3 },
        before: { name: '' },
        values: { name: 'Private' },
      };
    expect(() => storeNativeEditorDraft(draft, storage)).toThrow('quota');
    await expect(
      stageNativePrivateCanvas(
        userId,
        f.snapshot,
        f.personal,
        f.candidate,
        { queue, storage },
        { key: draft.key, revision: draft.revision },
      ),
    ).rejects.toThrow('native.draft-storage-failed');
    expect(loadNativeEditorDraft(userId, projectId, draft.key, storage)).toEqual(draft);
    expect(await queue.read(userId, projectId)).toBeNull();
  });
  it.each(['commands', 'history'])(
    'does not claim over a pre-IDB legacy %s request',
    async (kind) => {
      const f = fixture(),
        { queue } = factory(),
        storage = store();
      storage.setItem(
        kind === 'commands'
          ? `ezerd.native.pending:${userId}:${projectId}`
          : `ezerd.native.history:${JSON.stringify([userId, projectId])}`,
        'unknown old request',
      );
      await expect(
        stageNativePrivateCanvas(userId, f.snapshot, f.personal, f.candidate, { queue, storage }),
      ).rejects.toThrow('native.pending-exists');
      expect(await queue.read(userId, projectId)).toBeNull();
    },
  );
  it('recovers the same private CAS payload after a crashed transmission lease and fences the old owner', async () => {
    let clock = 1000;
    const idb = new IDBFactory(),
      first = new NativeDurableQueue(idb, 'private-crash', { now: () => clock, leaseMs: 10 }),
      second = new NativeDurableQueue(idb, 'private-crash', { now: () => clock, leaseMs: 10 });
    queues.push(first, second);
    const f = fixture(),
      storage = store(),
      pending = await stageNativePrivateCanvas(userId, f.snapshot, f.personal, f.candidate, {
        queue: first,
        storage,
      });
    const durable = {
      userId,
      projectId,
      kind: 'privateCanvas' as const,
      operationId: pending.revision,
      payload: pending,
    };
    const oldToken = await first.beginTransmission(durable);
    clock += 11;
    let resolve!: (value: unknown) => void;
    const waiting = new Promise((done) => {
      resolve = done;
    });
    const api = vi
      .fn()
      .mockReturnValueOnce(waiting)
      .mockResolvedValueOnce({ ...f.personal, version: 3, state: pending.state });
    const replay = recoverNativePrivateCanvas(
      pending,
      f.snapshot,
      true,
      { queue: second, storage },
      api as typeof request,
    );
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    await first.endTransmission(durable, oldToken);
    await second.read(userId, projectId);
    expect(second.state(userId, projectId)).toBe('sending');
    resolve(f.personal);
    await replay;
    expect(await second.read(userId, projectId)).toBeNull();
    expect(JSON.parse((api.mock.calls[1]![1] as RequestInit).body! as string).expectedVersion).toBe(
      2,
    );
  });
  it('checks the real actor-bound transport again after an awaited GET and sends no PUT with a new session', async () => {
    const f = fixture(),
      { queue } = factory(),
      options = { queue, storage: store() },
      pending = await stageNativePrivateCanvas(
        userId,
        f.snapshot,
        f.personal,
        f.candidate,
        options,
      );
    const sessionStorage = store();
    sessionStorage.setItem(
      'ezerd.sync.session',
      JSON.stringify({ userId, token: 'captured-token', expiresAt: '2099-01-01T00:00:00Z' }),
    );
    const fetcher = vi.fn(async () => {
      sessionStorage.setItem(
        'ezerd.sync.session',
        JSON.stringify({
          userId: projectId,
          token: 'other-token',
          expiresAt: '2099-01-01T00:00:00Z',
        }),
      );
      return new Response(JSON.stringify(f.personal), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const actorApi = captureNativeActorApi(userId, request, { sessionStorage, fetcher });
    await expect(
      recoverNativePrivateCanvas(pending, f.snapshot, true, options, actorApi),
    ).rejects.toThrow('native.actor-mismatch');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((await queue.read(userId, projectId))!.payload)).not.toContain(
      'captured-token',
    );
    expect(await loadNativePrivatePending(userId, projectId, options)).toEqual(pending);
  });
  it('preserves newer typed draft revisions when the captured input receives a matching save result', async () => {
    const f = fixture(),
      { queue } = factory(),
      storage = store(),
      options = { queue, storage },
      draft = {
        userId,
        projectId,
        key: 'canvas:action:v:view',
        revision: crypto.randomUUID(),
        expected: { version: 7, sequence: 10, databaseRevision: 3 },
        before: { name: '' },
        values: { name: 'Private' },
      };
    storeNativeEditorDraft(draft, storage);
    const pending = await stageNativePrivateCanvas(
      userId,
      f.snapshot,
      f.personal,
      f.candidate,
      options,
      { key: draft.key, revision: draft.revision },
    );
    const newer = { ...draft, revision: crypto.randomUUID(), values: { name: 'Newer' } };
    storeNativeEditorDraft(newer, storage);
    const api = vi.fn().mockResolvedValue({ ...f.personal, version: 3, state: pending.state });
    await recoverNativePrivateCanvas(pending, f.snapshot, false, options, api as typeof request);
    expect(loadNativeEditorDraft(userId, projectId, draft.key, storage)).toEqual(newer);
    expect(await queue.read(userId, projectId)).toBeNull();
  });
  it('requires actual databaseRevision metadata and does not fake it from the shared snapshot', () => {
    const f = fixture();
    const { databaseRevision: _, ...legacy } = f.personal;
    expect(() => nativePrivateSnapshotSchema.parse(legacy)).toThrow(
      'native.personal-revision-guard-unavailable',
    );
    expect(nativePrivateSnapshotSchema.parse(f.personal).databaseRevision).toBe(3);
  });
  it('atomically excludes a second tab and command/history/upgrade writers before any PUT', async () => {
    const f = fixture(),
      { queue, second } = factory(),
      storage = store(),
      options = { queue, storage };
    const [a, b] = await Promise.allSettled([
      stageNativePrivateCanvas(userId, f.snapshot, f.personal, f.candidate, options),
      stageNativePrivateCanvas(userId, f.snapshot, f.personal, f.candidate, {
        queue: second,
        storage,
      }),
    ]);
    expect([a, b].filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const kind of ['commands', 'history', 'upgrade'] as const)
      await expect(
        second.claim({ kind, userId, projectId, operationId: crypto.randomUUID(), payload: {} }),
      ).rejects.toThrow('native.pending-exists');
  });
  it('sends every guarded context field and clears only a matching direct PUT result', async () => {
    const f = fixture(),
      { queue } = factory(),
      options = { queue, storage: store() },
      pending = await stageNativePrivateCanvas(
        userId,
        f.snapshot,
        f.personal,
        f.candidate,
        options,
      );
    const api = vi
      .fn()
      .mockResolvedValueOnce(f.personal)
      .mockResolvedValueOnce({ ...f.personal, version: 3, state: pending.state });
    await recoverNativePrivateCanvas(pending, f.snapshot, true, options, api as typeof request);
    const wire = JSON.parse((api.mock.calls[1]![1] as RequestInit).body! as string);
    expect(wire).toEqual({
      expectedVersion: 2,
      expectedDatabaseRevision: 3,
      expectedProjectVersion: 7,
      expectedSyncSequence: 10,
      state: pending.state,
    });
    expect(wire).not.toHaveProperty('operationId');
    expect(api.mock.calls.some((c) => String(c[0]).includes('cancel'))).toBe(false);
    expect(await queue.read(userId, projectId)).toBeNull();
  });
  it('confirms observed matching next-CAS state without pretending a GET is an operation ACK', async () => {
    const f = fixture(),
      { queue } = factory(),
      options = { queue, storage: store() },
      pending = await stageNativePrivateCanvas(
        userId,
        f.snapshot,
        f.personal,
        f.candidate,
        options,
      );
    const lost = vi
      .fn()
      .mockResolvedValueOnce(f.personal)
      .mockRejectedValueOnce(Error('response lost'));
    await expect(
      recoverNativePrivateCanvas(pending, f.snapshot, true, options, lost as typeof request),
    ).rejects.toThrow('response lost');
    await expect(discardNativePrivatePending(pending, options)).rejects.toThrow(
      'native.transmission-unknown',
    );
    const get = vi.fn().mockResolvedValue({ ...f.personal, version: 3, state: pending.state });
    await recoverNativePrivateCanvas(
      pending,
      { ...f.snapshot, project: { ...f.snapshot.project, status: 'archived' } },
      false,
      options,
      get as typeof request,
    );
    expect(get).toHaveBeenCalledTimes(1);
    expect(await loadNativePrivatePending(userId, projectId, options)).toBeNull();
  });
  it.each(['database', 'project', 'sequence', 'state', 'version', 'malformed', 'readonly'])(
    'preserves uncertainty and sends no PUT after %s baseline changes',
    async (reason) => {
      const f = fixture(),
        { queue } = factory(),
        options = { queue, storage: store() },
        pending = await stageNativePrivateCanvas(
          userId,
          f.snapshot,
          f.personal,
          f.candidate,
          options,
        );
      const current = structuredClone(f.personal),
        snapshot = structuredClone(f.snapshot);
      if (reason === 'database') current.databaseRevision++;
      if (reason === 'project') current.projectVersion++;
      if (reason === 'sequence') current.syncSequence++;
      if (reason === 'state') current.state.views = [{ id: 'other', name: 'Other', domainIds: [] }];
      if (reason === 'version') current.version = 4;
      const api = vi.fn().mockResolvedValue(reason === 'malformed' ? {} : current);
      await expect(
        recoverNativePrivateCanvas(
          pending,
          snapshot,
          reason !== 'readonly',
          options,
          api as typeof request,
        ),
      ).rejects.toThrow();
      expect(api).toHaveBeenCalledTimes(1);
      expect(await queue.read(userId, projectId)).not.toBeNull();
    },
  );
  it('rejects malformed or wrong-context PUT results without deleting the pending request', async () => {
    const f = fixture(),
      { queue } = factory(),
      options = { queue, storage: store() },
      pending = await stageNativePrivateCanvas(
        userId,
        f.snapshot,
        f.personal,
        f.candidate,
        options,
      );
    const api = vi
      .fn()
      .mockResolvedValueOnce(f.personal)
      .mockResolvedValueOnce({
        ...f.personal,
        databaseRevision: 4,
        version: 3,
        state: pending.state,
      });
    await expect(
      recoverNativePrivateCanvas(pending, f.snapshot, true, options, api as typeof request),
    ).rejects.toThrow('native.ack-mismatch');
    expect(await loadNativePrivatePending(userId, projectId, options)).toEqual(pending);
  });
  it('adopts the exact old localStorage row as uncertain rather than allowing an unsafe reset', async () => {
    const f = fixture(),
      { queue } = factory(),
      storage = store(),
      options = { queue, storage },
      pending = await stageNativePrivateCanvas(
        userId,
        f.snapshot,
        f.personal,
        f.candidate,
        options,
      );
    await discardNativePrivatePending(pending, options);
    storage.setItem(
      `ezerd.native.canvas.personal:${JSON.stringify([userId, projectId])}`,
      JSON.stringify(pending),
    );
    expect(await loadNativePrivatePending(userId, projectId, options)).toEqual(pending);
    await expect(discardNativePrivatePending(pending, options)).rejects.toThrow(
      'native.transmission-unknown',
    );
  });
  it('rejects unknown storage before a claim', async () => {
    const f = fixture(),
      { queue } = factory(),
      storage = {
        ...store(),
        getItem() {
          throw Error('Storage denied');
        },
      };
    await expect(
      stageNativePrivateCanvas(userId, f.snapshot, f.personal, f.candidate, { queue, storage }),
    ).rejects.toThrow('Storage denied');
    expect(await queue.read(userId, projectId)).toBeNull();
  });
});
