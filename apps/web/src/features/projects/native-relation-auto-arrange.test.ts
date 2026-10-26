import { describe, expect, it, vi } from 'vitest';
import { createEmptyNativeDocument, defaultDatabaseContext } from '@ezerd/model';
import type { NativeSyncOperationResult } from '@ezerd/contracts';
import type { NativeRelationArrangeState } from './native-relation-auto-arrange.js';
import {
  createNativeRelationArrangeController,
  nativeRelationArrangeBatch,
} from './native-relation-auto-arrange.js';

const projectId = '00000000-0000-4000-8000-000000000001';
const sourceId = '00000000-0000-4000-8000-000000000002';
const targetId = '00000000-0000-4000-8000-000000000003';
const relationId = '00000000-0000-4000-8000-000000000004';
const source = {
  objectId: sourceId,
  id: sourceId,
  viewId: '__tables__',
  x: 0,
  y: 0,
  width: 200,
  height: 100,
};
const target = {
  objectId: targetId,
  id: targetId,
  viewId: '__tables__',
  x: 0,
  y: 300,
  width: 200,
  height: 100,
};
const relation = {
  id: relationId,
  sourceTableId: sourceId,
  targetTableId: targetId,
  scope: 'both',
  physical: {
    name: 'fk',
    sourceColumnIds: [],
    targetColumnIds: [],
    onDelete: 'no-action',
    onUpdate: 'no-action',
  },
  logical: { name: 'references', cardinality: 'one-to-many', required: false },
};
const arranged = {
  relationId,
  sourceAnchor: { side: 'bottom' as const, ratio: 0.5 },
  targetAnchor: { side: 'top' as const, ratio: 0.5 },
  waypoints: [{ x: 100, y: 200 }],
};
function fixture(): NativeRelationArrangeState {
  const document = createEmptyNativeDocument(defaultDatabaseContext('postgresql'));
  const nodes = [{ ...source }, { ...target }];
  document.tables = [
    { id: sourceId, scope: 'both' },
    { id: targetId, scope: 'both' },
  ] as typeof document.tables;
  document.tableRelations = [relation] as typeof document.tableRelations;
  document.layout.nodes = nodes;
  const scene = {
    nodes,
    relations: [{ relation, label: 'references', geometry: { points: [] } }],
    viewId: '__tables__',
  };
  return {
    document,
    scene,
    viewId: '__tables__',
    mode: 'physical',
    eligible: true,
    snapshot: {
      project: { id: projectId, version: 1, databaseRevision: 1 },
      sequence: 1,
      sourceDocument: document,
    },
    userId: projectId,
  } as unknown as NativeRelationArrangeState;
}
function fakeWorker() {
  let onmessage: ((event: MessageEvent) => void) | null = null;
  let onerror: ((event: ErrorEvent) => void) | null = null;
  return {
    posted: null as { jobId: string } | null,
    terminated: false,
    postMessage(value: { jobId: string }) {
      this.posted = value;
    },
    terminate() {
      this.terminated = true;
    },
    get onmessage() {
      return onmessage;
    },
    set onmessage(value: ((event: MessageEvent) => void) | null) {
      onmessage = value;
    },
    get onerror() {
      return onerror;
    },
    set onerror(value: ((event: ErrorEvent) => void) | null) {
      onerror = value;
    },
    result() {
      onmessage?.({
        data: {
          jobId: this.posted!.jobId,
          type: 'result',
          result: {
            ok: true,
            routes: [arranged],
            metrics: {
              crossings: 0,
              overlapLength: 0,
              spacingViolations: 0,
              totalBends: 2,
              totalLength: 400,
              crowdedTableIds: [],
              searchLimitReached: false,
            },
          },
        },
      } as MessageEvent);
    },
  };
}

function markerStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    get size() {
      return values.size;
    },
  };
}

