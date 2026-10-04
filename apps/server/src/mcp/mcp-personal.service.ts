import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  combinedViewSchema,
  noteSchema,
  personalStateSnapshotSchema,
  relationLayoutSchema,
  viewportSchema,
} from '@ezerd/contracts';
import {
  addNote,
  addTableReference,
  removeCombinedView,
  removeNote,
  removeTableReference,
  requestFingerprint,
  setViewport,
  updateNodeLayout,
  updateNote,
  upsertCombinedView,
  upsertRelationLayout,
  type DesignDocument,
  type NativeDesignDocument,
} from '@ezerd/model';
import type { AuthenticatedUser } from '../identity/session.js';
import { PersonalStateService } from '../workspace/personal-state.service.js';

const objectId = z.string().trim().min(1).max(160);
const coordinate = z.number().min(-1e7).max(1e7);
const nodePatch = z
  .strictObject({
    x: coordinate.optional(),
    y: coordinate.optional(),
    width: z.number().positive().max(10000).optional(),
    height: z.number().positive().max(10000).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined));
export const personalCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('upsert_combined_view'), value: combinedViewSchema }),
  z.strictObject({ type: z.literal('delete_combined_view'), id: objectId }),
  z.strictObject({
    type: z.literal('patch_combined_view'),
    id: objectId,
    patch: z
      .strictObject({
        name: combinedViewSchema.shape.name.optional(),
        domainIds: combinedViewSchema.shape.domainIds.optional(),
      })
      .refine((value) => Object.values(value).some((item) => item !== undefined)),
  }),
  z.strictObject({ type: z.literal('set_viewport'), value: viewportSchema }),
  z.strictObject({
    type: z.literal('add_table_reference'),
    tableId: objectId,
    viewId: objectId,
    placement: z.strictObject({
      x: coordinate,
      y: coordinate,
      width: z.number().positive().max(10000).optional(),
      height: z.number().positive().max(10000).optional(),
    }),
  }),
  z.strictObject({ type: z.literal('remove_table_reference'), nodeId: objectId }),
  z.strictObject({ type: z.literal('update_node_layout'), nodeId: objectId, patch: nodePatch }),
  z.strictObject({ type: z.literal('upsert_relation_layout'), value: relationLayoutSchema }),
  z.strictObject({
    type: z.literal('delete_relation_layout'),
    relationId: objectId,
    viewId: objectId,
  }),
  z.strictObject({
    type: z.literal('upsert_note'),
    value: noteSchema,
    placement: z.strictObject({ x: coordinate, y: coordinate }).optional(),
  }),
  z.strictObject({ type: z.literal('delete_note'), id: objectId }),
  z.strictObject({
    type: z.literal('patch_note'),
    id: objectId,
    patch: z
      .strictObject({
        text: noteSchema.shape.text.optional(),
        color: noteSchema.shape.color.nullable(),
      })
      .refine((value) => Object.values(value).some((item) => item !== undefined)),
  }),
]);
export const applyPersonalChangesSchema = z.strictObject({
  expectedDatabaseRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  expectedProjectVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  expectedSyncSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  projectId: z.uuid(),
  expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  operationId: z.uuid(),
  commands: z.array(personalCommandSchema).min(1).max(100),
});

@Injectable()
export class McpPersonalService {
  constructor(@Inject(PersonalStateService) private readonly personal: PersonalStateService) {}

  get(projectId: string, user: AuthenticatedUser) {
    return this.personal.get(projectId, user);
  }

  apply(input: z.infer<typeof applyPersonalChangesSchema>, user: AuthenticatedUser) {
    const fingerprint = createHash('sha256')
      .update(requestFingerprint({ command: 'apply_personal_changes', ...input }))
      .digest('hex');
    return this.personal
      .mutate(
        input.projectId,
        user,
        input.expectedVersion,
        (source) => {
          let candidate = source;
          try {
            for (const command of input.commands) candidate = this.applyCommand(candidate, command);
          } catch (error) {
            throw new BadRequestException(
              error instanceof Error ? error.message : '개인 화면 변경 명령이 올바르지 않습니다.',
            );
          }
          return candidate;
        },
        { id: input.operationId, fingerprint },
        {
          expectedDatabaseRevision: input.expectedDatabaseRevision,
          expectedProjectVersion: input.expectedProjectVersion,
          expectedSyncSequence: input.expectedSyncSequence,
        },
      )
      .then((value) => personalStateSnapshotSchema.parse(value));
  }

