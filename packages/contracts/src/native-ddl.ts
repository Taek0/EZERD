import { z } from 'zod';
import { projectDatabaseStateSchema } from './database-state.js';
import { databaseIssueSchema } from './project-document-state.js';
const counter = z.number().int().nonnegative().max(2147483647);
export const projectDDLExportSchema = z
  .strictObject({
    projectId: z.uuid(),
    projectName: z.string().max(120),
    version: counter,
    sequence: counter,
    database: projectDatabaseStateSchema,
    documentSchemaVersion: z.union([z.literal(1), z.literal(2)]),
    filename: z.string().min(1).max(180),
    encoding: z.literal('UTF-8'),
    sql: z.string().max(4000000),
    canExport: z.boolean(),
    issues: z.array(databaseIssueSchema).max(10000),
  })
  .superRefine((value, ctx) => {
    if (
      (!value.canExport && value.sql !== '') ||
      (value.canExport && value.issues.some((issue) => issue.severity === 'error'))
    )
      ctx.addIssue({ code: 'custom', message: 'ddl.partial-export-not-allowed' });
  });
export type ProjectDDLExport = z.infer<typeof projectDDLExportSchema>;