describe('relation arrange worker and durable handoff', () => {
  it('terminates on structure change and ignores a late result', () => {
    const state = fixture(),
      worker = fakeWorker(),
      save = vi.fn();
    const statuses: string[] = [];
    const controller = createNativeRelationArrangeController({
      getState: () => state,
      onStatus: (status) => statuses.push(status.phase),
      save,
      createWorker: () => worker,
    });
    controller.start();
    state.scene.relations = [];
    controller.update();
    worker.result();
    expect(worker.terminated).toBe(true);
    expect(statuses).toEqual(['computing', 'invalidated']);
    expect(save).not.toHaveBeenCalled();
  });

  it('retries a confirmed rejected batch once at a new version with a new operation ID', async () => {
    const state = fixture(),
      worker = fakeWorker();
    const storage = markerStorage();
    const statuses: string[] = [];
    const save = vi
      .fn()
      .mockImplementationOnce(() => ({ operationId: 'first', completion: Promise.resolve(false) }))
      .mockImplementationOnce(() => ({ operationId: 'second', completion: Promise.resolve(true) }));
    const controller = createNativeRelationArrangeController({
      getState: () => state,
      onStatus: (status) => statuses.push(status.phase),
      save,
      createWorker: () => worker,
      readStatus: async () => ({ status: 'accepted', sequence: 3 }),
      storage,
    });
    controller.start();
    worker.result();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    state.snapshot.project.version = 2;
    state.snapshot.sequence = 2;
    controller.update();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.results[0]!.value.operationId).toBe('first');
    expect(save.mock.results[1]!.value.operationId).toBe('second');
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('saved'));
    controller.undo();
    expect(statuses.at(-1)).toBe('saving');
    // Undo waits for the accepted second attempt to appear in the snapshot.
    controller.dispose();
  });

  it('recovers a cancelled accepted batch after reload and retries an offline fence', async () => {
    const state = fixture(),
      worker = fakeWorker(),
      storage = markerStorage();
    const completion = new Promise<boolean>(() => {});
    const save = vi.fn().mockReturnValue({ operationId: 'cancelled-batch', completion });
    const accepted = { status: 'accepted', sequence: 3 } as NativeSyncOperationResult;
    const cancelSave = vi.fn().mockResolvedValue(accepted);
    const first = createNativeRelationArrangeController({
      getState: () => state,
      onStatus: vi.fn(),
      save,
      createWorker: () => worker,
      cancelSave,
      storage,
    });
    first.start();
    worker.result();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    first.cancel();
    await vi.waitFor(() => expect(cancelSave).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(
        JSON.parse(
          storage.getItem(`ezerd.native.arrange-undo:${JSON.stringify([projectId, projectId])}`)!,
        ).acceptedSequence,
      ).toBe(3),
    );
    // Another edit reached sequence 2, but the accepted batch is sequence 3.
    state.snapshot.sequence = 2;
    first.update();
    expect(storage.size).toBe(1);
    first.dispose();

    const statuses: string[] = [];
    const retry = vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(accepted);
    state.ready = false;
    const recoveryWorker = vi.fn(fakeWorker);
    const second = createNativeRelationArrangeController({
      getState: () => state,
      onStatus: (status) => statuses.push(status.phase),
      save,
      createWorker: recoveryWorker,
      cancelSave: retry,
      storage,
    });
    second.update();
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('offline'));
    expect(storage.size).toBe(1);
    second.start();
    expect(recoveryWorker).not.toHaveBeenCalled();
    second.cancel();
    await vi.waitFor(() => expect(retry).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('saving'));
    second.update();
    expect(storage.size).toBe(1);
    second.dispose();
  });

  it('does not offer history undo for a no-op response with a rejected operation', async () => {
    const state = fixture(),
      worker = fakeWorker();
    const statuses: Array<{ phase: string; canUndo: boolean }> = [];
    const controller = createNativeRelationArrangeController({
      getState: () => state,
      onStatus: (status) => statuses.push(status),
      save: () => ({ operationId: 'no-op', completion: Promise.resolve(true) }),
      readStatus: async () => ({ status: 'rejected', sequence: 2 }),
      createWorker: () => worker,
    });
    controller.start();
    worker.result();
    await vi.waitFor(() => expect(statuses.at(-1)?.phase).toBe('saved'));
    expect(statuses.at(-1)?.canUndo).toBe(false);
    controller.dispose();
  });

  it('honors cancellation after a transmission-busy fence by compensating the later ACK', async () => {
    const state = fixture(),
      worker = fakeWorker(),
      storage = markerStorage();
    let resolve!: (value: boolean) => void;
    const completion = new Promise<boolean>((done) => {
      resolve = done;
    });
    const reload = vi.fn();
    const statuses: string[] = [];
    const controller = createNativeRelationArrangeController({
      getState: () => state,
      onStatus: (status) => statuses.push(status.phase),
      save: () => ({ operationId: 'busy-batch', completion }),
      createWorker: () => worker,
      cancelSave: vi.fn().mockRejectedValue(Error('native.transmission-busy')),
      readStatus: async () => ({ status: 'accepted', sequence: 3 }),
      onReload: reload,
      storage,
    });
    controller.start();
    worker.result();
    state.ready = false;
    controller.update();
    controller.cancel();
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('saving'));
    resolve(true);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(storage.size).toBe(1);
    expect(statuses).not.toContain('saved');
    controller.dispose();
  });

  it('recognizes an accepted history operation after a crash before marker cleanup', async () => {
    const state = fixture(),
      storage = markerStorage();
    storage.setItem(
      `ezerd.native.arrange-undo:${JSON.stringify([projectId, projectId])}`,
      JSON.stringify({
        viewId: '__tables__',
        operationId: 'arrange',
        startSequence: 1,
        after: [],
        historyOperationId: 'history-undo',
      }),
    );
    const cancelSave = vi.fn();
    const readStatus = vi.fn().mockResolvedValue({ status: 'accepted', sequence: 3 });
    const statuses: string[] = [];
    const controller = createNativeRelationArrangeController({
      getState: () => state,
      onStatus: (status) => statuses.push(status.phase),
      save: vi.fn(),
      cancelSave,
      readStatus,
      storage,
    });
    controller.update();
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('saved'));
    expect(readStatus).toHaveBeenCalledWith(projectId, projectId, 'history-undo');
    expect(cancelSave).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
    controller.dispose();
  });

  it('releases a marker after a terminal rejected history operation', async () => {
    const state = fixture(),
      storage = markerStorage();
    storage.setItem(
      `ezerd.native.arrange-undo:${JSON.stringify([projectId, projectId])}`,
      JSON.stringify({
        viewId: '__tables__',
        operationId: 'arrange',
        startSequence: 1,
        after: [],
        historyOperationId: 'rejected-undo',
      }),
    );
    const statuses: string[] = [];
    const cancelSave = vi.fn();
    const controller = createNativeRelationArrangeController({
      getState: () => state,
      onStatus: (status) => statuses.push(`${status.phase}:${status.reason ?? ''}`),
      save: vi.fn(),
      cancelSave,
      readStatus: async () => ({ status: 'rejected', sequence: 3 }),
      storage,
    });
    controller.update();
    await vi.waitFor(() => expect(statuses.at(-1)).toBe('failed:route'));
    expect(storage.size).toBe(0);
    expect(cancelSave).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('keeps a moved table and corrects its route before the single local save', async () => {
    const state = fixture(),
      worker = fakeWorker();
    const save = vi
      .fn()
      .mockReturnValue({ operationId: 'moved', completion: Promise.resolve(true) });
    const controller = createNativeRelationArrangeController({
      getState: () => state,
      onStatus: vi.fn(),
      save,
      createWorker: () => worker,
      readStatus: async () => ({ status: 'accepted', sequence: 2 }),
    });
    controller.start();
    state.scene.nodes[1]!.y = 340;
    controller.update();
    worker.result();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]![0][0].routes).toHaveLength(1);
    expect(state.scene.nodes[1]!.y).toBe(340);
    controller.dispose();
  });

  it('does not apply a completed result over a remote route edit', () => {
    const state = fixture(),
      worker = fakeWorker(),
      save = vi.fn();
    const statuses: string[] = [];
    const controller = createNativeRelationArrangeController({
      getState: () => state,
      onStatus: (status) => statuses.push(`${status.phase}:${status.reason ?? ''}`),
      save,
      createWorker: () => worker,
    });
    controller.start();
    state.document.layout.relations = [
      {
        relationId,
        viewId: '__tables__',
        offset: 12,
      },
    ];
    worker.result();
    expect(statuses.at(-1)).toBe('invalidated:route');
    expect(save).not.toHaveBeenCalled();
  });

  it('checks the complete batch limit before handing routes to the save queue', () => {
    const state = fixture();
    const tooMany = Array.from({ length: 1001 }, (_, index) => ({
      relationId: `route-${index}`,
      viewId: '__tables__',
      offset: 0,
      waypoints: [{ x: index, y: 1 }],
    }));
    expect(() => nativeRelationArrangeBatch(state, tooMany)).toThrow('relation.auto-arrange-limit');
  });
});

