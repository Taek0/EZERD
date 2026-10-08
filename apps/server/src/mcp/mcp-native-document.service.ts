import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  nativeEditorCommandSchema,
  nativeStoredDesignDocumentSchema,
  type NativeEditorCommand,
  planNativeClipboardCommand,
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
  addTableReference,
  removeTableReference,
  updateNodeLayout,
  addNote,
  updateNote,
  removeNote,
  upsertRelationLayout,
  TABLES_VIEW_ID,
  type NativeColumn,
  type NativeTable,
  type NativeDesignDocument,
} from '@ezerd/model';
import { NativeSyncService } from '../sync/native-sync.service.js';
import type { AuthenticatedUser } from '../identity/session.js';
import {
  applyNativeDomainEditorCommand,
  nativeDomainCandidateClaims,
  patchNativeConstraintKey,
  patchNativeConstraintForeignKey,
} from './native-editor-candidate.js';
import {
  applyNativeCanvasStyle,
  applyNativeDomainRelation,
} from './native-canvas-decoration-candidate.js';
import { mcpSchemaMetadata } from './mcp-schema-metadata.js';
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
/** Advertise the runtime input shape while preserving raw commands for locked replay/validation.
 * JSON Schema cannot express AST budgets or project policy; these stay in the handler.
 */
export const applyNativeProjectChangesMetadataSchema = z
  .strictObject({
    ...applyNativeProjectChangesSchema.shape,
    commands: z
      .array(z.object({ type: z.string().min(1) }).passthrough())
      .min(1)
      .max(100),
  })
  .meta(mcpSchemaMetadata(applyNativeProjectChangesSchema));

