import { z } from 'zod';
import {
  syncOperationInputSchema,
  syncOperationResultSchema,
  syncEventSchema,
} from './legacy-sync.js';
import {
  nativeSyncOperationInputSchema,
  nativeSyncOperationResultSchema,
  nativeSyncEventSchema,
} from './native-sync.js';

/** Readers for stored transport history; never substitute these for Native write validation. */
export const syncOperationInputReadSchema = z.union([
  syncOperationInputSchema,
  nativeSyncOperationInputSchema,
]);
export const syncOperationResultReadSchema = z.union([
  syncOperationResultSchema,
  nativeSyncOperationResultSchema,
]);
export const syncEventReadSchema = z.union([syncEventSchema, nativeSyncEventSchema]);
export type SyncOperationInputRead = z.infer<typeof syncOperationInputReadSchema>;
export type SyncOperationResultRead = z.infer<typeof syncOperationResultReadSchema>;
export type SyncEventRead = z.infer<typeof syncEventReadSchema>;
