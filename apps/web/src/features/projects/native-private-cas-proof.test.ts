import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  createEmptyNativeDocument,
  defaultDatabaseContext,
  extractPersonalState,
  upsertCombinedView,
} from '@ezerd/model';
import type { NativeCanvasPersonalPending, ProjectDocumentState } from '@ezerd/contracts';
import { NativeDurableQueue, type NativeDurablePending } from './native-durable-queue.js';
import { ApiError, request } from '../../shared/api/client.js';
import { loadNativeEditorDraft, storeNativeEditorDraft } from './native-editor-draft.js';
import { stageNativePrivateCanvas, recoverNativePrivateCanvas } from './native-private-canvas.js';
import {
  inspectNativePrivateCASPrecondition,
  loadNativePrivateCASArchive,
  verifyNativePrivateCASPrecondition,
  discardArchivedNativePrivateCAS,
} from './native-private-cas-proof.js';

const userId = '00000000-0000-4000-8000-000000000001',
  projectId = '00000000-0000-4000-8000-000000000002';
const queues: NativeDurableQueue[] = [];
function storage() {
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
function fixture() {
  const document = createEmptyNativeDocument(defaultDatabaseContext('postgresql'));
  document.domains = [{ id: 'd', name: 'Domain', description: '' }];
  const candidate = upsertCombinedView(document, {
    id: 'v',
    name: 'Uncertain input',
    domainIds: ['d'],
  });
  const snapshot: ProjectDocumentState = {
    protocolVersion: 2,
    project: {
      id: projectId,
      workspaceId: projectId,
      name: 'Native',
      status: 'active',
      version: 7,
      databaseKind: 'postgresql',
      databaseProfileId: document.database.profileId,
      databaseRevision: 3,
      createdAt: '2026-10-02T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
    },
    sequence: 10,
    sourceDocument: document,
    native: { status: 'available', document, issues: [], migrationIssues: [] },
  };
  const personal = {
    version: 2,
    projectVersion: 7,
    syncSequence: 10,
    databaseRevision: 3,
    state: extractPersonalState(document),
  };
  const pending: NativeCanvasPersonalPending = {
    revision: crypto.randomUUID(),
    userId,
    projectId,
    expectedVersion: 2,
    databaseRevision: 3,
    projectVersion: 7,
    sequence: 10,
    before: personal.state,
    state: extractPersonalState(candidate),
  };
  return { snapshot, personal, pending, candidate };
}
const entry = (pending: NativeCanvasPersonalPending): NativeDurablePending => ({
  userId: pending.userId,
  projectId: pending.projectId,
  operationId: pending.revision,
  kind: 'privateCanvas',
  payload: pending,
});
function connections() {
  const idb = new IDBFactory();
  let now = 0;
  const queue = new NativeDurableQueue(idb, 'private-cas-test', {
    now: () => now,
    leaseMs: 100,
    ownerId: 'first-tab',
  });
  const second = new NativeDurableQueue(idb, 'private-cas-test', {
    now: () => now,
    leaseMs: 100,
    ownerId: 'second-tab',
  });
  queues.push(queue, second);
  return {
    queue,
    second,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
function waiting() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function staged(withDraft = false) {
  const f = fixture(),
    pair = connections(),
    s = storage();
  const draft = {
    userId,
    projectId,
    key: 'canvas:action:view',
    revision: crypto.randomUUID(),
    expected: { version: 7, sequence: 10, databaseRevision: 3 },
    before: { name: '' },
    values: { name: 'Uncertain input 原文' },
  };
  if (withDraft) storeNativeEditorDraft(draft, s);
  const pending = await stageNativePrivateCanvas(
    userId,
    f.snapshot,
    f.personal,
    f.candidate,
    { queue: pair.queue, storage: s },
    withDraft ? draft : undefined,
  );
  return { ...f, ...pair, s, draft, pending };
}
afterEach(async () => {
  await Promise.all(queues.splice(0).map((q) => q.close()));
  vi.unstubAllGlobals();
});
describe('private CAS bounded proof', () => {
  it.each([
    ['version', 'personal-version-advanced'],
    ['databaseRevision', 'database-revision-advanced'],
    ['projectVersion', 'project-version-advanced'],
    ['syncSequence', 'sequence-advanced'],
  ] as const)('uses monotonic %s advance, without claiming an accepted ACK', (field, reason) => {
    const f = fixture();
    const result = inspectNativePrivateCASPrecondition(f.pending, {
      ...f.personal,
      [field]: f.personal[field] + 1,
    });
    expect(result.outcome).toBe('cas-precondition-consumed');
    expect(result.reasons).toEqual([reason]);
  });
  it.each(['databaseRevision', 'projectVersion', 'syncSequence'] as const)(
    'rejects regressed %s even with another advanced counter',
    (field) => {
      const f = fixture();
      expect(() =>
        inspectNativePrivateCASPrecondition(f.pending, {
          ...f.personal,
          version: 9,
          [field]: f.personal[field] - 1,
        }),
      ).toThrow('counter-regressed');
    },
  );
  it('same-version content differences, identical desired state and lower personal version do not prove consumption', () => {
    const f = fixture();
    for (const state of [f.personal.state, f.pending.state])
      expect(inspectNativePrivateCASPrecondition(f.pending, { ...f.personal, state }).outcome).toBe(
        'unconfirmed',
      );
    expect(
      inspectNativePrivateCASPrecondition(f.pending, { ...f.personal, version: 1 }).outcome,
    ).toBe('unconfirmed');
  });
  it('requires native GET database revision and safe counters', () => {
    const f = fixture(),
      { databaseRevision: _, ...legacy } = f.personal;
    expect(() => inspectNativePrivateCASPrecondition(f.pending, legacy)).toThrow();
    expect(() =>
      inspectNativePrivateCASPrecondition(f.pending, {
        ...f.personal,
        databaseRevision: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow();
  });
  it('validates exact archived payload and preserves the transmission fence separately from ACKs', () => {
    const f = fixture(),
      s = storage(),
      token = crypto.randomUUID(),
      observed = { ...f.personal, version: 3 },
      reasons = ['personal-version-advanced'];
    const key = `ezerd.native.canvas.cas-archive:${JSON.stringify([userId, projectId, f.pending.revision])}`;
    s.setItem(
      key,
      JSON.stringify({
        format: 'ezerd.native.private-cas-archive',
        formatVersion: 1,
        outcome: 'cas-precondition-consumed',
        pending: f.pending,
        observed,
        reasons,
        transmissionToken: token,
        observedAt: '2026-10-02T00:00:00Z',
        authorization: 'ignored-untrusted-field',
      }),
    );
    const saved = loadNativePrivateCASArchive(f.pending, s)!;
    expect(saved.transmissionToken).toBe(token);
    expect(saved.pending.state).toEqual(f.pending.state);
    expect(saved).not.toHaveProperty('authorization');
    expect(() => loadNativePrivateCASArchive({ ...f.pending, expectedVersion: 1 }, s)).toThrow(
      'archive-mismatch',
    );
    s.setItem(key, JSON.stringify({ ...saved, reasons: ['sequence-advanced'] }));
    expect(() => loadNativePrivateCASArchive(f.pending, s)).toThrow('archive-invalid');
  });
  it('refuses explicit discard without archive and preserves the actual IDB pending', async () => {
    const f = fixture(),
      queue = new NativeDurableQueue(new IDBFactory()),
      s = storage();
    queues.push(queue);
    const pending = await stageNativePrivateCanvas(userId, f.snapshot, f.personal, f.candidate, {
      queue,
      storage: s,
    });
    await expect(
      discardArchivedNativePrivateCAS(userId, f.snapshot, pending, {
        queue,
        storage: s,
        api: vi.fn(),
      }),
    ).rejects.toThrow('proof-required');
    expect((await queue.read(userId, projectId))?.operationId).toBe(pending.revision);
  });
  it('fails closed before GET when an atomic private fence implementation is unavailable', async () => {
    const f = fixture(),
      queue = new NativeDurableQueue(new IDBFactory()),
      api = vi.fn();
    queues.push(queue);
    Object.defineProperty(queue, 'confirmPrivateCASPreconditionConsumed', { value: undefined });
    await expect(
      verifyNativePrivateCASPrecondition(userId, f.snapshot, f.pending, { queue, api }),
    ).rejects.toThrow('fence-unavailable');
    expect(api).not.toHaveBeenCalled();
  });
  it('refuses wrong actor before a network request', async () => {
    const f = fixture(),
      api = vi.fn();
    await expect(
      verifyNativePrivateCASPrecondition(projectId, f.snapshot, f.pending, { api }),
    ).rejects.toThrow('scope-mismatch');
    expect(api).not.toHaveBeenCalled();
  });
});

describe('private proof with the production queue and two real IDB connections', () => {
  it('keeps the unchanged CAS open for the existing exact-request GET/PUT retry path', async () => {
    const f = await staged(),
      api = vi.fn().mockResolvedValue(f.personal);
    expect(
      await verifyNativePrivateCASPrecondition(userId, f.snapshot, f.pending, {
        queue: f.queue,
        storage: f.s,
        api: api as typeof request,
      }),
    ).toEqual({ outcome: 'unconfirmed' });
    expect(loadNativePrivateCASArchive(f.pending, f.s)).toBeNull();
    expect(await f.second.read(userId, projectId)).toEqual(entry(f.pending));
    await expect(
      f.second.claim({ ...entry(f.pending), operationId: crypto.randomUUID() }),
    ).rejects.toThrow('pending-exists');
    const replay = vi
      .fn()
      .mockResolvedValueOnce(f.personal)
      .mockResolvedValueOnce({ ...f.personal, version: 3, state: f.pending.state });
    expect(
      await recoverNativePrivateCanvas(
        f.pending,
        f.snapshot,
        true,
        { queue: f.second, storage: f.s },
        replay as typeof request,
      ),
    ).toMatchObject({ version: 3, state: f.pending.state });
    expect(JSON.parse(replay.mock.calls[1]![1].body)).toMatchObject({
      expectedVersion: 2,
      expectedDatabaseRevision: 3,
      expectedProjectVersion: 7,
      expectedSyncSequence: 10,
      state: f.pending.state,
    });
    expect(replay.mock.calls[1]![1].method).toBe('PUT');
    expect(await f.queue.read(userId, projectId)).toBeNull();
  });
  it('blocks proof and network access when IDB state is unknown', async () => {
    const f = fixture(),
      s = storage(),
      api = vi.fn(),
      factory = new IDBFactory();
    vi.spyOn(factory, 'open').mockImplementation(() => {
      throw Error('IDB denied');
    });
    const queue = new NativeDurableQueue(factory);
    await expect(
      verifyNativePrivateCASPrecondition(userId, f.snapshot, f.pending, {
        queue,
        storage: s,
        api: api as typeof request,
      }),
    ).rejects.toThrow('IDB denied');
    expect(queue.state(userId, projectId)).toBe('unknown');
    expect(api).not.toHaveBeenCalled();
    expect(loadNativePrivateCASArchive(f.pending, s)).toBeNull();
    await queue.close().catch(() => {}); // The rejected open created no connection to retain.
  });
  it('archives exact state/input/token via actor-bound GET, retains pending, then explicitly discards from the other tab', async () => {
    const f = await staged(true),
      session = storage();
    session.setItem(
      'ezerd.sync.session',
      JSON.stringify({ userId, token: 'private-bound-session', expiresAt: '2099-01-01T00:00:00Z' }),
    );
    vi.stubGlobal('sessionStorage', session);
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe(`/api/projects/${projectId}/personal-state`);
      expect(init?.method ?? 'GET').toBe('GET');
      expect(init?.cache).toBe('no-store');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer private-bound-session');
      return new Response(JSON.stringify({ ...f.personal, version: 3 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const begin = vi.spyOn(f.queue, 'beginTransmission');
    const result = await verifyNativePrivateCASPrecondition(userId, f.snapshot, f.pending, {
      queue: f.queue,
      storage: f.s,
    });
    expect(result.outcome).toBe('cas-precondition-consumed');
    const archive = loadNativePrivateCASArchive(f.pending, f.s)!;
    expect(archive.pending).toEqual(f.pending);
    expect(archive.capturedDraft).toEqual(f.draft);
    expect(archive.transmissionToken).toBe(await begin.mock.results[0]!.value);
    expect(archive.reasons).toEqual(['personal-version-advanced']);
    expect(JSON.stringify(archive)).not.toContain('private-bound-session');
    expect(await f.second.read(userId, projectId)).toEqual(entry(f.pending));
    expect(f.second.state(userId, projectId)).toBe('pending');
    await expect(
      f.second.claim({ ...entry(f.pending), kind: 'commands', operationId: crypto.randomUUID() }),
    ).rejects.toThrow('pending-exists');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      await discardArchivedNativePrivateCAS(userId, f.snapshot, f.pending, {
        queue: f.second,
        storage: f.s,
      }),
    ).toEqual(archive);
    expect(await f.queue.read(userId, projectId)).toBeNull();
    expect(loadNativePrivateCASArchive(f.pending, f.s)).toEqual(archive);
    expect(loadNativeEditorDraft(userId, projectId, f.draft.key, f.s)).toEqual(f.draft);
    expect(fetcher).toHaveBeenCalledTimes(1); // No PUT, cancellation or ACK lookup during proof/discard.
  });
  it.each(['databaseRevision', 'projectVersion', 'syncSequence'] as const)(
    'archives consumed %s from GET even while personal version stays unchanged',
    async (field) => {
      const f = await staged(),
        api = vi.fn().mockResolvedValue({ ...f.personal, [field]: f.personal[field] + 1 });
      const result = await verifyNativePrivateCASPrecondition(userId, f.snapshot, f.pending, {
        queue: f.queue,
        storage: f.s,
        api: api as typeof request,
      });
      expect(result.outcome).toBe('cas-precondition-consumed');
      expect(await f.second.read(userId, projectId)).toEqual(entry(f.pending));
      expect(f.second.state(userId, projectId)).toBe('pending');
      expect(loadNativePrivateCASArchive(f.pending, f.s)?.observed.version).toBe(
        f.pending.expectedVersion,
      );
    },
  );
  it('preserves newer editor input instead of archiving it as the original captured revision', async () => {
    const f = await staged(true),
      newer = { ...f.draft, revision: crypto.randomUUID(), values: { name: 'Newer typed input' } };
    storeNativeEditorDraft(newer, f.s);
    const api = vi.fn().mockResolvedValue({ ...f.personal, version: 3 });
    await verifyNativePrivateCASPrecondition(userId, f.snapshot, f.pending, {
      queue: f.queue,
      storage: f.s,
      api: api as typeof request,
    });
    expect(loadNativePrivateCASArchive(f.pending, f.s)?.capturedDraft).toBeUndefined();
    await discardArchivedNativePrivateCAS(userId, f.snapshot, f.pending, {
      queue: f.second,
      storage: f.s,
      api: api as typeof request,
    });
    expect(loadNativeEditorDraft(userId, projectId, newer.key, f.s)).toEqual(newer);
  });
  it.each([
    '404',
    'transport',
    'same-version-content',
    'regressed-context',
    'missing-native-context',
  ] as const)(
    'keeps unknown pending for %s without archiving or treating it as an ACK',
    async (mode) => {
      const f = await staged(),
        api = vi.fn(async () => {
          if (mode === '404') throw new ApiError(404, 'not found');
          if (mode === 'transport') throw Error('transport unavailable');
          if (mode === 'regressed-context')
            return { ...f.personal, version: 3, databaseRevision: 2 };
          if (mode === 'missing-native-context') {
            const { databaseRevision: _, ...legacy } = f.personal;
            return { ...legacy, version: 3 };
          }
          return { ...f.personal, state: f.pending.state };
        });
      const output = verifyNativePrivateCASPrecondition(userId, f.snapshot, f.pending, {
        queue: f.queue,
        storage: f.s,
        api: api as typeof request,
      });
      if (mode === 'same-version-content') expect(await output).toEqual({ outcome: 'unconfirmed' });
      else await expect(output).rejects.toThrow();
      expect(loadNativePrivateCASArchive(f.pending, f.s)).toBeNull();
      expect(await f.second.read(userId, projectId)).toEqual(entry(f.pending));
      expect(f.second.state(userId, projectId)).toBe('unknown');
      await expect(f.second.discard(entry(f.pending))).rejects.toThrow('transmission-unknown');
      expect(api).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects an account switch during awaited GET before the atomic archive or any POST', async () => {
    const f = await staged(),
      session = storage();
    session.setItem(
      'ezerd.sync.session',
      JSON.stringify({ userId, token: 'old-session', expiresAt: '2099-01-01T00:00:00Z' }),
    );
    vi.stubGlobal('sessionStorage', session);
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method ?? 'GET').toBe('GET');
      session.setItem(
        'ezerd.sync.session',
        JSON.stringify({
          userId: projectId,
          token: 'new-actor',
          expiresAt: '2099-01-01T00:00:00Z',
        }),
      );
      return new Response(JSON.stringify({ ...f.personal, version: 3 }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(
      verifyNativePrivateCASPrecondition(userId, f.snapshot, f.pending, {
        queue: f.queue,
        storage: f.s,
      }),
    ).rejects.toThrow('actor-mismatch');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(loadNativePrivateCASArchive(f.pending, f.s)).toBeNull();
    expect(await f.second.read(userId, projectId)).toEqual(entry(f.pending));
    expect(f.second.state(userId, projectId)).toBe('unknown');
  });
  it('sends no GET or POST if the actor changes during the initial IDB read', async () => {
    const f = await staged(),
      session = storage(),
      fetcher = vi.fn();
    session.setItem(
      'ezerd.sync.session',
      JSON.stringify({ userId, token: 'old-session', expiresAt: '2099-01-01T00:00:00Z' }),
    );
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('fetch', fetcher);
    const read = f.queue.read.bind(f.queue);
    vi.spyOn(f.queue, 'read').mockImplementationOnce(async (actor, project) => {
      const result = await read(actor, project);
      session.setItem(
        'ezerd.sync.session',
        JSON.stringify({
          userId: projectId,
          token: 'new-actor',
          expiresAt: '2099-01-01T00:00:00Z',
        }),
      );
      return result;
    });
    await expect(
      verifyNativePrivateCASPrecondition(userId, f.snapshot, f.pending, {
        queue: f.queue,
        storage: f.s,
      }),
    ).rejects.toThrow('actor-mismatch');
    expect(fetcher).not.toHaveBeenCalled();
    expect(loadNativePrivateCASArchive(f.pending, f.s)).toBeNull();
    expect(await f.second.read(userId, projectId)).toEqual(entry(f.pending));
  });
  it('aborts the real IDB proof transaction when UI context changes inside its guard', async () => {
    const f = await staged(),
      api = vi.fn().mockResolvedValue({ ...f.personal, version: 3 });
    let current = true;
    const original = f.queue.confirmPrivateCASPreconditionConsumed.bind(f.queue);
    vi.spyOn(f.queue, 'confirmPrivateCASPreconditionConsumed').mockImplementationOnce(
      (pending, token, guard) =>
        original(pending, token, () => {
          current = false;
          guard?.();
        }),
    );
    await expect(
      verifyNativePrivateCASPrecondition(userId, f.snapshot, f.pending, {
        queue: f.queue,
        storage: f.s,
        api: api as typeof request,
        assertCurrent: () => {
          if (!current) throw Error('context changed');
        },
      }),
    ).rejects.toThrow('context changed');
    expect(loadNativePrivateCASArchive(f.pending, f.s)).toBeNull();
    expect(await f.second.read(userId, projectId)).toEqual(entry(f.pending));
    expect(f.second.state(userId, projectId)).toBe('unknown');
    await expect(f.second.discard(entry(f.pending))).rejects.toThrow('transmission-unknown');
  });
  it('does not run archive storage after lease expiry and retains unknown pending', async () => {
    const f = await staged(),
      hold = waiting(),
      api = vi.fn().mockReturnValue(hold.promise),
      writes = vi.spyOn(f.s, 'setItem');
    const checking = verifyNativePrivateCASPrecondition(userId, f.snapshot, f.pending, {
      queue: f.queue,
      storage: f.s,
      api: api as typeof request,
    });
    const rejected = expect(checking).rejects.toThrow('proof-fence-changed');
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    f.advance(101);
    hold.resolve({ ...f.personal, version: 3 });
    await rejected;
    expect(writes).not.toHaveBeenCalled();
    expect(await f.second.read(userId, projectId)).toEqual(entry(f.pending));
    expect(f.second.state(userId, projectId)).toBe('unknown');
    await expect(f.second.discard(entry(f.pending))).rejects.toThrow('transmission-unknown');
  });
  it('fences an expired GET proof against a newer lease from the other connection, including its late end', async () => {
    const f = await staged(),
      hold = waiting(),
      api = vi.fn().mockReturnValue(hold.promise),
      writes = vi.spyOn(f.s, 'setItem');
    const checking = verifyNativePrivateCASPrecondition(userId, f.snapshot, f.pending, {
      queue: f.queue,
      storage: f.s,
      api: api as typeof request,
    });
    const rejected = expect(checking).rejects.toThrow('proof-fence-changed');
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    f.advance(101);
    const nextToken = await f.second.beginTransmission(entry(f.pending));
    hold.resolve({ ...f.personal, version: 3 });
    await rejected;
    expect(writes).not.toHaveBeenCalled();
    expect(loadNativePrivateCASArchive(f.pending, f.s)).toBeNull();
    expect(await f.second.read(userId, projectId)).toEqual(entry(f.pending));
    expect(f.second.state(userId, projectId)).toBe('sending');
    expect(await f.second.renewTransmission(entry(f.pending), nextToken)).toBe(true);
    await f.second.endTransmission(entry(f.pending), nextToken);
    await expect(f.second.discard(entry(f.pending))).rejects.toThrow('transmission-unknown');
  });
  it('lets only one of two concurrent proof readers send GET and preserves the row until explicit discard', async () => {
    const f = await staged(),
      hold = waiting(),
      api = vi.fn().mockReturnValue(hold.promise);
    const outputs = Promise.allSettled(
      [f.queue, f.second].map((queue) =>
        verifyNativePrivateCASPrecondition(userId, f.snapshot, f.pending, {
          queue,
          storage: f.s,
          api: api as typeof request,
        }),
      ),
    );
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    hold.resolve({ ...f.personal, version: 3 });
    const results = await outputs;
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: Error('native.transmission-busy'),
    });
    expect(await f.queue.read(userId, projectId)).toEqual(entry(f.pending));
    expect(loadNativePrivateCASArchive(f.pending, f.s)?.outcome).toBe('cas-precondition-consumed');
    await discardArchivedNativePrivateCAS(userId, f.snapshot, f.pending, {
      queue: f.second,
      storage: f.s,
      api: api as typeof request,
    });
    expect(await f.queue.read(userId, projectId)).toBeNull();
  });
  it.each(['write-denied', 'readback-failed'] as const)(
    'aborts uncertainty release for archive %s, preserving typed input and exact row',
    async (mode) => {
      const f = await staged(true),
        api = vi.fn().mockResolvedValue({ ...f.personal, version: 3 });
      const read = f.s.getItem;
      if (mode === 'write-denied')
        vi.spyOn(f.s, 'setItem').mockImplementation(() => {
          throw Error('archive quota');
        });
      else
        vi.spyOn(f.s, 'getItem').mockImplementation((key) =>
          key.startsWith('ezerd.native.canvas.cas-archive:') ? null : read(key),
        );
      await expect(
        verifyNativePrivateCASPrecondition(userId, f.snapshot, f.pending, {
          queue: f.queue,
          storage: f.s,
          api: api as typeof request,
        }),
      ).rejects.toThrow(mode === 'write-denied' ? 'archive quota' : 'archive-storage-failed');
      vi.restoreAllMocks();
      expect(await f.second.read(userId, projectId)).toEqual(entry(f.pending));
      expect(f.second.state(userId, projectId)).toBe('unknown');
      expect(loadNativeEditorDraft(userId, projectId, f.draft.key, f.s)).toEqual(f.draft);
      await expect(f.second.discard(entry(f.pending))).rejects.toThrow('transmission-unknown');
      if (mode === 'readback-failed') {
        expect(loadNativePrivateCASArchive(f.pending, f.s)?.pending).toEqual(f.pending);
        await expect(
          discardArchivedNativePrivateCAS(userId, f.snapshot, f.pending, {
            queue: f.second,
            storage: f.s,
            api: api as typeof request,
          }),
        ).rejects.toThrow('transmission-unknown');
      }
    },
  );
  it('does not let an older archived proof discard an active or subsequently unknown retransmission', async () => {
    const f = await staged(),
      api = vi.fn().mockResolvedValue({ ...f.personal, version: 3 });
    await verifyNativePrivateCASPrecondition(userId, f.snapshot, f.pending, {
      queue: f.queue,
      storage: f.s,
      api: api as typeof request,
    });
    const archive = loadNativePrivateCASArchive(f.pending, f.s)!,
      next = await f.second.beginTransmission(entry(f.pending));
    await f.queue.endTransmission(entry(f.pending), archive.transmissionToken);
    expect(await f.second.read(userId, projectId)).toEqual(entry(f.pending));
    expect(f.second.state(userId, projectId)).toBe('sending');
    await expect(
      discardArchivedNativePrivateCAS(userId, f.snapshot, f.pending, {
        queue: f.queue,
        storage: f.s,
        api: api as typeof request,
      }),
    ).rejects.toThrow('transmission-busy');
    await f.second.endTransmission(entry(f.pending), next);
    await expect(
      discardArchivedNativePrivateCAS(userId, f.snapshot, f.pending, {
        queue: f.queue,
        storage: f.s,
        api: api as typeof request,
      }),
    ).rejects.toThrow('transmission-unknown');
    expect(loadNativePrivateCASArchive(f.pending, f.s)).toEqual(archive);
  });
  it('rejects altered payload or wrong project before sending GET and cannot erase a different operation', async () => {
    const f = await staged(),
      api = vi.fn();
    const changed = { ...f.pending, expectedVersion: 1 };
    await expect(
      verifyNativePrivateCASPrecondition(userId, f.snapshot, changed, {
        queue: f.queue,
        storage: f.s,
        api: api as typeof request,
      }),
    ).rejects.toThrow('pending-changed');
    await expect(
      verifyNativePrivateCASPrecondition(
        userId,
        { ...f.snapshot, project: { ...f.snapshot.project, id: userId } },
        f.pending,
        { queue: f.queue, storage: f.s, api: api as typeof request },
      ),
    ).rejects.toThrow('scope-mismatch');
    expect(api).not.toHaveBeenCalled();
    expect(await f.second.read(userId, projectId)).toEqual(entry(f.pending));
  });
});
