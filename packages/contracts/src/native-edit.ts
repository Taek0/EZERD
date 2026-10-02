import { z } from 'zod';
import { nativeEditorCommandSchema, nativeEditorDraftRefSchema } from './native-editor-command.js';
export * from './native-editor-command.js';

/** Local editor and MCP inputs share strict patches; storage still validates the full candidate. */
export const nativeWebCommandSchema = nativeEditorCommandSchema;
export const nativePendingSaveSchema = z.strictObject({
  userId: z.uuid(),
  projectId: z.uuid(),
  editorDraft: nativeEditorDraftRefSchema.optional(),
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
