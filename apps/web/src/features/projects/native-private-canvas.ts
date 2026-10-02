import {
  nativeCanvasPersonalPendingSchema,
  personalStateSnapshotSchema,
  personalStateSchema,
  savePersonalStateSchema,
  type NativeCanvasPersonalPending,
  type ProjectDocumentState,
} from '@ezerd/contracts';
import {
  diffSharedDocument,
  extractPersonalState,
  mergeStoredPersonalState,
  requestFingerprint,
  type NativeDesignDocument,
} from '@ezerd/model';
import { body, request } from '../../shared/api/client.js';
import { captureNativeActorApi } from './native-actor-api.js';
import {
  getNativeDurableQueue,
  nativeDurableId,
  type NativeDurablePending,
  type NativeDurableQueue,
} from './native-durable-queue.js';
import { discardNativeEditorDraft, loadNativeEditorDraft } from './native-editor-draft.js';
import { nativeMemoryDraftFailed } from './native-durable-drafts.js';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type NativePrivateSnapshot = ReturnType<typeof personalStateSnapshotSchema.parse> & {
  databaseRevision: number;
};
/** Reuse contracts, preserving the required revision while the parent connects the new barrel shape. */
export const nativePrivateSnapshotSchema = {
  parse(raw: unknown): NativePrivateSnapshot {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw Error('native.personal-snapshot-invalid');
    const { databaseRevision, ...rest } = raw as Record<string, unknown>;
    if (
      typeof databaseRevision !== 'number' ||
      !Number.isSafeInteger(databaseRevision) ||
      databaseRevision < 0
    )
      throw Error('native.personal-revision-guard-unavailable');
    const parsed = personalStateSnapshotSchema.parse(
      'databaseRevision' in personalStateSnapshotSchema.shape ? raw : rest,
    );
    return { ...parsed, databaseRevision };
  },
};
export interface NativePrivateOptions {
  storage?: Storage;
  queue?: NativeDurableQueue;
}
const key = (userId: string, projectId: string) =>
  `ezerd.native.canvas.personal:${JSON.stringify([userId, projectId])}`;
const storageFor = (options: NativePrivateOptions) => options.storage ?? globalThis.localStorage;
const queueFor = (options: NativePrivateOptions) => options.queue ?? getNativeDurableQueue();
const entry = (pending: NativeCanvasPersonalPending): NativeDurablePending => ({
  userId: pending.userId,
  projectId: pending.projectId,
  operationId: pending.revision,
  kind: 'privateCanvas',
  payload: pending,
});

