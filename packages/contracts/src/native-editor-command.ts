import { z } from 'zod';
import {
  nativeDeletionCollections,
  type NativeColumn,
  type NativeTable,
  type NativeColumnPatch,
  type NativeTablePatch,
  type NativeTableKey,
  type NativeIndex,
  type NativeCheck,
  type NativeTableRelation,
  type ProjectEnum,
  type NodeLayout,
  type Note,
  type RelationLayout,
  type CombinedView,
  type Domain,
} from '@ezerd/model';
import {
  nativeStoredColumnSchema,
  nativeStoredTableSchema,
  nativeStoredDesignDocumentSchema,
} from './native-document.js';
import {
  nodeLayoutSchema,
  noteSchema,
  relationLayoutSchema,
  viewportSchema,
  combinedViewSchema,
  personalStateSchema,
  domainSchema,
} from './workspace.js';

const id = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => value === value.trim() && value !== 'overview' && value !== '__tables__');
export const nativeColumnPatchSchema = z
  .strictObject({
    scope: nativeStoredColumnSchema.shape.scope.optional(),
    logical: nativeStoredColumnSchema.shape.logical.partial().strict().optional(),
    physical: nativeStoredColumnSchema.shape.physical.partial().strict().optional(),
    customProperties: nativeStoredColumnSchema.shape.customProperties.optional(),
  })
  .transform((value) => value as NativeColumnPatch);
export const nativeTablePatchSchema = z
  .strictObject({
    scope: nativeStoredTableSchema.shape.scope.optional(),
    color: nativeStoredTableSchema.shape.color,
    logical: nativeStoredTableSchema.shape.logical.partial().strict().optional(),
    physical: nativeStoredTableSchema.shape.physical.partial().strict().optional(),
    customProperties: nativeStoredTableSchema.shape.customProperties.optional(),
    canvasDisplay: nativeStoredTableSchema.shape.canvasDisplay,
  })
  .transform((value) => value as NativeTablePatch);

const collections = nativeStoredDesignDocumentSchema.in.shape;
const key = collections.keys.unwrap().element;
const index = collections.indexes.unwrap().element;
const check = collections.checks.unwrap().element;
const enumeration = collections.enums.unwrap().element;
const relation = collections.tableRelations.unwrap().element;
const coordinate = nodeLayoutSchema.shape.x;
const placement = z
  .strictObject({
    x: coordinate,
    y: coordinate,
    width: nodeLayoutSchema.shape.width.optional(),
    height: nodeLayoutSchema.shape.height.optional(),
  })
  .transform((value) => value as { x: number; y: number; width?: number; height?: number });
const nodePatch = nodeLayoutSchema
  .pick({ x: true, y: true, width: true, height: true })
  .partial()
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined))
  .transform((value) => value as Partial<Pick<NodeLayout, 'x' | 'y' | 'width' | 'height'>>);
const canvasId = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => value === value.trim());
export const nativeDomainCommandTypes = [
  'add_domain',
  'patch_domain',
  'delete_domain',
  'move_table_domain',
] as const;
const domainPatch = z
  .strictObject({
    name: domainSchema.shape.name.optional(),
    description: domainSchema.shape.description.optional(),
    color: domainSchema.shape.color.unwrap().nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined))
  .transform((value) => value as { name?: string; description?: string; color?: string | null });
export const nativeDomainRemovalPolicySchema = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('rejectNonempty') }),
    z.strictObject({ kind: z.literal('moveTables'), targetDomainId: id.nullable() }),
    z.strictObject({
      kind: z.literal('deleteTables'),
      cascadeGeneratedColumns: z.boolean().optional(),
    }),
  ])
  .transform(
    (value) =>
      value as
        | { kind: 'rejectNonempty' }
        | { kind: 'moveTables'; targetDomainId: string | null }
        | { kind: 'deleteTables'; cascadeGeneratedColumns?: boolean },
  );
