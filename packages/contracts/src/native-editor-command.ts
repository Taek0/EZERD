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
} from '@ezerd/model';
import {
  nativeStoredColumnSchema,
  nativeStoredTableSchema,
  nativeStoredDesignDocumentSchema,
} from './native-document.js';

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
