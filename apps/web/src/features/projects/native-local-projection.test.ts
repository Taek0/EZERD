import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeColumn, createNativeTable, updateNativeColumn } from '@ezerd/model';
import {
  decorationFixture,
  decorationSnapshot,
  decorationUserId as user,
  decorationProjectId as project,
} from './native-canvas-decoration-test-fixtures.js';
import {
  enqueueNativeSave,
  flushNativeSaveIntent,
  nativeSaveIntents,
  nativeRejectedSaveIntents,
} from './native-save-intents.js';
import {
  projectNativeLocalColumns,
  readNativeLocalEntries,
  recordNativeLocalResult,
  pruneNativeLocalBridges,
  subscribeNativeLocalChanges,
  type NativeLocalEntry,
} from './native-local-projection.js';
import {
  createNativeTestIndexedDB,
  nativeTestDeferred,
} from './native-durable-test-environment.js';
import { ApiError, type request } from '../../shared/api/client.js';
function storage(seed: [string, string][] = []) {
  const data = new Map(seed);
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
    dump: () => [...data.entries()],
  };
}
const rename = (name: string) => ({
  type: 'patch_column' as const,
  id: 'c',
  patch: { physical: { name } },
});
function setup() {
  const doc = decorationFixture(),
    snapshot = decorationSnapshot(doc),
    store = storage();
  return {
    doc,
    snapshot,
    store,
    enqueue: (name: string) =>
      enqueueNativeSave(user, snapshot, [rename(name)], undefined, undefined, store),
    project: (base = doc, sequence = 10) =>
      projectNativeLocalColumns(base, readNativeLocalEntries(user, project, store), sequence, 3),
  };
}
beforeEach(() => vi.stubGlobal('indexedDB', createNativeTestIndexedDB()));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('local column projection', () => {
  it('projects durable queued renames without mutating the server document or operation', () => {
    const f = setup(),
      raw = JSON.stringify(f.doc);
    f.enqueue('local_name');
    const intent = JSON.stringify(nativeSaveIntents(user, project, f.store));
    expect(f.project().document.columns![0]!.physical.name).toBe('local_name');
    expect(f.project().pending).toBe(1);
    expect(JSON.stringify(f.doc)).toBe(raw);
    expect(JSON.stringify(nativeSaveIntents(user, project, f.store))).toBe(intent);
  });
  it('keeps the newest local input above an earlier ACK and bridges the ACK/render gap', () => {
    const f = setup();
    f.enqueue('first');
    const first = readNativeLocalEntries(user, project, f.store)[0]!;
    f.enqueue('later');
    recordNativeLocalResult(first, true, 11, f.store);
    f.store.removeItem(first.key);
    expect(f.project().document.columns![0]!.physical.name).toBe('later');
    const confirmed = updateNativeColumn(f.doc, 'c', { physical: { name: 'first' } });
    expect(f.project(confirmed, 11).document.columns![0]!.physical.name).toBe('later');
    pruneNativeLocalBridges(user, project, 11, 3, f.store);
    expect(readNativeLocalEntries(user, project, f.store)).toHaveLength(1);
  });
  it('restores queued work and accepted bridges from a fresh storage reader', () => {
    const f = setup();
    f.enqueue('accepted');
    const entry = readNativeLocalEntries(user, project, f.store)[0]!;
    recordNativeLocalResult(entry, true, 11, f.store);
    f.store.removeItem(entry.key);
    const reloaded = storage(f.store.dump());
    const entries = readNativeLocalEntries(user, project, reloaded);
    expect(
      projectNativeLocalColumns(f.doc, entries, 10, 3).document.columns![0]!.physical.name,
    ).toBe('accepted');
    expect(projectNativeLocalColumns(f.doc, entries, 11, 3).document).toBe(f.doc);
  });
  it('applies adds once and allows a later rename of an unconfirmed new column', () => {
    const f = setup(),
      column = createNativeColumn(f.doc.database, f.doc.tables![0]!, 'new');
    enqueueNativeSave(
      user,
      f.snapshot,
      [{ type: 'add_column', value: column }],
      undefined,
      undefined,
      f.store,
    );
    enqueueNativeSave(
      user,
      f.snapshot,
      [{ type: 'patch_column', id: 'new', patch: { physical: { name: 'pending_name' } } }],
      undefined,
      undefined,
      f.store,
    );
    const projected = f.project().document;
    expect(projected.columns?.filter((c) => c.id === 'new')).toHaveLength(1);
    expect(projected.columns?.find((c) => c.id === 'new')?.physical.name).toBe('pending_name');
    expect(f.project(projected).document.columns?.filter((c) => c.id === 'new')).toHaveLength(1);
  });
  it('does not partially project unsupported batches or commands from another database revision', () => {
    const f = setup();
    enqueueNativeSave(
      user,
      f.snapshot,
      [rename('name'), { type: 'reorder_columns', tableId: 't', columnIds: ['c'] }],
      undefined,
      undefined,
      f.store,
    );
    expect(f.project().document).toBe(f.doc);
    f.enqueue('name_only');
    const entries = readNativeLocalEntries(user, project, f.store);
    expect(projectNativeLocalColumns(f.doc, entries, 10, 4)).toMatchObject({
      document: f.doc,
      pending: 0,
      blocked: 1,
    });
    expect(readNativeLocalEntries('different-user', project, f.store)).toEqual([]);
  });
  it('does not show unpersisted work and retains a bridge if optional bridge storage fails', () => {
    const f = setup();
    const write = vi.spyOn(f.store, 'setItem').mockImplementation(() => {
      throw Error('quota');
    });
    expect(() => f.enqueue('not_stored')).toThrow('quota');
    expect(f.project().document).toBe(f.doc);
    write.mockRestore();
    f.enqueue('accepted');
    const entry = readNativeLocalEntries(user, project, f.store)[0]!;
    vi.spyOn(f.store, 'setItem').mockImplementation(() => {
      throw Error('quota');
    });
    recordNativeLocalResult(entry, true, 11, f.store);
    f.store.removeItem(entry.key);
    expect(f.project().document.columns![0]!.physical.name).toBe('accepted');
  });
  it('reports missing dependent objects instead of mutating an unrelated column', () => {
    const f = setup();
    enqueueNativeSave(
      user,
      f.snapshot,
      [{ type: 'patch_column', id: 'missing', patch: { physical: { name: 'x' } } }],
      undefined,
      undefined,
      f.store,
    );
    expect(f.project()).toMatchObject({ document: f.doc, pending: 0, blocked: 1 });
  });
});
function ack(entry: NativeLocalEntry, status: 'accepted' | 'rejected' = 'accepted') {
  return {
    protocolVersion: 2,
    database: { kind: 'postgresql', profileId: 'postgresql-18-v1' },
    databaseRevision: 3,
    operationId: entry.pending.request.operationId,
    groupId: entry.pending.request.groupId,
    sequence: 11,
    status,
    actor: { id: user, username: 'actor', color: '#123456' },
    changedPaths: [],
    createdAt: '2026-10-14T00:00:00Z',
    nextBaseline: {
      baselineId: '00000000-0000-4000-8000-000000000003',
      baseSequence: 11,
      baselineIssuedAt: '2026-10-14T00:00:00Z',
      databaseRevision: 3,
    },
  };
}
it('shows an edit before a delayed transport resolves and retains its visual ACK bridge', async () => {
  const f = setup(),
    changed = vi.fn(),
    off = subscribeNativeLocalChanges(user, project, changed);
  f.enqueue('first');
  const entry = readNativeLocalEntries(user, project, f.store)[0]!,
    sent = nativeTestDeferred<unknown>();
  const api = vi
    .fn()
    .mockRejectedValueOnce(new ApiError(404, 'missing'))
    .mockImplementationOnce(() => sent.promise);
  const flush = flushNativeSaveIntent(user, f.snapshot, f.store, api as typeof request);
  await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  expect(f.project().document.columns![0]!.physical.name).toBe('first');
  expect(nativeSaveIntents(user, project, f.store)).toHaveLength(1);
  sent.resolve(ack(entry));
  expect(await flush).toMatchObject({ accepted: true });
  expect(nativeSaveIntents(user, project, f.store)).toHaveLength(0);
  expect(f.project().document.columns![0]!.physical.name).toBe('first');
  expect(changed).toHaveBeenCalled();
  off();
});
it('removes only rejected projection and preserves the original rejected intent', async () => {
  const f = setup();
  f.enqueue('rejected');
  const entry = readNativeLocalEntries(user, project, f.store)[0]!;
  const api = vi
    .fn()
    .mockRejectedValueOnce(new ApiError(404, 'missing'))
    .mockResolvedValueOnce(ack(entry, 'rejected'));
  expect(
    await flushNativeSaveIntent(user, f.snapshot, f.store, api as typeof request),
  ).toMatchObject({ accepted: false });
  expect(f.project().document).toBe(f.doc);
  expect(nativeRejectedSaveIntents(user, project, f.store)[0]!.pending.request.commands).toEqual([
    rename('rejected'),
  ]);
});

