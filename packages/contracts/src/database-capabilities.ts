import { z } from 'zod';
import { databaseFeatureIds, databaseTypeCatalog } from '@ezerd/model';
import { projectDatabaseStateSchema } from './database-state.js';
const parameter = z.enum([
  'length',
  'precision',
  'scale',
  'bitLength',
  'unsigned',
  'fields',
  'srid',
]);
const parameterRule = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('integer'),
    min: z.number(),
    max: z.number(),
    required: z.boolean().optional(),
  }),
  z.strictObject({ kind: z.literal('boolean') }),
  z.strictObject({ kind: z.literal('choice'), values: z.array(z.string()) }),
]);
const availability = z.enum(['specified', 'implemented', 'verified']);
export const projectDatabaseCapabilitiesSchema = z.strictObject({
  projectId: z.uuid(),
  version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  database: projectDatabaseStateSchema,
  documentSchemaVersion: z.union([z.literal(1), z.literal(2)]),
  capabilityScope: z.literal('native-v2'),
  targetVersion: z.string(),
  assumptions: z.array(z.string()),
  defaultTypeId: z.string(),
  defaultTypeParameters: z.partialRecord(parameter, z.union([z.string(), z.number(), z.boolean()])),
  types: z.array(
    z.strictObject({
      id: z.string(),
      sqlName: z.string(),
      aliases: z.array(z.string()),
      category: z.enum([...new Set(databaseTypeCatalog.map((type) => type.category))]),
      parameters: z.partialRecord(parameter, parameterRule),
      array: z.boolean(),
      deprecated: z.boolean(),
      sqliteStrict: z.boolean(),
      sqliteAffinity: z.enum(['integer', 'text', 'blob', 'real', 'numeric']).optional(),
      availability,
      usable: z.boolean(),
    }),
  ),
  features: z.array(
    z.strictObject({
      id: z.enum(databaseFeatureIds),
      supportedByEngine: z.boolean(),
      availability,
      usable: z.boolean(),
      requiresObjectValidation: z.literal(true),
    }),
  ),
});
export type ProjectDatabaseCapabilities = z.infer<typeof projectDatabaseCapabilitiesSchema>;
