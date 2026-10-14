import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decorationFixture,
  decorationSnapshot,
  decorationUserId as user,
} from './native-canvas-decoration-test-fixtures.js';
import { storeNativeDraft, discardNativeDraft, type NativePropertyDraft } from './native-save.js';
import {
  storeNativeEditorDraft,
  discardNativeEditorDraft,
  type NativeEditorDraft,
} from './native-editor-draft.js';
import { nativeDurableId } from './native-durable-queue.js';
import { nativeInlineKey } from './native-inline-edit.js';
import {
  readNativeLocalDraftNames,
  projectNativeLocalDraftNames,
} from './native-local-draft-names.js';
function setup() {
  const doc = decorationFixture(),
    snapshot = decorationSnapshot(doc),
    column = doc.columns![0]!;
  const before = {
    physicalName: column.physical.name,
    logicalName: column.logical.name,
    comment: column.physical.comment,
    definition: column.logical.definition,
  };
  const draft: NativePropertyDraft = {
    userId: user,
    projectId: snapshot.project.id,
    kind: 'column',
    objectId: column.id,
    expected: { version: 7, sequence: 10, databaseRevision: 3 },
    values: { ...before },
    before: { ...before },
  };
  return {
    doc,
    snapshot,
    column,
    draft,
    read: () => readNativeLocalDraftNames(user, snapshot.project.id),
    project: () =>
      projectNativeLocalDraftNames(doc, readNativeLocalDraftNames(user, snapshot.project.id), 3)
        .document,
  };
}
beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    removeItem: (k: string) => map.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());
describe('autosave-independent local name drafts', () => {
  it('shows a stored property draft immediately without a queued server operation', () => {
    const f = setup();
    f.draft.values.physicalName = 'typing';
    storeNativeDraft(f.draft);
    expect(f.project().columns![0]!.physical.name).toBe('typing');
    expect(f.doc.columns![0]!.physical.name).toBe('opaque');
    expect(f.read()).toHaveLength(1);
  });
  it('tracks latest edits per field without promoting an old field on ACK rebase', () => {
    const f = setup();
    f.draft.values.physicalName = 'property_first';
    f.draft.values.logicalName = 'logical_old';
    storeNativeDraft(f.draft);
    const inline: NativeEditorDraft = {
      userId: user,
      projectId: f.snapshot.project.id,
      key: nativeInlineKey({ tableId: 't', columnId: 'c', mode: 'physical', field: 'name' }),
      revision: nativeDurableId(),
      expected: f.draft.expected,
      before: { value: 'property_first' },
      values: { value: 'inline_latest' },
    };
    storeNativeEditorDraft(inline);
    expect(f.project().columns![0]!.physical.name).toBe('inline_latest');
    f.draft.values.logicalName = 'logical_new';
    storeNativeDraft(f.draft);
    expect(f.project().columns![0]!.physical.name).toBe('inline_latest');
    expect(f.project().columns![0]!.logical.name).toBe('logical_new');
    f.draft.expected = { ...f.draft.expected, sequence: 11 };
    f.draft.before.comment = 'new remote comment';
    storeNativeDraft(f.draft);
    expect(f.project().columns![0]!.physical.name).toBe('inline_latest');
    f.draft.values.physicalName = 'property_latest';
    storeNativeDraft(f.draft);
    expect(f.project().columns![0]!.physical.name).toBe('property_latest');
    discardNativeDraft(user, f.snapshot.project.id, 'column', 'c');
    expect(f.project().columns![0]!.physical.name).toBe('inline_latest');
    discardNativeEditorDraft(user, f.snapshot.project.id, inline);
    expect(f.read()).toEqual([]);
  });
  it('isolates actor/revision and ignores invalid names or a remotely removed object', () => {
    const f = setup();
    f.draft.values.physicalName = 'pending';
    storeNativeDraft(f.draft);
    expect(readNativeLocalDraftNames('other', f.snapshot.project.id)).toEqual([]);
    expect(projectNativeLocalDraftNames(f.doc, f.read(), 4).document).toBe(f.doc);
    const removed = { ...f.doc, columns: [] };
    expect(projectNativeLocalDraftNames(removed, f.read(), 3).document).toBe(removed);
    f.draft.values.physicalName = 'x'.repeat(121);
    expect(() => storeNativeDraft(f.draft)).toThrow();
    expect(f.read()).toEqual([]);
  });
  it('supports a table title and does not treat non-name inline drafts as name changes', () => {
    const f = setup();
    const draft: NativeEditorDraft = {
      userId: user,
      projectId: f.snapshot.project.id,
      key: nativeInlineKey({ tableId: 't', mode: 'physical', field: 'name' }),
      revision: nativeDurableId(),
      expected: f.draft.expected,
      before: { value: 'records' },
      values: { value: 'new_title' },
    };
    storeNativeEditorDraft(draft);
    expect(f.project().tables![0]!.physical.name).toBe('new_title');
    storeNativeEditorDraft({
      ...draft,
      key: nativeInlineKey({ tableId: 't', columnId: 'c', mode: 'physical', field: 'comment' }),
      revision: nativeDurableId(),
    });
    expect(f.read()).toHaveLength(1);
  });
});
