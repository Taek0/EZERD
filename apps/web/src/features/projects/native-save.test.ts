import { describe, expect, it, vi } from 'vitest';
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
    const pending = stageNativeSave(userId, snapshot(), [command], store);
    const api = vi.fn().mockResolvedValue(ack(pending.request.operationId));
    await recoverNativePending(pending, snapshot(), store, api as typeof request);
    expect(loadNativeDraft(userId, projectId, 'column', 'c', store)).toBeNull();
    storeNativeDraft({ ...draft, values: { ...draft.values, definition: 'Newer input' } }, store);
    const next = stageNativeSave(userId, snapshot(), [command], store);
    await sendNativePending(
      next,
      store,
      vi.fn().mockResolvedValue(ack(next.request.operationId)) as typeof request,
    );
    expect(loadNativeDraft(userId, projectId, 'column', 'c', store)?.values.definition).toBe(
      'Newer input',
    );
  });
  it('persists the complete immutable command before sending and isolates users/projects', () => {
    const store = storage(),
      pending = stageNativeSave(userId, snapshot(), [command], store);
    expect(loadNativePending(userId, projectId, store)).toEqual(pending);
    expect(loadNativePending(other, projectId, store)).toBeNull();
    expect(pending.request).toMatchObject({
      expectedVersion: 7,
      expectedSequence: 10,
      expectedDatabaseRevision: 3,
      commands: [command],
    });
    expect(() => stageNativeSave(userId, snapshot(), [command], store)).toThrow(
      'native.pending-exists',
    );
    discardNativePending(userId, projectId, other, store);
    expect(loadNativePending(userId, projectId, store)).toEqual(pending);
  });
  it('keeps an unknown/rejected result for explicit recovery and clears only a matching accepted ACK', async () => {
    const store = storage(),
      pending = stageNativeSave(userId, snapshot(), [command], store);
    const failed = vi.fn().mockRejectedValue(new Error('Network unavailable'));
    await expect(sendNativePending(pending, store, failed as typeof request)).rejects.toThrow();
    expect(loadNativePending(userId, projectId, store)).toEqual(pending);
    const rejected = vi.fn().mockResolvedValue(ack(pending.request.operationId, 'rejected'));
    expect((await sendNativePending(pending, store, rejected as typeof request)).status).toBe(
      'rejected',
    );
    expect(loadNativePending(userId, projectId, store)).toEqual(pending);
    const wrongActor = vi.fn().mockResolvedValue({
      ...ack(pending.request.operationId),
      actor: { id: other, username: 'other', color: '#123456' },
    });
    await expect(sendNativePending(pending, store, wrongActor as typeof request)).rejects.toThrow(
      'native.ack-mismatch',
    );
    expect(loadNativePending(userId, projectId, store)).toEqual(pending);
    const accepted = vi.fn().mockResolvedValue(ack(pending.request.operationId));
    await sendNativePending(pending, store, accepted as typeof request);
    expect(loadNativePending(userId, projectId, store)).toBeNull();
  });
  it('looks up an old accepted result across revisions before attempting any replay', async () => {
    const store = storage(),
      pending = stageNativeSave(userId, snapshot(), [command], store);
    const newer = snapshot();
    newer.project.databaseRevision = 4;
    const api = vi.fn().mockResolvedValue(ack(pending.request.operationId));
    await recoverNativePending(pending, newer, store, api as typeof request);
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0]![0]).toContain(`/operations/${pending.request.operationId}`);
    expect(loadNativePending(userId, projectId, store)).toBeNull();
  });
  it('replays the same operation only after a missing result and blocks a new context', async () => {
    const store = storage(),
      pending = stageNativeSave(userId, snapshot(), [command], store);
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
  it('retains typing drafts and their original epoch across reopen without removing newer edits', () => {
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
    const pending = stageNativeSave(userId, current, [command], store, draft.expected);
    expect(pending.request.expectedVersion).toBe(7);
  });
  it('never starts a request if durability fails or the source requires upgrade', () => {
    const quota = {
      ...storage(),
      setItem() {
        throw new Error('Quota');
      },
    };
    expect(() => stageNativeSave(userId, snapshot(), [command], quota)).toThrow('Quota');
    const legacy = snapshot();
    legacy.sourceDocument = {
      schemaVersion: 1,
      domains: [],
      domainRelations: [],
      notes: [],
      layout: { nodes: [], viewports: [] },
    };
    expect(() => stageNativeSave(userId, legacy, [command], storage())).toThrow(
      'document.native-upgrade-required',
    );
  });
  it("reviews stale drafts explicitly while keeping another user's untouched newer fields", () => {
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
      pending = stageNativeSave(userId, snapshot(), [command], store);
    const api = vi.fn().mockRejectedValue(new ApiError(404, 'Missing'));
    await expect(
      recoverNativePending(pending, snapshot(), store, api as typeof request, false),
    ).rejects.toThrow('project.read-only');
    expect(api).toHaveBeenCalledTimes(1);
    const accepted = vi.fn().mockResolvedValue(ack(pending.request.operationId));
    await recoverNativePending(pending, snapshot(), store, accepted as typeof request, false);
    expect(loadNativePending(userId, projectId, store)).toBeNull();
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
    const pending = stageNativeSave(userId, snapshot(), commands, store, draft.expected, draft);
    expect(loadNativePending(userId, projectId, store)?.request.commands).toEqual(commands);
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
    expect(loadNativePending(userId, projectId, store)).toBeNull();
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
    const pending = stageNativeSave(
      userId,
      snapshot(),
      [{ type: 'patch_column', id: 'c', patch: { physical: { nullable: true } } }],
      store,
      draft.expected,
      draft,
    );
    const newer = { ...draft, revision: crypto.randomUUID(), values: { nullable: 'newer input' } };
    storeNativeEditorDraft(newer, store);
    await sendNativePending(
      pending,
      store,
      vi.fn().mockResolvedValue(ack(pending.request.operationId)) as typeof request,
    );
    expect(loadNativeEditorDraft(userId, projectId, draft.key, store)).toEqual(newer);
    expect(loadNativeDraft(userId, projectId, 'column', 'c', store)).toEqual(property);
  });
  it('refuses changed draft references and readonly staging before a request can be sent', () => {
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
    expect(() =>
      stageNativeSave(userId, snapshot(), [command], store, draft.expected, {
        key: draft.key,
        revision: userId,
      }),
    ).toThrow('native.draft-changed');
    const readonly = snapshot();
    readonly.project.status = 'archived';
    expect(() => stageNativeSave(userId, readonly, [command], store)).toThrow('project.read-only');
    expect(loadNativePending(userId, projectId, store)).toBeNull();
  });
  it.each(['group', 'revision', 'sequence'])(
    'retains pending and input when an accepted ACK has the wrong %s',
    async (field) => {
      const store = storage(),
        pending = stageNativeSave(userId, snapshot(), [command], store);
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
      expect(loadNativePending(userId, projectId, store)).toEqual(pending);
    },
  );
});
