import { z } from 'zod';
import {
  rawDesignDocumentSchema,
  rawStoredDesignDocumentSchema,
  storedDesignDocumentSchema,
} from './workspace.js';
import {
  syncOperationInputFields,
  syncOperationResultFields,
  syncEventFields,
  syncBaselineSchema,
} from './sync-base.js';

/** Historical v1 envelopes, retained for decoding; the v1 editing APIs are retired. */
export const syncOperationInputSchema = z.strictObject({
  ...syncOperationInputFields,
  baselineDocument: rawStoredDesignDocumentSchema,
  document: rawDesignDocumentSchema,
});
export const syncOperationResultSchema = z.strictObject({
  ...syncOperationResultFields,
  nextBaseline: syncBaselineSchema,
  document: storedDesignDocumentSchema.optional(),
});
export const syncEventSchema = z.strictObject({
  ...syncEventFields,
  nextBaseline: syncBaselineSchema,
  document: storedDesignDocumentSchema.optional(),
});
export type SyncOperationInput = z.infer<typeof syncOperationInputSchema>;
export type SyncOperationResult = z.infer<typeof syncOperationResultSchema>;
export type SyncEvent = z.infer<typeof syncEventSchema>;