/** Explicit domain lifecycle policies; personal state and physical payloads are not patchable. */
export const nativeDomainCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('add_domain'),
    value: domainSchema.extend({ id }).transform((value) => value as Domain),
    placement,
    nodeId: id.optional(),
  }),
  z.strictObject({ type: z.literal('patch_domain'), id, patch: domainPatch }),
  z.strictObject({ type: z.literal('delete_domain'), id, policy: nativeDomainRemovalPolicySchema }),
  z.strictObject({
    type: z.literal('move_table_domain'),
    tableId: id,
    targetDomainId: id.nullable(),
  }),
]);
export type NativeDomainCommand = z.output<typeof nativeDomainCommandSchema>;
/** Private combined views and all cameras belong to personal state, never shared sync. */
export const nativeSharedCanvasCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('add_table_reference'),
    tableId: id,
    viewId: canvasId,
    nodeId: canvasId.optional(),
    placement,
  }),
  z.strictObject({ type: z.literal('remove_table_reference'), nodeId: canvasId }),
  z.strictObject({ type: z.literal('update_node_layout'), nodeId: canvasId, patch: nodePatch }),
  z.strictObject({
    type: z.literal('upsert_note'),
    value: noteSchema.transform((value) => value as Note),
    placement: placement.optional(),
  }),
  z.strictObject({
    type: z.literal('patch_note'),
    id,
    patch: noteSchema
      .pick({ text: true, color: true })
      .partial()
      .strict()
      .transform((value) => value as Partial<Pick<Note, 'text' | 'color'>>),
  }),
  z.strictObject({ type: z.literal('delete_note'), id }),
  z.strictObject({
    type: z.literal('upsert_relation_layout'),
    value: relationLayoutSchema.transform((value) => value as RelationLayout),
  }),
  z.strictObject({ type: z.literal('delete_relation_layout'), relationId: id, viewId: canvasId }),
]);
export type NativeSharedCanvasCommand = z.output<typeof nativeSharedCanvasCommandSchema>;
export const nativePersonalCanvasCommandSchema = z.discriminatedUnion('type', [
  ...nativeSharedCanvasCommandSchema.options,
  z.strictObject({ type: z.literal('set_viewport'), value: viewportSchema }),
  z.strictObject({
    type: z.literal('upsert_combined_view'),
    value: combinedViewSchema.transform((value) => value as CombinedView),
  }),
  z.strictObject({ type: z.literal('delete_combined_view'), id }),
]);
export type NativePersonalCanvasCommand = z.output<typeof nativePersonalCanvasCommandSchema>;
export const nativeCanvasPersonalPendingSchema = z.strictObject({
  userId: z.uuid(),
  projectId: z.uuid(),
  revision: z.uuid(),
  databaseRevision: z.number().int().nonnegative(),
  projectVersion: z.number().int().nonnegative(),
  sequence: z.number().int().nonnegative(),
  expectedVersion: z.number().int().nonnegative(),
  before: personalStateSchema,
  state: personalStateSchema,
  editorDraft: z.strictObject({ key: z.string().min(1).max(320), revision: z.uuid() }).optional(),
});
export type NativeCanvasPersonalPending = z.output<typeof nativeCanvasPersonalPendingSchema>;
export const nativeKeyPatchSchema = key
  .omit({ id: true, tableId: true })
  .partial()
  .strict()
  .transform((value) => value as Partial<Omit<NativeTableKey, 'id' | 'tableId'>>);
export const nativeIndexPatchSchema = index
  .omit({ id: true, tableId: true })
  .partial()
  .strict()
  .transform((value) => value as Partial<Omit<NativeIndex, 'id' | 'tableId'>>);
export const nativeCheckPatchSchema = check
  .omit({ id: true, tableId: true })
  .partial()
  .strict()
  .transform((value) => value as Partial<Omit<NativeCheck, 'id' | 'tableId'>>);
