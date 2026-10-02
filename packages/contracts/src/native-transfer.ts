import { z } from 'zod';
import { databaseContextSchema, databaseRevisionSchema } from './database-state.js';
import {
  nativeProjectTransferSchema,
  projectTransferReadSchema,
  type ProjectTransferRead,
} from './native-document.js';
import {
  projectDocumentStateSchema,
  rawDesignDocumentReadSchema,
} from './project-document-state.js';
import { MAX_PROJECT_TRANSFER_BYTES } from './project-transfer.js';
import { databaseKindSchema, projectSchema, MAX_DOCUMENT_BYTES } from './workspace.js';

/** Apply the transport budget before any parser can trim or canonicalize source evidence. */
function transferBudget(input: unknown, ctx: z.RefinementCtx) {
  try {
    const file = input as {
      document?: unknown;
      sourceDocument?: unknown;
      native?: { document?: unknown };
    } | null;
    for (const document of [file?.document, file?.sourceDocument, file?.native?.document]) {
      if (document !== undefined) {
        let bytes = 0;
        for (const character of JSON.stringify(document)) {
          const code = character.codePointAt(0)!;
          bytes += code <= 127 ? 1 : code <= 2047 ? 2 : code <= 65535 ? 3 : 4;
          if (bytes > MAX_DOCUMENT_BYTES) {
            ctx.addIssue({ code: 'custom', message: 'document.size-limit' });
            return z.NEVER;
          }
        }
      }
    }
    let bytes = 0;
    for (const character of JSON.stringify(input) ?? '') {
      const code = character.codePointAt(0)!;
      bytes += code <= 127 ? 1 : code <= 2047 ? 2 : code <= 65535 ? 3 : 4;
      if (bytes > MAX_PROJECT_TRANSFER_BYTES) {
        ctx.addIssue({ code: 'custom', message: 'project-transfer.size-limit' });
        return z.NEVER;
      }
    }
  } catch {
    ctx.addIssue({ code: 'custom', message: 'project-transfer.json-invalid' });
    return z.NEVER;
  }
  return input;
}

const counter = z.number().int().nonnegative().max(2147483647);
/** Informational source coordinates, never proof of authority to create legacy/native values. */
export const nativeTransferSourceSchema = z.strictObject({
  projectId: z.uuid(),
  version: counter,
  sequence: counter,
  databaseRevision: databaseRevisionSchema,
});

const versionedTransfer = z
  .strictObject({
    format: z.literal('ezerd-project'),
    formatVersion: z.literal(2),
    exportedAt: z.iso.datetime(),
    project: z.strictObject({
      name: z.string().trim().min(1).max(120),
      databaseKind: databaseKindSchema,
      databaseProfileId: nativeProjectTransferSchema.shape.project.shape.databaseProfileId,
    }),
    source: nativeTransferSourceSchema,
    sourceDocument: rawDesignDocumentReadSchema,
    native: projectDocumentStateSchema.shape.native,
  })
  .superRefine((file, ctx) => {
    const context = {
      kind: file.project.databaseKind,
      profileId: file.project.databaseProfileId,
    };
    if (!databaseContextSchema.safeParse(context).success)
      ctx.addIssue({ code: 'custom', path: ['project'], message: 'database.context-mismatch' });
    if (
      file.native.status === 'available' &&
      (file.native.document.database.kind !== context.kind ||
        file.native.document.database.profileId !== context.profileId)
    )
      ctx.addIssue({ code: 'custom', path: ['native'], message: 'database.context-mismatch' });
    if (
      file.sourceDocument.schemaVersion === 2 &&
      (file.sourceDocument.database.kind !== context.kind ||
        file.sourceDocument.database.profileId !== context.profileId) &&
      (file.native.status !== 'unavailable' || file.native.code !== 'database.context-changed')
    )
      ctx.addIssue({
        code: 'custom',
        path: ['sourceDocument'],
        message: 'database.context-mismatch',
      });
  });

/** Raw source plus a separately labelled preview/diagnostics, as in document-state. */
export const versionedProjectTransferSchema = z.preprocess(transferBudget, versionedTransfer);
export type VersionedProjectTransfer = z.infer<typeof versionedProjectTransferSchema>;

/** Also accepts the previously specified compact native v2 and structural legacy v1 readers. */
export const nativeTransferReadSchema = z.preprocess(
  transferBudget,
  z.union([
    versionedTransfer,
    // Keep the original source evidence even when the structural parser trims identifiers/aliases.
    z.custom<ProjectTransferRead>(
      (value) => projectTransferReadSchema.safeParse(value).success,
      'project-transfer.source-invalid',
    ),
  ]),
);
export type NativeTransferRead = z.infer<typeof nativeTransferReadSchema>;
export const importNativeProjectSchema = z.strictObject({
  workspaceId: z.uuid(),
  transfer: nativeTransferReadSchema,
});
export const nativeTransferImportResultSchema = z.strictObject({
  project: projectSchema,
  sequence: counter,
  migrationIssues: projectDocumentStateSchema.shape.native.options[0].shape.migrationIssues,
  issues: projectDocumentStateSchema.shape.native.options[0].shape.issues,
});
export type NativeTransferImportResult = z.infer<typeof nativeTransferImportResultSchema>;
