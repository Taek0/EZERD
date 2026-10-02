import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { ApiError } from '../../shared/api/client.js';
import { getNativeDurableQueue, NativeDurableQueue } from './native-durable-queue.js';
import { assertNativeExportReady } from './project-ddl-export.js';
import {
  prepareNativeUpgrade,
  stageNativeUpgrade,
  sendNativeUpgrade,
  loadNativeUpgrade,
  nativeUpgradeEntry,
  applyNativeUpgrade,
  validateNativeUpgradeAck,
  type NativeUpgradePlan,
  type NativeUpgradeOptions,
} from './native-upgrade.js';
import {
  transferState,
  transferControl,
  transferStorage,
  transferActor,
  transferProject,
  transferWorkspace,
  transferTime,
} from './native-transfer-test-fixtures.js';
import type { NativeSyncOperationResult } from '@ezerd/contracts';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('localStorage', transferStorage());
});
afterEach(async () => {
  await getNativeDurableQueue().close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function fixture() {
  let state = transferState('postgresql', 1);
  const storage = transferStorage();
  const api = vi.fn(async (_url: string, _init?: RequestInit): Promise<unknown> => state);
  const options: NativeUpgradeOptions = {
    control: transferControl(),
    canUpgrade: true,
    prepare: async () => true,
    storage,
    api,
    assertReady: (actor, project) => assertNativeExportReady(actor, project, storage),
  };
  return {
    options,
    api,
    storage,
    get state() {
      return state;
    },
    set state(value) {
      state = value;
    },
  };
}
function ack(plan: NativeUpgradePlan): NativeSyncOperationResult {
  if (plan.snapshot.native.status !== 'available') throw Error('fixture');
  return {
    protocolVersion: 2,
    operationId: plan.input.operationId,
    groupId: plan.input.operationId,
    sequence: plan.input.expectedSequence + 1,
    databaseRevision: plan.input.expectedDatabaseRevision + 1,
    status: 'accepted',
    reasonCode: 'document.upgraded',
    database: plan.snapshot.native.document.database,
    actor: { id: plan.userId, username: 'Owner', color: '#000000' },
    changedPaths: ['/schemaVersion'],
    createdAt: transferTime,
    document: plan.snapshot.native.document,
    nextBaseline: {
      baselineId: transferWorkspace,
      baseSequence: plan.input.expectedSequence + 1,
      baselineIssuedAt: transferTime,
      databaseRevision: plan.input.expectedDatabaseRevision + 1,
    },
  };
}
function upgraded(plan: NativeUpgradePlan, status: 'active' | 'archived' = 'active') {
  const result = ack(plan);
  return {
    ...plan.snapshot,
    project: {
      ...plan.snapshot.project,
      version: plan.input.expectedVersion + 1,
      databaseRevision: result.databaseRevision,
      status,
    },
    sequence: result.sequence,
    sourceDocument: result.document!,
  };
}
describe('native upgrade durable consumer', () => {
  it('reviews fresh source without writing, stages atomically, and consumes only an exact accepted ACK', async () => {
    const f = fixture(),
      plan = await prepareNativeUpgrade(f.options);
    expect(await getNativeDurableQueue().read(transferActor, transferProject)).toBeNull();
    await stageNativeUpgrade(plan, f.options);
    expect(await loadNativeUpgrade(f.options)).toMatchObject({
      input: plan.input,
      snapshot: plan.snapshot,
    });
    expect(Object.isFrozen(plan.snapshot.sourceDocument)).toBe(true);
    f.api.mockImplementation(async (url, init) => {
      expect(url).toContain('/document/upgrade');
      expect(JSON.parse(String(init?.body))).toEqual(plan.input);
      return ack(plan);
    });
    expect(await sendNativeUpgrade(plan, f.options)).toEqual(ack(plan));
    expect(await getNativeDurableQueue().read(transferActor, transferProject)).toBeNull();
  });
  it.each(['mysql', 'sqlite'] as const)(
    'keeps %s v1 physical representations and migration diagnostics in the persisted review',
    async (kind) => {
      const f = fixture();
      f.state = transferState(kind, 1);
      const plan = await prepareNativeUpgrade(f.options);
      await stageNativeUpgrade(plan, f.options);
      const restored = await loadNativeUpgrade(f.options);
      expect(restored?.snapshot).toEqual(f.state);
      expect(restored?.snapshot.sourceDocument.columns?.[0]?.physical.type).toEqual({
        name: 'int4',
        isArray: false,
      });
      expect(
        restored?.snapshot.native.status === 'available' &&
          restored.snapshot.native.document.columns?.[0]?.physical.type.kind,
      ).toBe('legacy');
    },
  );
  it('checks current source again before stage and denies ordinary read-only writes', async () => {
    const f = fixture(),
      plan = await prepareNativeUpgrade(f.options);
    f.state = { ...f.state, project: { ...f.state.project, version: 10 } };
    await expect(stageNativeUpgrade(plan, f.options)).rejects.toThrow('preview-changed');
    await expect(prepareNativeUpgrade({ ...f.options, canUpgrade: false })).rejects.toThrow(
      'design-required',
    );
    await expect(stageNativeUpgrade(plan, { ...f.options, canUpgrade: false })).rejects.toThrow(
      'design-required',
    );
    expect(await getNativeDurableQueue().read(transferActor, transferProject)).toBeNull();
    expect(f.api.mock.calls.every(([url]) => url.endsWith('/document-state'))).toBe(true);
  });
  it('uses the same actor/project row to exclude every other native writer', async () => {
    const f = fixture(),
      plan = await prepareNativeUpgrade(f.options);
    await stageNativeUpgrade(plan, f.options);
    const queue = getNativeDurableQueue();
    for (const kind of ['commands', 'history', 'privateCanvas'] as const) {
      await expect(
        queue.claim({
          userId: transferActor,
          projectId: transferProject,
          operationId: transferWorkspace,
          kind,
          payload: { kind },
        }),
      ).rejects.toThrow();
    }
    await expect(
      assertNativeExportReady(transferActor, transferProject, f.storage),
    ).rejects.toThrow();
    const separate = new NativeDurableQueue(indexedDB);
    await expect(
      separate.claim({
        userId: transferActor,
        projectId: transferProject,
        operationId: transferWorkspace,
        kind: 'history',
        payload: {},
      }),
    ).rejects.toThrow();
    await separate.close();
  });
  it('commits exactly one winner when upgrade and history claim through separate IDB connections', async () => {
    const f = fixture(),
      plan = await prepareNativeUpgrade(f.options);
    const a = getNativeDurableQueue(),
      b = new NativeDurableQueue(indexedDB);
    const history = {
      userId: transferActor,
      projectId: transferProject,
      operationId: transferWorkspace,
      kind: 'history' as const,
      payload: { command: 'undo' },
    };
    const outcomes = await Promise.allSettled([
      a.claim(nativeUpgradeEntry(plan)),
      b.claim(history),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const row = await a.read(transferActor, transferProject);
    expect(['upgrade', 'history']).toContain(row?.kind);
    expect(await b.read(transferActor, transferProject)).toEqual(row);
    await b.close();
  });
  it('rechecks legacy pending inside the transaction and never sends before a durable claim', async () => {
    const f = fixture(),
      plan = await prepareNativeUpgrade(f.options);
    f.options.assertReady = async () => undefined;
    f.storage.setItem(
      `ezerd.native.history:${JSON.stringify([transferActor, transferProject])}`,
      '{}',
    );
    await expect(stageNativeUpgrade(plan, f.options)).rejects.toThrow('pending');
    await expect(sendNativeUpgrade(plan, f.options)).rejects.toThrow('pending-changed');
    expect(f.api.mock.calls.every(([url]) => url.endsWith('/document-state'))).toBe(true);
    expect(await getNativeDurableQueue().read(transferActor, transferProject)).toBeNull();
  });
  it('preserves HTTP/transport failures and replays the exact stored body after reopen with viewer/archive', async () => {
    const f = fixture(),
      plan = await prepareNativeUpgrade(f.options);
    await stageNativeUpgrade(plan, f.options);
    f.api.mockRejectedValueOnce(new ApiError(403, 'read-denied'));
    await expect(sendNativeUpgrade(plan, f.options)).rejects.toThrow('read-denied');
    expect(
      await getNativeDurableQueue()
        .discard(nativeUpgradeEntry(plan))
        .catch((e: Error) => e.message),
    ).toContain('unknown');
    await getNativeDurableQueue().close();
    const readonly = { ...f.options, canUpgrade: false, prepare: vi.fn(async () => false) };
    const restored = await loadNativeUpgrade(readonly);
    expect(restored?.input).toEqual(plan.input);
    f.state = upgraded(plan, 'archived');
    f.api.mockImplementation(async (url, init) => {
      if (url.endsWith('/document/upgrade')) {
        expect(JSON.parse(String(init?.body))).toEqual(plan.input);
        return ack(plan);
      }
      return f.state;
    });
    const outcome = await applyNativeUpgrade(restored!, readonly, true);
    expect(outcome.snapshot?.project.status).toBe('archived');
    expect(readonly.prepare).not.toHaveBeenCalled();
    expect(await getNativeDurableQueue().read(transferActor, transferProject)).toBeNull();
  });
  it.each([
    'actor',
    'operationId',
    'groupId',
    'sequence',
    'databaseRevision',
    'baseline',
    'profile',
  ] as const)('retains payload on wrong %s ACK', async (field) => {
    const f = fixture(),
      plan = await prepareNativeUpgrade(f.options);
    await stageNativeUpgrade(plan, f.options);
    const wrong = structuredClone(ack(plan));
    if (field === 'actor') wrong.actor.id = transferWorkspace;
    else if (field === 'baseline') wrong.nextBaseline.baseSequence++;
    else if (field === 'profile')
      wrong.database = { kind: 'mysql', profileId: 'mysql-8.4-innodb-v1' };
    else if (field === 'sequence' || field === 'databaseRevision') wrong[field]++;
    else wrong[field] = transferWorkspace;
    f.api.mockResolvedValue(wrong);
    await expect(sendNativeUpgrade(plan, f.options)).rejects.toThrow();
    expect((await loadNativeUpgrade(f.options))?.input).toEqual(plan.input);
  });
  it('allows only one actual POST for competing senders and keeps its heartbeat alive', async () => {
    const f = fixture(),
      plan = await prepareNativeUpgrade(f.options);
    await stageNativeUpgrade(plan, f.options);
    let respond!: (value: unknown) => void, started!: () => void;
    const invoked = new Promise<void>((resolve) => {
      started = resolve;
    });
    f.api.mockImplementation(async () => {
      started();
      return new Promise((resolve) => {
        respond = resolve;
      });
    });
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const queue = getNativeDurableQueue(),
      renew = vi.spyOn(queue, 'renewTransmission');
    const first = sendNativeUpgrade(plan, f.options);
    await invoked;
    await expect(sendNativeUpgrade(plan, f.options)).rejects.toThrow('busy');
    await vi.advanceTimersByTimeAsync(5001);
    expect(renew).toHaveBeenCalled();
    respond(ack(plan));
    await first;
    expect(f.api).toHaveBeenCalledTimes(3); // two document-state reads plus one actual POST
    renew.mockRestore();
  });
  it('does not consume on account/scope changes or malformed persisted actor evidence', async () => {
    const f = fixture(),
      plan = await prepareNativeUpgrade(f.options);
    await stageNativeUpgrade(plan, f.options);
    f.options.control.currentScope = () => ({
      ...f.options.control.scope,
      userId: transferWorkspace,
    });
    await expect(sendNativeUpgrade(plan, f.options)).rejects.toThrow('대상');
    expect(await getNativeDurableQueue().read(transferActor, transferProject)).not.toBeNull();
    f.options.control.currentScope = () => f.options.control.scope;
    const entry = nativeUpgradeEntry(plan);
    await getNativeDurableQueue().discard(entry);
    await getNativeDurableQueue().claim({
      ...entry,
      payload: { ...(entry.payload as object), userId: transferWorkspace },
    });
    await expect(loadNativeUpgrade(f.options)).rejects.toThrow('pending-invalid');
  });
  it('consumes a verified ACK before reload and reports reload failure without a new POST', async () => {
    const f = fixture(),
      plan = await prepareNativeUpgrade(f.options);
    f.api.mockImplementation(async (url) =>
      url.endsWith('/document/upgrade') ? ack(plan) : f.state,
    );
    const outcome = await applyNativeUpgrade(plan, f.options);
    expect(outcome.snapshot).toBeNull();
    expect(outcome.reloadError).toBe('native.upgrade-reload-invalid');
    expect(await loadNativeUpgrade(f.options)).toBeNull();
    expect(f.api.mock.calls.filter(([url]) => url.endsWith('/document/upgrade'))).toHaveLength(1);
  });
  it('rejects an ACK with invalid graph even if all scalar coordinates match', async () => {
    const f = fixture(),
      plan = await prepareNativeUpgrade(f.options),
      wrong = structuredClone(ack(plan));
    wrong.document!.columns![0]!.tableId = 'missing';
    expect(() => validateNativeUpgradeAck(plan, wrong)).toThrow('설계');
  });
  it('pins the real actor transport and never persists session credentials', async () => {
    const f = fixture(),
      session = transferStorage();
    session.setItem(
      'ezerd.sync.session',
      JSON.stringify({
        userId: transferActor,
        token: 'private-session-token',
        expiresAt: '2050-01-01T00:00:00Z',
      }),
    );
    vi.stubGlobal('sessionStorage', session);
    const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer private-session-token');
      return new Response(JSON.stringify(f.state), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const options = { ...f.options };
    delete options.api;
    const plan = await prepareNativeUpgrade(options);
    await stageNativeUpgrade(plan, options);
    expect(
      JSON.stringify(await getNativeDurableQueue().read(transferActor, transferProject)),
    ).not.toContain('private-session-token');
    session.setItem(
      'ezerd.sync.session',
      JSON.stringify({
        userId: transferWorkspace,
        token: 'other-token',
        expiresAt: '2050-01-01T00:00:00Z',
      }),
    );
    await expect(sendNativeUpgrade(plan, options)).rejects.toThrow('mismatch');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
