import { z } from 'zod';
import { databaseRevisionSchema, databaseContextSchema } from './database-state.js';
import {
  rawDesignDocumentSchema,
  rawStoredDesignDocumentSchema,
  storedDesignDocumentSchema,
} from './workspace.js';

const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** JSON-pointer-like paths. Segments are object ids or property names, never array indexes. */
export const syncPathSchema = z
  .string()
  .min(1)
  .max(1000)
  .refine(
    (value) =>
      value.startsWith('/') && value !== '/' && !value.endsWith('/') && !value.includes('//'),
    '변경 경로가 올바르지 않습니다.',
  );

export const syncChangeSchema = z
  .strictObject({
    path: syncPathSchema,
    before: z.unknown(),
    after: z.unknown(),
    beforeExists: z.boolean().optional(),
    afterExists: z.boolean().optional(),
  })
  .refine(
    (change) => Object.hasOwn(change, 'before') && Object.hasOwn(change, 'after'),
    '변경 전후 값이 필요합니다.',
  );

export const syncOperationInputSchema = z.strictObject({
  operationId: z.uuid(),
  groupId: z.uuid(),
  clientId: z.uuid(),
  baselineId: z.uuid(),
  baseSequence: sequence,
  baselineIssuedAt: z.iso.datetime(),
  databaseRevision: databaseRevisionSchema.optional(),
  kind: z.enum(['online', 'reconnect']),
  dependencyPaths: z.array(syncPathSchema).max(1000).default([]),
  changes: z
    .array(syncChangeSchema)
    .min(1)
    .max(1000)
    .refine(
      (changes) => new Set(changes.map((change) => change.path)).size === changes.length,
      '한 작업에 같은 변경 경로가 중복되었습니다.',
    ),
  baselineDocument: rawStoredDesignDocumentSchema,
  document: rawDesignDocumentSchema,
});

export const syncActorSchema = z.strictObject({
  id: z.uuid(),
  username: z.string().trim().min(1).max(40),
  color: z
    .string()
    .length(7)
    .regex(/^#[0-9a-f]{6}$/i),
});

export const syncOperationStatusSchema = z.enum(['accepted', 'rejected']);

export const syncBaselineSchema = z.strictObject({
  baselineId: z.uuid(),
  baseSequence: sequence,
  baselineIssuedAt: z.iso.datetime(),
  databaseRevision: databaseRevisionSchema.optional(),
});

export const syncOperationResultSchema = z.strictObject({
  operationId: z.uuid(),
  groupId: z.uuid(),
  sequence,
  status: syncOperationStatusSchema,
  reason: z.string().max(10000).optional(),
  reasonCode: z.string().optional(),
  database: databaseContextSchema.optional(),
  databaseRevision: databaseRevisionSchema.optional(),
  actor: syncActorSchema,
  changedPaths: z.array(syncPathSchema).max(1000),
  createdAt: z.iso.datetime(),
  nextBaseline: syncBaselineSchema,
  document: storedDesignDocumentSchema.optional(),
});

export const syncEventSchema = z.strictObject({
  operationId: z.uuid(),
  groupId: z.uuid(),
  sequence,
  status: syncOperationStatusSchema,
  reason: z.string().max(10000).optional(),
  reasonCode: z.string().optional(),
  database: databaseContextSchema.optional(),
  databaseRevision: databaseRevisionSchema.optional(),
  actor: syncActorSchema,
  changes: z.array(syncChangeSchema).max(1000),
  changedPaths: z.array(syncPathSchema).max(1000),
  createdAt: z.iso.datetime(),
  nextBaseline: syncBaselineSchema,
  document: storedDesignDocumentSchema.optional(),
});

export type SyncPath = z.infer<typeof syncPathSchema>;
export type SyncChange = z.infer<typeof syncChangeSchema>;
export type SyncOperationInput = z.infer<typeof syncOperationInputSchema>;
export type SyncActor = z.infer<typeof syncActorSchema>;
export type SyncOperationStatus = z.infer<typeof syncOperationStatusSchema>;
export type SyncBaseline = z.infer<typeof syncBaselineSchema>;
export type SyncOperationResult = z.infer<typeof syncOperationResultSchema>;
export type SyncEvent = z.infer<typeof syncEventSchema>;
