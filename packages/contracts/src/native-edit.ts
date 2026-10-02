import { z } from 'zod';
import type { NativeColumnPatch, NativeTablePatch } from '@ezerd/model';
import { nativeStoredColumnSchema, nativeStoredTableSchema } from './native-document.js';

/** Local editor and MCP inputs share strict patches; storage still validates the full candidate. */
export const nativeColumnPatchSchema = z
  .strictObject({
    scope: nativeStoredColumnSchema.shape.scope.optional(),
    logical: nativeStoredColumnSchema.shape.logical.partial().strict().optional(),
    physical: nativeStoredColumnSchema.shape.physical.partial().optional(),
    customProperties: nativeStoredColumnSchema.shape.customProperties.optional(),
  })
  .transform((value) => value as NativeColumnPatch);
export const nativeTablePatchSchema = z
  .strictObject({
    scope: nativeStoredTableSchema.shape.scope.optional(),
    color: nativeStoredTableSchema.shape.color,
    logical: nativeStoredTableSchema.shape.logical.partial().strict().optional(),
    physical: nativeStoredTableSchema.shape.physical.partial().optional(),
    customProperties: nativeStoredTableSchema.shape.customProperties.optional(),
    canvasDisplay: nativeStoredTableSchema.shape.canvasDisplay,
  })
  .transform((value) => value as NativeTablePatch);
export const nativeWebCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('patch_column'),
    id: z.string().min(1).max(160),
    patch: nativeColumnPatchSchema,
  }),
  z.strictObject({
    type: z.literal('patch_table'),
    id: z.string().min(1).max(160),
    patch: nativeTablePatchSchema,
  }),
]);
export const nativePendingSaveSchema = z.strictObject({
  userId: z.uuid(),
  projectId: z.uuid(),
  request: z.strictObject({
    operationId: z.uuid(),
    groupId: z.uuid(),
    clientId: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    expectedSequence: z.number().int().nonnegative(),
    expectedDatabaseRevision: z.number().int().nonnegative(),
    commands: z.array(nativeWebCommandSchema).min(1).max(100),
    includeDocument: z.literal(true),
  }),
});
const nativePropertyValuesSchema = z.strictObject({
  physicalName: z.string().max(120),
  comment: z.string().max(10000),
  logicalName: z.string().max(120),
  definition: z.string().max(10000),
});
export const nativePropertyDraftSchema = z.strictObject({
  userId: z.uuid(),
  projectId: z.uuid(),
  objectId: z.string().min(1).max(160),
  kind: z.enum(['table', 'column']),
  expected: z.strictObject({
    version: z.number().int().nonnegative(),
    sequence: z.number().int().nonnegative(),
    databaseRevision: z.number().int().nonnegative(),
  }),
  values: nativePropertyValuesSchema,
  before: nativePropertyValuesSchema,
});
