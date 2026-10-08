import { z } from 'zod';
import { nativeSyncOperationResultSchema } from './native-sync.js';
import { syncOperationResultReadSchema } from './sync-read.js';
import type { NativeSyncOperationResult } from './native-sync.js';
import type { SyncOperationResultRead } from './sync-read.js';

// Baseline + candidate + diff may duplicate the bounded design. Match the REST envelope budget.
export const MAX_NATIVE_CANCELLATION_BYTES = 8_000_000;
export const NATIVE_CANCELLATION_REASON = 'operation.cancelled';

const identity = z
  .object({ operationId: z.uuid(), groupId: z.uuid(), clientId: z.uuid() })
  .passthrough();
// Retain the exact request even if a structural parser would omit a special object key.
const rawIdentity = z.custom<z.infer<typeof identity>>(
  (value) => identity.safeParse(value).success,
  'native.cancellation-identity-invalid',
);
const upgradeIdentity = z.object({ operationId: z.uuid(), clientId: z.uuid() }).passthrough();
const rawUpgradeIdentity = z.custom<z.infer<typeof upgradeIdentity>>(
  (value) => upgradeIdentity.safeParse(value).success,
  'native.cancellation-identity-invalid',
);
const envelope = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('protocol-operation'), request: rawIdentity }),
  z.strictObject({ kind: z.literal('native-command'), request: rawIdentity }),
  z.strictObject({ kind: z.literal('native-upgrade'), request: rawUpgradeIdentity }),
  z.strictObject({
    kind: z.literal('history-undo'),
    sourceOperationId: z.uuid(),
    request: rawIdentity,
  }),
  z.strictObject({
    kind: z.literal('history-restore'),
    sourceOperationId: z.uuid(),
    request: rawIdentity,
  }),
]);

/** Read only the common identity, never today's complete operation/command schema. */
export const nativeCancellationInputSchema = envelope.superRefine((value, ctx) => {
  try {
    const text = JSON.stringify(value, (_key, item: unknown) => {
      if (
        item === undefined ||
        typeof item === 'bigint' ||
        typeof item === 'function' ||
        typeof item === 'symbol' ||
        (typeof item === 'number' && !Number.isFinite(item))
      )
        throw new Error('Non-JSON input');
      return item;
    });
    let bytes = 0;
    for (const character of text) {
      const point = character.codePointAt(0)!;
      bytes += point <= 127 ? 1 : point <= 2047 ? 2 : point <= 65535 ? 3 : 4;
      if (bytes > MAX_NATIVE_CANCELLATION_BYTES) {
        ctx.addIssue({ code: 'custom', message: 'native.cancellation-size-limit' });
        return;
      }
    }
  } catch {
    ctx.addIssue({ code: 'custom', message: 'native.cancellation-json-invalid' });
  }
});
export type NativeCancellationInput = z.infer<typeof nativeCancellationInputSchema>;

/** Validate known protocol versions while retaining historical strings and fields verbatim. */
const rawRecordedAck = z.custom<SyncOperationResultRead>(
  (value) => syncOperationResultReadSchema.safeParse(value).success,
  'native.cancellation-result-invalid',
);
const rawCancelledAck = z.custom<NativeSyncOperationResult>((value) => {
  const checked = nativeSyncOperationResultSchema.safeParse(value);
  return (
    checked.success &&
    checked.data.status === 'rejected' &&
    checked.data.reasonCode === NATIVE_CANCELLATION_REASON &&
    checked.data.reason === NATIVE_CANCELLATION_REASON &&
    checked.data.changedPaths.length === 0 &&
    !Object.hasOwn(value as object, 'document')
  );
}, 'native.cancellation-result-invalid');

/** Only a durable cancellation ACK is proof of cancellation; a prior accepted ACK stays recorded. */
export const nativeCancellationResultSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('recorded'), result: rawRecordedAck }),
  z.strictObject({ outcome: z.literal('cancelled'), result: rawCancelledAck }),
]);
export type NativeCancellationResult = z.infer<typeof nativeCancellationResultSchema>;