export const nativeEnumPatchSchema = enumeration
  .omit({ id: true })
  .partial()
  .strict()
  .transform((value) => value as Partial<Omit<ProjectEnum, 'id'>>);
export const nativeForeignKeyPatchSchema = z
  .strictObject({
    scope: relation.shape.scope.optional(),
    logical: relation.shape.logical.partial().strict().optional(),
    physical: relation.shape.physical.unwrap().partial().strict().optional(),
    deferrable: relation.shape.deferrable,
  })
  .transform(
    (value) =>
      value as {
        scope?: NativeTableRelation['scope'];
        logical?: Partial<NativeTableRelation['logical']>;
        physical?: Partial<NonNullable<NativeTableRelation['physical']>>;
        deferrable?: NonNullable<NativeTableRelation['deferrable']>;
      },
  );

/** Shape only. Current-project policy, legacy provenance and retired IDs are checked at commit. */
export const nativeEditorCommandSchema = z.discriminatedUnion('type', [
  ...nativeDomainCommandSchema.options,
  ...nativeSharedCanvasCommandSchema.options,
  z.strictObject({ type: z.literal('patch_column'), id, patch: nativeColumnPatchSchema }),
  z.strictObject({ type: z.literal('patch_table'), id, patch: nativeTablePatchSchema }),
  z.strictObject({
    type: z.literal('add_table'),
    value: nativeStoredTableSchema.transform((value) => value as NativeTable),
  }),
  z.strictObject({
    type: z.literal('add_column'),
    value: nativeStoredColumnSchema.transform((value) => value as NativeColumn),
  }),
  z.strictObject({
    type: z.literal('add_key'),
    value: key.transform((value) => value as NativeTableKey),
  }),
  z.strictObject({ type: z.literal('patch_key'), id, patch: nativeKeyPatchSchema }),
  z.strictObject({
    type: z.literal('add_index'),
    value: index.transform((value) => value as NativeIndex),
  }),
  z.strictObject({ type: z.literal('patch_index'), id, patch: nativeIndexPatchSchema }),
  z.strictObject({
    type: z.literal('add_check'),
    value: check.transform((value) => value as NativeCheck),
  }),
  z.strictObject({ type: z.literal('patch_check'), id, patch: nativeCheckPatchSchema }),
  z.strictObject({
    type: z.literal('add_enum'),
    value: enumeration.transform((value) => value as ProjectEnum),
  }),
  z.strictObject({ type: z.literal('patch_enum'), id, patch: nativeEnumPatchSchema }),
  z.strictObject({
    type: z.literal('add_foreign_key'),
    value: relation.transform((value) => value as NativeTableRelation),
  }),
  z.strictObject({ type: z.literal('patch_foreign_key'), id, patch: nativeForeignKeyPatchSchema }),
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
export type NativeEditorCommand = z.output<typeof nativeEditorCommandSchema>;

export const nativeEditorDraftRefSchema = z.strictObject({
  key: z.string().min(1).max(320),
  revision: z.uuid(),
});
export const nativeEditorDraftSchema = z.strictObject({
  userId: z.uuid(),
  projectId: z.uuid(),
  key: z.string().min(1).max(320),
  revision: z.uuid(),
  expected: z.strictObject({
    version: z.number().int().nonnegative(),
    sequence: z.number().int().nonnegative(),
    databaseRevision: z.number().int().nonnegative(),
  }),
  // Incomplete form tokens are durable too; commands are parsed only on explicit submission.
  values: z
    .record(z.string().min(1).max(160), z.string().max(100000))
    .refine((value) => Object.keys(value).length <= 100),
  before: z
    .record(z.string().min(1).max(160), z.string().max(100000))
    .refine((value) => Object.keys(value).length <= 100),
});
export type NativeEditorDraft = z.output<typeof nativeEditorDraftSchema>;
export type NativeEditorDraftRef = z.output<typeof nativeEditorDraftRefSchema>;
