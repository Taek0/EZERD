import { z } from 'zod';
import { databaseContextSchema, databaseRevisionSchema } from './database-state.js';
import { nativeStoredDesignDocumentSchema } from './native-document.js';
import {
  syncBaselineSchema,
  syncChangeSchema,
  syncEventSchema,
  syncOperationInputSchema,
  syncOperationResultSchema,
} from './sync.js';
const sameContext = (
  left: { kind: string; profileId: string },
  right: { kind: string; profileId: string },
) => left.kind === right.kind && left.profileId === right.profileId;

/** Additive contracts only: the live v1 endpoint continues rejecting this envelope. */
export const nativeSyncOperationInputSchema = syncOperationInputSchema
  .extend({
    protocolVersion: z.literal(2),
    database: databaseContextSchema,
    databaseRevision: databaseRevisionSchema,
    baselineDocument: nativeStoredDesignDocumentSchema,
    document: nativeStoredDesignDocumentSchema,
  })
  .superRefine((input, ctx) => {
    for (const field of ['baselineDocument', 'document'] as const)
      if (!sameContext(input.database, input[field].database))
        ctx.addIssue({
          code: 'custom',
          path: [field, 'database'],
          message: 'database.context-mismatch',
        });
  });
export const nativeSyncBaselineSchema = syncBaselineSchema.extend({
  databaseRevision: databaseRevisionSchema,
});
export const nativeSyncOperationResultSchema = syncOperationResultSchema
  .extend({
    protocolVersion: z.literal(2),
    database: databaseContextSchema,
    databaseRevision: databaseRevisionSchema,
    nextBaseline: nativeSyncBaselineSchema,
    document: nativeStoredDesignDocumentSchema.optional(),
  })
  .superRefine((result, ctx) => {
    if (result.document && !sameContext(result.database, result.document.database))
      ctx.addIssue({
        code: 'custom',
        path: ['document', 'database'],
        message: 'database.context-mismatch',
      });
    if (
      result.status === 'accepted' &&
      result.nextBaseline.databaseRevision !== result.databaseRevision
    )
      ctx.addIssue({
        code: 'custom',
        path: ['nextBaseline', 'databaseRevision'],
        message: 'database.context-mismatch',
      });
  });
export const nativeSyncEventSchema = nativeSyncOperationResultSchema.safeExtend({
  changes: z.array(syncChangeSchema).max(1000),
});
export const syncOperationInputReadSchema = z.union([
  syncOperationInputSchema,
  nativeSyncOperationInputSchema,
]);
export const syncOperationResultReadSchema = z.union([
  syncOperationResultSchema,
  nativeSyncOperationResultSchema,
]);
export const syncEventReadSchema = z.union([syncEventSchema, nativeSyncEventSchema]);
export type NativeSyncOperationInput = z.infer<typeof nativeSyncOperationInputSchema>;
export type NativeSyncOperationResult = z.infer<typeof nativeSyncOperationResultSchema>;
export type NativeSyncEvent = z.infer<typeof nativeSyncEventSchema>;
export type SyncOperationInputRead = z.infer<typeof syncOperationInputReadSchema>;
export type SyncOperationResultRead = z.infer<typeof syncOperationResultReadSchema>;
export type SyncEventRead = z.infer<typeof syncEventReadSchema>;
