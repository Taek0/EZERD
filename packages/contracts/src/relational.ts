import { z } from 'zod';
const id = z.string().trim().min(1).max(160).refine(value => value !== 'overview');
const name = z.string().max(120);
const description = z.string().max(10000);
const scope = z.enum(['both', 'logical', 'physical']);
const properties = z.record(z.string().min(1).max(120), z.string().max(10000)).refine(value => Object.keys(value).length <= 100, '속성은 영역별 100개까지 가능합니다.');
export const customPropertiesSchema = z.strictObject({ common: properties, logical: properties, physical: properties });
export const tableSchema = z.strictObject({
  id, domainId: id, scope,
  logical: z.strictObject({ name, definition: description }),
  physical: z.strictObject({ name, schema: name, comment: description }),
  customProperties: customPropertiesSchema,
});
export const physicalTypeSchema = z.strictObject({
  name, length: z.number().int().min(1).max(10485760).optional(),
  precision: z.number().int().min(0).max(1000).optional(),
  scale: z.number().int().min(-1000).max(1000).optional(), isArray: z.boolean(),
});
export const columnSchema = z.strictObject({
  id, tableId: id, scope,
  logical: z.strictObject({ name, definition: description, semanticType: name, required: z.boolean() }),
  physical: z.strictObject({ name, type: physicalTypeSchema, nullable: z.boolean(), defaultExpression: z.string().max(10000).nullable(), comment: description }),
  customProperties: customPropertiesSchema,
});
export const tableKeySchema = z.strictObject({ id, tableId: id, scope, kind: z.enum(['primary', 'unique']), name, columnIds: z.array(id).max(32) });
export const referentialActionSchema = z.enum(['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT']);
export const tableRelationSchema = z.strictObject({
  id, sourceTableId: id, targetTableId: id, scope,
  logical: z.strictObject({ name, cardinality: z.enum(['one-to-one', 'one-to-many', 'many-to-many']), required: z.boolean() }),
  physical: z.strictObject({ name, sourceColumnIds: z.array(id).max(32), targetColumnIds: z.array(id).max(32), onDelete: referentialActionSchema, onUpdate: referentialActionSchema }).nullable(),
});

