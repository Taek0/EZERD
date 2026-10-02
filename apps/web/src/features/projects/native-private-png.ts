import {
  nativeStoredDesignDocumentSchema,
  projectDocumentStateSchema,
  personalStateSnapshotSchema,
  type ProjectDocumentState,
} from '@ezerd/contracts';
import {
  sharedDocument,
  reconcilePersonalState,
  mergeStoredPersonalState,
  diffSharedDocument,
  requestFingerprint,
} from '@ezerd/model';
import { request } from '../../shared/api/client.js';
import { captureNativeActorApi } from './native-actor-api.js';
import { nativePrivateSnapshotSchema } from './native-private-canvas.js';
import { getNativeDurableQueue, type NativeDurableQueue } from './native-durable-queue.js';
import { exportNativeCanvasPng } from './native-canvas-png.js';
import type { nativeCanvasScene } from './NativeERDCanvas.js';
export type NativePngPersonalSnapshot = ReturnType<typeof personalStateSnapshotSchema.parse>;

/** Only server-saved inputs belong here; callers cannot supply a preview document or camera. */
export function prepareNativePrivatePng(
  snapshot: ProjectDocumentState,
  rawPersonal: NativePngPersonalSnapshot,
  viewId: string,
) {
  if (snapshot.sourceDocument.schemaVersion !== 2) throw Error('document.native-upgrade-required');
  const personal = nativePrivateSnapshotSchema.parse(rawPersonal),
    shared = sharedDocument(snapshot.sourceDocument);
  if (
    personal.projectVersion !== snapshot.project.version ||
    personal.syncSequence !== snapshot.sequence ||
    personal.databaseRevision !== snapshot.project.databaseRevision ||
    shared.database.kind !== snapshot.project.databaseKind ||
    shared.database.profileId !== snapshot.project.databaseProfileId
  )
    throw Error('canvas.export-context-changed');
  const state = reconcilePersonalState(shared, personal.state),
    view = state.views.find((view) => view.id === viewId);
  if (!view) throw Error('canvas.export-private-view-unavailable');
  const document = nativeStoredDesignDocumentSchema.parse(mergeStoredPersonalState(shared, state));
  if (diffSharedDocument(shared, document).length) throw Error('canvas.shared-mutation-forbidden');
  return { document, personal, view };
}

type Queue = Pick<NativeDurableQueue, 'read' | 'state'>;
export interface NativePrivatePngOptions {
  /** Explicit injected transports are actor-bound, as in the existing personal helpers. */
  api?: typeof request;
  queue?: Queue;
}

/** Read-only export: observes writer leases; never claims, sends, acknowledges or discards one. */
export async function exportNativePrivateCanvasPng(
  userId: string,
  rawSnapshot: ProjectDocumentState,
  rawPersonal: NativePngPersonalSnapshot,
  viewId: string,
  mode: 'physical' | 'logical',
  sceneFor: typeof nativeCanvasScene,
  isCurrent: () => boolean,
  options: NativePrivatePngOptions = {},
) {
  const api = options.api ?? request,
    actorApi = captureNativeActorApi(userId, api); // Pin credentials before the first queue/API await.
  const session = api === request ? globalThis.sessionStorage.getItem('ezerd.sync.session') : null;
  const snapshot = projectDocumentStateSchema.parse(rawSnapshot),
    prepared = prepareNativePrivatePng(snapshot, rawPersonal, viewId),
    projectId = snapshot.project.id,
    queue = options.queue ?? getNativeDurableQueue(),
    sourceFingerprint = requestFingerprint(sharedDocument(prepared.document)),
    personalFingerprint = requestFingerprint(prepared.personal.state);
  let queueFingerprint: string | undefined, queueState: 'empty' | 'pending' | undefined;
  function guard() {
    if (!isCurrent()) throw Error('canvas.export-context-changed');
    if (api === request) {
      if (globalThis.sessionStorage.getItem('ezerd.sync.session') !== session)
        throw Error('native.actor-session-changed');
      captureNativeActorApi(userId); // Expiry and actor checks after awaits, including before click.
    }
    if (queueState !== undefined && queue.state(userId, projectId) !== queueState)
      throw Error('canvas.export-private-writer-changed');
  }
  async function checkQueue() {
    guard();
    const row = await queue.read(userId, projectId);
    guard();
    if (row && (row.userId !== userId || row.projectId !== projectId))
      throw Error('canvas.export-private-writer-changed');
    const status = queue.state(userId, projectId);
    if (status !== 'empty' && status !== 'pending')
      throw Error('canvas.export-private-writer-changed');
    const fingerprint = requestFingerprint(row);
    if (queueFingerprint !== undefined && fingerprint !== queueFingerprint)
      throw Error('canvas.export-private-writer-changed');
    queueFingerprint = fingerprint;
    queueState = status;
  }
  async function checkSavedHeads() {
    await checkQueue();
    const parsedLatest = projectDocumentStateSchema.safeParse(
      await actorApi(`/api/projects/${encodeURIComponent(projectId)}/document-state`, {
        cache: 'no-store',
      }),
    );
    guard();
    if (!parsedLatest.success) throw Error('canvas.export-context-changed');
    const latest = parsedLatest.data;
    if (
      latest.project.id !== projectId ||
      latest.sourceDocument.schemaVersion !== 2 ||
      latest.project.version !== snapshot.project.version ||
      latest.sequence !== snapshot.sequence ||
      latest.project.databaseRevision !== snapshot.project.databaseRevision ||
      latest.project.databaseKind !== snapshot.project.databaseKind ||
      latest.project.databaseProfileId !== snapshot.project.databaseProfileId ||
      requestFingerprint(sharedDocument(latest.sourceDocument)) !== sourceFingerprint
    )
      throw Error('canvas.export-context-changed');
    const personal = nativePrivateSnapshotSchema.parse(
      await actorApi(`/api/projects/${encodeURIComponent(projectId)}/personal-state`, {
        cache: 'no-store',
      }),
    );
    guard();
    // Same counters are insufficient if a stale or malformed transport returns other content.
    if (
      personal.version !== prepared.personal.version ||
      requestFingerprint(personal.state) !== personalFingerprint
    )
      throw Error('canvas.export-personal-changed');
    prepareNativePrivatePng(latest, personal, viewId);
    await checkQueue();
  }
  guard();
  await checkSavedHeads();
  const scene = sceneFor(prepared.document, viewId, mode),
    current = () => {
      try {
        guard();
        return true;
      } catch {
        return false;
      }
    };
  return exportNativeCanvasPng(
    prepared.document,
    scene,
    mode,
    `${snapshot.project.name}-${prepared.view.name}`,
    current,
    checkSavedHeads, // Runs after decode/toBlob and before any file URL/download is created.
  );
}
