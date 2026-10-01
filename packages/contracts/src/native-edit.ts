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
