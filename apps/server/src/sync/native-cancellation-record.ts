import { ConflictException, ForbiddenException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  nativeCancellationResultSchema,
  nativeHistoryCommandResultSchema,
  type NativeHistoryCommandResult,
} from '@ezerd/contracts';
import type { DatabaseService } from '../db/database.service.js';
import { nativeRequestCancellations } from '../db/schema.js';

type Executor =
  DatabaseService['db'] | Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];
type Identity = { actorId: string; fingerprint: string; actorMismatchCode?: string };

/** Call only after access and ordinary ledger lookup. It grants no baseline/write authority. */
export async function readNativeCancellation(
  tx: Executor,
  projectId: string,
  operationId: string,
  identity?: Identity,
  kinds?: readonly string[],
) {
  const [row] = await tx
    .select()
    .from(nativeRequestCancellations)
    .where(
      and(
        eq(nativeRequestCancellations.projectId, projectId),
        eq(nativeRequestCancellations.operationId, operationId),
      ),
    );
  if (!row) return undefined;
  if (identity) {
    if (row.actorId !== identity.actorId && identity.actorMismatchCode)
      throw new ForbiddenException({ code: identity.actorMismatchCode });
    if (row.actorId !== identity.actorId || row.fingerprint !== identity.fingerprint)
      throw new ConflictException({ code: 'sync.replay-mismatch' });
  }
  if (kinds && !kinds.includes(row.kind))
    throw new ConflictException({ code: 'sync.replay-mismatch' });
  const checked = nativeCancellationResultSchema.safeParse({
    outcome: 'cancelled',
    result: row.result,
  });
  if (
    !checked.success ||
    checked.data.outcome !== 'cancelled' ||
    checked.data.result.operationId.toLowerCase() !== row.operationId.toLowerCase() ||
    checked.data.result.groupId.toLowerCase() !== row.groupId.toLowerCase() ||
    checked.data.result.actor.id.toLowerCase() !== row.actorId.toLowerCase()
  )
    throw new ConflictException({ code: 'sync.protocol-mismatch' });
  return { row, result: structuredClone(checked.data.result) };
}

export async function readNativeHistoryCancellation(
  tx: Executor,
  projectId: string,
  operationId: string,
  actorId: string,
  fingerprint: string,
  command: 'undo' | 'restore',
  sourceOperationId: string,
): Promise<NativeHistoryCommandResult | undefined> {
  const marker = await readNativeCancellation(
    tx,
    projectId,
    operationId,
    { actorId, fingerprint, actorMismatchCode: 'history.replay-actor-mismatch' },
    [`history-${command}`],
  );
  if (!marker) return undefined;
  const output = { ...(marker.row.metadata.nativeHistory as object), result: marker.result };
  const checked = nativeHistoryCommandResultSchema.safeParse(output);
  if (
    !checked.success ||
    checked.data.command !== command ||
    checked.data.sourceOperationId !== sourceOperationId ||
    marker.row.sourceOperationId?.toLowerCase() !== sourceOperationId.toLowerCase() ||
    checked.data.identityMap.length !== 0
  )
    throw new ConflictException({ code: 'sync.replay-mismatch' });
  return structuredClone(output) as NativeHistoryCommandResult;
}
