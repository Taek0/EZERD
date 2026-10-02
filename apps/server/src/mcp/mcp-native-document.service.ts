import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  nativeEditorCommandSchema,
  nativeStoredDesignDocumentSchema,
  type NativeEditorCommand,
} from '@ezerd/contracts';
import {
  addNativeColumn,
  createNativeForeignKeyFromPrimaryKey,
  planNativeDeletion,
  updateNativeColumn,
  updateNativeTable,
  deriveOperationChanges,
  requestFingerprint,
  inspectNativeLegacyChanges,
  type NativeColumn,
  type NativeTable,
  type NativeDesignDocument,
} from '@ezerd/model';
import { NativeSyncService } from '../sync/native-sync.service.js';
import type { AuthenticatedUser } from '../identity/session.js';
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const applyNativeProjectChangesSchema = z.strictObject({
  projectId: z.uuid(),
  expectedVersion: sequence,
  expectedSequence: sequence,
  expectedDatabaseRevision: sequence,
  operationId: z.uuid(),
  groupId: z.uuid(),
  clientId: z.uuid(),
  commands: z.array(nativeEditorCommandSchema).min(1).max(100),
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
            'add_table',
            'add_key',
            'patch_key',
            'add_index',
            'patch_index',
            'add_check',
            'patch_check',
            'add_enum',
            'patch_enum',
            'add_foreign_key',
            'patch_foreign_key',
            'delete_objects',
            'create_foreign_key',
          ]),
        })
        .passthrough(),
    )
    .min(1)
    .max(100),
});

function patchObject<T extends { id: string }>(
  items: T[] | undefined,
  id: string,
  patch: NoInfer<Partial<T>>,
): T[] {
  if (!items?.some((item) => item.id === id)) throw new Error('document.object-not-found');
  return items.map((item) => (item.id === id ? { ...item, ...structuredClone(patch) } : item));
}
/** Produces an atomic native candidate. Locked sync still checks references, DB policy and retired IDs. */
export function nativeEditorCandidate(
  document: NativeDesignDocument,
  commands: NativeEditorCommand[],
): NativeDesignDocument {
  let candidate = structuredClone(document);
  const occupied = new Set(
    [
      ...document.domains,
      ...document.domainRelations,
      ...document.notes,
      ...(document.views ?? []),
      ...(document.tables ?? []),
      ...(document.columns ?? []),
      ...(document.keys ?? []),
      ...(document.tableRelations ?? []),
      ...(document.enums ?? []),
      ...(document.indexes ?? []),
      ...(document.checks ?? []),
      ...document.layout.nodes,
    ].map((item) => item.id),
  );
  const claim = (id: string) => {
    if (occupied.has(id)) throw new Error('document.duplicate-identities');
    occupied.add(id);
  };
  for (const raw of commands) {
    const command = nativeEditorCommandSchema.parse(raw);
    // Deleting earlier in this batch is not an ordinary-write identity resurrection license.
    if ('value' in command) claim(command.value.id);
    if (command.type === 'create_foreign_key') {
      claim(command.relationId);
      command.columnIds.forEach(claim);
    }
    switch (command.type) {
      case 'patch_column':
        candidate = updateNativeColumn(candidate, command.id, command.patch);
        break;
      case 'patch_table':
        candidate = updateNativeTable(candidate, command.id, command.patch);
        break;
      case 'add_column':
        candidate = addNativeColumn(candidate, command.value as NativeColumn);
        break;
      case 'add_table':
        candidate.tables = [...(candidate.tables ?? []), command.value as NativeTable];
        break;
      case 'add_key':
        candidate.keys = [...(candidate.keys ?? []), command.value];
        break;
      case 'patch_key':
        candidate.keys = patchObject(candidate.keys, command.id, command.patch);
        break;
      case 'add_index':
        candidate.indexes = [...(candidate.indexes ?? []), command.value];
        break;
      case 'patch_index':
        candidate.indexes = patchObject(candidate.indexes, command.id, command.patch);
        break;
      case 'add_check':
        candidate.checks = [...(candidate.checks ?? []), command.value];
        break;
      case 'patch_check':
        candidate.checks = patchObject(candidate.checks, command.id, command.patch);
        break;
      case 'add_enum':
        candidate.enums = [...(candidate.enums ?? []), command.value];
        break;
      case 'patch_enum':
        candidate.enums = patchObject(candidate.enums, command.id, command.patch);
        break;
      case 'add_foreign_key':
        candidate.tableRelations = [...(candidate.tableRelations ?? []), command.value];
        break;
      case 'patch_foreign_key': {
        const current = candidate.tableRelations?.find((item) => item.id === command.id);
        if (!current) throw new Error('document.object-not-found');
        if (command.patch.physical && !current.physical)
          throw new Error('foreign-key.physical-key-required');
        candidate.tableRelations = patchObject(candidate.tableRelations, command.id, {
          ...command.patch,
          logical: { ...current.logical, ...command.patch.logical },
          physical: command.patch.physical
            ? { ...current.physical!, ...command.patch.physical }
            : current.physical,
        });
        break;
      }
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
          throw new BadRequestException({ code: 'deletion.blocked', blockers: deletion.blockers });
        candidate = deletion.document;
        break;
      }
    }
  }
  const legacy = inspectNativeLegacyChanges(candidate, document)[0];
  if (legacy) throw new Error(legacy.code);
  return nativeStoredDesignDocumentSchema.parse(candidate) as NativeDesignDocument;
}
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
    let candidate: NativeDesignDocument;
    try {
      candidate = nativeEditorCandidate(baseline.document, input.commands);
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
