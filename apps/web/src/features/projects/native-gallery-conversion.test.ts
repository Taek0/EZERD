import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createEmptyNativeDocument,
  createNativeColumn,
  createNativeTable,
  defaultDatabaseContext,
  planNativeDatabaseConversion,
  requestFingerprint,
  type DatabaseKind,
} from '@ezerd/model';
import type {
  ProjectDocumentState,
  ProjectDatabaseChangeResult,
  ProjectDatabasePreview,
} from '@ezerd/contracts';
import { ApiError } from '../../shared/api/client.js';
import { projectEntry } from './project-entry.js';
import { getNativeDurableQueue } from './native-durable-queue.js';
import { loadNativePending } from './native-save.js';
import { cancelNativeDurableEntry } from './native-cancellation.js';
import { assertNativeExportReady } from './project-ddl-export.js';
import {
  NativeGalleryConversionReview,
  GalleryConversionArchiveView,
} from './NativeGalleryConversion.js';
import {
  fetchGalleryDatabaseSnapshot,
  prepareGalleryDatabaseConversion,
  stageGalleryDatabaseConversion,
  sendGalleryDatabaseConversion,
  loadGalleryDatabaseConversion,
  loadGalleryProjectForOpen,
  galleryConversionEntry,
  galleryConversionDetails,
  saveNativeGalleryName,
  galleryConversionMatchesInput,
  readGalleryDatabaseArchives,
  prepareGalleryDatabaseRelease,
  releaseGalleryDatabaseConversion,
  type NativeGalleryConversionOptions,
  type NativeGalleryConversionPlan,
} from './native-gallery-conversion.js';
import {
  transferActor,
  transferProject,
  transferWorkspace,
  transferTime,
  transferStorage,
  transferState,
} from './native-transfer-test-fixtures.js';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('localStorage', transferStorage());
});
afterEach(async () => {
  await getNativeDurableQueue().close();
  vi.unstubAllGlobals();
});
function fixture(kind: 'postgresql' | 'mysql' = 'postgresql', physical = false) {
  const context = defaultDatabaseContext(kind),
    document = createEmptyNativeDocument(context);
  if (physical) {
    const table = createNativeTable(context, 'table');
    table.logical.name = ' 원문 이름 ';
    table.physical.name = 'legacy_items';
    table.physical.options =
      kind === 'mysql' ? { database: 'mysql', engine: 'InnoDB' } : { database: 'postgresql' };
    const column = createNativeColumn(context, table, 'column');
    column.physical.name = 'signed_id';
    column.physical.type =
      kind === 'postgresql'
        ? { kind: 'builtin', database: 'postgresql', typeId: 'postgresql:integer', parameters: {} }
        : { kind: 'builtin', database: 'mysql', typeId: 'mysql:int', parameters: {} };
    document.tables = [table];
    document.columns = [column];
  }
  let state: ProjectDocumentState = {
    protocolVersion: 2,
    project: {
      id: transferProject,
      workspaceId: transferWorkspace,
      name: 'Original',
      databaseKind: kind,
      databaseProfileId: context.profileId,
      databaseRevision: 1,
      version: 4,
      status: 'active',
      createdAt: transferTime,
      updatedAt: transferTime,
    },
    sequence: 7,
    sourceDocument: document,
    native: { status: 'available', document, migrationIssues: [], issues: [] },
  };
  const workspace = {
    id: transferWorkspace,
    name: 'Workspace',
    role: 'owner' as 'owner' | 'viewer',
    status: 'active' as 'active' | 'archived',
    createdAt: transferTime,
    updatedAt: transferTime,
  };
  let scope: NativeGalleryConversionOptions['control']['scope'] | null = {
    userId: transferActor,
    projectId: transferProject,
    workspaceId: transferWorkspace,
  };
  let lossChange = false,
    lossName = false;
  let previewOverride: ((p: ProjectDatabasePreview) => unknown) | null = null;
  let ackOverride: ((a: ProjectDatabaseChangeResult) => unknown) | null = null;
  const ledger = new Map<string, { fingerprint: string; ack: ProjectDatabaseChangeResult }>();
  const api = vi.fn(async (url: string, init?: RequestInit): Promise<unknown> => {
    const input = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.startsWith('/api/workspaces/')) return structuredClone(workspace);
    if (url.endsWith('/document-state')) return structuredClone(state);
    if (url.endsWith('/database/preview')) {
      expect(input.expectedSequence).toBe(state.sequence);
      expect(input.expectedVersion).toBe(state.project.version);
      if (state.sourceDocument.schemaVersion !== 2) throw Error('fixture');
      const target = defaultDatabaseContext(input.targetKind),
        current = { ...state.sourceDocument.database, revision: state.project.databaseRevision };
      const plan = planNativeDatabaseConversion(state.sourceDocument, current, target);
      const preview: ProjectDatabasePreview = {
        projectId: transferProject,
        version: state.project.version,
        sequence: state.sequence,
        current,
        target,
        canChange: plan.canApply,
        issues: plan.issues,
        ...(!plan.canApply && { reasonCode: 'database.conversion-required' }),
      };
      return previewOverride ? previewOverride(preview) : preview;
    }
    if (url.endsWith('/database/change')) {
      const replay = ledger.get(input.operationId);
      if (replay) {
        if (replay.fingerprint !== requestFingerprint(input))
          throw new ApiError(409, 'identity-conflict');
        return ackOverride ? ackOverride(replay.ack) : replay.ack;
      }
      if (
        workspace.role === 'viewer' ||
        workspace.status === 'archived' ||
        state.project.status === 'archived'
      )
        throw new ApiError(403, 'read-only');
      if (
        input.expectedVersion !== state.project.version ||
        input.expectedSequence !== state.sequence ||
        input.expectedDatabaseRevision !== state.project.databaseRevision
      )
        throw new ApiError(409, 'stale');
      if (state.sourceDocument.schemaVersion !== 2) throw Error('fixture');
      const target = defaultDatabaseContext(input.targetKind);
      const conversion = planNativeDatabaseConversion(
        state.sourceDocument,
        state.sourceDocument.database,
        target,
      );
      if (!conversion.document) throw new ApiError(409, 'conversion-required');
      const ack: ProjectDatabaseChangeResult = {
        projectId: transferProject,
        operationId: input.operationId,
        changed: true,
        version: state.project.version + 1,
        sequence: state.sequence + 1,
        database: { ...target, revision: state.project.databaseRevision + 1 },
      };
      state = {
        ...state,
        project: {
          ...state.project,
          databaseKind: target.kind,
          databaseProfileId: target.profileId,
          databaseRevision: ack.database.revision,
          version: ack.version,
        },
        sequence: ack.sequence,
        sourceDocument: conversion.document,
        native: {
          status: 'available',
          document: conversion.document,
          migrationIssues: [],
          issues: [],
        },
      };
      ledger.set(input.operationId, { fingerprint: requestFingerprint(input), ack });
      if (lossChange) {
        lossChange = false;
        throw new TypeError('response-lost');
      }
      return ackOverride ? ackOverride(ack) : ack;
    }
    if (init?.method === 'PATCH') {
      expect(Object.keys(input).sort()).toEqual(['expectedVersion', 'name']);
      expect(input.expectedVersion).toBe(state.project.version);
      if (workspace.role === 'viewer' || workspace.status === 'archived')
        throw new ApiError(403, 'read-only');
      state = {
        ...state,
        project: { ...state.project, name: input.name.trim(), version: state.project.version + 1 },
      };
      if (lossName) {
        lossName = false;
        throw new TypeError('response-lost');
      }
      return state.project;
    }
    throw Error(`unexpected fixture path ${url}`);
  });
  const options: NativeGalleryConversionOptions = {
    control: { scope: { ...scope }, currentScope: () => scope },
    canEdit: () => workspace.role === 'owner' && workspace.status === 'active',
    api,
    storage: globalThis.localStorage,
  };
  return {
    options,
    api,
    workspace,
    get state() {
      return state;
    },
    set state(value) {
      state = value;
    },
    set scope(value: NativeGalleryConversionOptions['control']['scope'] | null) {
      scope = value;
    },
    set lossChange(value: boolean) {
      lossChange = value;
    },
    set lossName(value: boolean) {
      lossName = value;
    },
    set previewOverride(value: ((p: ProjectDatabasePreview) => unknown) | null) {
      previewOverride = value;
    },
    set ackOverride(value: ((a: ProjectDatabaseChangeResult) => unknown) | null) {
      ackOverride = value;
    },
    async review(
      target: DatabaseKind = kind === 'postgresql' ? 'mysql' : 'postgresql',
      name?: string,
    ) {
      return prepareGalleryDatabaseConversion(
        await fetchGalleryDatabaseSnapshot(options),
        target,
        name,
        options,
      );
    },
  };
}
describe('native gallery conversion actual consumers', () => {
  it.each(['mysql', 'sqlite'] as const)(
    'changes empty native PG → %s using fresh three-counter input then a separate name PATCH',
    async (target) => {
      const f = fixture(),
        plan = await f.review(target, 'Renamed');
      expect(await getNativeDurableQueue().read(transferActor, transferProject)).toBeNull();
      await stageGalleryDatabaseConversion(plan, f.options);
      const result = await sendGalleryDatabaseConversion(plan, f.options);
      expect(result.project).toMatchObject({
        name: 'Renamed',
        databaseKind: target,
        version: 6,
        databaseRevision: 2,
      });
      expect(f.state.sequence).toBe(8);
      const calls = f.api.mock.calls.filter(
        ([, init]) => init?.method === 'POST' || init?.method === 'PATCH',
      );
      expect(calls.map(([url]) => url.split('/').at(-1))).toEqual([
        'preview',
        'change',
        transferProject,
      ]);
      expect(JSON.parse(String(calls[1]?.[1]?.body))).toEqual({
        operationId: plan.input.operationId,
        expectedVersion: 4,
        expectedSequence: 7,
        expectedDatabaseRevision: 1,
        targetKind: target,
        targetProfileId: defaultDatabaseContext(target).profileId,
      });
      expect(JSON.parse(String(calls[2]?.[1]?.body))).toEqual({
        expectedVersion: 5,
        name: 'Renamed',
      });
      expect(await loadGalleryDatabaseConversion(f.options)).toBeNull();
    },
  );
  it.each(['postgresql', 'mysql'] as const)(
    'uses the verified physical %s signed integer mapping while retaining raw source in durable review',
    async (source) => {
      const f = fixture(source, true),
        before = structuredClone(f.state),
        plan = await f.review();
      expect(plan.preview.canChange).toBe(true);
      expect(
        galleryConversionDetails(plan).sourceMap.some((row) => row.path.endsWith('/type')),
      ).toBe(true);
      await stageGalleryDatabaseConversion(plan, f.options);
      expect((await loadGalleryDatabaseConversion(f.options))?.snapshot.sourceDocument).toEqual(
        before.sourceDocument,
      );
      await sendGalleryDatabaseConversion(plan, f.options);
      expect(f.state.sourceDocument.columns?.[0]?.logical).toEqual(
        before.sourceDocument.columns?.[0]?.logical,
      );
      expect(f.state.sourceDocument.tables?.[0]?.logical.name).toBe(' 원문 이름 ');
      expect(f.state.sourceDocument.columns?.[0]?.physical.type).toMatchObject({
        kind: 'builtin',
        database: source === 'postgresql' ? 'mysql' : 'postgresql',
        typeId: source === 'postgresql' ? 'mysql:int' : 'postgresql:integer',
      });
    },
  );
  it('reviews unsupported physical → SQLite with object diagnostics and sends no write', async () => {
    const f = fixture('mysql', true),
      plan = await f.review('sqlite');
    expect(plan.preview.canChange).toBe(false);
    await expect(stageGalleryDatabaseConversion(plan, f.options)).rejects.toThrow(
      'conversion-required',
    );
    expect(f.api.mock.calls.some(([url]) => url.endsWith('/database/change'))).toBe(false);
    expect(await getNativeDurableQueue().read(transferActor, transferProject)).toBeNull();
  });
  it('keeps v1 source identity distinct from its native preview', async () => {
    const f = fixture();
    f.state = transferState('postgresql', 1);
    const state = await fetchGalleryDatabaseSnapshot(f.options);
    expect(state.sourceDocument.schemaVersion).toBe(1);
    await expect(
      prepareGalleryDatabaseConversion(state, 'mysql', undefined, f.options),
    ).rejects.toThrow('context-invalid');
  });
  it('opens native as viewer with no conversion pending and redirects only an actual databaseChange row to recovery', async () => {
    const f = fixture(),
      plan = await f.review();
    await stageGalleryDatabaseConversion(plan, f.options);
    f.workspace.role = 'viewer';
    const recovered = await loadGalleryProjectForOpen(transferProject, f.options, async () =>
      projectEntry(f.state),
    );
    expect(recovered.kind).toBe('recover');
    // Never transmitted: this test removes its own unsent fixture through the guarded queue API.
    expect(await getNativeDurableQueue().discard(galleryConversionEntry(plan))).toBe(true);
    const opened = await loadGalleryProjectForOpen(transferProject, f.options, async () =>
      projectEntry(f.state),
    );
    expect(opened.kind).toBe('open');
    expect(await loadGalleryDatabaseConversion(f.options)).toBeNull();
    await expect(f.review()).rejects.toThrow('edit-required');
  });
  it('opens the original native read view when IDB recovery is unknown, without treating unknown as empty or permitting a write', async () => {
    const f = fixture();
    f.workspace.role = 'viewer';
    const queue = getNativeDurableQueue(),
      read = vi.spyOn(queue, 'read').mockRejectedValue(Error('storage denied'));
    const opened = await loadGalleryProjectForOpen(transferProject, f.options, async () =>
      projectEntry(f.state),
    );
    expect(opened.kind).toBe('open');
    expect(queue.state(transferActor, transferProject)).toBe('unknown');
    f.workspace.role = 'owner';
    await expect(f.review()).rejects.toThrow('storage denied');
    expect(f.api.mock.calls.some(([url]) => url.endsWith('/database/change'))).toBe(false);
    read.mockRestore();
  });
  it('does not hide a changed actor/workspace as storage-unknown during project opening', async () => {
    const f = fixture();
    vi.spyOn(getNativeDurableQueue(), 'read').mockImplementation(async () => {
      f.scope = null;
      throw Error('storage denied');
    });
    await expect(
      loadGalleryProjectForOpen(transferProject, f.options, async () => projectEntry(f.state)),
    ).rejects.toThrow();
  });
  it('a denied local storage getter does not prevent native read opening but still blocks fresh conversion staging', async () => {
    const f = fixture();
    Object.defineProperty(f.options, 'storage', {
      get() {
        throw Error('storage denied');
      },
    });
    expect(
      (
        await loadGalleryProjectForOpen(transferProject, f.options, async () =>
          projectEntry(f.state),
        )
      ).kind,
    ).toBe('open');
    await expect(f.review()).rejects.toThrow('storage denied');
    expect(f.api.mock.calls.some(([url]) => url.endsWith('/database/change'))).toBe(false);
  });
  it.each(['version', 'sequence', 'revision', 'target', 'project', 'extra'] as const)(
    'rejects mismatched/unknown %s preview before staging',
    async (field) => {
      const f = fixture();
      f.previewOverride = (p) =>
        field === 'version'
          ? { ...p, version: 99 }
          : field === 'sequence'
            ? { ...p, sequence: 99 }
            : field === 'revision'
              ? { ...p, current: { ...p.current, revision: 99 } }
              : field === 'target'
                ? { ...p, target: defaultDatabaseContext('sqlite') }
                : field === 'project'
                  ? { ...p, projectId: transferWorkspace }
                  : { ...p, trusted: true };
      await expect(f.review()).rejects.toThrow();
      expect(await getNativeDurableQueue().read(transferActor, transferProject)).toBeNull();
    },
  );
  it('rejects a changed snapshot before claiming a durable request', async () => {
    const f = fixture(),
      plan = await f.review();
    f.state = { ...f.state, sequence: 8 };
    await expect(stageGalleryDatabaseConversion(plan, f.options)).rejects.toThrow(
      'preview-changed',
    );
    expect(await getNativeDurableQueue().read(transferActor, transferProject)).toBeNull();
  });
  it('blocks existing native writers and unsaved local input without consuming either', async () => {
    const f = fixture(),
      plan = await f.review(),
      queue = getNativeDurableQueue();
    const other = {
      userId: transferActor,
      projectId: transferProject,
      operationId: transferWorkspace,
      kind: 'history' as const,
      payload: { original: 'retain' },
    };
    await queue.claim(other);
    await expect(stageGalleryDatabaseConversion(plan, f.options)).rejects.toThrow();
    expect(await queue.read(transferActor, transferProject)).toEqual(other);
    await queue.discard(other);
    localStorage.setItem(
      `ezerd.native.canvas.personal:${JSON.stringify([transferActor, transferProject])}`,
      'original',
    );
    await expect(stageGalleryDatabaseConversion(plan, f.options)).rejects.toThrow('pending');
    expect(
      localStorage.getItem(
        `ezerd.native.canvas.personal:${JSON.stringify([transferActor, transferProject])}`,
      ),
    ).toBe('original');
  });
  it('does not send when durable storage is unavailable', async () => {
    const f = fixture(),
      plan = await f.review();
    const claim = vi.spyOn(getNativeDurableQueue(), 'claim').mockRejectedValue(Error('IDB failed'));
    await expect(stageGalleryDatabaseConversion(plan, f.options)).rejects.toThrow('IDB failed');
    expect(f.api.mock.calls.some(([url]) => url.endsWith('/database/change'))).toBe(false);
    claim.mockRestore();
  });
  it('replays the immutable operation after a lost change ACK and a durable reload', async () => {
    const f = fixture(),
      plan = await f.review('mysql', 'Recovered Name');
    await stageGalleryDatabaseConversion(plan, f.options);
    f.lossChange = true;
    await expect(sendGalleryDatabaseConversion(plan, f.options)).rejects.toThrow('response-lost');
    const queue = getNativeDurableQueue();
    expect(queue.state(transferActor, transferProject)).toBe('unknown');
    const restored = await loadGalleryDatabaseConversion(f.options);
    expect(restored).toEqual(plan);
    await sendGalleryDatabaseConversion(restored!, f.options);
    expect(f.state).toMatchObject({ sequence: 8, project: { version: 6, name: 'Recovered Name' } });
    const inputs = f.api.mock.calls
      .filter(([url]) => url.endsWith('/database/change'))
      .map(([, init]) => init?.body);
    expect(inputs).toEqual([JSON.stringify(plan.input), JSON.stringify(plan.input)]);
    expect(await queue.read(transferActor, transferProject)).toBeNull();
  });
  it('lost name ACK retains the original request/name; recovery recognizes the stored name and avoids a duplicate PATCH even as viewer', async () => {
    const f = fixture(),
      plan = await f.review('mysql', 'Name ACK lost');
    await stageGalleryDatabaseConversion(plan, f.options);
    f.lossName = true;
    await expect(sendGalleryDatabaseConversion(plan, f.options)).rejects.toThrow('response-lost');
    expect((await loadGalleryDatabaseConversion(f.options))?.requestedName).toBe('Name ACK lost');
    f.workspace.role = 'viewer';
    await sendGalleryDatabaseConversion(plan, f.options);
    expect(f.api.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
    expect(f.state.project.version).toBe(6);
    expect(await loadGalleryDatabaseConversion(f.options)).toBeNull();
  });
  it.each(['viewer', 'archived'] as const)(
    'old accepted ACK is recoverable after %s transition when no name save remains',
    async (transition) => {
      const f = fixture(),
        plan = await f.review();
      await stageGalleryDatabaseConversion(plan, f.options);
      f.lossChange = true;
      await expect(sendGalleryDatabaseConversion(plan, f.options)).rejects.toThrow('response-lost');
      if (transition === 'viewer') f.workspace.role = 'viewer';
      else {
        f.workspace.status = 'archived';
        f.state = { ...f.state, project: { ...f.state.project, status: 'archived' } };
      }
      await expect(sendGalleryDatabaseConversion(plan, f.options)).resolves.toMatchObject({
        project: { databaseKind: 'mysql' },
      });
      expect(await loadGalleryDatabaseConversion(f.options)).toBeNull();
    },
  );
  it('read-only ACK replay never grants a pending separate rename permission', async () => {
    const f = fixture(),
      plan = await f.review('mysql', 'Retained original input');
    await stageGalleryDatabaseConversion(plan, f.options);
    f.lossChange = true;
    await expect(sendGalleryDatabaseConversion(plan, f.options)).rejects.toThrow();
    f.workspace.role = 'viewer';
    const outcome = await sendGalleryDatabaseConversion(plan, f.options);
    expect(outcome).toMatchObject({ completed: false, archive: { outcome: 'accepted' } });
    expect(f.api.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);
    expect(outcome.archive?.plan.requestedName).toBe('Retained original input');
    expect(await loadGalleryDatabaseConversion(f.options)).toBeNull();
  });
  it.each([
    'project',
    'operation',
    'version',
    'sequence',
    'revision',
    'kind',
    'profile',
    'changed',
    'extra',
  ] as const)('retains pending for an invalid %s change ACK', async (field) => {
    const f = fixture(),
      plan = await f.review();
    await stageGalleryDatabaseConversion(plan, f.options);
    f.ackOverride = (a) =>
      field === 'project'
        ? { ...a, projectId: transferWorkspace }
        : field === 'operation'
          ? { ...a, operationId: transferWorkspace }
          : field === 'version'
            ? { ...a, version: 99 }
            : field === 'sequence'
              ? { ...a, sequence: 99 }
              : field === 'revision'
                ? { ...a, database: { ...a.database, revision: 99 } }
                : field === 'kind' || field === 'profile'
                  ? {
                      ...a,
                      database: {
                        ...defaultDatabaseContext('sqlite'),
                        revision: a.database.revision,
                      },
                    }
                  : field === 'changed'
                    ? { ...a, changed: false }
                    : { ...a, extra: 'untrusted' };
    await expect(sendGalleryDatabaseConversion(plan, f.options)).rejects.toThrow();
    expect(await loadGalleryDatabaseConversion(f.options)).toEqual(plan);
  });
  it('keeps stale 409/role 403 pending and never uses private CAS release or native cancel for it', async () => {
    const f = fixture(),
      plan = await f.review();
    await stageGalleryDatabaseConversion(plan, f.options);
    f.state = { ...f.state, project: { ...f.state.project, version: 5 } };
    await expect(sendGalleryDatabaseConversion(plan, f.options)).rejects.toThrow('stale');
    const queue = getNativeDurableQueue(),
      entry = galleryConversionEntry(plan);
    await expect(queue.discard(entry)).rejects.toThrow('transmission-unknown');
    expect(await loadNativePending(transferActor, transferProject)).toBeNull();
    await expect(assertNativeExportReady(transferActor, transferProject)).rejects.toThrow();
    const cancelApi = vi.fn();
    await expect(cancelNativeDurableEntry(entry, { api: cancelApi })).rejects.toThrow(
      'kind-not-supported',
    );
    expect(cancelApi).not.toHaveBeenCalled();
    const token = await queue.beginTransmission(entry);
    expect(await queue.confirmPrivateCASPreconditionConsumed(entry, token)).toBe(false);
    await queue.endTransmission(entry, token);
    f.workspace.role = 'viewer';
    await expect(sendGalleryDatabaseConversion(plan, f.options)).rejects.toThrow('read-only');
    expect(await loadGalleryDatabaseConversion(f.options)).toEqual(plan);
  });
  it('never consumes an ACK into another actor/workspace and leaves the source request recoverable', async () => {
    const f = fixture(),
      plan = await f.review();
    await stageGalleryDatabaseConversion(plan, f.options);
    const api = f.options.api!;
    f.options.api = async (url, init) => {
      const result = await api(url, init);
      if (url.endsWith('/database/change'))
        f.scope = {
          userId: transferWorkspace,
          projectId: transferProject,
          workspaceId: transferWorkspace,
        };
      return result;
    };
    await expect(sendGalleryDatabaseConversion(plan, f.options)).rejects.toThrow();
    expect((await getNativeDurableQueue().read(transferActor, transferProject))?.payload).toEqual(
      plan,
    );
    expect(f.api.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);
  });
  it('uses latest metadata version for a same-context native name save with no DB metadata field', async () => {
    const f = fixture(),
      state = await fetchGalleryDatabaseSnapshot(f.options);
    await expect(saveNativeGalleryName(state, 'New Name', f.options)).resolves.toMatchObject({
      version: 5,
      databaseKind: 'postgresql',
    });
    expect(
      JSON.parse(String(f.api.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1]?.body)),
    ).toEqual({ expectedVersion: 4, name: 'New Name' });
    expect(f.api.mock.calls.some(([url]) => url.endsWith('/database/change'))).toBe(false);
  });
  it('an older durable ACK cannot clear a newer gallery name or target selection', async () => {
    const f = fixture(),
      plan = await f.review('mysql', 'Original input');
    expect(
      galleryConversionMatchesInput(plan, { name: 'Original input', databaseKind: 'mysql' }),
    ).toBe(true);
    expect(galleryConversionMatchesInput(plan, { name: 'New draft', databaseKind: 'mysql' })).toBe(
      false,
    );
    expect(
      galleryConversionMatchesInput(plan, { name: 'Original input', databaseKind: 'sqlite' }),
    ).toBe(false);
  });
  it.each(['revision', 'rename'] as const)(
    'archives accepted old ACK/source/name after later %s without overwriting the current project',
    async (change) => {
      const f = fixture('postgresql', true),
        plan = await f.review('mysql', 'Original input');
      await stageGalleryDatabaseConversion(plan, f.options);
      f.lossChange = true;
      await expect(sendGalleryDatabaseConversion(plan, f.options)).rejects.toThrow('response-lost');
      if (change === 'revision') {
        if (f.state.sourceDocument.schemaVersion !== 2) throw Error('fixture');
        const converted = planNativeDatabaseConversion(
          f.state.sourceDocument,
          f.state.sourceDocument.database,
          defaultDatabaseContext('postgresql'),
        ).document!;
        f.state = {
          ...f.state,
          project: {
            ...f.state.project,
            version: 6,
            databaseRevision: 3,
            databaseKind: 'postgresql',
            databaseProfileId: converted.database.profileId,
          },
          sequence: 9,
          sourceDocument: converted,
          native: { status: 'available', document: converted, migrationIssues: [], issues: [] },
        };
      } else
        f.state = {
          ...f.state,
          project: { ...f.state.project, version: 6, name: 'Another writer' },
        };
      const latest = structuredClone(f.state),
        outcome = await sendGalleryDatabaseConversion(plan, f.options);
      expect(outcome.completed).toBe(false);
      expect(outcome.project).toEqual(latest.project);
      expect(outcome.archive).toMatchObject({
        outcome: 'accepted',
        plan,
        fresh: latest,
        ack: {
          operationId: plan.input.operationId,
          version: 5,
          sequence: 8,
          database: { revision: 2 },
        },
      });
      expect(f.state).toEqual(latest);
      expect(f.api.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);
      expect(await loadGalleryDatabaseConversion(f.options)).toBeNull();
      expect(readGalleryDatabaseArchives(f.options)[0]).toEqual(outcome.archive);
    },
  );
  it('archive storage failure keeps the accepted request uncertain and preserves original input', async () => {
    const f = fixture(),
      plan = await f.review('mysql', 'Input to retain');
    await stageGalleryDatabaseConversion(plan, f.options);
    f.lossChange = true;
    await expect(sendGalleryDatabaseConversion(plan, f.options)).rejects.toThrow();
    f.state = { ...f.state, project: { ...f.state.project, name: 'Concurrent name', version: 6 } };
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw Error('quota');
    });
    await expect(sendGalleryDatabaseConversion(plan, f.options)).rejects.toThrow('quota');
    expect(await loadGalleryDatabaseConversion(f.options)).toEqual(plan);
    expect(getNativeDurableQueue().state(transferActor, transferProject)).toBe('unknown');
    write.mockRestore();
  });
  it('ordinary stale 409 + fresh monotonic version is reviewed, archived as unconfirmed, then explicitly fenced/released without applying a change', async () => {
    const f = fixture(),
      plan = await f.review('mysql', 'Input retained');
    await stageGalleryDatabaseConversion(plan, f.options);
    f.state = { ...f.state, project: { ...f.state.project, version: 5, name: 'Another writer' } };
    const latest = structuredClone(f.state);
    await expect(sendGalleryDatabaseConversion(plan, f.options)).rejects.toThrow('stale');
    const proof = await prepareGalleryDatabaseRelease(plan, f.options);
    expect(proof.ack).toBeNull();
    expect(readGalleryDatabaseArchives(f.options)).toEqual([]);
    expect(await loadGalleryDatabaseConversion(f.options)).toEqual(plan);
    const released = await releaseGalleryDatabaseConversion(proof, f.options);
    expect(released.archive).toMatchObject({
      outcome: 'unconfirmed',
      ack: null,
      plan,
      fresh: latest,
    });
    expect(readGalleryDatabaseArchives(f.options)[0]?.plan.snapshot).toEqual(plan.snapshot);
    expect(f.state).toEqual(latest);
    expect(await getNativeDurableQueue().read(transferActor, transferProject)).toBeNull();
    const html = renderToStaticMarkup(
      createElement(GalleryConversionArchiveView, { record: released.archive }),
    );
    expect(html).toContain('적용 여부는 확인되지 않았습니다');
    expect(html).toContain('Input retained');
    expect(html).toContain('expectedSequence');
    expect(html).toContain('Another writer');
  });
  it('replays a known ACK while preparing release and keeps its confirmed status in the explicit archive', async () => {
    const f = fixture(),
      plan = await f.review('mysql', 'Original name input');
    await stageGalleryDatabaseConversion(plan, f.options);
    f.lossChange = true;
    await expect(sendGalleryDatabaseConversion(plan, f.options)).rejects.toThrow();
    const proof = await prepareGalleryDatabaseRelease(plan, f.options);
    expect(proof.ack?.operationId).toBe(plan.input.operationId);
    const released = await releaseGalleryDatabaseConversion(proof, f.options);
    expect(released.archive.outcome).toBe('accepted');
    expect(released.archive.plan.requestedName).toBe('Original name input');
    expect(f.state.project.name).toBe('Original');
    expect(await loadGalleryDatabaseConversion(f.options)).toBeNull();
  });
  it.each(['same', 'sequenceOnly', 'lowerRevision'] as const)(
    'refuses %s counters as no-new-mutation proof and preserves the request',
    async (counters) => {
      const f = fixture(),
        plan = await f.review();
      await stageGalleryDatabaseConversion(plan, f.options);
      if (counters === 'sequenceOnly') f.state = { ...f.state, sequence: 8 };
      if (counters === 'lowerRevision')
        f.state = { ...f.state, project: { ...f.state.project, version: 5, databaseRevision: 0 } };
      await expect(prepareGalleryDatabaseRelease(plan, f.options)).rejects.toThrow(
        'precondition-not-consumed',
      );
      expect(await loadGalleryDatabaseConversion(f.options)).toEqual(plan);
      expect(readGalleryDatabaseArchives(f.options)).toEqual([]);
    },
  );
  it.each(['role403', 'transport'] as const)(
    'never turns %s into request release even with advanced counters',
    async (failure) => {
      const f = fixture(),
        plan = await f.review();
      await stageGalleryDatabaseConversion(plan, f.options);
      f.state = { ...f.state, project: { ...f.state.project, version: 5 } };
      if (failure === 'role403') f.workspace.role = 'viewer';
      else {
        const original = f.options.api!;
        f.options.api = async (url, init) => {
          if (url.endsWith('/database/change')) throw new TypeError('lost');
          return original(url, init);
        };
      }
      await expect(prepareGalleryDatabaseRelease(plan, f.options)).rejects.toThrow();
      expect(readGalleryDatabaseArchives(f.options)).toEqual([]);
      expect(await loadGalleryDatabaseConversion(f.options)).toEqual(plan);
    },
  );
  it('a newer remote state invalidates reviewed release proof before any archive or queue clear', async () => {
    const f = fixture(),
      plan = await f.review();
    await stageGalleryDatabaseConversion(plan, f.options);
    f.state = { ...f.state, project: { ...f.state.project, version: 5 } };
    const proof = await prepareGalleryDatabaseRelease(plan, f.options);
    f.state = { ...f.state, project: { ...f.state.project, version: 6 } };
    await expect(releaseGalleryDatabaseConversion(proof, f.options)).rejects.toThrow(
      'preview-changed',
    );
    expect(readGalleryDatabaseArchives(f.options)).toEqual([]);
    expect(await loadGalleryDatabaseConversion(f.options)).toEqual(plan);
  });
  it('a caller-invented ACK cannot release a request; the exact endpoint is checked again', async () => {
    const f = fixture(),
      plan = await f.review();
    await stageGalleryDatabaseConversion(plan, f.options);
    f.state = { ...f.state, project: { ...f.state.project, version: 5 } };
    const proof = await prepareGalleryDatabaseRelease(plan, f.options);
    proof.ack = {
      projectId: transferProject,
      operationId: plan.input.operationId,
      changed: true,
      version: 5,
      sequence: 8,
      database: { ...defaultDatabaseContext('mysql'), revision: 2 },
    };
    await expect(releaseGalleryDatabaseConversion(proof, f.options)).rejects.toThrow('stale');
    expect(await loadGalleryDatabaseConversion(f.options)).toEqual(plan);
    expect(readGalleryDatabaseArchives(f.options)).toEqual([]);
  });
  it('explicit proof release fails closed on archive quota without making unknown discardable', async () => {
    const f = fixture(),
      plan = await f.review();
    await stageGalleryDatabaseConversion(plan, f.options);
    f.state = { ...f.state, project: { ...f.state.project, version: 5 } };
    const proof = await prepareGalleryDatabaseRelease(plan, f.options);
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw Error('quota');
    });
    await expect(releaseGalleryDatabaseConversion(proof, f.options)).rejects.toThrow('quota');
    await expect(getNativeDurableQueue().discard(galleryConversionEntry(plan))).rejects.toThrow(
      'transmission-unknown',
    );
    expect(await loadGalleryDatabaseConversion(f.options)).toEqual(plan);
    write.mockRestore();
  });
});
describe('native gallery conversion review product text', () => {
  it('shows named objects, actual INTEGER → INT and public/current database mapping without internal profile IDs or JSON', async () => {
    const f = fixture('postgresql', true),
      plan = await f.review();
    const html = renderToStaticMarkup(
      createElement(NativeGalleryConversionReview, { plan, recovered: false }),
    );
    expect(html).toContain('legacy_items');
    expect(html).toContain('signed_id');
    expect(html).toMatch(/integer.*→.*int/i);
    expect(html).toContain('public');
    expect(html).toContain('PostgreSQL 18');
    expect(html).toContain('MySQL 8.4');
    expect(html).not.toContain('postgresql-18-v1');
    expect(html).not.toContain('mysql-8.4-innodb-v1');
    expect(html).not.toContain('<pre>');
    expect(html).not.toContain('typeId');
  });
  it('shows human diagnostics for a blocked conversion and original payload details only for recovery', async () => {
    const f = fixture('mysql', true),
      plan = await f.review('sqlite');
    const html = renderToStaticMarkup(
      createElement(NativeGalleryConversionReview, { plan, recovered: false }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('legacy_items');
    expect(html).not.toContain('database.conversion');
    expect(html).not.toContain('<pre>');
    const recovered = renderToStaticMarkup(
      createElement(NativeGalleryConversionReview, { plan, recovered: true }),
    );
    expect(recovered).toContain('<pre>');
    expect(recovered).toContain('expectedSequence');
  });
});
