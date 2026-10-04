import {
  nativeCanvasPersonalPendingSchema,
  nativeEditorDraftSchema,
  type NativeCanvasPersonalPending,
  type ProjectDocumentState,
} from '@ezerd/contracts';
import { requestFingerprint } from '@ezerd/model';
import { request } from '../../shared/api/client.js';
import { captureNativeActorApi } from './native-actor-api.js';
import {
  getNativeDurableQueue,
  type NativeDurablePending,
  type NativeDurableQueue,
} from './native-durable-queue.js';
import { loadNativeEditorDraft } from './native-editor-draft.js';
import {
  nativePrivateSnapshotSchema,
  type NativePrivateSnapshot,
} from './native-private-canvas.js';

export type NativePrivateCASReason =
  | 'personal-version-advanced'
  | 'database-revision-advanced'
  | 'project-version-advanced'
  | 'sequence-advanced';
export interface NativePrivateCASArchive {
  format: 'ezerd.native.private-cas-archive';
  formatVersion: 1;
  outcome: 'cas-precondition-consumed';
  pending: NativeCanvasPersonalPending;
  observed: NativePrivateSnapshot;
  reasons: NativePrivateCASReason[];
  /** This is an IDB transmission fence, not authentication or a server operation ACK. */
  transmissionToken: string;
  observedAt: string;
  capturedDraft?: ReturnType<typeof loadNativeEditorDraft>;
}
export interface NativePrivateCASQueueFence {
  confirmPrivateCASPreconditionConsumed(
    pending: NativeDurablePending,
    token: string,
    guard?: () => void,
  ): Promise<boolean>;
}
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface NativePrivateCASOptions {
  queue?: NativeDurableQueue;
  storage?: Storage;
  api?: typeof request;
  /** Runs inside the claim-fenced mutation too; reject stale actor/project/UI scopes here. */
  assertCurrent?: () => void;
}
const archiveKey = (pending: NativeCanvasPersonalPending) =>
  `ezerd.native.canvas.cas-archive:${JSON.stringify([pending.userId, pending.projectId, pending.revision])}`;
const entry = (pending: NativeCanvasPersonalPending): NativeDurablePending => ({
  kind: 'privateCanvas',
  userId: pending.userId,
  projectId: pending.projectId,
  operationId: pending.revision,
  payload: pending,
});
const queueFor = (options: NativePrivateCASOptions) => options.queue ?? getNativeDurableQueue();
const storageFor = (options: NativePrivateCASOptions) => options.storage ?? globalThis.localStorage;

/** Content differences cannot establish rejection or prevent an in-flight CAS from committing. */
export function inspectNativePrivateCASPrecondition(
  pending: NativeCanvasPersonalPending,
  raw: unknown,
): {
  outcome: 'cas-precondition-consumed' | 'unconfirmed';
  observed: NativePrivateSnapshot;
  reasons: NativePrivateCASReason[];
} {
  pending = nativeCanvasPersonalPendingSchema.parse(pending);
  const observed = nativePrivateSnapshotSchema.parse(raw);
  if (
    observed.databaseRevision < pending.databaseRevision ||
    observed.projectVersion < pending.projectVersion ||
    observed.syncSequence < pending.sequence
  )
    throw Error('native.personal-counter-regressed');
  const reasons: NativePrivateCASReason[] = [];
  if (observed.version > pending.expectedVersion) reasons.push('personal-version-advanced');
  if (observed.databaseRevision > pending.databaseRevision)
    reasons.push('database-revision-advanced');
  if (observed.projectVersion > pending.projectVersion) reasons.push('project-version-advanced');
  if (observed.syncSequence > pending.sequence) reasons.push('sequence-advanced');
  return {
    outcome: reasons.length ? 'cas-precondition-consumed' : 'unconfirmed',
    observed,
    reasons,
  };
}
function assertScope(
  actor: string,
  snapshot: ProjectDocumentState,
  pending: NativeCanvasPersonalPending,
  options: NativePrivateCASOptions,
) {
  if (actor !== pending.userId || snapshot.project.id !== pending.projectId)
    throw Error('native.private-proof-scope-mismatch');
  options.assertCurrent?.();
  if ((options.api ?? request) === request) captureNativeActorApi(actor); // Fresh synchronous actor check inside tx.
}
function fence(queue: NativeDurableQueue): NativePrivateCASQueueFence {
  const candidate = queue as NativeDurableQueue & Partial<NativePrivateCASQueueFence>;
  if (typeof candidate.confirmPrivateCASPreconditionConsumed !== 'function')
    throw Error('native.private-cas-fence-unavailable');
  return {
    confirmPrivateCASPreconditionConsumed: (pending, token, guard) =>
      candidate.confirmPrivateCASPreconditionConsumed!(pending, token, guard),
  };
}
export function loadNativePrivateCASArchive(
  pending: NativeCanvasPersonalPending,
  storage: Storage = localStorage,
): NativePrivateCASArchive | null {
  const raw = storage.getItem(archiveKey(pending));
  if (raw === null) return null;
  const value = JSON.parse(raw) as Partial<NativePrivateCASArchive>;
  if (
    value.format !== 'ezerd.native.private-cas-archive' ||
    value.formatVersion !== 1 ||
    value.outcome !== 'cas-precondition-consumed' ||
    typeof value.observedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.observedAt))
  )
    throw Error('native.private-archive-invalid');
  const original = nativeCanvasPersonalPendingSchema.parse(value.pending);
  if (requestFingerprint(original) !== requestFingerprint(pending))
    throw Error('native.private-archive-mismatch');
  const token = nativeCanvasPersonalPendingSchema.shape.revision.parse(value.transmissionToken);
  const inspected = inspectNativePrivateCASPrecondition(original, value.observed);
  if (
    inspected.outcome !== 'cas-precondition-consumed' ||
    requestFingerprint(inspected.reasons) !== requestFingerprint(value.reasons)
  )
    throw Error('native.private-archive-invalid');
  const capturedDraft = value.capturedDraft
    ? nativeEditorDraftSchema.parse(value.capturedDraft)
    : undefined;
  if (
    capturedDraft &&
    (capturedDraft.userId !== pending.userId ||
      capturedDraft.projectId !== pending.projectId ||
      capturedDraft.key !== pending.editorDraft?.key ||
      capturedDraft.revision !== pending.editorDraft?.revision)
  )
    throw Error('native.private-archive-invalid');
  return {
    format: 'ezerd.native.private-cas-archive',
    formatVersion: 1,
    outcome: 'cas-precondition-consumed',
    pending: original,
    observed: inspected.observed,
    reasons: inspected.reasons,
    transmissionToken: token,
    observedAt: value.observedAt,
    ...(capturedDraft ? { capturedDraft } : {}),
  };
}
/** A real actor-bound GET plus an active exact-token tx fence establishes this distinct outcome. */
export async function verifyNativePrivateCASPrecondition(
  actor: string,
  snapshot: ProjectDocumentState,
  rawPending: NativeCanvasPersonalPending,
  options: NativePrivateCASOptions = {},
): Promise<
  | { outcome: 'unconfirmed' }
  | { outcome: 'cas-precondition-consumed'; archive: NativePrivateCASArchive }
