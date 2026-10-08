import { describe, expect, it } from 'vitest';
import {
  loadNativeEditorDraft,
  storeNativeEditorDraft,
  discardNativeEditorDraft,
  rebaseNativeEditorDraft,
  type NativeEditorDraft,
} from './native-editor-draft.js';
import { nativeDraftMemoryState } from './native-durable-drafts.js';
const uuid = '00000000-0000-4000-8000-000000000001',
  other = '00000000-0000-4000-8000-000000000002';
const memory = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
};
function draft(): NativeEditorDraft {
  return {
    userId: uuid,
    projectId: uuid,
    key: 'create:column:table',
    revision: uuid,
    expected: { version: 7, sequence: 10, databaseRevision: 3 },
    before: { id: 'stable-created-id', name: '', parameter: '18' },
    values: { id: 'stable-created-id', name: 'draft', parameter: '-unfinished' },
  };
}
describe('native editor durable incomplete input', () => {
  it('isolates user/project/form identity and keeps incomplete tokens', () => {
    const store = memory(),
      input = draft();
    storeNativeEditorDraft(input, store);
    expect(loadNativeEditorDraft(uuid, uuid, input.key, store)).toEqual(input);
    expect(loadNativeEditorDraft(other, uuid, input.key, store)).toBeNull();
    expect(loadNativeEditorDraft(uuid, other, input.key, store)).toBeNull();
    expect(loadNativeEditorDraft(uuid, uuid, 'format:column:table', store)).toBeNull();
  });
  it('consumes only the acknowledged input revision and protects a newer tab', () => {
    const store = memory(),
      input = draft();
    storeNativeEditorDraft(input, store);
    storeNativeEditorDraft(
      { ...input, revision: other, values: { ...input.values, name: 'newer input' } },
      store,
    );
    discardNativeEditorDraft(uuid, uuid, input, store);
    expect(loadNativeEditorDraft(uuid, uuid, input.key, store)?.values.name).toBe('newer input');
    discardNativeEditorDraft(uuid, uuid, { key: input.key, revision: other }, store);
    expect(loadNativeEditorDraft(uuid, uuid, input.key, store)).toBeNull();
  });
  it('rebases edited fields explicitly, inherits untouched newer fields, and preserves created IDs', () => {
    const input = draft();
    input.before.note = 'old';
    input.values.note = 'old';
    const rebased = rebaseNativeEditorDraft(
      input,
      { version: 8, sequence: 11, databaseRevision: 3 },
      { id: 'new-mount-id', name: 'server name', parameter: '12', note: 'server note' },
    );
    expect(rebased.values).toEqual({
      id: 'stable-created-id',
      name: 'draft',
      parameter: '-unfinished',
      note: 'server note',
    });
    expect(rebased.before).toEqual({
      id: 'stable-created-id',
      name: 'server name',
      parameter: '12',
      note: 'server note',
    });
    expect(rebased.revision).not.toBe(input.revision);
    expect(input.before.name).toBe('');
    expect(() =>
      rebaseNativeEditorDraft(input, { version: 8, sequence: 11, databaseRevision: 4 }, {}),
    ).toThrow('database.context-changed');
  });
  it('retains evidence of corrupt storage instead of replacing it', () => {
    const store = memory(),
      input = draft();
    storeNativeEditorDraft(input, store);
    const key = `ezerd.native.editor:${JSON.stringify([uuid, uuid, input.key])}`;
    store.setItem(key, '{broken');
    expect(() => storeNativeEditorDraft(input, store)).toThrow();
    expect(store.getItem(key)).toBe('{broken');
  });
  it('recovers the exact failed typed input after unmount/reopen instead of the older persisted input', () => {
    const target = memory(),
      input = draft();
    storeNativeEditorDraft(input, target);
    let failing = true;
    const broken = {
      ...target,
      setItem: (key: string, value: string) => {
        if (failing) throw Error('Quota');
        target.setItem(key, value);
      },
    };
    const next = {
      ...input,
      revision: other,
      values: { ...input.values, parameter: '-still-typing' },
    };
    expect(() => storeNativeEditorDraft(next, broken)).toThrow('Quota');
    expect(loadNativeEditorDraft(uuid, uuid, input.key, broken)).toEqual(next);
    expect(nativeDraftMemoryState(uuid, uuid, broken).storageFailure).toBe(true);
    discardNativeEditorDraft(uuid, uuid, input, broken);
    expect(loadNativeEditorDraft(uuid, uuid, input.key, broken)).toEqual(next);
    failing = false;
    storeNativeEditorDraft(next, broken);
    expect(nativeDraftMemoryState(uuid, uuid, broken).storageFailure).toBe(false);
    discardNativeEditorDraft(uuid, uuid, next, broken);
    expect(loadNativeEditorDraft(uuid, uuid, input.key, broken)).toBeNull();
  });
  it('ACK discard never destroys memory if storage removal cannot be confirmed', () => {
    const target = {
        ...memory(),
        removeItem() {
          throw Error('Denied');
        },
      },
      input = draft();
    storeNativeEditorDraft(input, target);
    expect(() => discardNativeEditorDraft(uuid, uuid, input, target)).toThrow('Denied');
    expect(loadNativeEditorDraft(uuid, uuid, input.key, target)).toEqual(input);
  });
});
