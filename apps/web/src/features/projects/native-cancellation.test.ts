import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { getNativeDurableQueue, type NativeDurablePending } from './native-durable-queue.js';
import { cancelNativeDurableEntry } from './native-cancellation.js';
import { stageNativeSave, loadNativePending } from './native-save.js';
import {
  transferActor,
  transferProject,
  transferState,
  transferTime,
} from './native-transfer-test-fixtures.js';
import { ApiError, request } from '../../shared/api/client.js';
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
beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(async () => {
  await getNativeDurableQueue().close();
  vi.unstubAllGlobals();
});
async function staged() {
  const store = storage(),
    state = transferState();
  const pending = await stageNativeSave(
    transferActor,
    state,
    [{ type: 'patch_table', id: 't', patch: { logical: { name: 'Changed' } } }],
    store,
  );
  return {
    store,
    state,
    pending,
    entry: {
      userId: transferActor,
      projectId: transferProject,
      operationId: pending.request.operationId,
      kind: 'commands',
      payload: pending,
    } satisfies NativeDurablePending,
  };
}
function output(data: Awaited<ReturnType<typeof staged>>, accepted = false) {
  return {
    outcome: accepted ? 'recorded' : 'cancelled',
    result: {
      protocolVersion: 2,
      operationId: data.entry.operationId,
      groupId: data.pending.request.groupId,
      sequence: data.state.sequence + (accepted ? 1 : 0),
      status: accepted ? 'accepted' : 'rejected',
      ...(!accepted && { reason: 'operation.cancelled', reasonCode: 'operation.cancelled' }),
      database: {
        kind: data.state.project.databaseKind,
        profileId: data.state.project.databaseProfileId,
      },
      databaseRevision: data.state.project.databaseRevision,
      actor: { id: transferActor, username: 'Owner', color: '#000000' },
      changedPaths: accepted ? ['/tables/t/logical/name'] : [],
      createdAt: transferTime,
      nextBaseline: {
        baselineId: crypto.randomUUID(),
        baseSequence: data.state.sequence + (accepted ? 1 : 0),
        baselineIssuedAt: transferTime,
        databaseRevision: data.state.project.databaseRevision,
      },
      ...(accepted && { document: data.state.sourceDocument }),
    },
  };
}
describe('durable native cancellation uses authoritative outcomes', () => {
  it('sends the original body under a single lease and removes only the confirmed pending', async () => {
    const data = await staged(),
      cleanup = vi.fn(),
      api = vi.fn(async () => output(data));
    const result = await cancelNativeDurableEntry(data.entry, {
      api: api as unknown as typeof request,
      cleanup,
    });
    expect(result.status).toBe('rejected');
    expect(cleanup).toHaveBeenCalledOnce();
    expect(
      JSON.parse((api.mock.calls[0] as unknown as [string, RequestInit])[1].body as string),
    ).toEqual({ kind: 'native-command', request: data.pending.request });
    expect(await loadNativePending(transferActor, transferProject, data.store)).toBeNull();
  });
  it('returns an already accepted ACK and preserves unexpected actor or operation responses', async () => {
    const data = await staged(),
      wrong = output(data);
    wrong.result.actor.id = transferProject;
    await expect(
      cancelNativeDurableEntry(data.entry, {
        api: vi.fn(async () => wrong) as unknown as typeof request,
      }),
    ).rejects.toThrow('ack-invalid');
    expect(await loadNativePending(transferActor, transferProject, data.store)).toEqual(
      data.pending,
    );
    expect(
      (
        await cancelNativeDurableEntry(data.entry, {
          api: vi.fn(async () => output(data, true)) as unknown as typeof request,
        })
      ).status,
    ).toBe('accepted');
  });
  it('never treats a transport error or lookup 404 as proof of cancellation', async () => {
    const data = await staged();
    await expect(
      cancelNativeDurableEntry(data.entry, {
        api: vi.fn(async () => {
          throw new ApiError(404, 'missing');
        }) as typeof request,
      }),
    ).rejects.toThrow('missing');
    expect(await loadNativePending(transferActor, transferProject, data.store)).toEqual(
      data.pending,
    );
    await expect(getNativeDurableQueue().discard(data.entry)).rejects.toThrow(
      'transmission-unknown',
    );
  });
  it('does not erase a pending replaced by another actor/project identity', async () => {
    const data = await staged(),
      bad = { ...data.entry, operationId: crypto.randomUUID() };
    const api = vi.fn();
    await expect(cancelNativeDurableEntry(bad, { api: api as typeof request })).rejects.toThrow(
      'pending-invalid',
    );
    expect(api).not.toHaveBeenCalled();
  });
});
