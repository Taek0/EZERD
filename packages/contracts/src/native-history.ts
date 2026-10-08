import { z } from 'zod';
import {
  databaseContextSchema,
  databaseRevisionSchema,
  projectDatabaseStateSchema,
} from './database-state.js';
import { nativeSyncOperationResultSchema } from './native-sync.js';
import { syncOperationResultReadSchema } from './sync-read.js';
import { syncChangeSchema } from './sync-base.js';

const counter = z.number().int().nonnegative().max(2147483647);
export const nativeHistoryQuerySchema = z.strictObject({
  since: z.coerce.number().int().nonnegative().max(2147483647).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
/** No client before/after/document, identity map or trusted-origin claims. */
export const nativeHistoryCommandSchema = z.strictObject({
  operationId: z.uuid(),
  groupId: z.uuid(),
  clientId: z.uuid(),
  baselineId: z.uuid(),
  baselineIssuedAt: z.iso.datetime(),
  expectedVersion: counter,
  expectedSequence: counter,
  database: databaseContextSchema,
  databaseRevision: databaseRevisionSchema,
});
export type NativeHistoryCommand = z.infer<typeof nativeHistoryCommandSchema>;
/** Local durable request envelope; never used as server authority. */
export const nativeHistoryPendingSchema = z.strictObject({
  userId: z.uuid(),
  projectId: z.uuid(),
  sourceOperationId: z.uuid(),
  command: z.enum(['undo', 'restore']),
  request: nativeHistoryCommandSchema,
});
export type NativeHistoryPending = z.infer<typeof nativeHistoryPendingSchema>;

export const nativeHistoryEntrySchema = z.strictObject({
  operationId: z.uuid(),
  sequence: counter,
  clientId: z.uuid(),
  kind: z.enum(['online', 'reconnect']),
  format: z.enum(['native', 'legacy', 'upgrade']),
  // Validate known versions without trimming/rewriting raw audit evidence.
  result: z.custom<z.infer<typeof syncOperationResultReadSchema>>(
    (value) => syncOperationResultReadSchema.safeParse(value).success,
    'history.result-invalid',
  ),
  changes: z.array(syncChangeSchema).max(1000),
  deletionSnapshot: z.unknown().optional(),
});
export const nativeHistoryPageSchema = z.strictObject({
  protocolVersion: z.literal(2),
  projectId: z.uuid(),
  version: counter,
  sequence: counter,
  database: projectDatabaseStateSchema,
  history: z.array(nativeHistoryEntrySchema).max(100),
  nextSince: counter.nullable(),
});
export type NativeHistoryPage = z.infer<typeof nativeHistoryPageSchema>;
export const nativeHistoryCommandResultSchema = z.strictObject({
  result: nativeSyncOperationResultSchema,
  command: z.enum(['undo', 'restore']),
  sourceOperationId: z.uuid(),
  // Informational server output; never accepted as input authority.
  identityMap: z
    .array(
      z.strictObject({
        kind: z.enum(['entity', 'node']),
        from: z.string().min(1).max(160),
        to: z.uuid(),
      }),
    )
    .max(1000),
});
export type NativeHistoryCommandResult = z.infer<typeof nativeHistoryCommandResultSchema>;
