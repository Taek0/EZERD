import { z } from 'zod';
export const deleteThreadSchema = z.strictObject({ expectedUpdatedAt: z.iso.datetime() });
