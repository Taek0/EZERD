import { describe, expect, it, vi } from 'vitest';
import { createEmptyNativeDocument, defaultDatabaseContext } from '@ezerd/model';
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
  logical: { name: 'references' },
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
  document.tables = [{ id: sourceId }, { id: targetId }] as typeof document.tables;
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
    });
    controller.start();
    state.scene.nodes[1]!.y = 340;
    controller.update();
    worker.result();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]![0][0].routes).toHaveLength(1);
    expect(state.scene.nodes[1]!.y).toBe(340);
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
