import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  columnSchema,
  designDocumentSchema,
  domainRelationSchema,
  domainSchema,
  noteSchema,
  projectEnumSchema,
  relationLayoutSchema,
  tableKeySchema,
  tableRelationSchema,
  tableSchema,
  syncOperationInputSchema,
} from '@ezerd/contracts';
import type { SyncOperationInput } from '@ezerd/contracts';
import {
  addColumn,
  addDomain,
  addNote,
  addTable,
  TABLES_VIEW_ID,
  diffSharedDocument,
  removeColumn,
  removeDomain,
  removeDomainRelation,
  removeEnum,
  removeKey,
  removeNote,
  removeTable,
  removeTableRelation,
  requestFingerprint,
  updateColumn,
  updateDomain,
  updateNodeLayout,
  updateNote,
  updateTable,
  upsertDomainRelation,
  upsertEnum,
  upsertKey,
  upsertRelationLayout,
  upsertTableRelation,
} from '@ezerd/model';
import type { DesignDocument } from '@ezerd/model';
import type { AuthenticatedUser } from '../identity/session.js';
import { SyncService } from '../sync/sync.service.js';
import { applyPatchCommand, patchCommandSchema, patchCommandSchemas } from './mcp-patch.js';

const objectId = z.string().trim().min(1).max(160);
const coordinate = z.number().min(-1e7).max(1e7);
const placement = z
  .strictObject({
    x: coordinate,
    y: coordinate,
    width: z.number().positive().max(10000).optional(),
    height: z.number().positive().max(10000).optional(),
  })
  .optional();
const nodePatch = z
  .strictObject({
    x: coordinate.optional(),
    y: coordinate.optional(),
    width: z.number().positive().max(10000).optional(),
    height: z.number().positive().max(10000).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined));
export const mcpDocumentCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('upsert_domain'), value: domainSchema, placement }),
  z.strictObject({ type: z.literal('delete_domain'), id: objectId }),
  z.strictObject({ type: z.literal('upsert_domain_relation'), value: domainRelationSchema }),
  z.strictObject({ type: z.literal('delete_domain_relation'), id: objectId }),
  z.strictObject({ type: z.literal('upsert_table'), value: tableSchema, placement }),
  z.strictObject({ type: z.literal('delete_table'), id: objectId }),
  z.strictObject({ type: z.literal('upsert_column'), value: columnSchema }),
  z.strictObject({ type: z.literal('delete_column'), id: objectId }),
  z.strictObject({ type: z.literal('upsert_key'), value: tableKeySchema }),
  z.strictObject({ type: z.literal('delete_key'), id: objectId }),
  z.strictObject({ type: z.literal('upsert_table_relation'), value: tableRelationSchema }),
  z.strictObject({ type: z.literal('delete_table_relation'), id: objectId }),
  z.strictObject({ type: z.literal('upsert_note'), value: noteSchema, placement }),
  z.strictObject({ type: z.literal('delete_note'), id: objectId }),
  z.strictObject({ type: z.literal('upsert_enum'), value: projectEnumSchema }),
  z.strictObject({ type: z.literal('delete_enum'), id: objectId }),
  z.strictObject({ type: z.literal('update_node_layout'), nodeId: objectId, patch: nodePatch }),
  z.strictObject({ type: z.literal('upsert_relation_layout'), value: relationLayoutSchema }),
  z.strictObject({
    type: z.literal('delete_relation_layout'),
    relationId: objectId,
    viewId: objectId,
  }),
  ...patchCommandSchemas,
]);
export const applyProjectChangesSchema = z.strictObject({
  projectId: z.uuid(),
  expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  expectedSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  operationId: z.uuid(),
  groupId: z.uuid(),
  clientId: z.uuid(),
  commands: z.array(mcpDocumentCommandSchema).min(1).max(200),
});
export type ApplyProjectChanges = z.infer<typeof applyProjectChangesSchema>;

@Injectable()
export class McpDocumentService {
  constructor(@Inject(SyncService) private readonly sync: SyncService) {}