/** The bundled contract must include the fields the revision-aware REST backend consumes. */
export function nativePrivateCanvasGuardAvailable(): boolean {
  return (
    ['expectedDatabaseRevision', 'expectedProjectVersion', 'expectedSyncSequence'].every(
      (field) => field in savePersonalStateSchema.shape,
    ) && 'databaseRevision' in personalStateSnapshotSchema.shape
  );
}
function parseEntry(row: NativeDurablePending): NativeCanvasPersonalPending {
  const pending = nativeCanvasPersonalPendingSchema.parse(row.payload);
  if (
    row.kind !== 'privateCanvas' ||
    row.userId !== pending.userId ||
    row.projectId !== pending.projectId ||
    row.operationId !== pending.revision ||
    requestFingerprint(pending) !== requestFingerprint(row.payload)
  )
    throw Error('native.pending-invalid');
  return pending;
}
function legacy(userId: string, projectId: string, options: NativePrivateOptions) {
  const raw = storageFor(options).getItem(key(userId, projectId));
  if (raw === null) return null;
  const pending = nativeCanvasPersonalPendingSchema.parse(JSON.parse(raw));
  if (pending.userId !== userId || pending.projectId !== projectId)
    throw Error('native.pending-invalid');
  return pending;
}
function legacyOtherWriters(userId: string, projectId: string, options: NativePrivateOptions) {
  const storage = storageFor(options);
  if (
    storage.getItem(`ezerd.native.pending:${userId}:${projectId}`) !== null ||
    storage.getItem(`ezerd.native.history:${JSON.stringify([userId, projectId])}`) !== null
  )
    throw Error('native.pending-exists');
}
/** Old localStorage requests are adopted as uncertain; no non-atomic storage write is a claim. */
export async function loadNativePrivatePending(
  userId: string,
  projectId: string,
  options: NativePrivateOptions = {},
): Promise<NativeCanvasPersonalPending | null> {
  const queue = queueFor(options),
    old = legacy(userId, projectId, options),
    row = await queue.read(userId, projectId);
  if (old) {
    await queue.claim(entry(old), undefined, true);
    return old;
  }
  return row?.kind === 'privateCanvas' ? parseEntry(row) : null;
}
function context(
  pending: NativeCanvasPersonalPending,
  snapshot: ProjectDocumentState,
  current?: NativePrivateSnapshot,
) {
  if (snapshot.project.id !== pending.projectId) throw Error('native.ack-mismatch');
  if (
    snapshot.sourceDocument.schemaVersion !== 2 ||
    snapshot.project.databaseRevision !== pending.databaseRevision ||
    snapshot.project.version !== pending.projectVersion ||
    snapshot.sequence !== pending.sequence ||
    (current &&
      (current.databaseRevision !== pending.databaseRevision ||
        current.projectVersion !== pending.projectVersion ||
        current.syncSequence !== pending.sequence))
  )
    throw Error('database.context-changed');
}
export async function stageNativePrivateCanvas(
  userId: string,
  snapshot: ProjectDocumentState,
  personal: NativePrivateSnapshot,
  candidate: NativeDesignDocument,
  options: NativePrivateOptions = {},
  editorDraft?: { key: string; revision: string },
): Promise<NativeCanvasPersonalPending> {
  legacyOtherWriters(userId, snapshot.project.id, options);
  if (legacy(userId, snapshot.project.id, options)) throw Error('native.pending-exists');
  if (snapshot.sourceDocument.schemaVersion !== 2) throw Error('document.native-upgrade-required');
  if (snapshot.project.status !== 'active') throw Error('project.read-only');
  const state = personalStateSchema.parse(extractPersonalState(candidate));
  const source = snapshot.sourceDocument;
  if (
    diffSharedDocument(source, mergeStoredPersonalState(source, state)).length ||
    diffSharedDocument(source, candidate).length
  )
    throw Error('canvas.shared-mutation-forbidden');
  const pending = nativeCanvasPersonalPendingSchema.parse({
    userId,
    projectId: snapshot.project.id,
    revision: nativeDurableId(),
    databaseRevision: snapshot.project.databaseRevision,
    projectVersion: snapshot.project.version,
    sequence: snapshot.sequence,
    expectedVersion: personal.version,
    before: personal.state,
    state,
    ...(editorDraft ? { editorDraft } : {}),
  });
  context(pending, snapshot, nativePrivateSnapshotSchema.parse(personal));
  if (requestFingerprint(state) === requestFingerprint(personal.state))
    throw Error('sync.no-changes');
  const guard = () => {
    legacyOtherWriters(userId, pending.projectId, options);
    if (legacy(userId, pending.projectId, options)) throw Error('native.pending-exists');
    if (editorDraft) {
      const draft = loadNativeEditorDraft(
        userId,
        pending.projectId,
        editorDraft.key,
        storageFor(options),
      );
      if (
        nativeMemoryDraftFailed(
          `ezerd.native.editor:${JSON.stringify([userId, pending.projectId, editorDraft.key])}`,
          storageFor(options),
        )
      )
        throw Error('native.draft-storage-failed');
      if (
        !draft ||
        draft.revision !== editorDraft.revision ||
        draft.expected.databaseRevision !== pending.databaseRevision ||
        draft.expected.version !== pending.projectVersion ||
        draft.expected.sequence !== pending.sequence
      )
        throw Error('native.draft-changed');
    }
  };
  guard();
  await queueFor(options).claim(entry(pending), guard);
  return pending;
}
export async function discardNativePrivatePending(
  pending: NativeCanvasPersonalPending,
  options: NativePrivateOptions = {},
): Promise<void> {
  const old = legacy(pending.userId, pending.projectId, options);
  if (old) await queueFor(options).claim(entry(old), undefined, true);
  if (await queueFor(options).discard(entry(pending))) {
    // Adoption is uncertain, so a historical legacy row cannot arrive on this path.
    if (old && requestFingerprint(old) === requestFingerprint(pending))
      storageFor(options).removeItem(key(pending.userId, pending.projectId));
  }
}
async function ensure(pending: NativeCanvasPersonalPending, options: NativePrivateOptions) {
  const row = await queueFor(options).read(pending.userId, pending.projectId);
  if (!row || requestFingerprint(parseEntry(row)) !== requestFingerprint(pending))
    throw Error('native.pending-changed');
}
async function consume(pending: NativeCanvasPersonalPending, options: NativePrivateOptions) {
  const accepted = await queueFor(options).acknowledge(entry(pending), () => {
    if (pending.editorDraft)
      discardNativeEditorDraft(
        pending.userId,
        pending.projectId,
        pending.editorDraft,
        storageFor(options),
      );
    const old = legacy(pending.userId, pending.projectId, options);
    if (old && requestFingerprint(old) === requestFingerprint(pending))
      storageFor(options).removeItem(key(pending.userId, pending.projectId));
  });
  if (!accepted) throw Error('native.pending-changed');
}
const postcondition = (pending: NativeCanvasPersonalPending, current: NativePrivateSnapshot) =>
  current.version === pending.expectedVersion + 1 &&
  requestFingerprint(current.state) === requestFingerprint(pending.state);
