import { z } from 'zod';
import {
  syncChangeSchema,
  syncHistoryEntrySchema,
  syncOperationResultSchema,
} from '@ezerd/contracts';
import type { SyncHistoryEntry, SyncOperationResult } from '@ezerd/contracts';

export const historyInputSchema = z.strictObject({
  projectId: z.uuid(),
  since: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.number().int().min(1).max(100).default(50),
  includeChanges: z.boolean().default(false),
  includeDocument: z.boolean().default(false),
  includeDeletionSnapshot: z.boolean().default(false),
});
export const compactHistoryEntrySchema = syncHistoryEntrySchema
  .omit({ changes: true, document: true, deletionSnapshot: true })
  .extend({
    changes: z.array(syncChangeSchema).optional(),
    document: syncOperationResultSchema.shape.document,
    deletionSnapshot: z.unknown().optional(),
  });
export const historyPageSchema = z.strictObject({
  history: z.array(compactHistoryEntrySchema),
  nextSince: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
});

export function projectHistory(
  page: { history: SyncHistoryEntry[]; nextSince: number | null },
  options: Pick<
    z.infer<typeof historyInputSchema>,
    'includeChanges' | 'includeDocument' | 'includeDeletionSnapshot'
  >,
) {
  return historyPageSchema.parse({
    history: page.history.map((entry) => {
      const { changes, document, deletionSnapshot, ...summary } = entry;
      return {
        ...summary,
        ...(options.includeChanges ? { changes } : {}),
        ...(options.includeDocument && document ? { document } : {}),
        ...(options.includeDeletionSnapshot && deletionSnapshot ? { deletionSnapshot } : {}),
      };
    }),
    nextSince: page.nextSince,
  });
}

export function operationResult(result: SyncOperationResult, includeDocument: boolean) {
  if (includeDocument) return syncOperationResultSchema.parse(result);
  const { document: _document, ...summary } = result;
  return syncOperationResultSchema.parse(summary);
}