  async apply(input: ApplyProjectChanges, user: AuthenticatedUser) {
    const requestHash = createHash('sha256')
      .update(requestFingerprint({ command: 'apply_project_changes', ...input }))
      .digest('hex');
    const replay = await this.sync.findReplay(
      input.projectId,
      input.operationId,
      requestHash,
      user,
    );
    if (replay) {
      if (replay.status === 'rejected')
        throw new ConflictException(replay.reason ?? '이 작업은 이전에 거부되었습니다.');
      return replay;
    }
    const baseline = await this.sync.establishBaseline(input.projectId, input.clientId, user, {
      version: input.expectedVersion,
      sequence: input.expectedSequence,
    });
    let candidate = structuredClone(baseline.document);
    try {
      for (const command of input.commands) candidate = this.applyCommand(candidate, command);
      candidate = designDocumentSchema.parse(candidate);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : '문서 변경 명령을 적용할 수 없습니다.',
      );
    }
    const changes = diffSharedDocument(baseline.document, candidate);
    if (!changes.length) throw new BadRequestException('실제 문서 변경이 없습니다.');
    const operationCandidate = {
      operationId: input.operationId,
      groupId: input.groupId,
      clientId: input.clientId,
      baselineId: baseline.baselineId,
      baseSequence: baseline.sequence,
      baselineIssuedAt: baseline.baselineIssuedAt,
      kind: 'reconnect',
      dependencyPaths: [],
      changes,
      baselineDocument: baseline.document,
      document: candidate,
    };
    const parsedOperation = syncOperationInputSchema.safeParse(operationCandidate);
    if (!parsedOperation.success)
      throw new BadRequestException(
        '변경 범위가 한 작업의 문서 또는 변경 개수 제한을 초과했습니다.',
      );
    const operation: SyncOperationInput = parsedOperation.data;
    const result = await this.sync.apply(input.projectId, operation, user, { requestHash });
    if (result.status === 'rejected')
      throw new ConflictException(result.reason ?? '동시 변경 때문에 작업을 적용할 수 없습니다.');
    return result;
  }

  private applyCommand(
    document: DesignDocument,
    command: z.infer<typeof mcpDocumentCommandSchema>,
  ): DesignDocument {
    const patch = patchCommandSchema.safeParse(command);
    if (patch.success) return applyPatchCommand(document, patch.data);
    const point =
      'placement' in command && command.placement
        ? { x: command.placement.x, y: command.placement.y }
        : { x: 0, y: 0 };
    const resize = (next: DesignDocument, objectId: string, viewId: string) => {
      if (!('placement' in command) || !command.placement) return next;
      const node = next.layout.nodes.find(
        (item) => item.objectId === objectId && item.viewId === viewId,
      );
      return node
        ? updateNodeLayout(next, node.id, {
            x: command.placement.x,
            y: command.placement.y,
            ...(command.placement.width !== undefined ? { width: command.placement.width } : {}),
            ...(command.placement.height !== undefined ? { height: command.placement.height } : {}),
          })
        : next;
    };
    const sharedViewId = (viewId: string) =>
      document.domains.some((domain) => domain.id === viewId) ? TABLES_VIEW_ID : viewId;
    switch (command.type) {
      case 'upsert_domain':
        return document.domains.some((item) => item.id === command.value.id)
          ? resize(
              updateDomain(document, command.value.id, command.value),
              command.value.id,
              'overview',
            )
          : resize(addDomain(document, command.value, point), command.value.id, 'overview');
      case 'delete_domain':
        return removeDomain(document, command.id);
      case 'upsert_domain_relation':
        return upsertDomainRelation(document, command.value);
      case 'delete_domain_relation':
        return removeDomainRelation(document, command.id);
      case 'upsert_table':
        return document.tables?.some((item) => item.id === command.value.id)
          ? resize(
              updateTable(document, command.value.id, command.value),
              command.value.id,
              TABLES_VIEW_ID,
            )
          : resize(addTable(document, command.value, point), command.value.id, TABLES_VIEW_ID);
      case 'delete_table':
        return removeTable(document, command.id);
      case 'upsert_column':
        if (document.columns?.some((item) => item.id === command.value.id)) {
          const current = document.columns.find((item) => item.id === command.value.id)!;
          if (current.tableId !== command.value.tableId)
            throw new Error('컬럼은 다른 테이블로 이동할 수 없습니다.');
          return updateColumn(document, command.value.id, command.value);
        }
        return addColumn(document, command.value);
      case 'delete_column':
        return removeColumn(document, command.id);
      case 'upsert_key':
        return upsertKey(document, command.value);
      case 'delete_key':
        return removeKey(document, command.id);
      case 'upsert_table_relation':
        return upsertTableRelation(document, command.value);
      case 'delete_table_relation':
        return removeTableRelation(document, command.id);
      case 'upsert_note': {
        const value = { ...command.value, viewId: sharedViewId(command.value.viewId) };
        if (document.notes.some((item) => item.id === command.value.id)) {
          const current = document.notes.find((item) => item.id === command.value.id)!;
          if (current.viewId !== value.viewId)
            throw new Error('메모는 다른 화면으로 이동할 수 없습니다.');
          return resize(updateNote(document, value.id, value), value.id, value.viewId);
        }
        return resize(addNote(document, value, point), value.id, value.viewId);
      }
      case 'delete_note':
        return removeNote(document, command.id);
      case 'upsert_enum':
        return upsertEnum(document, command.value);
      case 'delete_enum':
        return removeEnum(document, command.id);
      case 'update_node_layout':
        if (
          document.views?.some((view) =>
            document.layout.nodes.some(
              (node) => node.id === command.nodeId && node.viewId === view.id,
            ),
          )
        )
          throw new Error('개인 결합 화면의 배치는 공유 문서 명령으로 변경할 수 없습니다.');
        return updateNodeLayout(document, command.nodeId, {
          ...(command.patch.x !== undefined ? { x: command.patch.x } : {}),
          ...(command.patch.y !== undefined ? { y: command.patch.y } : {}),
          ...(command.patch.width !== undefined ? { width: command.patch.width } : {}),
          ...(command.patch.height !== undefined ? { height: command.patch.height } : {}),
        });
      case 'upsert_relation_layout':
        if (document.views?.some((view) => view.id === command.value.viewId))
          throw new Error('개인 결합 화면의 관계 경로는 공유 문서 명령으로 변경할 수 없습니다.');
        return upsertRelationLayout(document, {
          ...command.value,
          viewId: sharedViewId(command.value.viewId),
        });
      case 'delete_relation_layout':
        if (document.views?.some((view) => view.id === command.viewId))
          throw new Error('개인 결합 화면의 관계 경로는 공유 문서 명령으로 변경할 수 없습니다.');
        return {
          ...document,
          layout: {
            ...document.layout,
            ...(document.layout.relations && {
              relations: document.layout.relations.filter(
                (item) =>
                  item.relationId !== command.relationId ||
                  item.viewId !== sharedViewId(command.viewId),
              ),
            }),
          },
        };
    }
    throw new Error('지원되지 않는 문서 변경 명령입니다.');
  }
}
