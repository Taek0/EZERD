import { describe, it, expect } from 'vitest';
import type { NativeEditorDraft } from '@ezerd/contracts';
import {
  NativeDraftArchive,
  nativeDraftArchive,
  nativeDraftWriterId,
  nativePropertyArchiveKey,
  preserveNativeDraftAckSources,
  consumeNativeDraftAckSources,
} from './native-draft-archive.js';
import {
  storeNativeEditorDraft,
  loadNativeEditorDraft,
  resetNativeEditorDraft,
} from './native-editor-draft.js';
import { retainNativeMemoryDraft, listNativeMemoryDrafts } from './native-durable-drafts.js';

const actor = '00000000-0000-4000-8000-000000000001',
  project = '00000000-0000-4000-8000-000000000002';
function storage() {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
function input(): NativeEditorDraft {
  return {
    userId: actor,
    projectId: project,
    key: 'column:deleted',
    revision: actor,
    expected: { version: 4, sequence: 8, databaseRevision: 2 },
    before: { token: '18' },
    values: { token: '-unfinished\n한글 "raw"' },
  };
}
describe('native per-writer recovery archive', () => {
  it('explicit reset of a corrupted pointer cannot discard another writer source', () => {
    const target = storage(),
      draft = input(),
      own = nativeDraftArchive(target),
      foreign = new NativeDraftArchive(target, 'foreign');
    own.store('editor', draft.key, draft);
    const other = foreign.store('editor', draft.key, { ...draft, values: { token: 'foreign' } });
    const record = own
      .records(actor, project)
      .find((value) => value.entry?.entryId === other.entryId)!;
    const head = [...target.data.keys()].find(
      (key) => key.startsWith('ezerd.native.archive-head:') && key.includes(nativeDraftWriterId()),
    )!;
    target.setItem(head, record.storageKey);
    expect(() => own.read(actor, project, 'editor', draft.key)).toThrow('native.draft-invalid');
    own.reset(actor, project, 'editor', draft.key);
    expect(target.getItem(record.storageKey)).toBe(record.raw);
    expect(own.read(actor, project, 'editor', draft.key)).toBeNull();
  });
  it('corrupt unique snapshot can be explicitly removed while intact snapshots remain usable', () => {
    const target = storage(),
      draft = input(),
      archive = nativeDraftArchive(target);
    const first = archive.store('editor', draft.key, draft);
    archive.store('editor', 'column:other', { ...draft, key: 'column:other' });
    const key = archive
      .records(actor, project)
      .find((value) => value.entry?.entryId === first.entryId)!.storageKey;
    target.setItem(key, 'original invalid archive bytes');
    const record = archive.records(actor, project).find((value) => value.storageKey === key)!;
    expect(record.entry).toBeUndefined();
    expect(record.raw).toBe('original invalid archive bytes');
    archive.dismiss(actor, project, record);
    expect(archive.records(actor, project)).toHaveLength(1);
  });
  it('failed explicit discard preserves source and matching memory for retry', () => {
    const target = storage(),
      draft = input();
    storeNativeEditorDraft(draft, target);
    const archive = nativeDraftArchive(target),
      record = archive.records(actor, project)[0]!;
    target.removeItem = () => {
      throw Error('Denied');
    };
    expect(() => archive.dismiss(actor, project, record)).toThrow('Denied');
    expect(target.getItem(record.storageKey)).toBe(record.raw);
    expect(listNativeMemoryDrafts(actor, project, target)[0]?.value).toEqual(draft);
  });
  it('successful explicit recovery archives failed memory before replacing the current head', () => {
    const target = storage(),
      draft = input(),
      archive = nativeDraftArchive(target);
    archive.store('editor', draft.key, draft);
    const record = archive.records(actor, project)[0]!,
      key = 'ezerd.native.editor:' + JSON.stringify([actor, project, draft.key]);
    const failed = { ...draft, revision: project, values: { token: 'failed original memory' } };
    retainNativeMemoryDraft(key, failed, true, target);
    const recovered = archive.recoverRecord(actor, project, record);
    expect(
      archive
        .entries(actor, project)
        .some((entry) => JSON.stringify(entry.draft) === JSON.stringify(failed)),
    ).toBe(true);
    expect(listNativeMemoryDrafts(actor, project, target)[0]?.value).toEqual(recovered.draft);
    expect(listNativeMemoryDrafts(actor, project, target)[0]?.storageFailure).toBe(false);
  });
  it('preserves interleaved writers, older snapshots and orphan source without touching shared keys', () => {
    const target = storage(),
      a = new NativeDraftArchive(target, 'tab-a'),
      b = new NativeDraftArchive(target, 'tab-b'),
      draft = input();
    a.store('editor', draft.key, draft);
    b.store('editor', draft.key, { ...draft, values: { token: 'B' } });
    a.store('editor', draft.key, { ...draft, revision: project, values: { token: 'A-new' } });
    expect(a.read(actor, project, 'editor', draft.key)?.draft.values).toEqual({ token: 'A-new' });
    expect(b.read(actor, project, 'editor', draft.key)?.draft.values).toEqual({ token: 'B' });
    expect(a.entries(actor, project)).toHaveLength(3);
    expect([...target.data.keys()].some((key) => key.startsWith('ezerd.native.editor:'))).toBe(
      false,
    );
    expect(a.entries(project, project)).toEqual([]);
    expect(a.entries(actor, actor)).toEqual([]);
  });
  it('normal forms never auto-adopt a foreign writer, but explicit recovery preserves revision provenance and expected', () => {
    const target = storage(),
      foreign = new NativeDraftArchive(target, 'another-tab'),
      draft = input();
    const original = foreign.store('editor', draft.key, draft);
    expect(loadNativeEditorDraft(actor, project, draft.key, target)).toBeNull();
    const own = nativeDraftArchive(target),
      recovered = own.recoverRecord(actor, project, own.records(actor, project)[0]!);
    expect(recovered.recoveredFrom).toBe(original.entryId);
    expect(recovered.revision).not.toBe(original.revision);
    expect(recovered.draft.expected).toEqual(draft.expected);
    expect(recovered.draft.values).toEqual(draft.values);
    expect(loadNativeEditorDraft(actor, project, draft.key, target)?.revision).toBe(
      recovered.revision,
    );
    expect(
      own.entries(actor, project).find((entry) => entry.entryId === original.entryId)?.draft,
    ).toEqual(draft);
  });
  it('legacy shared input requires review; copy/dismiss leaves the exact original bytes intact', () => {
    const target = storage(),
      draft = input(),
      key = 'ezerd.native.editor:' + JSON.stringify([actor, project, draft.key]);
    const raw = JSON.stringify(draft, null, 3);
    target.setItem(key, raw);
    expect(() => loadNativeEditorDraft(actor, project, draft.key, target)).toThrow(
      'native.draft-recovery-required',
    );
    const archive = nativeDraftArchive(target),
      record = archive.records(actor, project)[0]!;
    archive.recoverRecord(actor, project, record);
    expect(target.getItem(key)).toBe(raw);
    archive.dismiss(actor, project, record);
    expect(target.getItem(key)).toBe(raw);
    expect(archive.records(actor, project).filter((value) => value.legacy)).toEqual([]);
    const changed = JSON.stringify({ ...draft, values: { token: 'other tab changed' } });
    target.setItem(key, changed);
    expect(archive.records(actor, project).find((value) => value.legacy)?.raw).toBe(changed);
  });
  it('never removes a shared legacy slot during a concurrent writer change', () => {
    const target = storage(),
      draft = input(),
      key = 'ezerd.native.editor:' + JSON.stringify([actor, project, draft.key]);
    target.setItem(key, JSON.stringify(draft));
    const originalSet = target.setItem;
    target.setItem = (name, value) => {
      if (name.startsWith('ezerd.native.archive-dismissed:')) originalSet(key, 'new source');
      originalSet(name, value);
    };
    const archive = nativeDraftArchive(target),
      record = archive.records(actor, project)[0]!;
    archive.dismiss(actor, project, record);
    expect(target.getItem(key)).toBe('new source');
    expect(archive.records(actor, project).find((value) => value.legacy)?.raw).toBe('new source');
  });
  it('corrupt source is listed/downloadable and reset dismisses it without silently replacing evidence', () => {
    const target = storage(),
      draft = input(),
      key = 'ezerd.native.editor:' + JSON.stringify([actor, project, draft.key]);
    target.setItem(key, '{ broken raw');
    const archive = nativeDraftArchive(target),
      record = archive.records(actor, project)[0]!;
    expect(record.entry).toBeUndefined();
    expect(record.raw).toBe('{ broken raw');
    expect(() => archive.recoverRecord(actor, project, record)).toThrow('native.draft-invalid');
    expect(() => storeNativeEditorDraft(draft, target)).toThrow();
    resetNativeEditorDraft(actor, project, draft.key, target);
    storeNativeEditorDraft(draft, target);
    expect(loadNativeEditorDraft(actor, project, draft.key, target)).toEqual(draft);
    expect(target.getItem(key)).toBe('{ broken raw');
  });
  it('rejects stale source and actor/project mismatches before recovery or discard', () => {
    const target = storage(),
      archive = nativeDraftArchive(target),
      draft = input();
    archive.store('editor', draft.key, draft);
    const record = archive.records(actor, project)[0]!;
    expect(() => archive.recoverRecord(project, project, record)).toThrow('native.draft-changed');
    expect(() => archive.dismiss(actor, actor, record)).toThrow('native.draft-changed');
    target.setItem(record.storageKey, record.raw + ' ');
    expect(() => archive.dismiss(actor, project, record)).toThrow('native.draft-changed');
    expect(() => archive.recoverRecord(actor, project, record)).toThrow('native.draft-changed');
  });
  it('preserves closed-form memory input and keeps it if recovery storage fails', () => {
    const target = storage(),
      draft = input(),
      archive = nativeDraftArchive(target);
    archive.store('editor', draft.key, draft);
    const record = archive.records(actor, project)[0]!,
      key = 'ezerd.native.editor:' + JSON.stringify([actor, project, draft.key]);
    const memory = { ...draft, values: { token: 'memory failed source' } };
    retainNativeMemoryDraft(key, memory, true, target);
    target.setItem = () => {
      throw Error('Quota');
    };
    expect(() => archive.recoverRecord(actor, project, record)).toThrow('Quota');
    expect(listNativeMemoryDrafts(actor, project, target)[0]?.value).toEqual(memory);
    expect(listNativeMemoryDrafts(project, project, target)).toEqual([]);
  });
  it('ACK consumes only its captured origin even from a different receiving writer', () => {
    const target = storage(),
      draft = input(),
      own = nativeDraftArchive(target),
      foreign = new NativeDraftArchive(target, 'tab-b');
    const origin = own.store('editor', draft.key, draft);
    const request = { operationId: actor, source: 'sent' };
    preserveNativeDraftAckSources(actor, project, actor, request, [origin], target);
    const next = own.store('editor', draft.key, {
      ...draft,
      revision: project,
      values: { token: 'newer' },
    });
    const other = foreign.store('editor', draft.key, draft);
    consumeNativeDraftAckSources(actor, project, actor, request, target);
    expect(
      own
        .entries(actor, project)
        .map((entry) => entry.entryId)
        .sort(),
    ).toEqual([next.entryId, other.entryId].sort());
    expect(own.read(actor, project, 'editor', draft.key)?.entryId).toBe(next.entryId);
  });
  it('property recovery with identical text has a new snapshot identity protected against old ACK', () => {
    const target = storage(),
      archive = nativeDraftArchive(target),
      logicalKey = nativePropertyArchiveKey('column', 'c');
    const values = { physicalName: 'c', logicalName: '', comment: 'typed', definition: '' };
    const original = archive.store('property', logicalKey, {
      userId: actor,
      projectId: project,
      kind: 'column',
      objectId: 'c',
      expected: input().expected,
      before: { ...values, comment: '' },
      values,
    });
    const request = { operationId: actor };
    preserveNativeDraftAckSources(actor, project, actor, request, [original], target);
    const recovered = archive.recoverRecord(actor, project, archive.records(actor, project)[0]!);
    consumeNativeDraftAckSources(actor, project, actor, request, target);
    expect(archive.read(actor, project, 'property', logicalKey)?.entryId).toBe(recovered.entryId);
    expect(listNativeMemoryDrafts(actor, project, target)[0]?.value).toEqual(recovered.draft);
  });
  it('ACK fingerprint mismatch and unauthorized staging leave archive intact; ambiguous old requests do not erase input', () => {
    const target = storage(),
      archive = nativeDraftArchive(target),
      draft = input(),
      entry = archive.store('editor', draft.key, draft);
    const request = { operationId: actor };
    expect(nativeDraftWriterId()).toBe(entry.writerId);
    preserveNativeDraftAckSources(actor, project, actor, request, [entry], target);
    expect(() =>
      consumeNativeDraftAckSources(actor, project, actor, { changed: true }, target),
    ).toThrow('native.ack-mismatch');
    expect(consumeNativeDraftAckSources(actor, project, project, request, target)).toBe(false);
    expect(() =>
      preserveNativeDraftAckSources(project, project, project, request, [entry], target),
    ).toThrow('native.draft-actor-mismatch');
    expect(archive.entries(actor, project)).toHaveLength(1);
  });
  it('record write survives pointer failure as explicit recovery evidence', () => {
    const target = storage(),
      set = target.setItem,
      archive = nativeDraftArchive(target),
      draft = input();
    target.setItem = (key, value) => {
      if (key.startsWith('ezerd.native.archive-head:')) throw Error('Quota');
      set(key, value);
    };
    expect(() => archive.store('editor', draft.key, draft)).toThrow('Quota');
    expect(archive.records(actor, project)[0]?.entry?.draft).toEqual(draft);
    expect(archive.read(actor, project, 'editor', draft.key)).toBeNull();
  });
});
