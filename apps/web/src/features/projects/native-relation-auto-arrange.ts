import {
  MAX_BATCH_RELATION_LAYOUT_BYTES,
  MAX_BATCH_RELATION_LAYOUTS,
  MAX_BATCH_RELATION_WAYPOINTS,
  nativeSyncOperationResultSchema,
  relationLayoutSchema,
  type ProjectDocumentState,
} from '@ezerd/contracts';
import { arrangeRelationRoutes, relationGeometry, segmentCrossesBounds } from '@ezerd/model';
import type { NativeDesignDocument, RelationLayout } from '@ezerd/model';
import type { nativeCanvasScene } from './NativeERDCanvas.js';
import { nativeRelationLabelWidth } from './native-canvas-style.js';
import type { NativeEditorSave } from './native-editor-form.js';
import { nativeDurableId } from './native-durable-queue.js';
import { captureNativeActorApi } from './native-actor-api.js';
import { ApiError, request } from '../../shared/api/client.js';
import { cancelNativeSaveIntent } from './native-save-intents.js';
import {
  loadNativeHistoryPending,
  sendNativeHistory,
  stageNativeHistory,
} from './native-history.js';

type Scene = ReturnType<typeof nativeCanvasScene>;
type ArrangeInput = Parameters<typeof arrangeRelationRoutes>[0];
type ArrangeResult = ReturnType<typeof arrangeRelationRoutes>;
type ArrangedRoute = Extract<ArrangeResult, { ok: true }>['routes'][number];
type Route = RelationLayout;
type UndoMarker = {
  viewId: string;
  operationId: string;
  startSequence: number;
  after: Map<string, Route>;
  historyOperationId?: string;
};
type MarkerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
async function readOperationStatus(userId: string, projectId: string, operationId: string) {
  const actorApi = captureNativeActorApi(userId, request);
  try {
    const result = nativeSyncOperationResultSchema.parse(
      await actorApi(
        `/api/projects/${encodeURIComponent(projectId)}/native-sync/operations/${operationId}`,
        { cache: 'no-store' },
      ),
    );
    if (result.operationId !== operationId || result.actor.id !== userId)
      throw Error('relation.auto-arrange-operation-invalid');
    return result.status;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
const markerKey = (userId: string, projectId: string) =>
  `ezerd.native.arrange-undo:${JSON.stringify([userId, projectId])}`;
function readUndoMarker(
  storage: MarkerStorage,
  userId: string,
  projectId: string,
): UndoMarker | null {
  const raw = storage.getItem(markerKey(userId, projectId));
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw Error('relation.auto-arrange-undo-invalid');
  const marker = value as Record<string, unknown>;
  if (
    typeof marker.viewId !== 'string' ||
    typeof marker.operationId !== 'string' ||
    !Number.isSafeInteger(marker.startSequence) ||
    !Array.isArray(marker.after)
  )
    throw Error('relation.auto-arrange-undo-invalid');
  const after = relationLayoutSchema.array().parse(marker.after);
  return {
    viewId: marker.viewId,
    operationId: marker.operationId,
    startSequence: marker.startSequence as number,
    after: new Map(after.map((route) => [route.relationId, route])),
    ...(typeof marker.historyOperationId === 'string'
      ? { historyOperationId: marker.historyOperationId }
      : {}),
  };
}
function storeUndoMarker(
  storage: MarkerStorage,
  userId: string,
  projectId: string,
  marker: UndoMarker,
) {
  const previous = readUndoMarker(storage, userId, projectId);
  if (previous && previous.operationId !== marker.operationId)
    throw Error('relation.auto-arrange-undo-pending');
  storage.setItem(
    markerKey(userId, projectId),
    JSON.stringify({
      viewId: marker.viewId,
      operationId: marker.operationId,
      startSequence: marker.startSequence,
      after: [...marker.after.values()],
      ...(marker.historyOperationId ? { historyOperationId: marker.historyOperationId } : {}),
    }),
  );
}
function clearUndoMarker(
  storage: MarkerStorage,
  userId: string,
  projectId: string,
  operationId: string,
) {
  if (readUndoMarker(storage, userId, projectId)?.operationId === operationId)
    storage.removeItem(markerKey(userId, projectId));
}

export interface NativeRelationArrangeState {
  document: NativeDesignDocument;
  scene: Scene;
  viewId: string;
  mode: 'physical' | 'logical';
  eligible: boolean;
  snapshot: ProjectDocumentState;
  userId?: string;
}
export interface NativeRelationArrangeStatus {
  phase:
    'idle' | 'computing' | 'saving' | 'saved' | 'invalidated' | 'failed' | 'offline' | 'cancelled';
  progress?: 'preparing' | 'routing' | 'applying' | 'retrying';
  reason?:
    | 'scope'
    | 'structure'
    | 'size'
    | 'route'
    | 'space'
    | 'save'
    | 'limit'
    | 'compute-limit'
    | 'undo'
    | 'cancel';
  canUndo: boolean;
  canCancel?: boolean;
  crowdedTableIds?: string[];
}
type WorkerMessage =
  | { jobId: string; type: 'progress'; phase: 'routing' }
  | { jobId: string; type: 'result'; result: ArrangeResult }
  | { jobId: string; type: 'error'; message: string };
type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;

const routeValue = (route: Route | undefined, relationId: string, viewId: string): Route =>
  route ?? { relationId, viewId, offset: 0 };
const sameRoute = (a: Route | undefined, b: Route | undefined, id: string, viewId: string) =>
  JSON.stringify(routeValue(a, id, viewId)) === JSON.stringify(routeValue(b, id, viewId));
const sameStoredRoute = (a: Route | undefined, b: Route | undefined) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const routesOf = (document: NativeDesignDocument, viewId: string) =>
  new Map(
    (document.layout.relations ?? [])
      .filter((route) => route.viewId === viewId)
      .map((route) => [route.relationId, route]),
  );

/** Geometry and structural identity are separate so ordinary moves can be corrected once. */
export function nativeRelationArrangeSignature(state: NativeRelationArrangeState) {
  const tables = (state.document.tables ?? []).map((table) => table.id).sort();
  const relations = (state.document.tableRelations ?? [])
    .map((relation) => [
      relation.id,
      relation.sourceTableId,
      relation.targetTableId,
      relation.scope,
      relation.physical?.sourceColumnIds,
      relation.physical?.targetColumnIds,
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const nodes = state.scene.nodes
    .map((node) => [node.objectId, node.width, node.height])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const labels = state.scene.relations
    .map((item) => [item.relation.id, nativeRelationLabelWidth(item.label)])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const positions = state.scene.nodes
    .map((node) => [node.objectId, node.x, node.y])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return {
    scope: `${state.snapshot.project.id}:${state.snapshot.project.databaseRevision}:${state.userId ?? ''}:${state.viewId}:${state.mode}:${state.eligible}`,
    structure: JSON.stringify([tables, relations, state.scene.relations.map((r) => r.relation.id)]),
    size: JSON.stringify([nodes, labels]),
    positions: JSON.stringify(positions),
  };
}

export function nativeRelationArrangeInput(state: NativeRelationArrangeState): ArrangeInput {
  const tables = new Set((state.document.tables ?? []).map((table) => table.id));
  return {
    tables: state.scene.nodes
      .filter((node) => tables.has(node.objectId))
      .map((node) => ({
        id: node.objectId,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
      })),
    notes: state.scene.nodes
      .filter((node) => !tables.has(node.objectId))
      .map((node) => ({
        id: node.objectId,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
      })),
    relations: state.scene.relations.map((item) => ({
      id: item.relation.id,
      sourceTableId: item.relation.sourceTableId,
      targetTableId: item.relation.targetTableId,
      labelWidth: nativeRelationLabelWidth(item.label),
    })),
  };
}

export function nativeRelationArrangeInvalidation(
  initial: ReturnType<typeof nativeRelationArrangeSignature>,
  state: NativeRelationArrangeState,
): NativeRelationArrangeStatus['reason'] | null {
  const current = nativeRelationArrangeSignature(state);
  if (current.scope !== initial.scope) return 'scope';
  if (current.structure !== initial.structure) return 'structure';
  if (current.size !== initial.size) return 'size';
  return null;
}

/** A moved card takes the normal route geometry path once at the latest positions. */
export function nativeRelationArrangeLayouts(
  state: NativeRelationArrangeState,
  routes: readonly ArrangedRoute[],
  moved: boolean,
): Route[] {
  const viewId = state.scene.viewId;
  const nodes = new Map(state.scene.nodes.map((node) => [node.objectId, node]));
  const relations = new Map(state.scene.relations.map((item) => [item.relation.id, item]));
  const existing = routesOf(state.document, viewId);
  if (routes.length !== relations.size) throw Error('relation.auto-arrange-structure');
  return routes.map((result, lane) => {
    const item = relations.get(result.relationId);
    if (!item) throw Error('relation.auto-arrange-structure');
    const source = nodes.get(item.relation.sourceTableId);
    const target = nodes.get(item.relation.targetTableId);
    if (!source || !target) throw Error('relation.auto-arrange-structure');
    const old = existing.get(result.relationId);
    const route = relationLayoutSchema.parse({
      relationId: result.relationId,
      viewId,
      offset: old?.offset ?? 0,
      sourceAnchor: result.sourceAnchor,
      targetAnchor: result.targetAnchor,
      waypoints: result.waypoints,
    });
    if (!moved) return route;
    const obstacles = state.scene.nodes.filter((node) => node !== source && node !== target);
    const points = relationGeometry(
      source,
      target,
      nativeRelationLabelWidth(item.label),
      lane,
      route.offset,
      undefined,
      obstacles,
      route,
    ).points;
    if (
      points.length < 2 ||
      obstacles.some((box) =>
        points.slice(1).some((point, index) => segmentCrossesBounds(points[index]!, point, box)),
      )
    )
      throw Error('relation.auto-arrange-no-valid-route');
    return relationLayoutSchema.parse({ ...route, waypoints: points.slice(1, -1) });
  });
}

export function nativeRelationArrangeBatch(
  state: NativeRelationArrangeState,
  layouts: readonly Route[],
) {
  const current = routesOf(state.document, state.scene.viewId);
  const changed = layouts.filter(
    (route) => !sameRoute(current.get(route.relationId), route, route.relationId, route.viewId),
  );
  const routes = changed.map(({ viewId: _viewId, ...route }) => route);
  if (
    routes.length > MAX_BATCH_RELATION_LAYOUTS ||
    routes.reduce((total, route) => total + (route.waypoints?.length ?? 0), 0) >
      MAX_BATCH_RELATION_WAYPOINTS ||
    new TextEncoder().encode(
      JSON.stringify({ type: 'batch_upsert_relation_layouts', viewId: state.scene.viewId, routes }),
    ).byteLength > MAX_BATCH_RELATION_LAYOUT_BYTES
  )
    throw Error('relation.auto-arrange-limit');
  return {
    type: 'batch_upsert_relation_layouts' as const,
    viewId: state.scene.viewId,
    routes,
  };
}

interface Job {
  id: string;
  worker: WorkerLike;
  initial: ReturnType<typeof nativeRelationArrangeSignature>;
  before: Map<string, Route | undefined>;
  result?: readonly Route[];
  saveGeneration: number;
  retryCount: number;
  operationId?: string;
  rejectedVersion?: number;
  applied?: Map<string, Route>;
  startSequence: number;
  cancelRequested?: boolean;
  cancelInFlight?: boolean;
  crowdedTableIds?: string[];
  rebaseTimer?: ReturnType<typeof setTimeout>;
  verificationTimer?: ReturnType<typeof setTimeout>;
  verification?: { state: NativeRelationArrangeState; after: Map<string, Route> };
}
type SaveReceipt = { operationId: string; completion: Promise<boolean> };
type ArrangeSave = (
  commands: Parameters<NativeEditorSave>[0],
  expected: Parameters<NativeEditorSave>[1],
) => Promise<boolean> | SaveReceipt;
export function createNativeRelationArrangeController(options: {
  getState: () => NativeRelationArrangeState;
  onStatus: (status: NativeRelationArrangeStatus) => void;
  save: ArrangeSave;
  onReload?: () => void;
  createWorker?: () => WorkerLike;
  cancelSave?: typeof cancelNativeSaveIntent;
  readStatus?: typeof readOperationStatus;
  storage?: MarkerStorage;
}) {
  const storage = options.storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
  let job: Job | null = null;
  let disposed = false;
  let status: NativeRelationArrangeStatus = { phase: 'idle', canUndo: false };
  let undo: UndoMarker | null = null;
  let pendingHistoryUndo = false;
  let recoveryRequested = false;
  let recoveryInFlight = false;
  let nextRecoveryAt = 0;
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  const emit = (next: NativeRelationArrangeStatus) => {
    if (disposed) return;
    status = next;
    options.onStatus(next);
  };
  const invalidate = (reason: NonNullable<NativeRelationArrangeStatus['reason']>) => {
    job?.worker.terminate();
    if (job?.rebaseTimer) clearTimeout(job.rebaseTimer);
    if (job?.verificationTimer) clearTimeout(job.verificationTimer);
    job = null;
    emit({ phase: 'invalidated', reason, canUndo: false });
  };
  const update = () => {
    if (
      !job &&
      !pendingHistoryUndo &&
      !recoveryRequested &&
      Date.now() >= nextRecoveryAt &&
      storage
    ) {
      const state = options.getState();
      if (state.userId) {
        try {
          const recovered = readUndoMarker(storage, state.userId, state.snapshot.project.id);
          if (recovered) {
            undo = recovered;
            emit({ phase: 'saving', canUndo: false });
            recoveryRequested = true;
            void recoverMarkedUndo(recovered, state);
          }
        } catch {
          recoveryRequested = true;
          emit({ phase: 'failed', reason: 'save', canUndo: false });
        }
      }
    }
    if (job && status.phase === 'computing') {
      const reason = nativeRelationArrangeInvalidation(job.initial, options.getState());
      if (reason) invalidate(reason);
    }
    if (job?.rejectedVersion !== undefined) {
      const current = options.getState();
      if (current.snapshot.project.version > job.rejectedVersion) {
        const pending = job;
        delete pending.rejectedVersion;
        if (pending.rebaseTimer) clearTimeout(pending.rebaseTimer);
        delete pending.rebaseTimer;
        void retryRejected(pending, current).catch(() => {
          if (job === pending) {
            job = null;
            emit({ phase: 'failed', reason: 'save', canUndo: false });
          }
        });
      }
    }
    if (pendingHistoryUndo && undo && options.getState().snapshot.sequence > undo.startSequence) {
      pendingHistoryUndo = false;
      void performHistoryUndo();
    }
  };
  const verifyAccepted = async (currentJob: Job) => {
    const pending = currentJob.verification;
    if (!pending || !currentJob.operationId || !pending.state.userId) return;
    let actual: 'accepted' | 'rejected' | null;
    try {
      actual = await (options.readStatus ?? readOperationStatus)(
        pending.state.userId,
        pending.state.snapshot.project.id,
        currentJob.operationId,
      );
    } catch {
      actual = null;
    }
    if (disposed || job !== currentJob) return;
    if (actual === null) {
      emit({ phase: 'offline', canUndo: false, canCancel: true });
      if (currentJob.verificationTimer) clearTimeout(currentJob.verificationTimer);
      currentJob.verificationTimer = setTimeout(() => void verifyAccepted(currentJob), 4000);
      return;
    }
    delete currentJob.verification;
    if (currentJob.verificationTimer) clearTimeout(currentJob.verificationTimer);
    delete currentJob.verificationTimer;
    job = null;
    if (actual === 'rejected') {
      if (storage && pending.state.userId)
        clearUndoMarker(
          storage,
          pending.state.userId,
          pending.state.snapshot.project.id,
          currentJob.operationId,
        );
      emit({
        phase: currentJob.cancelRequested ? 'cancelled' : 'saved',
        canUndo: false,
      });
      return;
    }
    undo = {
      viewId: pending.state.scene.viewId,
      operationId: currentJob.operationId,
      after: pending.after,
      startSequence: currentJob.startSequence,
    };
    if (currentJob.cancelRequested) {
      pendingHistoryUndo = true;
      emit({ phase: 'saving', canUndo: false });
      options.onReload?.();
      update();
    } else emit({ phase: 'saved', canUndo: true });
  };
  const recoverMarkedUndo = async (marker: UndoMarker, state: NativeRelationArrangeState) => {
    if (!state.userId || !storage || recoveryInFlight) return;
    recoveryInFlight = true;
    try {
      if (marker.historyOperationId) {
        const historyStatus = await (options.readStatus ?? readOperationStatus)(
          state.userId,
          state.snapshot.project.id,
          marker.historyOperationId,
        );
        if (historyStatus === 'accepted') {
          clearUndoMarker(storage, state.userId, state.snapshot.project.id, marker.operationId);
          undo = null;
          recoveryRequested = false;
          emit({ phase: 'saved', reason: 'undo', canUndo: false });
          options.onReload?.();
          return;
        }
        if (historyStatus === 'rejected') {
          delete marker.historyOperationId;
          storeUndoMarker(storage, state.userId, state.snapshot.project.id, marker);
        }
      }
      const result = await (options.cancelSave ?? cancelNativeSaveIntent)(
        state.userId,
        state.snapshot.project.id,
        marker.operationId,
      );
      if (disposed || undo?.operationId !== marker.operationId) return;
      if (result?.status === 'rejected') {
        clearUndoMarker(storage, state.userId, state.snapshot.project.id, marker.operationId);
        undo = null;
        recoveryRequested = false;
        emit({ phase: 'cancelled', reason: 'cancel', canUndo: false });
      } else if (result?.status === 'accepted') {
        pendingHistoryUndo = true;
        options.onReload?.();
        update();
      } else scheduleRecoveryRetry();
    } catch {
      if (!disposed) scheduleRecoveryRetry();
    } finally {
      recoveryInFlight = false;
    }
  };
  const scheduleRecoveryRetry = () => {
    recoveryRequested = false;
    nextRecoveryAt = Date.now() + 4000;
    emit({ phase: 'offline', canUndo: false, canCancel: true });
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      if (!disposed) update();
    }, 4000);
  };
  const retryRejected = async (currentJob: Job, state: NativeRelationArrangeState) => {
    const reason = nativeRelationArrangeInvalidation(currentJob.initial, state);
    if (reason) return invalidate(reason);
    if (state.snapshot.sourceDocument.schemaVersion !== 2) return invalidate('structure');
    const confirmed = routesOf(state.snapshot.sourceDocument, state.scene.viewId);
    if ([...currentJob.before].some(([id, before]) => !sameStoredRoute(before, confirmed.get(id))))
      return invalidate('route');
    currentJob.retryCount++;
    currentJob.before = new Map([...currentJob.before.keys()].map((id) => [id, confirmed.get(id)]));
    await persist(currentJob, currentJob.result ?? []);
  };
  const persist = async (currentJob: Job, layouts: readonly Route[]) => {
    const state = options.getState();
    const reason = nativeRelationArrangeInvalidation(currentJob.initial, state);
    if (reason) return invalidate(reason);
    const current = routesOf(state.document, state.scene.viewId);
    for (const [id, before] of currentJob.before)
      if (!sameStoredRoute(before, current.get(id))) return invalidate('route');
    let corrected: Route[];
    let command: ReturnType<typeof nativeRelationArrangeBatch>;
    try {
      corrected = nativeRelationArrangeLayouts(
        state,
        layouts.map((route) => ({
          relationId: route.relationId,
          sourceAnchor: route.sourceAnchor!,
          targetAnchor: route.targetAnchor!,
          waypoints: route.waypoints ?? [],
        })),
        nativeRelationArrangeSignature(state).positions !== currentJob.initial.positions,
      );
      command = nativeRelationArrangeBatch(state, corrected);
    } catch (error) {
      emit({
        phase: 'failed',
        reason: error instanceof Error && error.message.endsWith('limit') ? 'limit' : 'space',
        canUndo: false,
      });
      job = null;
      return;
    }
    if (!command.routes.length) {
      job = null;
      emit({ phase: 'saved', canUndo: false });
      return;
    }
    const generation = ++currentJob.saveGeneration;
    const changedIds = new Set(command.routes.map((route) => route.relationId));
    const after = new Map(
      corrected
        .filter((route) => changedIds.has(route.relationId))
        .map((route) => [route.relationId, route]),
    );
    currentJob.applied = after;
    // Undo must wait for this attempt's ACK, including a rebased second attempt.
    currentJob.startSequence = state.snapshot.sequence;
    emit({
      phase: 'saving',
      ...(currentJob.retryCount ? { progress: 'retrying' as const } : {}),
      canUndo: false,
    });
    const submitted = options.save([command], {
      version: state.snapshot.project.version,
      sequence: state.snapshot.sequence,
      databaseRevision: state.snapshot.project.databaseRevision,
    });
    const receipt: SaveReceipt | null = 'operationId' in submitted ? submitted : null;
    if (receipt) {
      currentJob.operationId = receipt.operationId;
      emit({
        phase: 'saving',
        ...(currentJob.retryCount ? { progress: 'retrying' as const } : {}),
        canUndo: false,
        canCancel: true,
      });
    }
    const accepted = await (receipt?.completion ?? submitted);
    if (disposed || job !== currentJob || generation !== currentJob.saveGeneration) return;
    if (accepted && receipt && state.userId) {
      currentJob.verification = { state, after };
      await verifyAccepted(currentJob);
      return;
    }
    if (currentJob.cancelRequested) {
      job = null;
      if (storage && state.userId && currentJob.operationId)
        clearUndoMarker(storage, state.userId, state.snapshot.project.id, currentJob.operationId);
      emit({ phase: 'cancelled', reason: 'cancel', canUndo: false });
      return;
    }
    if (accepted) {
      undo = currentJob.operationId
        ? {
            viewId: state.scene.viewId,
            operationId: currentJob.operationId,
            after,
            startSequence: currentJob.startSequence,
          }
        : null;
      job = null;
      emit({
        phase: 'saved',
        canUndo: !!undo,
        ...(currentJob.crowdedTableIds?.length
          ? { crowdedTableIds: currentJob.crowdedTableIds }
          : {}),
      });
      return;
    }
    const latest = options.getState();
    if (currentJob.retryCount === 0) {
      currentJob.rejectedVersion = state.snapshot.project.version;
      currentJob.rebaseTimer = setTimeout(() => {
        if (job === currentJob && currentJob.rejectedVersion !== undefined) {
          job = null;
          emit({ phase: 'failed', reason: 'save', canUndo: false });
        }
      }, 10000);
      emit({ phase: 'saving', progress: 'retrying', canUndo: false, canCancel: true });
      if (latest.snapshot.project.version > state.snapshot.project.version) {
        delete currentJob.rejectedVersion;
        clearTimeout(currentJob.rebaseTimer);
        delete currentJob.rebaseTimer;
        await retryRejected(currentJob, latest);
      }
      return;
    }
    job = null;
    emit({ phase: 'failed', reason: 'save', canUndo: false });
  };
  const start = () => {
    if (disposed || job) return;
    const state = options.getState();
    if (storage && state.userId) {
      try {
        if (readUndoMarker(storage, state.userId, state.snapshot.project.id)) {
          update();
          return;
        }
      } catch {
        recoveryRequested = true;
        emit({ phase: 'failed', reason: 'save', canUndo: false });
        return;
      }
    }
    if (!state.eligible || state.scene.viewId === 'overview') {
      emit({ phase: 'invalidated', reason: 'scope', canUndo: false });
      return;
    }
    const initial = nativeRelationArrangeSignature(state);
    const existing = routesOf(state.document, state.scene.viewId);
    const before = new Map(
      state.scene.relations.map((item) => [item.relation.id, existing.get(item.relation.id)]),
    );
    const worker =
      options.createWorker?.() ??
      new Worker(new URL('./native-relation-auto-arrange.worker.ts', import.meta.url), {
        type: 'module',
      });
    const currentJob: Job = {
      id: nativeDurableId(),
      worker,
      initial,
      before,
      saveGeneration: 0,
      retryCount: 0,
      startSequence: state.snapshot.sequence,
    };
    job = currentJob;
    undo = null;
    emit({ phase: 'computing', progress: 'preparing', canUndo: false, canCancel: true });
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (job !== currentJob || event.data.jobId !== currentJob.id) return;
      const message = event.data;
      if (message.type === 'progress') {
        emit({ phase: 'computing', progress: message.phase, canUndo: false, canCancel: true });
        return;
      }
      worker.terminate();
      const latest = options.getState();
      const reason = nativeRelationArrangeInvalidation(initial, latest);
      if (reason) return invalidate(reason);
      if (message.type === 'error' || !message.result.ok) {
        job = null;
        emit({
          phase: 'failed',
          reason:
            message.type === 'result' && message.result.ok === false
              ? message.result.error.code === 'no-valid-route'
                ? 'space'
                : message.result.error.code === 'search-limit'
                  ? 'compute-limit'
                  : 'structure'
              : 'save',
          canUndo: false,
        });
        return;
      }
      currentJob.crowdedTableIds = message.result.metrics.crowdedTableIds;
      emit({ phase: 'computing', progress: 'applying', canUndo: false, canCancel: true });
      try {
        const layouts = nativeRelationArrangeLayouts(latest, message.result.routes, false);
        currentJob.result = layouts;
        void persist(currentJob, layouts).catch(() => {
          if (job === currentJob) {
            job = null;
            emit({ phase: 'failed', reason: 'save', canUndo: false });
          }
        });
      } catch {
        job = null;
        emit({ phase: 'failed', reason: 'space', canUndo: false });
      }
    };
    worker.onerror = () => {
      if (job !== currentJob) return;
      worker.terminate();
      job = null;
      emit({ phase: 'failed', reason: 'save', canUndo: false });
    };
    worker.postMessage({ jobId: currentJob.id, input: nativeRelationArrangeInput(state) });
  };
  const cancel = () => {
    if (!job) {
      if (undo && status.phase === 'offline') {
        nextRecoveryAt = 0;
        update();
      }
      return;
    }
    if (status.phase === 'computing') {
      job.worker.terminate();
      job = null;
      emit({ phase: 'cancelled', reason: 'cancel', canUndo: false });
      return;
    }
    if ((status.phase !== 'saving' && status.phase !== 'offline') || job.cancelInFlight) return;
    const currentJob = job;
    const operationId = currentJob.operationId;
    if (!operationId) return;
    const state = options.getState();
    if (!state.userId) return;
    if (!storage) {
      emit({ phase: 'failed', reason: 'save', canUndo: false });
      return;
    }
    try {
      storeUndoMarker(storage, state.userId, state.snapshot.project.id, {
        viewId: state.scene.viewId,
        operationId,
        after: currentJob.applied ?? new Map(),
        startSequence: currentJob.startSequence,
      });
    } catch {
      emit({ phase: 'failed', reason: 'save', canUndo: false });
      return;
    }
    currentJob.cancelRequested = true;
    currentJob.cancelInFlight = true;
    if (currentJob.rebaseTimer) clearTimeout(currentJob.rebaseTimer);
    void (options.cancelSave ?? cancelNativeSaveIntent)(
      state.userId,
      state.snapshot.project.id,
      operationId,
    )
      .then((result) => {
        if (job !== currentJob) return;
        job = null;
        if (!result) {
          emit({ phase: 'offline', canUndo: false, canCancel: true });
        } else if (result.status === 'rejected') {
          clearUndoMarker(storage, state.userId!, state.snapshot.project.id, operationId);
          undo = null;
          emit({ phase: 'cancelled', reason: 'cancel', canUndo: false });
        } else {
          undo = {
            viewId: state.scene.viewId,
            operationId,
            after: currentJob.applied ?? new Map(),
            startSequence: currentJob.startSequence,
          };
          pendingHistoryUndo = true;
          emit({ phase: 'saving', canUndo: false });
          options.onReload?.();
          update();
        }
      })
      .catch((error) => {
        if (job === currentJob) {
          currentJob.cancelInFlight = false;
          emit({
            phase:
              error instanceof Error && error.message === 'native.transmission-busy'
                ? 'saving'
                : 'offline',
            canUndo: false,
            canCancel: true,
          });
        }
      });
  };
  const performHistoryUndo = async () => {
    if (!undo || job) return;
    const state = options.getState();
    const target = undo;
    if (state.scene.viewId !== target.viewId) {
      pendingHistoryUndo = false;
      return invalidate('scope');
    }
    const current = routesOf(state.document, target.viewId);
    if (
      [...target.after].some(([id, route]) => !sameRoute(route, current.get(id), id, target.viewId))
    ) {
      pendingHistoryUndo = false;
      if (storage && state.userId)
        clearUndoMarker(storage, state.userId, state.snapshot.project.id, target.operationId);
      undo = null;
      return invalidate('route');
    }
    if (!state.userId) return invalidate('scope');
    if (state.snapshot.sequence <= target.startSequence) {
      pendingHistoryUndo = true;
      emit({ phase: 'saving', canUndo: false });
      return;
    }
    emit({ phase: 'saving', canUndo: false });
    try {
      const previous = await loadNativeHistoryPending(state.userId, state.snapshot.project.id);
      if (target.historyOperationId) {
        const historyStatus = await (options.readStatus ?? readOperationStatus)(
          state.userId,
          state.snapshot.project.id,
          target.historyOperationId,
        );
        if (historyStatus === 'accepted') {
          if (storage)
            clearUndoMarker(storage, state.userId, state.snapshot.project.id, target.operationId);
          undo = null;
          emit({ phase: 'saved', reason: 'undo', canUndo: false });
          options.onReload?.();
          return;
        }
        if (historyStatus === null && previous?.request.operationId !== target.historyOperationId)
          throw Error('relation.auto-arrange-undo-unconfirmed');
        if (historyStatus === 'rejected') {
          delete target.historyOperationId;
          if (storage) storeUndoMarker(storage, state.userId, state.snapshot.project.id, target);
        }
      }
      const pending =
        previous?.sourceOperationId === target.operationId && previous.command === 'undo'
          ? previous
          : await stageNativeHistory(state.userId, state.snapshot, target.operationId, 'undo');
      target.historyOperationId = pending.request.operationId;
      if (storage) storeUndoMarker(storage, state.userId, state.snapshot.project.id, target);
      const output = await sendNativeHistory(pending);
      if (output.result.status === 'accepted') {
        if (storage)
          clearUndoMarker(storage, state.userId, state.snapshot.project.id, target.operationId);
        undo = null;
        options.onReload?.();
      }
      emit(
        output.result.status === 'accepted'
          ? { phase: 'saved', reason: 'undo', canUndo: false }
          : { phase: 'failed', reason: 'route', canUndo: true },
      );
    } catch {
      emit({ phase: 'failed', reason: 'save', canUndo: true });
    }
  };
  const undoLatest = () => {
    if (!undo) return;
    const state = options.getState();
    if (!state.userId || !storage) {
      emit({ phase: 'failed', reason: 'save', canUndo: true });
      return;
    }
    try {
      storeUndoMarker(storage, state.userId, state.snapshot.project.id, undo);
    } catch {
      emit({ phase: 'failed', reason: 'save', canUndo: true });
      return;
    }
    pendingHistoryUndo = true;
    emit({ phase: 'saving', canUndo: false });
    update();
  };
  const dispose = () => {
    disposed = true;
    job?.worker.terminate();
    if (job?.rebaseTimer) clearTimeout(job.rebaseTimer);
    if (recoveryTimer) clearTimeout(recoveryTimer);
    if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
    job = null;
  };
  const onOnline = () => {
    nextRecoveryAt = 0;
    update();
  };
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
  return { start, cancel, undo: undoLatest, update, dispose, getStatus: () => status };
}
