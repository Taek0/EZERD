import { z } from 'zod';
import {
  columnSchema,
  domainRelationSchema,
  domainSchema,
  noteSchema,
  physicalTypePatchSchema,
  projectEnumSchema,
  tableKeySchema,
  tableRelationSchema,
  tableSchema,
} from '@ezerd/contracts';
import {
  updateColumn,
  updateDomain,
  updateNote,
  updateTable,
  upsertDomainRelation,
  upsertEnum,
  upsertKey,
  upsertTableRelation,
  type Column,
  type CustomProperties,
  type DesignDocument,
  type Domain,
  type DomainRelation,
  type Note,
  type ProjectEnum,
  type Table,
  type TableKey,
  type TableRelation,
} from '@ezerd/model';

const id = z.string().trim().min(1).max(160);
const propertyChanges = z.record(z.string().min(1).max(120), z.string().max(10000).nullable());
const customPropertiesPatch = z.strictObject({
  common: propertyChanges.optional(),
  logical: propertyChanges.optional(),
  physical: propertyChanges.optional(),
});
const nonEmpty = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
  schema.refine((value) => Object.values(value).some((item) => item !== undefined));
const domainPatch = nonEmpty(
  z.strictObject({
    name: domainSchema.shape.name.optional(),
    description: domainSchema.shape.description.optional(),
    color: domainSchema.shape.color.nullable(),
  }),
);
const tablePatch = nonEmpty(
  z.strictObject({
    domainId: tableSchema.shape.domainId.optional(),
    color: tableSchema.shape.color.nullable(),
    scope: tableSchema.shape.scope.optional(),
    logical: tableSchema.shape.logical.partial().optional(),
    physical: tableSchema.shape.physical.partial().optional(),
    customProperties: customPropertiesPatch.optional(),
    canvasDisplay: tableSchema.shape.canvasDisplay,
  }),
);
const columnPatch = nonEmpty(
  z.strictObject({
    scope: columnSchema.shape.scope.optional(),
    logical: columnSchema.shape.logical.partial().optional(),
    physical: columnSchema.shape.physical
      .omit({ type: true })
      .partial()
      .extend({ type: physicalTypePatchSchema.optional() })
      .optional(),
    customProperties: customPropertiesPatch.optional(),
  }),
);
const notePatch = nonEmpty(
  z.strictObject({
    text: noteSchema.shape.text.optional(),
    color: noteSchema.shape.color.nullable(),
  }),
);
const domainRelationPatch = nonEmpty(domainRelationSchema.omit({ id: true }).partial());
const keyPatch = nonEmpty(tableKeySchema.omit({ id: true, tableId: true }).partial());
const tableRelationPatch = nonEmpty(
  z.strictObject({
    sourceTableId: tableRelationSchema.shape.sourceTableId.optional(),
    targetTableId: tableRelationSchema.shape.targetTableId.optional(),
    scope: tableRelationSchema.shape.scope.optional(),
    logical: tableRelationSchema.shape.logical.partial().optional(),
    physical: tableRelationSchema.shape.physical.optional(),
  }),
);
const enumPatch = nonEmpty(projectEnumSchema.omit({ id: true }).partial());

export const patchCommandSchemas = [
  z.strictObject({ type: z.literal('patch_domain'), id, patch: domainPatch }),
  z.strictObject({ type: z.literal('patch_table'), id, patch: tablePatch }),
  z.strictObject({ type: z.literal('patch_column'), id, patch: columnPatch }),
  z.strictObject({ type: z.literal('patch_note'), id, patch: notePatch }),
  z.strictObject({ type: z.literal('patch_domain_relation'), id, patch: domainRelationPatch }),
  z.strictObject({ type: z.literal('patch_key'), id, patch: keyPatch }),
  z.strictObject({ type: z.literal('patch_table_relation'), id, patch: tableRelationPatch }),
  z.strictObject({ type: z.literal('patch_enum'), id, patch: enumPatch }),
] as const;
export const patchCommandSchema = z.discriminatedUnion('type', patchCommandSchemas);
export type PatchCommand = z.infer<typeof patchCommandSchema>;

