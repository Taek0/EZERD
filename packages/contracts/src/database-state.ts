import { z } from 'zod';
import {
  databaseKinds,
  databaseProfiles,
  getDatabaseProfile,
  MAX_DATABASE_REVISION,
  type DatabaseIssue,
} from '@ezerd/model';

export const databaseProfileIdSchema = z.enum(databaseProfiles.map((profile) => profile.id));
export const databaseRevisionSchema = z.number().int().min(0).max(MAX_DATABASE_REVISION);
export const databaseContextSchema = z
  .strictObject({ kind: z.enum(databaseKinds), profileId: databaseProfileIdSchema })
  .superRefine((value, ctx) => {
    try {
      getDatabaseProfile(value);
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['profileId'],
        message: 'database.profile-unsupported',
      });
    }
  });
export const projectDatabaseStateSchema = databaseContextSchema.safeExtend({
  revision: databaseRevisionSchema,
});
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const previewProjectDatabaseSchema = z
  .strictObject({
    expectedVersion: sequence,
    expectedSequence: sequence.optional(),
    targetKind: z.enum(databaseKinds),
    targetProfileId: databaseProfileIdSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.targetProfileId)
      try {
        getDatabaseProfile({ kind: value.targetKind, profileId: value.targetProfileId });
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['targetProfileId'],
          message: 'database.profile-unsupported',
        });
      }
  });
export const changeProjectDatabaseSchema = previewProjectDatabaseSchema.safeExtend({
  operationId: z.uuid(),
  expectedDatabaseRevision: databaseRevisionSchema,
});
// Keep this leaf schema independent: project-document-state imports database-state itself.
// This is the same issue shape used there, without introducing an eager initialization cycle.
const conversionIssueSchema: z.ZodType<DatabaseIssue> = z.strictObject({
  code: z.string().max(160),
  category: z.enum(['unsupported', 'invalid', 'incomplete', 'environment']),
  severity: z.enum(['error', 'warning']),
  objectId: z.string().max(160).nullable(),
  path: z.string().max(1000),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});
export const projectDatabasePreviewSchema = z.strictObject({
  projectId: z.uuid(),
  version: sequence,
  sequence,
  current: projectDatabaseStateSchema,
  target: databaseContextSchema,
  canChange: z.boolean(),
  reasonCode: z.string().optional(),
  issues: z.array(conversionIssueSchema).optional(),
});
export const projectDatabaseChangeResultSchema = z.strictObject({
  projectId: z.uuid(),
  operationId: z.uuid(),
  version: sequence,
  sequence,
  database: projectDatabaseStateSchema,
  changed: z.boolean(),
});
export type ProjectDatabasePreview = z.infer<typeof projectDatabasePreviewSchema>;
export type ProjectDatabaseChangeResult = z.infer<typeof projectDatabaseChangeResultSchema>;