function commandValidationError(error: z.ZodError) {
  return new BadRequestException({
    code: 'native.command-invalid',
    issues: error.issues,
  });
}

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
  const claims = nativeDomainCandidateClaims(document);
  const occupied = claims.occupiedIds;
  const claim = (id: string) => {
    if (occupied.has(id)) throw new Error('document.duplicate-identities');
    occupied.add(id);
  };
  const sharedView = (viewId: string) => {
    if (
      viewId !== 'overview' &&
      viewId !== TABLES_VIEW_ID &&
      !candidate.domains.some((domain) => domain.id === viewId)
    )
      throw new Error('canvas.shared-view-required');
    if (candidate.views?.some((view) => view.id === viewId))
      throw new Error('canvas.personal-command-required');
  };
  for (const raw of commands) {
    const command = nativeEditorCommandSchema.parse(raw);
    const previousNodeIds = new Set(candidate.layout.nodes.map((node) => node.id));
    // Deleting earlier in this batch is not an ordinary-write identity resurrection license.
    if (
      'value' in command &&
      'id' in command.value &&
      command.type !== 'upsert_note' &&
      command.type !== 'add_domain'
    )
      claim(command.value.id);
    if (command.type === 'create_foreign_key') {
      claim(command.relationId);
      command.columnIds.forEach(claim);
    }
    switch (command.type) {
      case 'patch_canvas_style':
        candidate = applyNativeCanvasStyle(candidate, command);
        break;
      case 'add_domain_relation':
      case 'patch_domain_relation':
      case 'delete_domain_relation':
        candidate = applyNativeDomainRelation(candidate, command);
        break;
      case 'paste_native_clipboard': {
        const plan = planNativeClipboardCommand(candidate, command);
        if (!plan.canApply)
          throw new BadRequestException({ code: 'clipboard.policy-blocked', issues: plan.issues });
        command.newIds.forEach(claim);
        candidate = plan.document;
        break;
      }
      case 'add_domain':
      case 'patch_domain':
      case 'delete_domain':
      case 'move_table_domain':
        candidate = applyNativeDomainEditorCommand(candidate, command, claims);
        break;
      case 'add_table_reference': {
        sharedView(command.viewId);
        if (command.nodeId) claim(command.nodeId);
        candidate = addTableReference(
          candidate,
          command.tableId,
          command.viewId,
          command.placement,
        );
        const node = candidate.layout.nodes.find(
          (node) => node.objectId === command.tableId && node.viewId === command.viewId,
        )!;
        candidate = updateNodeLayout(candidate, node.id, {
          ...(command.placement.width !== undefined ? { width: command.placement.width } : {}),
          ...(command.placement.height !== undefined ? { height: command.placement.height } : {}),
        });
        if (command.nodeId)
          candidate.layout.nodes = candidate.layout.nodes.map((item) =>
            item.id === node.id ? { ...item, id: command.nodeId! } : item,
          );
        break;
      }
      case 'update_node_layout': {
        const node = candidate.layout.nodes.find((node) => node.id === command.nodeId);
        if (!node) throw new Error('canvas.node-not-found');
        sharedView(node.viewId);
        candidate = updateNodeLayout(candidate, node.id, command.patch);
        break;
      }
      case 'remove_table_reference': {
        const node = candidate.layout.nodes.find((node) => node.id === command.nodeId);
        if (!node) throw new Error('canvas.node-not-found');
        sharedView(node.viewId);
        candidate = removeTableReference(candidate, node.id);
        break;
      }
      case 'upsert_note': {
        sharedView(command.value.viewId);
        const current = candidate.notes.find((note) => note.id === command.value.id);
        if (current && current.viewId !== command.value.viewId)
          throw new Error('canvas.note-view-immutable');
        if (!current) {
          claim(command.value.id);
          candidate = addNote(candidate, command.value, command.placement ?? { x: 0, y: 0 });
        } else candidate = updateNote(candidate, current.id, command.value);
        if (command.placement) {
          const node = candidate.layout.nodes.find(
            (node) => node.objectId === command.value.id && node.viewId === command.value.viewId,
          )!;
          candidate = updateNodeLayout(candidate, node.id, command.placement);
        }
        break;
      }
      case 'patch_note':
      case 'delete_note': {
        const note = candidate.notes.find((note) => note.id === command.id);
        if (!note) throw new Error('canvas.note-not-found');
        sharedView(note.viewId);
        candidate =
          command.type === 'patch_note'
            ? updateNote(candidate, note.id, command.patch)
            : removeNote(candidate, note.id);
        break;
      }
      case 'upsert_relation_layout':
        sharedView(command.value.viewId);
        candidate = upsertRelationLayout(candidate, command.value);
        break;
      case 'delete_relation_layout':
        sharedView(command.viewId);
        candidate.layout.relations = (candidate.layout.relations ?? []).filter(
          (route) => route.relationId !== command.relationId || route.viewId !== command.viewId,
        );
        break;
      case 'reorder_columns': {
        const columns = candidate.columns ?? [];
        const owned = columns.filter((column) => column.tableId === command.tableId);
        const byId = new Map(owned.map((column) => [column.id, column]));
        if (
          !candidate.tables?.some((table) => table.id === command.tableId) ||
          owned.length !== command.columnIds.length ||
          command.columnIds.some((id) => !byId.has(id))
        )
          throw new Error('column.order-invalid');
        let index = 0;
        candidate.columns = columns.map((column) =>
          column.tableId === command.tableId ? byId.get(command.columnIds[index++]!)! : column,
        );
        break;
      }
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
        candidate = patchNativeConstraintKey(candidate, command.id, command.patch);
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
        candidate = patchNativeConstraintForeignKey(candidate, command.id, command.patch);
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
    for (const node of candidate.layout.nodes) {
      if (
        previousNodeIds.has(node.id) ||
        command.type === 'add_domain' ||
        command.type === 'paste_native_clipboard' ||
        (command.type === 'add_table_reference' && command.nodeId === node.id)
      )
        continue;
      claim(node.id);
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
    if (!identity.success) throw commandValidationError(identity.error);
    const { includeDocument: _includeDocument, ...semanticInput } = raw as Record<string, unknown>;
    const hash = createHash('sha256')
      .update(requestFingerprint({ command: 'apply_native_project_changes', ...semanticInput }))
      .digest('hex');
    const finish = (result: Awaited<ReturnType<NativeSyncService['apply']>>) => {
      if (identity.data.includeDocument) return result;
      const { document: _document, ...ack } = result;
      return ack;
    };
    return finish(
      await this.sync.apply(
        identity.data.projectId,
        { operationId: identity.data.operationId },
        user,
        hash,
        async (issueBaseline) => {
          // Runs only after read/replay, the project row lock/replay and fresh design access.
          const parsed = applyNativeProjectChangesSchema.safeParse(raw);
          if (!parsed.success) throw commandValidationError(parsed.error);
          const input = parsed.data;
          // The locked issuer accepts an older observed edit head within the same DB revision.
          // Applying explicit patches to this current document merges disjoint properties and
          // gives overlapping properties to the command processed later by the server.
          const baseline = await issueBaseline(input.clientId, {
            version: input.expectedVersion,
            sequence: input.expectedSequence,
            databaseRevision: input.expectedDatabaseRevision,
          });
          let candidate: NativeDesignDocument;
          try {
            candidate = nativeEditorCandidate(baseline.document, input.commands);
          } catch (error) {
            if (error instanceof BadRequestException) throw error;
            if (error instanceof z.ZodError) throw commandValidationError(error);
            throw new BadRequestException({
              code: error instanceof Error ? error.message : 'native.command-invalid',
            });
          }
          const changes = deriveOperationChanges(baseline.document, candidate);
          if (!changes.length) throw new BadRequestException({ code: 'sync.no-changes' });
          return {
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
          };
        },
      ),
    );
  }
}