it('keeps the durable local edit visible when transport fails offline', async () => {
  const f = setup();
  f.enqueue('offline_name');
  const api = vi
    .fn()
    .mockRejectedValueOnce(new ApiError(404, 'missing'))
    .mockRejectedValueOnce(Error('offline'));
  await expect(
    flushNativeSaveIntent(user, f.snapshot, f.store, api as typeof request),
  ).rejects.toThrow('offline');
  expect(nativeSaveIntents(user, project, f.store)).toHaveLength(1);
  expect(f.project().document.columns![0]!.physical.name).toBe('offline_name');
  const reloaded = storage(f.store.dump());
  expect(
    projectNativeLocalColumns(f.doc, readNativeLocalEntries(user, project, reloaded), 10, 3)
      .document.columns![0]!.physical.name,
  ).toBe('offline_name');
});

it('projects column attributes and atomic dependent table deletion before ACK', () => {
  const f = setup();
  enqueueNativeSave(
    user,
    f.snapshot,
    [{ type: 'patch_column', id: 'c', patch: { physical: { nullable: false, comment: 'local' } } }],
    undefined,
    undefined,
    f.store,
  );
  expect(f.project().document.columns![0]!.physical).toMatchObject({
    nullable: false,
    comment: 'local',
  });
  enqueueNativeSave(
    user,
    f.snapshot,
    [{ type: 'delete_objects', targets: [{ collection: 'tables', id: 't' }] }],
    undefined,
    undefined,
    f.store,
  );
  const projected = f.project();
  expect(projected.blocked).toBe(0);
  expect(projected.document.tables).toEqual([]);
  expect(projected.document.columns).toEqual([]);
  expect(projected.document.layout.nodes.some((n) => n.objectId === 't')).toBe(false);
  expect(f.doc.tables).toHaveLength(1);
  const reloaded = storage(f.store.dump());
  expect(
    projectNativeLocalColumns(f.doc, readNativeLocalEntries(user, project, reloaded), 10, 3)
      .document,
  ).toEqual(projected.document);
});
it('keeps an entire failed batch out of the display and isolates a changed database revision', () => {
  const f = setup();
  enqueueNativeSave(
    user,
    f.snapshot,
    [
      rename('tentative'),
      { type: 'patch_column', id: 'missing', patch: { physical: { nullable: false } } },
    ],
    undefined,
    undefined,
    f.store,
  );
  expect(f.project()).toMatchObject({ document: f.doc, blocked: 1, pending: 0 });
  expect(
    projectNativeLocalColumns(f.doc, readNativeLocalEntries(user, project, f.store), 10, 4),
  ).toMatchObject({ document: f.doc, blocked: 1 });
});
it('rolls rejected deletion back without losing the saved intent', async () => {
  const f = setup();
  enqueueNativeSave(
    user,
    f.snapshot,
    [{ type: 'delete_objects', targets: [{ collection: 'columns', id: 'c' }] }],
    undefined,
    undefined,
    f.store,
  );
  expect(f.project().document.columns).toEqual([]);
  const entry = readNativeLocalEntries(user, project, f.store)[0]!;
  const api = vi
    .fn()
    .mockRejectedValueOnce(new ApiError(404, 'missing'))
    .mockResolvedValueOnce(ack(entry, 'rejected'));
  await flushNativeSaveIntent(user, f.snapshot, f.store, api as typeof request);
  expect(f.project().document).toBe(f.doc);
  expect(nativeRejectedSaveIntents(user, project, f.store)).toHaveLength(1);
});

