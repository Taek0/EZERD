import {
  MAX_BATCH_RELATION_LAYOUT_BYTES,
  MAX_BATCH_RELATION_LAYOUTS,
  MAX_BATCH_RELATION_WAYPOINTS,
  relationLayoutSchema,
  type ProjectDocumentState,
} from '@ezerd/contracts';
import { arrangeRelationRoutes, relationGeometry, segmentCrossesBounds } from '@ezerd/model';
import type { NativeDesignDocument, RelationLayout } from '@ezerd/model';
import type { nativeCanvasScene } from './NativeERDCanvas.js';
import { nativeRelationLabelWidth } from './native-canvas-style.js';
import type { NativeEditorSave } from './native-editor-form.js';
import { nativeDurableId } from './native-durable-queue.js';
import { cancelNativeSaveIntent } from './native-save-intents.js';
import { sendNativeHistory, stageNativeHistory } from './native-history.js';

type Scene = ReturnType<typeof nativeCanvasScene>;
type ArrangeInput = Parameters<typeof arrangeRelationRoutes>[0];
type ArrangeResult = ReturnType<typeof arrangeRelationRoutes>;
type ArrangedRoute = Extract<ArrangeResult, { ok: true }>['routes'][number];
type Route = RelationLayout;

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
  reason?: 'scope' | 'structure' | 'size' | 'route' | 'space' | 'save' | 'limit' | 'cancel';
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
  crowdedTableIds?: string[];
  rebaseTimer?: ReturnType<typeof setTimeout>;
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
}) {
  let job: Job | null = null;
  let disposed = false;
  let status: NativeRelationArrangeStatus = { phase: 'idle', canUndo: false };
  let undo: {
    viewId: string;
    operationId: string;
    after: Map<string, Route>;
    startSequence: number;
  } | null = null;
  let pendingHistoryUndo = false;
  const emit = (next: NativeRelationArrangeStatus) => {
    if (disposed) return;
    status = next;
    options.onStatus(next);
  };
  const invalidate = (reason: NonNullable<NativeRelationArrangeStatus['reason']>) => {
    job?.worker.terminate();
    if (job?.rebaseTimer) clearTimeout(job.rebaseTimer);
    job = null;
    emit({ phase: 'invalidated', reason, canUndo: false });
  };
  const update = () => {
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
    emit({
      phase: 'saving',
      ...(currentJob.retryCount ? { progress: 'retrying' as const } : {}),
      canUndo: false,
      canCancel: true,
    });
    const submitted = options.save([command], {
      version: state.snapshot.project.version,
      sequence: state.snapshot.sequence,
      databaseRevision: state.snapshot.project.databaseRevision,
    });
    const receipt: SaveReceipt | null = 'operationId' in submitted ? submitted : null;
    if (receipt) currentJob.operationId = receipt.operationId;
    const accepted = await (receipt?.completion ?? submitted);
    if (disposed || job !== currentJob || generation !== currentJob.saveGeneration) return;
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
            message.type === 'result' &&
            message.result.ok === false &&
            message.result.error.code === 'no-valid-route'
              ? 'space'
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
    if (!job) return;
    if (status.phase === 'computing') {
      job.worker.terminate();
      job = null;
      emit({ phase: 'cancelled', reason: 'cancel', canUndo: false });
      return;
    }
    if (status.phase !== 'saving' || job.cancelRequested) return;
    const currentJob = job;
    const operationId = currentJob.operationId;
    if (!operationId) return;
    const state = options.getState();
    if (!state.userId) return;
    currentJob.cancelRequested = true;
    if (currentJob.rebaseTimer) clearTimeout(currentJob.rebaseTimer);
    currentJob.saveGeneration++;
    void cancelNativeSaveIntent(state.userId, state.snapshot.project.id, operationId)
      .then((result) => {
        if (job !== currentJob) return;
        job = null;
        if (!result) {
          emit({ phase: 'failed', reason: 'save', canUndo: false });
        } else if (result.status === 'rejected') {
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
      .catch(() => {
        if (job === currentJob) {
          currentJob.cancelRequested = false;
          emit({ phase: 'offline', canUndo: false, canCancel: true });
        }
      });
  };
  const performHistoryUndo = async () => {
    if (!undo || job) return;
    const state = options.getState();
    const target = undo;
    if (state.scene.viewId !== target.viewId) return invalidate('scope');
    const current = routesOf(state.document, target.viewId);
    if (
      [...target.after].some(([id, route]) => !sameRoute(route, current.get(id), id, target.viewId))
    )
      return invalidate('route');
    if (!state.userId) return invalidate('scope');
    if (state.snapshot.sequence <= target.startSequence) {
      pendingHistoryUndo = true;
      emit({ phase: 'saving', canUndo: false });
      return;
    }
    undo = null;
    emit({ phase: 'saving', canUndo: false });
    try {
      const pending = await stageNativeHistory(
        state.userId,
        state.snapshot,
        target.operationId,
        'undo',
      );
      const output = await sendNativeHistory(pending);
      if (output.result.status === 'accepted') options.onReload?.();
      emit(
        output.result.status === 'accepted'
          ? { phase: 'saved', canUndo: false }
          : { phase: 'failed', reason: 'route', canUndo: false },
      );
    } catch {
      emit({ phase: 'failed', reason: 'save', canUndo: false });
    }
  };
  const undoLatest = () => {
    if (!undo) return;
    pendingHistoryUndo = true;
    update();
  };
  const dispose = () => {
    disposed = true;
    job?.worker.terminate();
    if (job?.rebaseTimer) clearTimeout(job.rebaseTimer);
    job = null;
  };
  return { start, cancel, undo: undoLatest, update, dispose, getStatus: () => status };
}