  private applyCommand<T extends DesignDocument | NativeDesignDocument>(
    document: T,
    command: z.infer<typeof personalCommandSchema>,
  ): T {
    const isCombined = (viewId: string) => document.views?.some((view) => view.id === viewId);
    const requireCombined = (viewId: string) => {
      if (!isCombined(viewId)) throw new Error('개인 결합 화면을 찾을 수 없습니다.');
    };
    switch (command.type) {
      case 'upsert_combined_view':
        return upsertCombinedView(document, command.value);
      case 'delete_combined_view':
        requireCombined(command.id);
        return removeCombinedView(document, command.id);
      case 'patch_combined_view': {
        const current = document.views?.find((view) => view.id === command.id);
        if (!current) throw new Error('개인 결합 화면을 찾을 수 없습니다.');
        return upsertCombinedView(document, {
          ...current,
          ...(command.patch.name !== undefined ? { name: command.patch.name } : {}),
          ...(command.patch.domainIds !== undefined ? { domainIds: command.patch.domainIds } : {}),
        });
      }
      case 'set_viewport':
        return setViewport(document, command.value);
      case 'add_table_reference': {
        requireCombined(command.viewId);
        const next = addTableReference(document, command.tableId, command.viewId, {
          x: command.placement.x,
          y: command.placement.y,
        });
        const node = next.layout.nodes.find(
          (item) => item.objectId === command.tableId && item.viewId === command.viewId,
        )!;
        return command.placement.width !== undefined || command.placement.height !== undefined
          ? updateNodeLayout(next, node.id, {
              ...(command.placement.width !== undefined ? { width: command.placement.width } : {}),
              ...(command.placement.height !== undefined
                ? { height: command.placement.height }
                : {}),
            })
          : next;
      }
      case 'remove_table_reference': {
        const node = document.layout.nodes.find((item) => item.id === command.nodeId);
        if (!node) throw new Error('화면의 테이블 참조를 찾을 수 없습니다.');
        requireCombined(node.viewId);
        return removeTableReference(document, command.nodeId);
      }
      case 'update_node_layout': {
        const node = document.layout.nodes.find((item) => item.id === command.nodeId);
        if (!node) throw new Error('배치 노드를 찾을 수 없습니다.');
        requireCombined(node.viewId);
        return updateNodeLayout(document, command.nodeId, {
          ...(command.patch.x !== undefined ? { x: command.patch.x } : {}),
          ...(command.patch.y !== undefined ? { y: command.patch.y } : {}),
          ...(command.patch.width !== undefined ? { width: command.patch.width } : {}),
          ...(command.patch.height !== undefined ? { height: command.patch.height } : {}),
        });
      }
      case 'upsert_relation_layout':
        requireCombined(command.value.viewId);
        return upsertRelationLayout(document, command.value);
      case 'delete_relation_layout':
        requireCombined(command.viewId);
        return {
          ...document,
          layout: {
            ...document.layout,
            relations: (document.layout.relations ?? []).filter(
              (item) => item.relationId !== command.relationId || item.viewId !== command.viewId,
            ),
          },
        };
      case 'upsert_note': {
        requireCombined(command.value.viewId);
        const existing = document.notes.find((item) => item.id === command.value.id);
        if (existing && existing.viewId !== command.value.viewId)
          throw new Error('메모는 다른 화면으로 이동할 수 없습니다.');
        const next = existing
          ? updateNote(document, command.value.id, command.value)
          : addNote(document, command.value, command.placement ?? { x: 0, y: 0 });
        const node = next.layout.nodes.find(
          (item) => item.objectId === command.value.id && item.viewId === command.value.viewId,
        );
        return node && command.placement
          ? updateNodeLayout(next, node.id, command.placement)
          : next;
      }
      case 'delete_note': {
        const note = document.notes.find((item) => item.id === command.id);
        if (!note) throw new Error('메모를 찾을 수 없습니다.');
        requireCombined(note.viewId);
        return removeNote(document, command.id);
      }
      case 'patch_note': {
        const current = document.notes.find((item) => item.id === command.id);
        if (!current) throw new Error('메모를 찾을 수 없습니다.');
        requireCombined(current.viewId);
        return updateNote(document, command.id, {
          ...(command.patch.text !== undefined ? { text: command.patch.text } : {}),
          ...(command.patch.color === null
            ? { color: undefined }
            : command.patch.color === undefined
              ? {}
              : { color: command.patch.color }),
        });
      }
    }
  }
}