> {
  const pending = nativeCanvasPersonalPendingSchema.parse(rawPending),
    actorApi = captureNativeActorApi(actor, options.api ?? request);
  assertScope(actor, snapshot, pending, options);
  const queue = queueFor(options),
    authority = fence(queue),
    durable = entry(pending);
  const row = await queue.read(actor, pending.projectId);
  if (
    !row ||
    row.kind !== 'privateCanvas' ||
    row.operationId !== pending.revision ||
    row.userId !== actor ||
    row.projectId !== pending.projectId ||
    requestFingerprint(row.payload) !== requestFingerprint(pending)
  )
    throw Error('native.pending-changed');
  const token = await queue.beginTransmission(durable);
  const heartbeat = setInterval(() => {
    void queue.renewTransmission(durable, token).catch(() => {});
  }, 5000);
  try {
    const raw = await actorApi(
      `/api/projects/${encodeURIComponent(pending.projectId)}/personal-state`,
      { cache: 'no-store' },
    );
    assertScope(actor, snapshot, pending, options);
    const inspected = inspectNativePrivateCASPrecondition(pending, raw);
    if (inspected.outcome === 'unconfirmed') return { outcome: 'unconfirmed' };
    const captured = pending.editorDraft
      ? loadNativeEditorDraft(
          actor,
          pending.projectId,
          pending.editorDraft.key,
          storageFor(options),
        )
      : null;
    const archive: NativePrivateCASArchive = {
      format: 'ezerd.native.private-cas-archive',
      formatVersion: 1,
      outcome: 'cas-precondition-consumed',
      pending,
      observed: inspected.observed,
      reasons: inspected.reasons,
      transmissionToken: token,
      observedAt: new Date().toISOString(),
      ...(captured && captured.revision === pending.editorDraft?.revision
        ? { capturedDraft: captured }
        : {}),
    };
    const confirmed = await authority.confirmPrivateCASPreconditionConsumed(durable, token, () => {
      assertScope(actor, snapshot, pending, options);
      loadNativePrivateCASArchive(pending, storageFor(options)); // Never overwrite a different original payload.
      const value = JSON.stringify(archive);
      storageFor(options).setItem(archiveKey(pending), value);
      if (storageFor(options).getItem(archiveKey(pending)) !== value)
        throw Error('native.private-archive-storage-failed');
    });
    if (!confirmed) throw Error('native.private-proof-fence-changed');
    return { outcome: 'cas-precondition-consumed', archive };
  } finally {
    clearInterval(heartbeat);
    await queue.endTransmission(durable, token);
  }
}
/** Explicit local discard only. No request is sent to cancel_native_request or to personal PUT. */
export async function discardArchivedNativePrivateCAS(
  actor: string,
  snapshot: ProjectDocumentState,
  pending: NativeCanvasPersonalPending,
  options: NativePrivateCASOptions = {},
): Promise<NativePrivateCASArchive> {
  pending = nativeCanvasPersonalPendingSchema.parse(pending);
  assertScope(actor, snapshot, pending, options);
  const archive = loadNativePrivateCASArchive(pending, storageFor(options));
  if (!archive) throw Error('native.private-proof-required');
  // An adopted row or a restarted transmission remains uncertain; discard cannot clear it.
  if (!(await queueFor(options).discard(entry(pending)))) throw Error('native.pending-changed');
  return archive;
}
