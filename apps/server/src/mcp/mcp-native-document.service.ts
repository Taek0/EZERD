import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  nativeColumnPatchSchema,
  nativeTablePatchSchema,
  nativeStoredColumnSchema,
} from '@ezerd/contracts';
import {
  addNativeColumn,
  createNativeForeignKeyFromPrimaryKey,
  nativeDeletionCollections,
  planNativeDeletion,
  updateNativeColumn,
  updateNativeTable,
  deriveOperationChanges,
  requestFingerprint,
  type NativeColumn,
  type NativeDesignDocument,
} from '@ezerd/model';
import { NativeSyncService } from '../sync/native-sync.service.js';
import type { AuthenticatedUser } from '../identity/session.js';
const id = z.string().trim().min(1).max(160);
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const commands = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('patch_column'), id, patch: nativeColumnPatchSchema }),
  z.strictObject({ type: z.literal('patch_table'), id, patch: nativeTablePatchSchema }),
  z.strictObject({
    type: z.literal('add_column'),
    value: nativeStoredColumnSchema.transform((value) => value as NativeColumn),
  }),
  z.strictObject({
    type: z.literal('delete_objects'),
    targets: z
      .array(z.strictObject({ collection: z.enum(nativeDeletionCollections), id }))
      .min(1)
      .max(100),
    cascadeGeneratedColumns: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('create_foreign_key'),
    primaryTableId: id,
    foreignTableId: id,
    primaryKeyId: id,
    relationId: id,
    columnIds: z.array(id).min(1).max(32),
  }),
]);
export const applyNativeProjectChangesSchema = z.strictObject({
  projectId: z.uuid(),
  expectedVersion: sequence,
  expectedSequence: sequence,
  expectedDatabaseRevision: sequence,
  operationId: z.uuid(),
  groupId: z.uuid(),
  clientId: z.uuid(),
  commands: z.array(commands).min(1).max(100),
  includeDocument: z.boolean().default(false),
});
/** SDK metadata is intentionally shallow; the handler parses the complete AST/patch runtime contract. */
export const applyNativeProjectChangesMetadataSchema = z.strictObject({
  ...applyNativeProjectChangesSchema.shape,
  commands: z
    .array(
      z
        .object({
          type: z.enum([
            'patch_column',
            'patch_table',
            'add_column',
            'delete_objects',
            'create_foreign_key',
          ]),
        })
        .passthrough(),
    )
    .min(1)
    .max(100),
});
@Injectable()
export class McpNativeDocumentService {
  constructor(@Inject(NativeSyncService) private readonly sync: NativeSyncService) {}
  async apply(raw: unknown, user: AuthenticatedUser) {
    const identity = z
      .object({
        projectId: z.uuid(),
        operationId: z.uuid(),
        includeDocument: z.boolean().default(false),
      })
      .passthrough()
      .safeParse(raw);
    if (!identity.success) throw new BadRequestException({ code: 'native.command-invalid' });
    const { includeDocument: _includeDocument, ...semanticInput } = raw as Record<string, unknown>;
    const hash = createHash('sha256')
      .update(requestFingerprint({ command: 'apply_native_project_changes', ...semanticInput }))
      .digest('hex');
    const finish = (result: Awaited<ReturnType<NativeSyncService['apply']>>) => {
      if (identity.data.includeDocument) return result;
      const { document: _document, ...ack } = result;
      return ack;
    };
    const replay = await this.sync.findReplay(
      identity.data.projectId,
      identity.data.operationId,
      hash,
      user,
    );
    if (replay) return finish(replay);
    const parsed = applyNativeProjectChangesSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ code: 'native.command-invalid' });
    const input = parsed.data;
    const baseline = await this.sync.baseline(input.projectId, input.clientId, user, {
      version: input.expectedVersion,
      sequence: input.expectedSequence,
      databaseRevision: input.expectedDatabaseRevision,
    });
    let candidate: NativeDesignDocument = structuredClone(baseline.document);
    try {
      for (const command of input.commands) {
        switch (command.type) {
          case 'patch_column':
            candidate = updateNativeColumn(candidate, command.id, command.patch);
            break;
          case 'patch_table':
            candidate = updateNativeTable(candidate, command.id, command.patch);
            break;
          case 'add_column':
            candidate = addNativeColumn(candidate, command.value);
            break;
          case 'create_foreign_key':
            candidate = createNativeForeignKeyFromPrimaryKey(candidate, command);
            break;
          case 'delete_objects': {
            const deletion = planNativeDeletion(candidate, command.targets, {
              ...(command.cascadeGeneratedColumns !== undefined
                ? { cascadeGeneratedColumns: command.cascadeGeneratedColumns }
                : {}),
            });
            if (deletion.blockers.length)
              throw new BadRequestException({
                code: 'deletion.blocked',
                blockers: deletion.blockers,
              });
            candidate = deletion.document;
            break;
          }
        }
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException({
        code: error instanceof Error ? error.message : 'native.command-invalid',
      });
    }
    const changes = deriveOperationChanges(baseline.document, candidate);
    if (!changes.length) throw new BadRequestException({ code: 'sync.no-changes' });
    return finish(
      await this.sync.apply(
        input.projectId,
        {
          protocolVersion: 2,
          database: baseline.database,
          databaseRevision: baseline.databaseRevision,
          operationId: input.operationId,
          groupId: input.groupId,
          clientId: input.clientId,
          baselineId: baseline.baselineId,
          baseSequence: baseline.sequence,
          baselineIssuedAt: baseline.baselineIssuedAt,
          kind: 'online',
          dependencyPaths: [],
          baselineDocument: baseline.document,
          document: candidate,
          changes,
        },
        user,
        hash,
      ),
    );
  }
}
