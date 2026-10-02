import { z } from 'zod';
import { databaseRevisionSchema } from './database-state.js';
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const upgradeProjectDocumentSchema = z.strictObject({
  operationId: z.uuid(),
  clientId: z.uuid(),
  expectedVersion: sequence,
  expectedSequence: sequence,
  expectedDatabaseRevision: databaseRevisionSchema,
});
