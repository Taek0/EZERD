import { z } from 'zod';
import type { DesignDocument, NativeDesignDocument } from '@ezerd/model';
import { projectSchema } from './workspace.js';
import {
  databaseContextSchema,
  databaseProfileIdSchema,
  databaseRevisionSchema,
} from './database-state.js';
import { designDocumentReadSchema, nativeStoredDesignDocumentSchema } from './native-document.js';

/** Validate the source shape while keeping raw aliases/identifiers, rather than returning a preview. */
export const rawDesignDocumentReadSchema = z.custom<DesignDocument | NativeDesignDocument>(
  (value) => designDocumentReadSchema.safeParse(value).success,
  'document.source-invalid',
);
export const databaseIssueSchema = z.strictObject({
  code: z.string().max(160),
  category: z.enum(['unsupported', 'invalid', 'incomplete', 'environment']),
  severity: z.enum(['error', 'warning']),
  objectId: z.string().max(160).nullable(),
  path: z.string().max(1000),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});
const migrationIssueSchema = z.strictObject({
  code: z.enum([
    'legacy.type-unresolved',
    'legacy.default-unresolved',
    'legacy.namespace-unresolved',
    'legacy.enum-context-mismatch',
  ]),
  objectId: z.string().max(160),
  path: z.string().max(1000),
});
export const projectDocumentStateSchema = z
  .strictObject({
    protocolVersion: z.literal(2),
    project: projectSchema.extend({
      databaseProfileId: databaseProfileIdSchema,
      databaseRevision: databaseRevisionSchema,
    }),
    sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    sourceDocument: rawDesignDocumentReadSchema,
    native: z.discriminatedUnion('status', [
      z.strictObject({
        status: z.literal('available'),
        document: nativeStoredDesignDocumentSchema,
        migrationIssues: z.array(migrationIssueSchema),
        issues: z.array(databaseIssueSchema),
      }),
      z.strictObject({
        status: z.literal('unavailable'),
        code: z.enum(['database.context-changed', 'document.native-preview-invalid']),
      }),
    ]),
  })
  .superRefine((state, ctx) => {
    const context = {
      kind: state.project.databaseKind,
      profileId: state.project.databaseProfileId,
    };
    if (!databaseContextSchema.safeParse(context).success)
      ctx.addIssue({ code: 'custom', path: ['project'], message: 'database.context-mismatch' });
    if (
      state.native.status === 'available' &&
      (state.native.document.database.kind !== context.kind ||
        state.native.document.database.profileId !== context.profileId)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['native', 'document', 'database'],
        message: 'database.context-mismatch',
      });
    if (
      state.sourceDocument.schemaVersion === 2 &&
      (state.sourceDocument.database.kind !== context.kind ||
        state.sourceDocument.database.profileId !== context.profileId) &&
      (state.native.status !== 'unavailable' || state.native.code !== 'database.context-changed')
    )
      ctx.addIssue({
        code: 'custom',
        path: ['sourceDocument', 'database'],
        message: 'database.context-mismatch',
      });
  });
export type ProjectDocumentState = z.infer<typeof projectDocumentStateSchema>;
