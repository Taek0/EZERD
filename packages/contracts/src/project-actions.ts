import { z } from 'zod';
export const deleteProjectSchema = z.strictObject({ expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) });
