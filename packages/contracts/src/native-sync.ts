import { z } from 'zod';
import { databaseContextSchema, databaseRevisionSchema } from './database-state.js';
import { nativeStoredDesignDocumentSchema } from './native-document.js';
import { databaseIssueSchema } from './project-document-state.js';
import {
  syncBaselineSchema,
  syncChangeSchema,
  syncOperationInputFields,
  syncOperationResultFields,
} from './sync-base.js';
const sameContext = (
  left: { kind: string; profileId: string },
  right: { kind: string; profileId: string },
) => left.kind === right.kind && left.profileId === right.profileId;

/** Native wire contracts are independent of the historical v1 envelopes. */
export const nativeSyncOperationInputSchema = z
  .strictObject({
    ...syncOperationInputFields,
    baselineDocument: nativeStoredDesignDocumentSchema,
    document: nativeStoredDesignDocumentSchema,
    protocolVersion: z.literal(2),
    database: databaseContextSchema,
    databaseRevision: databaseRevisionSchema,
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
export const nativeSyncOperationResultSchema = z
  .strictObject({
    ...syncOperationResultFields,
    nextBaseline: nativeSyncBaselineSchema,
    document: nativeStoredDesignDocumentSchema.optional(),
    delta: z
      .strictObject({
        baseSequence: z.number().int().nonnegative(),
        projectVersion: z.number().int().nonnegative(),
        changes: z.array(syncChangeSchema).max(1000),
      })
      .optional(),
    protocolVersion: z.literal(2),
    database: databaseContextSchema,
    databaseRevision: databaseRevisionSchema,
    issues: z.array(databaseIssueSchema).max(1000).optional(),
  })
  .superRefine((result, ctx) => {
    if (
      result.delta &&
      (result.status !== 'accepted' ||
        result.delta.baseSequence + 1 !== result.sequence ||
        result.delta.changes.length !== result.changedPaths.length ||
        result.delta.changes.some((change, i) => change.path !== result.changedPaths[i]) ||
        new Set(result.changedPaths).size !== result.changedPaths.length)
    )
      ctx.addIssue({ code: 'custom', path: ['delta'], message: 'sync.delta-invalid' });
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
export type NativeSyncOperationInput = z.infer<typeof nativeSyncOperationInputSchema>;
export type NativeSyncOperationResult = z.infer<typeof nativeSyncOperationResultSchema>;
export type NativeSyncEvent = z.infer<typeof nativeSyncEventSchema>;
export const nativeSyncSnapshotSchema = z
  .strictObject({
    protocolVersion: z.literal(2),
    projectVersion: z.number().int().nonnegative(),
    sequence: z.number().int().nonnegative(),
    baselineId: z.uuid(),
    baselineIssuedAt: z.iso.datetime(),
    database: databaseContextSchema,
    databaseRevision: databaseRevisionSchema,
    document: nativeStoredDesignDocumentSchema,
  })
  .superRefine((value, ctx) => {
    if (!sameContext(value.database, value.document.database))
      ctx.addIssue({
        code: 'custom',
        path: ['document', 'database'],
        message: 'database.context-mismatch',
      });
  });
export type NativeSyncSnapshot = z.infer<typeof nativeSyncSnapshotSchema>;

/** Opt-in transport optimization; old clients and historical ACKs keep their original envelope. */
export function nativeAckResponse(
  result: NativeSyncOperationResult,
  compact = false,
): NativeSyncOperationResult {
  const { delta, ...full } = result;
  if (!compact || !delta || result.status !== 'accepted') return full;
  const { document: _document, ...ack } = full;
  return { ...ack, delta };
}