describe('local arrangement preflight', () => {
  it.each([
    [
      'deleted relation',
      (state: NativeRelationArrangeState) => {
        state.document.tableRelations = [];
      },
    ],
    [
      'deleted endpoint',
      (state: NativeRelationArrangeState) => {
        state.document.tables = state.document.tables!.slice(1);
      },
    ],
    [
      'stale endpoint',
      (state: NativeRelationArrangeState) => {
        state.document.tableRelations = [
          { ...state.document.tableRelations![0]!, sourceTableId: targetId },
        ];
      },
    ],
    [
      'permission',
      (state: NativeRelationArrangeState) => {
        state.eligible = false;
      },
    ],
    [
      'busy or pending draft',
      (state: NativeRelationArrangeState) => {
        state.ready = false;
      },
    ],
    [
      'actor',
      (state: NativeRelationArrangeState) => {
        delete state.userId;
      },
    ],
    [
      'view mismatch',
      (state: NativeRelationArrangeState) => {
        state.viewId = 'overview';
      },
    ],
    [
      'placement view',
      (state: NativeRelationArrangeState) => {
        state.scene.nodes[0]!.viewId = 'other';
      },
    ],
    [
      'duplicate placement',
      (state: NativeRelationArrangeState) => {
        state.scene.nodes.push({ ...state.scene.nodes[0]! });
      },
    ],
    [
      'missing placement',
      (state: NativeRelationArrangeState) => {
        state.scene.nodes = state.scene.nodes.slice(1);
      },
    ],
    [
      'invalid bounds',
      (state: NativeRelationArrangeState) => {
        state.scene.nodes[0]!.x = Infinity;
      },
    ],
    [
      'zero size',
      (state: NativeRelationArrangeState) => {
        state.scene.nodes[0]!.width = 0;
      },
    ],
    [
      'count limit',
      (state: NativeRelationArrangeState) => {
        state.scene.nodes = Array.from({ length: 257 }, (_, i) => ({
          ...state.scene.nodes[0]!,
          objectId: String(i),
        }));
      },
    ],
  ] as const)('does not create a Worker for %s', (_name, change) => {
    const state = fixture();
    change(state);
    const createWorker = vi.fn(fakeWorker);
    const save = vi.fn(async () => true);
    const controller = createNativeRelationArrangeController({
      getState: () => state,
      createWorker,
      save,
      onStatus: vi.fn(),
      storage: markerStorage(),
    });
    controller.start();
    expect(createWorker).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(controller.getStatus().phase).toBe('invalidated');
    controller.dispose();
  });

  it.each(['deletion', 'permission', 'readiness'] as const)(
    'rejects a late result after %s',
    async (change) => {
      const state = fixture();
      const worker = fakeWorker();
      const save = vi.fn(async () => true);
      const controller = createNativeRelationArrangeController({
        getState: () => state,
        createWorker: () => worker,
        save,
        onStatus: vi.fn(),
        storage: markerStorage(),
      });
      controller.start();
      if (change === 'deletion') state.document.tableRelations = [];
      if (change === 'permission') state.eligible = false;
      if (change === 'readiness') state.ready = false;
      worker.result();
      await Promise.resolve();
      expect(save).not.toHaveBeenCalled();
      expect(controller.getStatus().phase).toBe('invalidated');
      controller.dispose();
    },
  );

  it('allows generated visible placements without raw layout nodes', async () => {
    const state = fixture();
    state.document.layout.nodes = [];
    const worker = fakeWorker();
    const save = vi.fn(async () => true);
    const controller = createNativeRelationArrangeController({
      getState: () => state,
      createWorker: () => worker,
      save,
      onStatus: vi.fn(),
      storage: markerStorage(),
    });
    controller.start();
    worker.result();
    await Promise.resolve();
    expect(save).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it('does not invalidate its own pending save when readiness changes', async () => {
    const state = fixture();
    const worker = fakeWorker();
    let finish!: (value: boolean) => void;
    const save = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const controller = createNativeRelationArrangeController({
      getState: () => state,
      createWorker: () => worker,
      save,
      onStatus: vi.fn(),
      storage: markerStorage(),
    });
    controller.start();
    worker.result();
    state.ready = false;
    controller.update();
    expect(controller.getStatus().phase).toBe('saving');
    finish(true);
    await Promise.resolve();
    expect(controller.getStatus().phase).toBe('saved');
    controller.dispose();
  });
});

it('blocks startup when recovery storage cannot be read', () => {
  const state = fixture();
  const createWorker = vi.fn(fakeWorker);
  const storage = {
    ...markerStorage(),
    getItem: () => {
      throw Error('storage unavailable');
    },
  };
  const controller = createNativeRelationArrangeController({
    getState: () => state,
    createWorker,
    save: vi.fn(async () => true),
    onStatus: vi.fn(),
    storage,
  });
  controller.start();
  expect(createWorker).not.toHaveBeenCalled();
  expect(controller.getStatus()).toMatchObject({ phase: 'failed', reason: 'save' });
  controller.dispose();
});

describe('semantic arrangement diffs and no-op saves', () => {
  const stored = () => ({ ...arranged, viewId: '__tables__', offset: 0 });
  const reordered = () => ({
    waypoints: [{ y: 200, x: 100 }],
    targetAnchor: { ratio: 0.5, side: 'top' as const },
    sourceAnchor: { ratio: 0.5, side: 'bottom' as const },
    offset: 0,
    viewId: '__tables__',
    relationId,
  });

  it('ignores property order and explicit undefined optional values', () => {
    const state = fixture();
    state.document.layout.relations = [reordered()];
    expect(nativeRelationArrangeBatch(state, [{ ...stored(), bend: undefined }]).routes).toEqual(
      [],
    );
    state.document.layout.relations = [];
    expect(
      nativeRelationArrangeBatch(state, [{ relationId, viewId: '__tables__', offset: 0 }]).routes,
    ).toEqual([]);
  });

  it('keeps exact coordinates, anchors, bends and waypoint order meaningful', () => {
    const state = fixture();
    const original = {
      ...stored(),
      waypoints: [
        { x: 100, y: 180 },
        { x: 100, y: 220 },
      ],
    };
    state.document.layout.relations = [original];
    const variants = [
      { ...original, offset: 1e-8 },
      { ...original, bend: { x: 100, y: 200 } },
      { ...original, sourceAnchor: { ...original.sourceAnchor, ratio: 0.5 + 1e-8 } },
      { ...original, targetAnchor: { ...original.targetAnchor, side: 'left' as const } },
      { ...original, waypoints: [{ x: 100 + 1e-8, y: 180 }, original.waypoints[1]!] },
      { ...original, waypoints: [...original.waypoints].reverse() },
    ];
    for (const variant of variants)
      expect(nativeRelationArrangeBatch(state, [variant]).routes).toHaveLength(1);
    const { waypoints: _points, ...automatic } = original;
    state.document.layout.relations = [automatic];
    expect(
      nativeRelationArrangeBatch(state, [{ ...automatic, waypoints: [] }]).routes,
    ).toHaveLength(1);
  });

  it('submits only the changed route in a mixed batch', () => {
    const state = fixture();
    const other = { ...stored(), relationId: 'other', offset: 2 };
    state.document.layout.relations = [reordered(), other];
    const batch = nativeRelationArrangeBatch(state, [stored(), { ...other, offset: 3 }]);
    expect(batch.routes).toEqual([{ ...arranged, relationId: 'other', offset: 3 }]);
  });

  it('does not save or create an undo marker when a completed result is unchanged', async () => {
    const state = fixture();
    state.document.layout.relations = [stored()];
    const worker = fakeWorker(),
      save = vi.fn(async () => true),
      storage = markerStorage();
    const controller = createNativeRelationArrangeController({
      getState: () => state,
      createWorker: () => worker,
      save,
      storage,
      onStatus: vi.fn(),
    });
    controller.start();
    // A fresh snapshot may have the same fields in a different object order.
    state.document.layout.relations = [reordered()];
    worker.result();
    await Promise.resolve();
    expect(save).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
    expect(controller.getStatus()).toMatchObject({ phase: 'saved', canUndo: false });
    controller.dispose();
  });

  it('still treats route removal during computation as a conflicting edit', async () => {
    const state = fixture();
    state.document.layout.relations = [{ relationId, viewId: '__tables__', offset: 0 }];
    const worker = fakeWorker(),
      save = vi.fn(async () => true);
    const controller = createNativeRelationArrangeController({
      getState: () => state,
      createWorker: () => worker,
      save,
      storage: markerStorage(),
      onStatus: vi.fn(),
    });
    controller.start();
    state.document.layout.relations = [];
    worker.result();
    await Promise.resolve();
    expect(save).not.toHaveBeenCalled();
    expect(controller.getStatus()).toMatchObject({ phase: 'invalidated', reason: 'route' });
    controller.dispose();
  });
});
