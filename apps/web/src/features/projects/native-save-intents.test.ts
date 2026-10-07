import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyNativeDocument, defaultDatabaseContext } from '@ezerd/model';
import type { ProjectDocumentState } from '@ezerd/contracts';
import { ApiError, request } from '../../shared/api/client.js';
import {
  createNativeTestIndexedDB,
  nativeTestDeferred,
} from './native-durable-test-environment.js';
import {
  enqueueNativeSave,
  flushNativeSaveIntent,
  nativeSaveIntents,
  nativeRejectedSaveIntents,
  lookupNativeSaveIntentResult,
} from './native-save-intents.js';
import { checkNativeAck, loadNativePending } from './native-save.js';
import { nativeEditorExportBlocked } from './native-export-state.js';
beforeEach(() => vi.stubGlobal('indexedDB', createNativeTestIndexedDB()));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const userId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
function storage() {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
function snapshot(): ProjectDocumentState {
  const doc = createEmptyNativeDocument(defaultDatabaseContext('postgresql'));
  return {
    protocolVersion: 2,
    project: {
      id: projectId,
      workspaceId: other,
      name: 'Native',
      status: 'active',
      version: 7,
      databaseKind: 'postgresql',
      databaseProfileId: 'postgresql-18-v1',
      databaseRevision: 3,
      createdAt: '2026-10-02T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
    },
    sequence: 10,
    sourceDocument: doc,
    native: { status: 'available', document: doc, migrationIssues: [], issues: [] },
  };
}
const command = {
  type: 'patch_column' as const,
  id: 'c',
  patch: { physical: { comment: 'Input preserved' } },
};
function ack(operationId: string, status = 'accepted') {
  return {
    protocolVersion: 2,
    database: defaultDatabaseContext('postgresql'),
    databaseRevision: 3,
    operationId,
    groupId: operationId,
    sequence: 11,
    status,
    actor: { id: userId, username: 'actor', color: '#123456' },
    changedPaths: ['/columns/c/physical/comment'],
    createdAt: '2026-10-02T00:00:01Z',
    nextBaseline: {
      baselineId: other,
      baseSequence: 11,
      baselineIssuedAt: '2026-10-02T00:00:01Z',
      databaseRevision: 3,
    },
  };
}
describe('durable unsent native save intents', () => {
  it('stages pre-existing unsent intents verbatim instead of changing their operation hash', async () => {
    const store = storage(),
      id = enqueueNativeSave(userId, snapshot(), [command], undefined, undefined, store),
      intent = nativeSaveIntents(userId, projectId, store)[0]!;
    // Simulate an intent persisted before enqueue normalization was introduced.
    intent.pending.request.commands = [
      { ...command, patch: { physical: { comment: 'older input' } } },
      structuredClone(command),
    ];
    store.setItem(intent.key, JSON.stringify(intent.pending));
    const api = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(404, 'missing'))
      .mockResolvedValueOnce(ack(id));
    expect(await flushNativeSaveIntent(userId, snapshot(), store, api as typeof request)).toEqual({
      operationId: id,
      accepted: true,
    });
    expect(JSON.parse(api.mock.calls[1]![1].body as string)).toEqual(intent.pending.request);
  });

  it('stores a canonical request once and validates the same waiter payload after another tab ACKs', async () => {
    const store = storage(),
      commands = [{ ...command, patch: { physical: { comment: 'intermediate' } } }, command],
      original = structuredClone(commands),
      id = enqueueNativeSave(userId, snapshot(), commands, undefined, undefined, store),
      waiter = nativeSaveIntents(userId, projectId, store)[0]!.pending,
      api = vi
        .fn()
        .mockRejectedValueOnce(new ApiError(404, 'missing'))
        .mockResolvedValueOnce(ack(id));
    expect(waiter.request.commands).toEqual([command]);
    expect(commands).toEqual(original);
    expect(enqueueNativeSave(userId, snapshot(), [command], undefined, undefined, store)).toBe(id);
    expect(await flushNativeSaveIntent(userId, snapshot(), store, api as typeof request)).toEqual({
      operationId: id,
      accepted: true,
    });
    expect(JSON.parse(api.mock.calls[1]![1].body as string)).toEqual(waiter.request);
    expect(() =>
      checkNativeAck(waiter, ack(id) as Parameters<typeof checkNativeAck>[1]),
    ).not.toThrow();
    expect(
      await lookupNativeSaveIntentResult(
        waiter,
        vi.fn().mockResolvedValue(ack(id)) as typeof request,
      ),
    ).toBe(true);
  });

  it('never rewrites an already-claimed request when a later final patch is enqueued', async () => {
    const store = storage(),
      sent = nativeTestDeferred<unknown>(),
      id = enqueueNativeSave(userId, snapshot(), [command], undefined, undefined, store),
      waiter = nativeSaveIntents(userId, projectId, store)[0]!.pending,
      api = vi
        .fn()
        .mockRejectedValueOnce(new ApiError(404, 'missing'))
        .mockImplementationOnce(() => sent.promise),
      flushing = flushNativeSaveIntent(userId, snapshot(), store, api as typeof request);
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    const bodyBefore = api.mock.calls[1]![1].body,
      claimedBefore = await loadNativePending(userId, projectId, store),
      later = { ...command, patch: { physical: { comment: 'final input' } } },
      laterId = enqueueNativeSave(
        userId,
        snapshot(),
        [command, later],
        undefined,
        undefined,
        store,
      );
    expect(laterId).not.toBe(id);
    expect(await loadNativePending(userId, projectId, store)).toEqual(claimedBefore);
    expect(claimedBefore).toEqual(waiter);
    expect(api.mock.calls[1]![1].body).toBe(bodyBefore);
    expect(JSON.parse(bodyBefore as string)).toEqual(waiter.request);
    expect(nativeSaveIntents(userId, projectId, store)[1]!.pending.request.commands).toEqual([
      later,
    ]);
    sent.resolve(ack(id));
    expect(await flushing).toEqual({ operationId: id, accepted: true });
    expect(
      nativeSaveIntents(userId, projectId, store).map(
        (intent) => intent.pending.request.operationId,
      ),
    ).toEqual([laterId]);
  });

  it('preserves the next edit while the first request is in flight, then sends in order', async () => {
    const store = storage(),
      sent = nativeTestDeferred<unknown>();
    const first = enqueueNativeSave(
      userId,
      snapshot(),
      [{ ...command, patch: { logical: { name: 'later' } } }],
      undefined,
      undefined,
      store,
    );
    const api = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(404, 'missing'))
      .mockImplementationOnce(() => sent.promise);
    const flushing = flushNativeSaveIntent(userId, snapshot(), store, api as typeof request);
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    const second = enqueueNativeSave(
      userId,
      snapshot(),
      [{ ...command, patch: { logical: { name: 'new' } } }],
      undefined,
      undefined,
      store,
    );
    expect(
      nativeSaveIntents(userId, projectId, store).map((i) => i.pending.request.operationId),
    ).toEqual([first, second]);
    expect(nativeEditorExportBlocked(userId, projectId)).toBe(true);
    sent.resolve(ack(first));
    expect(await flushing).toEqual({ operationId: first, accepted: true });
    const secondApi = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(404, 'missing'))
      .mockResolvedValueOnce(ack(second));
    expect(
      await flushNativeSaveIntent(userId, snapshot(), store, secondApi as typeof request),
    ).toEqual({ operationId: second, accepted: true });
    expect(nativeSaveIntents(userId, projectId, store)).toEqual([]);
    expect(nativeEditorExportBlocked(userId, projectId)).toBe(false);
  });
  it('looks up the stable operation after reload without replaying a previously accepted request', async () => {
    const store = storage();
    const id = enqueueNativeSave(userId, snapshot(), [command], undefined, undefined, store);
    const api = vi.fn().mockResolvedValue(ack(id));
    expect(await flushNativeSaveIntent(userId, snapshot(), store, api as typeof request)).toEqual({
      operationId: id,
      accepted: true,
    });
    expect(api).toHaveBeenCalledTimes(1);
    expect(nativeSaveIntents(userId, projectId, store)).toEqual([]);
  });
  it('retains an unknown transmission and all later intents for automatic recovery', async () => {
    const store = storage();
    const id = enqueueNativeSave(userId, snapshot(), [command], undefined, undefined, store);
    enqueueNativeSave(
      userId,
      snapshot(),
      [{ ...command, patch: { logical: { name: 'later' } } }],
      undefined,
      undefined,
      store,
    );
    const api = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(404, 'missing'))
      .mockRejectedValueOnce(Error('offline'));
    await expect(
      flushNativeSaveIntent(userId, snapshot(), store, api as typeof request),
    ).rejects.toThrow('offline');
    expect((await loadNativePending(userId, projectId, store))?.request.operationId).toBe(id);
    expect(nativeSaveIntents(userId, projectId, store)).toHaveLength(2);
    const recovered = vi.fn().mockResolvedValue(ack(id));
    await flushNativeSaveIntent(userId, snapshot(), store, recovered as typeof request);
    expect(nativeSaveIntents(userId, projectId, store)).toHaveLength(1);
  });
  it('archives a terminal rejection and permits the next intent', async () => {
    const store = storage();
    const id = enqueueNativeSave(userId, snapshot(), [command], undefined, undefined, store);
    const api = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(404, 'missing'))
      .mockResolvedValueOnce(ack(id, 'rejected'));
    expect(await flushNativeSaveIntent(userId, snapshot(), store, api as typeof request)).toEqual({
      operationId: id,
      accepted: false,
    });
    expect(await loadNativePending(userId, projectId, store)).toBeNull();
    expect(nativeSaveIntents(userId, projectId, store)).toEqual([]);
    expect(
      nativeRejectedSaveIntents(userId, projectId, store)[0]?.pending.request.commands,
    ).toEqual([command]);
  });
  it('fences validation failures before releasing the slot and keeps rejected commands', async () => {
    const store = storage();
    const id = enqueueNativeSave(userId, snapshot(), [command], undefined, undefined, store);
    const api = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(404, 'missing'))
      .mockRejectedValueOnce(new ApiError(400, 'invalid'))
      .mockResolvedValueOnce({
        outcome: 'cancelled',
        result: {
          ...ack(id, 'rejected'),
          changedPaths: [],
          reason: 'operation.cancelled',
          reasonCode: 'operation.cancelled',
        },
      });
    expect(await flushNativeSaveIntent(userId, snapshot(), store, api as typeof request)).toEqual({
      operationId: id,
      accepted: false,
    });
    expect(api.mock.calls[2]?.[0]).toContain('/native-sync/cancel');
    expect(await loadNativePending(userId, projectId, store)).toBeNull();
    expect(nativeRejectedSaveIntents(userId, projectId, store)).toHaveLength(1);
  });
  it('fences an already-current no-op and completes without a rejected archive', async () => {
    const store = storage();
    const id = enqueueNativeSave(userId, snapshot(), [command], undefined, undefined, store);
    const api = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(404, 'missing'))
      .mockRejectedValueOnce(new ApiError(400, 'already current', 'sync.no-changes'))
      .mockResolvedValueOnce({
        outcome: 'cancelled',
        result: {
          ...ack(id, 'rejected'),
          changedPaths: [],
          reason: 'operation.cancelled',
          reasonCode: 'operation.cancelled',
        },
      });
    expect(await flushNativeSaveIntent(userId, snapshot(), store, api as typeof request)).toEqual({
      operationId: id,
      accepted: true,
    });
    expect(await loadNativePending(userId, projectId, store)).toBeNull();
    expect(nativeRejectedSaveIntents(userId, projectId, store)).toHaveLength(0);
  });
  it('deduplicates repeated clicks for the same immutable input', () => {
    const store = storage();
    const first = enqueueNativeSave(userId, snapshot(), [command], undefined, undefined, store);
    expect(enqueueNativeSave(userId, snapshot(), [command], undefined, undefined, store)).toBe(
      first,
    );
    expect(nativeSaveIntents(userId, projectId, store)).toHaveLength(1);
  });
  it('preserves the final A in an A to B to A sequence', () => {
    const store = storage();
    const a = enqueueNativeSave(userId, snapshot(), [command], undefined, undefined, store);
    enqueueNativeSave(
      userId,
      snapshot(),
      [{ ...command, patch: { logical: { name: 'B' } } }],
      undefined,
      undefined,
      store,
    );
    const last = enqueueNativeSave(userId, snapshot(), [command], undefined, undefined, store);
    expect(last).not.toBe(a);
    expect(nativeSaveIntents(userId, projectId, store)).toHaveLength(3);
  });
  it('bounds unsent records without dropping existing input', () => {
    const store = storage();
    for (let i = 0; i < 128; i++)
      enqueueNativeSave(
        userId,
        snapshot(),
        [{ ...command, patch: { logical: { name: String(i) } } }],
        undefined,
        undefined,
        store,
      );
    expect(() =>
      enqueueNativeSave(userId, snapshot(), [command], undefined, undefined, store),
    ).toThrow('native.pending-exists');
    expect(nativeSaveIntents(userId, projectId, store)).toHaveLength(128);
  });
});
