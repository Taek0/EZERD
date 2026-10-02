import {
  nativeCancellationInputSchema,
  nativeCancellationResultSchema,
  nativePendingSaveSchema,
  nativeHistoryPendingSchema,
  upgradeProjectDocumentSchema,
  nativeSyncOperationResultSchema,
  type NativeSyncOperationResult,
} from '@ezerd/contracts';
import { requestFingerprint } from '@ezerd/model';
import { body, request } from '../../shared/api/client.js';
import { captureNativeActorApi } from './native-actor-api.js';
import { getNativeDurableQueue, type NativeDurablePending } from './native-durable-queue.js';

/** Cancel exactly the durable request, without inventing a new operation or authority. */
export async function cancelNativeDurableEntry(
  entry: NativeDurablePending,
  options: { api?: typeof request; cleanup?: (result: NativeSyncOperationResult) => void } = {},
): Promise<NativeSyncOperationResult> {
  const api = captureNativeActorApi(entry.userId, options.api ?? request),
    queue = getNativeDurableQueue();
  let raw: unknown, groupId: string, expectedSequence: number, revision: number;
  if (entry.kind === 'commands') {
    const pending = nativePendingSaveSchema.parse(entry.payload);
    if (
      pending.userId !== entry.userId ||
      pending.projectId !== entry.projectId ||
      pending.request.operationId !== entry.operationId
    )
      throw Error('native.cancellation-pending-invalid');
    raw = { kind: 'native-command', request: pending.request };
    groupId = pending.request.groupId;
    expectedSequence = pending.request.expectedSequence;
    revision = pending.request.expectedDatabaseRevision;
  } else if (entry.kind === 'history') {
    const pending = nativeHistoryPendingSchema.parse(entry.payload);
    if (
      pending.userId !== entry.userId ||
      pending.projectId !== entry.projectId ||
      pending.request.operationId !== entry.operationId
    )
      throw Error('native.cancellation-pending-invalid');
    raw = {
      kind: `history-${pending.command}`,
      sourceOperationId: pending.sourceOperationId,
      request: pending.request,
    };
    groupId = pending.request.groupId;
    expectedSequence = pending.request.expectedSequence;
    revision = pending.request.databaseRevision;
  } else if (entry.kind === 'upgrade') {
    const pending = entry.payload as { userId?: unknown; projectId?: unknown; input?: unknown };
    const input = upgradeProjectDocumentSchema.parse(pending?.input);
    if (
      pending.userId !== entry.userId ||
      pending.projectId !== entry.projectId ||
      input.operationId !== entry.operationId
    )
      throw Error('native.cancellation-pending-invalid');
    raw = { kind: 'native-upgrade', request: input };
    groupId = input.operationId;
    expectedSequence = input.expectedSequence;
    revision = input.expectedDatabaseRevision + 1;
  } else throw Error('native.cancellation-kind-not-supported');
  const input = nativeCancellationInputSchema.parse(raw);
  const stored = await queue.read(entry.userId, entry.projectId);
  if (requestFingerprint(stored) !== requestFingerprint(entry))
    throw Error('native.pending-changed');
  const token = await queue.beginTransmission(entry),
    heartbeat = setInterval(() => {
      void queue.renewTransmission(entry, token).catch(() => {});
    }, 5000);
  try {
    const output = nativeCancellationResultSchema.parse(
      await api(`/api/projects/${entry.projectId}/native-sync/cancel`, body('POST', input)),
    );
    const result = nativeSyncOperationResultSchema.parse(output.result);
    if (
      result.operationId !== entry.operationId ||
      result.groupId !== groupId ||
      result.actor.id !== entry.userId ||
      (result.status === 'accepted' &&
        (result.databaseRevision !== revision ||
          result.sequence <= expectedSequence ||
          (entry.kind === 'upgrade' && result.sequence !== expectedSequence + 1)))
    )
      throw Error('native.cancellation-ack-invalid');
    await queue.acknowledge(entry, () => {
      options.cleanup?.(result);
    });
    return result;
  } finally {
    clearInterval(heartbeat);
    await queue.endTransmission(entry, token);
  }
}