function existing<T extends { id: string }>(items: T[] | undefined, id: string): T {
  const item = items?.find((value) => value.id === id);
  if (!item) throw new Error('수정할 객체를 찾을 수 없습니다.');
  return item;
}

function defined<T extends object>(value: object): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

function mergeCustomProperties(
  current: CustomProperties,
  patch: z.infer<typeof customPropertiesPatch>,
): CustomProperties {
  const merge = (values: Record<string, string>, changes?: Record<string, string | null>) => {
    const next = { ...values };
    for (const [key, value] of Object.entries(changes ?? {})) {
      if (value === null) delete next[key];
      else next[key] = value;
    }
    return next;
  };
  return {
    common: merge(current.common, patch.common),
    logical: merge(current.logical, patch.logical),
    physical: merge(current.physical, patch.physical),
  };
}

export function applyPatchCommand(document: DesignDocument, command: PatchCommand): DesignDocument {
  switch (command.type) {
    case 'patch_domain': {
      const current = existing(document.domains, command.id);
      const { color, ...rest } = command.patch;
      const next: Domain = { ...current, ...defined<Domain>(rest) };
      if (color === null) next.color = undefined;
      else if (color !== undefined) next.color = color;
      return updateDomain(document, command.id, next);
    }
    case 'patch_table': {
      const current = existing(document.tables, command.id);
      const { logical, physical, customProperties, color, ...rest } = command.patch;
      const next: Table = {
        ...current,
        ...defined<Table>(rest),
        ...(logical
          ? { logical: { ...current.logical, ...defined<Table['logical']>(logical) } }
          : {}),
        ...(physical
          ? { physical: { ...current.physical, ...defined<Table['physical']>(physical) } }
          : {}),
        ...(customProperties
          ? { customProperties: mergeCustomProperties(current.customProperties, customProperties) }
          : {}),
      };
      if (color === null) next.color = undefined;
      else if (color !== undefined) next.color = color;
      return updateTable(document, command.id, next);
    }
    case 'patch_column': {
      const current = existing(document.columns, command.id);
      const { logical, physical, customProperties, ...rest } = command.patch;
      const next: Column = {
        ...current,
        ...defined<Column>(rest),
        ...(logical
          ? { logical: { ...current.logical, ...defined<Column['logical']>(logical) } }
          : {}),
        ...(physical
          ? {
              physical: {
                ...current.physical,
                ...defined<Column['physical']>(physical),
                ...(physical.type
                  ? {
                      type: {
                        ...current.physical.type,
                        ...defined<Column['physical']['type']>(physical.type),
                      },
                    }
                  : {}),
              },
            }
          : {}),
        ...(customProperties
          ? { customProperties: mergeCustomProperties(current.customProperties, customProperties) }
          : {}),
      };
      return updateColumn(document, command.id, next);
    }
    case 'patch_note': {
      const current = existing(document.notes, command.id);
      const { color, ...rest } = command.patch;
      const next: Note = { ...current, ...defined<Note>(rest) };
      if (color === null) next.color = undefined;
      else if (color !== undefined) next.color = color;
      return updateNote(document, command.id, next);
    }
    case 'patch_domain_relation': {
      const current = existing(document.domainRelations, command.id);
      return upsertDomainRelation(document, {
        ...current,
        ...defined<DomainRelation>(command.patch),
      });
    }
    case 'patch_key': {
      const current = existing(document.keys, command.id);
      return upsertKey(document, { ...current, ...defined<TableKey>(command.patch) });
    }
    case 'patch_table_relation': {
      const current = existing(document.tableRelations, command.id);
      const { logical, ...rest } = command.patch;
      const next: TableRelation = {
        ...current,
        ...defined<TableRelation>(rest),
        ...(logical
          ? { logical: { ...current.logical, ...defined<TableRelation['logical']>(logical) } }
          : {}),
      };
      return upsertTableRelation(document, next);
    }
    case 'patch_enum': {
      const current = existing(document.enums, command.id);
      return upsertEnum(document, { ...current, ...defined<ProjectEnum>(command.patch) });
    }
  }
}
