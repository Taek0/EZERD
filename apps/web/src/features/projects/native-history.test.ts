import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { getNativeDurableQueue } from './native-durable-queue.js';
import { createEmptyNativeDocument, defaultDatabaseContext } from '@ezerd/model';
import type { ProjectDocumentState } from '@ezerd/contracts';
import { ApiError, request } from '../../shared/api/client.js';
import {
  loadNativeHistoryPending,
  sendNativeHistory,
  stageNativeHistory,
} from './native-history.js';
import { stageNativeSave } from './native-save.js';
import { assertNativeExportReady } from './project-ddl-export.js';
const userId = '00000000-0000-4000-8000-000000000001',
  projectId = '00000000-0000-4000-8000-000000000002',
  source = '00000000-0000-4000-8000-000000000003';
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(async () => {
  await getNativeDurableQueue().close();
  vi.unstubAllGlobals();
});
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
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
}
function fixture(): ProjectDocumentState {
  const document = createEmptyNativeDocument(defaultDatabaseContext('postgresql'));
  return {
    protocolVersion: 2,
    project: {
      id: projectId,
      workspaceId: source,
      name: 'History',
      status: 'active',
      version: 1,
      databaseKind: 'postgresql',
      databaseProfileId: document.database.profileId,
      databaseRevision: 0,
      createdAt: '2026-10-02T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
    },
    sequence: 1,
    sourceDocument: document,
    native: { status: 'available', document, migrationIssues: [], issues: [] },
  };
}
function baseline(snapshot = fixture()) {
  return {
    protocolVersion: 2,
    projectVersion: snapshot.project.version,
    sequence: snapshot.sequence,
    baselineId: source,
    baselineIssuedAt: '2026-10-02T00:00:00Z',
    database:
      snapshot.sourceDocument.schemaVersion === 2
        ? snapshot.sourceDocument.database
        : defaultDatabaseContext('postgresql'),
    databaseRevision: 0,
    document: snapshot.sourceDocument,
  };
}
function result(input: Awaited<ReturnType<typeof stageNativeHistory>>) {
  return {
    command: input.command,
    sourceOperationId: input.sourceOperationId,
    identityMap: [],
    result: {
      protocolVersion: 2,
      operationId: input.request.operationId,
      groupId: input.request.groupId,
      sequence: 2,
      status: 'accepted',
      reasonCode: 'history.undo',
      database: input.request.database,
      databaseRevision: 0,
      actor: { id: userId, username: 'Owner', color: '#000000' },
      changedPaths: ['/notes/n'],
      createdAt: '2026-10-02T00:00:00Z',
      document: fixture().sourceDocument,
      nextBaseline: {
        baselineId: source,
        baselineIssuedAt: '2026-10-02T00:00:00Z',
        baseSequence: 2,
        databaseRevision: 0,
      },
    },
  };
}
describe('native history request durability and authority', () => {
  it('preserves terminal HTTP errors without a recorded server outcome', async () => {
    const store = storage(),
      pending = await stageNativeHistory(
        userId,
        fixture(),
        source,
        'undo',
        store,
        vi.fn(async () => baseline()) as unknown as typeof request,
      );
    const rejected = vi.fn(async (_url: string, init?: RequestInit) => {
      throw new ApiError(init?.method === 'POST' ? 409 : 404, 'rejected');
    });
    await expect(sendNativeHistory(pending, store, rejected as typeof request)).rejects.toThrow(
      'rejected',
    );
    expect(await loadNativeHistoryPending(userId, projectId, store)).toEqual(pending);
  });
  it('preserves rejected requests when read access cannot confirm the ledger', async () => {
    const store = storage(),
      pending = await stageNativeHistory(
        userId,
        fixture(),
        source,
        'undo',
        store,
        vi.fn(async () => baseline()) as unknown as typeof request,
      );
    await expect(
      sendNativeHistory(
        pending,
        store,
        vi.fn(async () => {
          throw new ApiError(403, 'forbidden');
        }) as typeof request,
      ),
    ).rejects.toThrow('forbidden');
    expect(await loadNativeHistoryPending(userId, projectId, store)).toEqual(pending);
  });
  it('stages before sending, blocks other saves/exports and clears only matching accepted ACK', async () => {
    const store = storage(),
      api = vi.fn(async () => baseline()) as unknown as typeof request;
    const pending = await stageNativeHistory(userId, fixture(), source, 'undo', store, api);
    expect(await loadNativeHistoryPending(userId, projectId, store)).toEqual(pending);
    await expect(assertNativeExportReady(userId, projectId, store)).rejects.toThrow('pending');
    await expect(
      stageNativeSave(
        userId,
        fixture(),
        [{ type: 'patch_table', id: 't', patch: { logical: { name: 'Input' } } }],
        store,
      ),
    ).rejects.toThrow('pending-exists');
    await sendNativeHistory(
      pending,
      store,
      vi.fn(async () => result(pending)) as unknown as typeof request,
    );
    expect(await loadNativeHistoryPending(userId, projectId, store)).toBeNull();
  });
  it('keeps the exact request after response loss and replays it without a new baseline', async () => {
    const store = storage(),
      pending = await stageNativeHistory(
        userId,
        fixture(),
        source,
        'undo',
        store,
        vi.fn(async () => baseline()) as unknown as typeof request,
      );
    await expect(
      sendNativeHistory(
        pending,
        store,
        vi.fn(async () => {
          throw Error('lost');
        }) as typeof request,
      ),
    ).rejects.toThrow('lost');
    const replay = vi.fn(async (_url: string, _init?: RequestInit) => result(pending));
    await sendNativeHistory(
      (await loadNativeHistoryPending(userId, projectId, store))!,
      store,
      replay as unknown as typeof request,
    );
    expect(JSON.parse(replay.mock.calls[0]![1]!.body as string)).toEqual(pending.request);
  });
  it('retains pending on mismatched actor/command ACK', async () => {
    const store = storage(),
      pending = await stageNativeHistory(
        userId,
        fixture(),
        source,
        'undo',
        store,
        vi.fn(async () => baseline()) as unknown as typeof request,
      );
    const wrong = result(pending);
    wrong.result.actor.id = source;
    await expect(
      sendNativeHistory(pending, store, vi.fn(async () => wrong) as unknown as typeof request),
    ).rejects.toThrow('ack-invalid');
    expect(await loadNativeHistoryPending(userId, projectId, store)).toEqual(pending);
  });
  it('does not send a command after local storage or concurrent draft failure', async () => {
    const store = storage();
    store.getItem = () => {
      throw Error('quota');
    };
    await expect(
      stageNativeHistory(
        userId,
        fixture(),
        source,
        'undo',
        store,
        vi.fn(async () => baseline()) as unknown as typeof request,
      ),
    ).rejects.toThrow('quota');
    const changed = baseline();
    changed.databaseRevision = 1;
    await expect(
      stageNativeHistory(
        userId,
        fixture(),
        source,
        'undo',
        storage(),
        vi.fn(async () => changed) as unknown as typeof request,
      ),
    ).rejects.toThrow('context-changed');
  });
  it('detects another pending save created while baseline request is in flight', async () => {
    const store = storage();
    await expect(
      stageNativeHistory(
        userId,
        fixture(),
        source,
        'undo',
        store,
        vi.fn(async () => {
          await stageNativeSave(
            userId,
            fixture(),
            [{ type: 'delete_objects', targets: [{ collection: 'tables', id: 'n' }] }],
            store,
          );
          return baseline();
        }) as unknown as typeof request,
      ),
    ).rejects.toThrow('pending');
    expect(await loadNativeHistoryPending(userId, projectId, store)).toBeNull();
  });
});
