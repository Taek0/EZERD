import { z } from 'zod';
import { normalizePhysicalType, validatePhysicalType, TABLES_VIEW_ID } from '@ezerd/model';
const id = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((value) => value !== 'overview' && value !== TABLES_VIEW_ID);
const name = z.string().max(120);
const description = z.string().max(10000);
const scope = z.enum(['both', 'logical', 'physical']);
const properties = z
  .record(z.string().min(1).max(120), z.string().max(10000))
  .refine((value) => Object.keys(value).length <= 100, '속성은 영역별 100개까지 가능합니다.');
export const customPropertiesSchema = z.strictObject({
  common: properties,
  logical: properties,
  physical: properties,
});
export const tableSchema = z.strictObject({
  canvasDisplay: z
    .strictObject({ showNullable: z.boolean().optional(), showComment: z.boolean().optional() })
    .optional(),
  id,
  domainId: id.nullable(),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  scope,
  logical: z.strictObject({ name, definition: description }),
  physical: z.strictObject({ name, schema: name, comment: description }),
  customProperties: customPropertiesSchema,
});
export const physicalTypeInputSchema = z.strictObject({
  name,
  enumId: id.optional(),
  length: z.number().int().min(1).max(10485760).optional(),
  precision: z.number().int().min(0).max(1000).optional(),
  scale: z.number().int().min(-1000).max(1000).optional(),
  isArray: z.boolean(),
});
export const physicalTypePatchSchema = physicalTypeInputSchema.partial();
export const storedPhysicalTypeSchema = physicalTypeInputSchema.overwrite(normalizePhysicalType);
export const rawPhysicalTypeSchema = physicalTypeInputSchema.superRefine((value, ctx) => {
  for (const issue of validatePhysicalType(value)) {
    ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
  }
});
export const physicalTypeSchema = rawPhysicalTypeSchema.overwrite(normalizePhysicalType);
export const columnSchema = z.strictObject({
  id,
  tableId: id,
  scope,
  logical: z.strictObject({
    name,
    definition: description,
    semanticType: name,
    required: z.boolean(),
  }),
  physical: z.strictObject({
    name,
    type: physicalTypeSchema,
    nullable: z.boolean(),
    defaultExpression: z.string().max(10000).nullable(),
    comment: description,
  }),
  customProperties: customPropertiesSchema,
});
export const storedColumnSchema = columnSchema.extend({
  physical: columnSchema.shape.physical.extend({ type: storedPhysicalTypeSchema }),
});
export const rawStoredColumnSchema = columnSchema.extend({
  physical: columnSchema.shape.physical.extend({ type: physicalTypeInputSchema }),
});
export const rawColumnSchema = columnSchema.extend({
  physical: columnSchema.shape.physical.extend({ type: rawPhysicalTypeSchema }),
});
export const tableKeySchema = z.strictObject({
  id,
  tableId: id,
  scope,
  kind: z.enum(['primary', 'unique']),
  name,
  columnIds: z.array(id).max(32),
});
export const referentialActionSchema = z.enum([
  'NO ACTION',
  'RESTRICT',
  'CASCADE',
  'SET NULL',
  'SET DEFAULT',
]);
export const relationCardinalitySchema = z.strictObject({
  min: z.union([z.literal(0), z.literal(1)]),
  max: z.union([z.literal(1), z.literal('many')]),
});
export const tableRelationSchema = z.strictObject({
  id,
  sourceTableId: id,
  targetTableId: id,
  scope,
  logical: z.strictObject({
    name,
    cardinality: z.enum(['one-to-one', 'one-to-many', 'many-to-many']),
    required: z.boolean(),
    description: description.optional(),
    sourceCardinality: relationCardinalitySchema.optional(),
    targetCardinality: relationCardinalitySchema.optional(),
  }),
  physical: z
    .strictObject({
      name,
      sourceColumnIds: z.array(id).max(32),
      targetColumnIds: z.array(id).max(32),
      onDelete: referentialActionSchema,
      onUpdate: referentialActionSchema,
    })
    .nullable(),
});

const enumLabel = z
  .string()
  .refine(
    (value) => !value.includes('\0') && utf8Length(value) <= 63,
    'ENUM 값은 UTF-8 63바이트 이하입니다.',
  );
export const projectEnumSchema = z.strictObject({
  id,
  name: enumLabel.refine((value) => !!value.trim()),
  schema: enumLabel,
  values: z
    .array(enumLabel)
    .min(1)
    .max(1000)
    .refine((values) => new Set(values).size === values.length, 'ENUM 값이 중복되었습니다.'),
});

function utf8Length(value: string): number {
  let count = 0;
  for (const char of value) {
    const code = char.codePointAt(0)!;
    count += code <= 127 ? 1 : code <= 2047 ? 2 : code <= 65535 ? 3 : 4;
  }
  return count;
}