it('projects FK creation, patch and cascading removal with generated columns', () => {
  const f = setup();
  f.doc.tables!.push(createNativeTable(f.doc.database, 'child', 'a'));
  f.doc.columns = [createNativeColumn(f.doc.database, f.doc.tables![0]!, 'c')];
  f.doc.keys = [
    { id: 'pk', tableId: 't', kind: 'primary', scope: 'both', name: 'pk', columnIds: ['c'] },
  ];
  enqueueNativeSave(
    user,
    f.snapshot,
    [
      {
        type: 'create_foreign_key',
        primaryTableId: 't',
        foreignTableId: 'child',
        primaryKeyId: 'pk',
        relationId: 'fk',
        columnIds: ['fc'],
      },
    ],
    undefined,
    undefined,
    f.store,
  );
  expect(f.project().blocked).toBe(0);
  expect(f.project().document.tableRelations).toHaveLength(1);
  expect(f.project().document.columns?.find((c) => c.id === 'fc')?.tableId).toBe('child');
  enqueueNativeSave(
    user,
    f.snapshot,
    [{ type: 'patch_foreign_key', id: 'fk', patch: { logical: { name: 'local relation' } } }],
    undefined,
    undefined,
    f.store,
  );
  expect(f.project().document.tableRelations![0]!.logical.name).toBe('local relation');
  enqueueNativeSave(
    user,
    f.snapshot,
    [{ type: 'delete_objects', targets: [{ collection: 'tables', id: 'child' }] }],
    undefined,
    undefined,
    f.store,
  );
  expect(f.project().document.tableRelations).toEqual([]);
  expect(f.project().document.columns?.some((c) => c.id === 'fc')).toBe(false);
  expect(f.doc.columns).toHaveLength(1);
});
