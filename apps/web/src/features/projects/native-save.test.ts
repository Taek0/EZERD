import { nativeTestDeferred } from './native-durable-test-environment.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyNativeDocument, defaultDatabaseContext } from '@ezerd/model';
import type { ProjectDocumentState } from '@ezerd/contracts';
import { ApiError, request } from '../../shared/api/client.js';
import {
  storeNativeEditorDraft,
  loadNativeEditorDraft,
  type NativeEditorDraft,
} from './native-editor-draft.js';
import {
  discardNativeDraft,
  discardNativePending,
  loadNativeDraft,
  loadNativePending,
  recoverNativePending,
  sendNativePending,
  stageNativeSave,
  storeNativeDraft,
  rebaseNativeDraft,
  type NativePropertyDraft,
} from './native-save.js';
import { createNativeTestIndexedDB } from './native-durable-test-environment.js';
import { getNativeDurableQueue, NativeDurableQueue } from './native-durable-queue.js';
beforeEach(() => {
  vi.stubGlobal('indexedDB', createNativeTestIndexedDB());
});
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
describe('native pending save and property draft durability', () => {
  it('default transport refuses a different session actor before any API mutation', async () => {
    const store = storage(),
      pending = await stageNativeSave(userId, snapshot(), [command], store),
      fetcher = vi.fn();
    vi.stubGlobal('sessionStorage', {
      getItem: () =>
        JSON.stringify({ userId: other, token: 'test-token-b', expiresAt: '2099-01-01T00:00:00Z' }),
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(sendNativePending(pending, store)).rejects.toThrow('native.actor-mismatch');
    await expect(recoverNativePending(pending, snapshot(), store)).rejects.toThrow(
      'native.actor-mismatch',
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(await loadNativePending(userId, projectId, store)).toEqual(pending);
  });
  it('default transport uses captured actor authorization without persisting it in the pending request', async () => {
    const store = storage(),
      pending = await stageNativeSave(userId, snapshot(), [command], store);
    vi.stubGlobal('sessionStorage', {
      getItem: () =>
        JSON.stringify({ userId, token: 'test-token-a', expiresAt: '2099-01-01T00:00:00Z' }),
    });
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-token-a');
      expect(JSON.parse(init!.body as string)).toEqual(pending.request);
      return new Response(JSON.stringify(ack(pending.request.operationId)));
    });
    vi.stubGlobal('fetch', fetcher);
    expect(
      JSON.stringify((await getNativeDurableQueue().read(userId, projectId))!.payload),
    ).not.toContain('test-token-a');
    await sendNativePending(pending, store);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await loadNativePending(userId, projectId, store)).toBeNull();
  });
  it('does not replay under a new account after an old-actor missing-ledger response', async () => {
    const store = storage(),
      pending = await stageNativeSave(userId, snapshot(), [command], store);
    let raw = JSON.stringify({ userId, token: 'test-token-a', expiresAt: '2099-01-01T00:00:00Z' });
    vi.stubGlobal('sessionStorage', { getItem: () => raw });
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).not.toBe('POST');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-token-a');
      raw = JSON.stringify({
        userId: other,
        token: 'test-token-b',
        expiresAt: '2099-01-01T00:00:00Z',
      });
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(recoverNativePending(pending, snapshot(), store)).rejects.toThrow(
      'native.actor-mismatch',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await loadNativePending(userId, projectId, store)).toEqual(pending);
  });
  it('captures actor auth before IDB await and refuses POST after an account switch', async () => {
    const store = storage(),
      pending = await stageNativeSave(userId, snapshot(), [command], store),
      queue = getNativeDurableQueue(),
      fetcher = vi.fn();
    let raw = JSON.stringify({ userId, token: 'test-token-a', expiresAt: '2099-01-01T00:00:00Z' });
    vi.stubGlobal('sessionStorage', { getItem: () => raw });
    vi.stubGlobal('fetch', fetcher);
    const original = queue.read.bind(queue);
    vi.spyOn(queue, 'read').mockImplementation(async (actor, project) => {
      const value = await original(actor, project);
      raw = JSON.stringify({
        userId: other,
        token: 'test-token-b',
        expiresAt: '2099-01-01T00:00:00Z',
      });
      return value;
    });
    await expect(sendNativePending(pending, store)).rejects.toThrow('native.actor-mismatch');
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify((await original(userId, projectId))!.payload)).not.toContain(
      'test-token',
    );
  });
  it('keeps the staged API request immutable and allows only one real transport callback', async () => {
    const store = storage(),
      pending = await stageNativeSave(userId, snapshot(), [command], store);
    const started = nativeTestDeferred<void>(),
      result = nativeTestDeferred<ReturnType<typeof ack>>();
    const api = vi.fn(async (_url: string, _init?: RequestInit) => {
      expect(await loadNativePending(userId, projectId, store)).toEqual(pending);
      started.resolve();
      return result.promise;
    });
    const first = sendNativePending(pending, store, api as typeof request);
    await started.promise;
    await expect(sendNativePending(pending, store, api as typeof request)).rejects.toThrow(
      'native.transmission-busy',
    );
    await expect(
      discardNativePending(userId, projectId, pending.request.operationId, store),
    ).rejects.toThrow('native.transmission-busy');
    expect(api).toHaveBeenCalledTimes(1);
    expect(JSON.parse(api.mock.calls[0]![1]!.body as string)).toEqual(pending.request);
    result.resolve(ack(pending.request.operationId));
    await first;
    expect(await loadNativePending(userId, projectId, store)).toBeNull();
  });
  it('imports the complete legacy pending without generating new replay identifiers', async () => {
    const store = storage(),
      pending = await stageNativeSave(userId, snapshot(), [command], store),
      queue = getNativeDurableQueue();
    await queue.discard({
      userId,
      projectId,
      operationId: pending.request.operationId,
      kind: 'commands',
      payload: pending,
    });
    store.setItem(`ezerd.native.pending:${userId}:${projectId}`, JSON.stringify(pending));
    expect(await loadNativePending(userId, projectId, store)).toEqual(pending);
    const api = vi.fn().mockResolvedValue(ack(pending.request.operationId));
    await sendNativePending(pending, store, api as typeof request);
    expect(JSON.parse(api.mock.calls[0]![1].body)).toEqual(pending.request);
    expect(store.getItem(`ezerd.native.pending:${userId}:${projectId}`)).toBeNull();
  });
  it('recovers a crashed foreign lease with exactly the stored API operation and preserves unknown from discard', async () => {
    const store = storage(),
      pending = await stageNativeSave(userId, snapshot(), [command], store);
    const entry = {
      userId,
      projectId,
      operationId: pending.request.operationId,
      kind: 'commands' as const,
      payload: pending,
    };
    const crashed = new NativeDurableQueue(indexedDB);
    await crashed.beginTransmission(entry);
    await crashed.close();
    const clock = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(clock + 31000);
    await expect(
      discardNativePending(userId, projectId, pending.request.operationId, store),
    ).rejects.toThrow('native.transmission-unknown');
    const api = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(404, 'Missing'))
      .mockResolvedValueOnce(ack(pending.request.operationId));
    await recoverNativePending(pending, snapshot(), store, api as typeof request);
    expect(JSON.parse(api.mock.calls[1]![1].body)).toEqual(pending.request);
    expect(await loadNativePending(userId, projectId, store)).toBeNull();
  });
  it.each(['history', 'canvas.personal'])(
    'retains the legacy %s guard before command stage',
    async (kind) => {
      const store = storage();
      store.setItem(
        `ezerd.native.${kind}:${JSON.stringify([userId, projectId])}`,
        'pending evidence',
      );
      await expect(stageNativeSave(userId, snapshot(), [command], store)).rejects.toThrow(
        'native.pending-exists',
      );
    },
  );
  it('blocks command stage while a history or private-canvas transactional claim exists', async () => {
    const store = storage(),
      queue = getNativeDurableQueue();
    await queue.claim({
      userId,
      projectId,
      operationId: other,
      kind: 'history',
      payload: { command: 'undo' },
    });
    await expect(stageNativeSave(userId, snapshot(), [command], store)).rejects.toThrow(
      'native.pending-exists',
    );
  });
  it('keeps failed basic property input across reopen and blocks new writes until persistence recovers', async () => {
    const target = storage();
    let failing = true;
    const store = {
      ...target,
      setItem: (key: string, value: string) => {
        if (failing) throw Error('Quota');
        target.setItem(key, value);
      },
    };
    const before = { physicalName: 'id', comment: '', logicalName: 'ID', definition: '' };
    const draft: NativePropertyDraft = {
      userId,
      projectId,
      kind: 'column',
      objectId: 'c',
      expected: { version: 7, sequence: 10, databaseRevision: 3 },
      before,
      values: { ...before, comment: 'unsaved typed input' },
    };
    expect(() => storeNativeDraft(draft, store)).toThrow('Quota');
    expect(loadNativeDraft(userId, projectId, 'column', 'c', store)).toEqual(draft);
    await expect(stageNativeSave(userId, snapshot(), [command], store)).rejects.toThrow(
      'native.draft-storage-failed',
    );
    failing = false;
    storeNativeDraft(draft, store);
    const pending = await stageNativeSave(userId, snapshot(), [command], store);
    expect(pending.request.commands).toEqual([command]);
  });
  it('clears acknowledged drafts before reload while retaining newer input from another tab', async () => {
    const store = storage();
    const before = { physicalName: 'id', comment: '', logicalName: 'ID', definition: '' };
    const draft: NativePropertyDraft = {
      userId,
      projectId,
      objectId: 'c',
      kind: 'column',
      expected: { version: 7, sequence: 10, databaseRevision: 3 },
      before,
      values: { ...before, comment: 'Input preserved' },
    };
    storeNativeDraft(draft, store);
    const pending = await stageNativeSave(userId, snapshot(), [command], store);
    const api = vi.fn().mockResolvedValue(ack(pending.request.operationId));
    await recoverNativePending(pending, snapshot(), store, api as typeof request);
    expect(loadNativeDraft(userId, projectId, 'column', 'c', store)).toBeNull();
    storeNativeDraft({ ...draft, values: { ...draft.values, definition: 'Newer input' } }, store);
    const next = await stageNativeSave(userId, snapshot(), [command], store);
    await sendNativePending(
      next,
      store,
      vi.fn().mockResolvedValue(ack(next.request.operationId)) as typeof request,
    );
    expect(loadNativeDraft(userId, projectId, 'column', 'c', store)?.values.definition).toBe(
      'Newer input',
    );
  });
  it('persists the complete immutable command before sending and isolates users/projects', async () => {
    const store = storage(),
      pending = await stageNativeSave(userId, snapshot(), [command], store);
    expect(await loadNativePending(userId, projectId, store)).toEqual(pending);
    expect(await loadNativePending(other, projectId, store)).toBeNull();
    expect(pending.request).toMatchObject({
      expectedVersion: 7,
      expectedSequence: 10,
      expectedDatabaseRevision: 3,
      commands: [command],
    });
    await expect(stageNativeSave(userId, snapshot(), [command], store)).rejects.toThrow(
      'native.pending-exists',
    );
    await discardNativePending(userId, projectId, other, store);
    expect(await loadNativePending(userId, projectId, store)).toEqual(pending);
  });
  it('keeps an unknown/rejected result for explicit recovery and clears only a matching accepted ACK', async () => {
    const store = storage(),
      pending = await stageNativeSave(userId, snapshot(), [command], store);
    const failed = vi.fn().mockRejectedValue(new Error('Network unavailable'));
    await expect(sendNativePending(pending, store, failed as typeof request)).rejects.toThrow();
    expect(await loadNativePending(userId, projectId, store)).toEqual(pending);
    const rejected = vi.fn().mockResolvedValue(ack(pending.request.operationId, 'rejected'));
    expect((await sendNativePending(pending, store, rejected as typeof request)).status).toBe(
      'rejected',
    );
    expect(await loadNativePending(userId, projectId, store)).toEqual(pending);
    const wrongActor = vi.fn().mockResolvedValue({
      ...ack(pending.request.operationId),
      actor: { id: other, username: 'other', color: '#123456' },
    });
    await expect(sendNativePending(pending, store, wrongActor as typeof request)).rejects.toThrow(
      'native.ack-mismatch',
    );
    expect(await loadNativePending(userId, projectId, store)).toEqual(pending);
    const accepted = vi.fn().mockResolvedValue(ack(pending.request.operationId));
    await sendNativePending(pending, store, accepted as typeof request);
    expect(await loadNativePending(userId, projectId, store)).toBeNull();
  });
  it('looks up an old accepted result across revisions before attempting any replay', async () => {
    const store = storage(),
      pending = await stageNativeSave(userId, snapshot(), [command], store);
    const newer = snapshot();
    newer.project.databaseRevision = 4;
    const api = vi.fn().mockResolvedValue(ack(pending.request.operationId));
    await recoverNativePending(pending, newer, store, api as typeof request);
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0]![0]).toContain(`/operations/${pending.request.operationId}`);
    expect(await loadNativePending(userId, projectId, store)).toBeNull();
  });
  it('replays the same operation only after a missing result and blocks a new context', async () => {
    const store = storage(),
      pending = await stageNativeSave(userId, snapshot(), [command], store);
    const changed = snapshot();
    changed.project.databaseRevision = 4;
    const absent = vi.fn().mockRejectedValue(new ApiError(404, 'Missing'));
    await expect(
      recoverNativePending(pending, changed, store, absent as typeof request),
    ).rejects.toThrow('database.context-changed');
    expect(absent).toHaveBeenCalledTimes(1);
    const api = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(404, 'Missing'))
      .mockResolvedValueOnce(ack(pending.request.operationId));
    await recoverNativePending(pending, snapshot(), store, api as typeof request);
    expect(JSON.parse(api.mock.calls[1]![1].body)).toEqual(pending.request);
  });
  it('retains typing drafts and their original epoch across reopen without removing newer edits', async () => {
    const store = storage();
    const draft: NativePropertyDraft = {
      userId,
      projectId,
      kind: 'column',
      objectId: 'c',
      expected: { version: 7, sequence: 10, databaseRevision: 3 },
      values: {
        physicalName: 'id',
        comment: 'Typing before save',
        logicalName: 'ID',
        definition: '',
      },
      before: { physicalName: 'id', comment: '', logicalName: 'ID', definition: '' },
    };
    storeNativeDraft(draft, store);
    expect(loadNativeDraft(userId, projectId, 'column', 'c', store)).toEqual(draft);
    expect(loadNativeDraft(other, projectId, 'column', 'c', store)).toBeNull();
    const newer = { ...draft, values: { ...draft.values, comment: 'Newer tab edit' } };
    storeNativeDraft(newer, store);
    discardNativeDraft(userId, projectId, 'column', 'c', store, draft);
    expect(loadNativeDraft(userId, projectId, 'column', 'c', store)).toEqual(newer);
    const current = snapshot();
    current.project.version = 8;
    const pending = await stageNativeSave(userId, current, [command], store, draft.expected);
    expect(pending.request.expectedVersion).toBe(7);
  });
  it('never starts a request if durability fails or the source requires upgrade', async () => {
    const quota = {
      ...storage(),
      getItem() {
        throw new Error('Quota');
      },
    };
    await expect(stageNativeSave(userId, snapshot(), [command], quota)).rejects.toThrow('Quota');
    const legacy = snapshot();
    legacy.sourceDocument = {
      schemaVersion: 1,
      domains: [],
      domainRelations: [],
      notes: [],
      layout: { nodes: [], viewports: [] },
    };
    await expect(stageNativeSave(userId, legacy, [command], storage())).rejects.toThrow(
      'document.native-upgrade-required',
    );
  });
  it("reviews stale drafts explicitly while keeping another user's untouched newer fields", async () => {
    const draft: NativePropertyDraft = {
      userId,
      projectId,
      objectId: 'c',
      kind: 'column',
      expected: { version: 7, sequence: 10, databaseRevision: 3 },
      before: { physicalName: 'old', comment: '', logicalName: 'Old', definition: '' },
      values: { physicalName: 'old', comment: 'My edit', logicalName: 'Old', definition: '' },
    };
    const result = rebaseNativeDraft(
      draft,
      { version: 8, sequence: 11, databaseRevision: 3 },
      {
        physicalName: 'renamed by another user',
        comment: 'Concurrent comment',
        logicalName: 'Old',
        definition: 'Concurrent definition',
      },
    );
    expect(result.values).toEqual({
      physicalName: 'renamed by another user',
      comment: 'My edit',
      logicalName: 'Old',
      definition: 'Concurrent definition',
    });
    expect(draft.expected.version).toBe(7);
    expect(result.expected.version).toBe(8);
  });
  it('can confirm an ACK in readonly mode but never replays a missing operation', async () => {
    const store = storage(),
      pending = await stageNativeSave(userId, snapshot(), [command], store);
    const api = vi.fn().mockRejectedValue(new ApiError(404, 'Missing'));
    await expect(
      recoverNativePending(pending, snapshot(), store, api as typeof request, false),
    ).rejects.toThrow('project.read-only');
    expect(api).toHaveBeenCalledTimes(1);
    const accepted = vi.fn().mockResolvedValue(ack(pending.request.operationId));
    await recoverNativePending(pending, snapshot(), store, accepted as typeof request, false);
    expect(await loadNativePending(userId, projectId, store)).toBeNull();
  });
  it('persists expanded commands and consumes an editor draft only on its accepted ACK', async () => {
    const store = storage();
    const draft: NativeEditorDraft = {
      userId,
      projectId,
      key: 'constraint:checks:q',
      revision: other,
      expected: { version: 7, sequence: 10, databaseRevision: 3 },
      before: { name: 'old' },
      values: { name: 'new' },
    };
    storeNativeEditorDraft(draft, store);
    const commands = [{ type: 'patch_check' as const, id: 'q', patch: { name: 'new' } }];
    const pending = await stageNativeSave(
      userId,
      snapshot(),
      commands,
      store,
      draft.expected,
      draft,
    );
    expect((await loadNativePending(userId, projectId, store))?.request.commands).toEqual(commands);
    await sendNativePending(
      pending,
      store,
      vi.fn().mockResolvedValue(ack(pending.request.operationId, 'rejected')) as typeof request,
    );
    expect(loadNativeEditorDraft(userId, projectId, draft.key, store)).toEqual(draft);
    await recoverNativePending(
      pending,
      snapshot(),
      store,
      vi.fn().mockResolvedValue(ack(pending.request.operationId)) as typeof request,
    );
    expect(loadNativeEditorDraft(userId, projectId, draft.key, store)).toBeNull();
    expect(await loadNativePending(userId, projectId, store)).toBeNull();
  });
  it('keeps newer format input and an independent basic property draft after an older ACK', async () => {
    const store = storage();
    const draft: NativeEditorDraft = {
      userId,
      projectId,
      key: 'format:column:c',
      revision: other,
      expected: { version: 7, sequence: 10, databaseRevision: 3 },
      before: { nullable: 'false' },
      values: { nullable: 'true' },
    };
    storeNativeEditorDraft(draft, store);
    const before = { physicalName: 'old', comment: '', logicalName: 'Old', definition: '' };
    const property: NativePropertyDraft = {
      userId,
      projectId,
      kind: 'column',
      objectId: 'c',
      expected: draft.expected,
      before,
      values: { ...before, comment: 'unsaved property' },
    };
    storeNativeDraft(property, store);
    const pending = await stageNativeSave(
      userId,
      snapshot(),
      [{ type: 'patch_column', id: 'c', patch: { physical: { nullable: true } } }],
      store,
      draft.expected,
      draft,
    );
    const newer = {
      ...draft,
      revision: crypto.randomUUID(),
      values: { nullable: 'newer input' },
    };
    storeNativeEditorDraft(newer, store);
    await sendNativePending(
      pending,
      store,
      vi.fn().mockResolvedValue(ack(pending.request.operationId)) as typeof request,
    );
    expect(loadNativeEditorDraft(userId, projectId, draft.key, store)).toEqual(newer);
    expect(loadNativeDraft(userId, projectId, 'column', 'c', store)).toEqual(property);
  });
  it('refuses changed draft references and readonly staging before a request can be sent', async () => {
    const store = storage();
    const draft: NativeEditorDraft = {
      userId,
      projectId,
      key: 'create:table:project',
      revision: other,
      expected: { version: 7, sequence: 10, databaseRevision: 3 },
      before: {},
      values: {},
    };
    storeNativeEditorDraft(draft, store);
    await expect(
      stageNativeSave(userId, snapshot(), [command], store, draft.expected, {
        key: draft.key,
        revision: userId,
      }),
    ).rejects.toThrow('native.draft-changed');
    const readonly = snapshot();
    readonly.project.status = 'archived';
    await expect(stageNativeSave(userId, readonly, [command], store)).rejects.toThrow(
      'project.read-only',
    );
    expect(await loadNativePending(userId, projectId, store)).toBeNull();
  });
  it.each(['group', 'revision', 'sequence'])(
    'retains pending and input when an accepted ACK has the wrong %s',
    async (field) => {
      const store = storage(),
        pending = await stageNativeSave(userId, snapshot(), [command], store);
      const invalid = ack(pending.request.operationId);
      if (field === 'group') invalid.groupId = other;
      if (field === 'revision') {
        invalid.databaseRevision = 4;
        invalid.nextBaseline.databaseRevision = 4;
      }
      if (field === 'sequence') invalid.sequence = 10;
      await expect(
        sendNativePending(pending, store, vi.fn().mockResolvedValue(invalid) as typeof request),
      ).rejects.toThrow('native.ack-mismatch');
      expect(await loadNativePending(userId, projectId, store)).toEqual(pending);
    },
  );
});