/** Fresh sends also preflight the current version-CAS; the local revision is not an idempotency key. */
export function sendNativePrivateCanvas(
  pending: NativeCanvasPersonalPending,
  snapshot: ProjectDocumentState,
  options: NativePrivateOptions = {},
  api: typeof request = request,
): Promise<NativePrivateSnapshot> {
  return recoverNativePrivateCanvas(pending, snapshot, true, options, api);
}
export async function readNativePrivateCanvas(
  userId: string,
  projectId: string,
  api: typeof request = request,
): Promise<NativePrivateSnapshot> {
  const actorApi = captureNativeActorApi(userId, api);
  return nativePrivateSnapshotSchema.parse(
    await actorApi(`/api/projects/${encodeURIComponent(projectId)}/personal-state`, {
      cache: 'no-store',
    }),
  );
}
/** REST has no operation ledger/ETag/idempotency key. Replay only the same version-CAS payload. */
export async function recoverNativePrivateCanvas(
  pending: NativeCanvasPersonalPending,
  snapshot: ProjectDocumentState,
  allowReplay: boolean,
  options: NativePrivateOptions = {},
  api: typeof request = request,
): Promise<NativePrivateSnapshot> {
  const actorApi = captureNativeActorApi(pending.userId, api); // Before the first IDB await.
  if (api === request && !nativePrivateCanvasGuardAvailable())
    throw Error('native.personal-revision-guard-unavailable');
  if (snapshot.project.id !== pending.projectId) throw Error('native.ack-mismatch');
  await loadNativePrivatePending(pending.userId, pending.projectId, options);
  await ensure(pending, options);
  const queue = queueFor(options),
    durable = entry(pending),
    token = await queue.beginTransmission(durable);
  const heartbeat = setInterval(() => {
    void queue.renewTransmission(durable, token).catch(() => {});
  }, 5000);
  const url = `/api/projects/${encodeURIComponent(pending.projectId)}/personal-state`;
  try {
    const current = nativePrivateSnapshotSchema.parse(await actorApi(url, { cache: 'no-store' }));
    // Same postcondition at exactly the next CAS version consumes that precondition.
    // This is observed effect confirmation, never a server operation ACK lookup.
    if (postcondition(pending, current)) {
      await consume(pending, options);
      return current;
    }
    if (!allowReplay || snapshot.project.status !== 'active') throw Error('project.read-only');
    legacyOtherWriters(pending.userId, pending.projectId, options);
    context(pending, snapshot, current);
    if (
      current.version !== pending.expectedVersion ||
      requestFingerprint(current.state) !== requestFingerprint(pending.before)
    )
      throw Error('native.personal-conflict');
    const result = nativePrivateSnapshotSchema.parse(
      await actorApi(
        url,
        body('PUT', {
          expectedVersion: pending.expectedVersion,
          expectedDatabaseRevision: pending.databaseRevision,
          expectedProjectVersion: pending.projectVersion,
          expectedSyncSequence: pending.sequence,
          state: pending.state,
        }),
      ),
    );
    if (
      !postcondition(pending, result) ||
      result.databaseRevision !== pending.databaseRevision ||
      result.projectVersion !== pending.projectVersion ||
      result.syncSequence !== pending.sequence
    )
      throw Error('native.ack-mismatch');
    await consume(pending, options);
    return result;
  } finally {
    clearInterval(heartbeat);
    await queue.endTransmission(durable, token);
  }
}
