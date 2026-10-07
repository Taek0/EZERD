import { z } from 'zod';
import {
  designDocumentReadSchema,
  nativeCancellationInputSchema,
  nativeCancellationResultSchema,
  nativeExpressionSchema,
  nativeHistoryEntrySchema,
  nativeStoredColumnSchema,
  nativeStoredDesignDocumentSchema,
  nativeStoredTableSchema,
  nativeSyncOperationResultSchema,
  nativeTransferReadSchema,
  projectTransferReadSchema,
  rawDesignDocumentReadSchema,
  rawStoredDesignDocumentSchema,
  syncOperationResultReadSchema,
  versionedProjectTransferSchema,
} from '@ezerd/contracts';

const identity = z
  .object({ operationId: z.uuid(), groupId: z.uuid(), clientId: z.uuid() })
  .passthrough();
const upgradeIdentity = identity.omit({ groupId: true });
const representations = new Map<z.core.$ZodType, { name: string; schema: z.ZodType }>([
  [nativeExpressionSchema, { name: 'expression', schema: nativeExpressionSchema.out }],
  [
    nativeStoredDesignDocumentSchema,
    { name: 'nativeDocument', schema: nativeStoredDesignDocumentSchema.in },
  ],
  [
    rawStoredDesignDocumentSchema,
    { name: 'legacyDocument', schema: rawStoredDesignDocumentSchema.clone() },
  ],
  [nativeStoredTableSchema, { name: 'nativeTable', schema: nativeStoredTableSchema.clone() }],
  [nativeStoredColumnSchema, { name: 'nativeColumn', schema: nativeStoredColumnSchema.clone() }],
  [rawDesignDocumentReadSchema, { name: 'document', schema: designDocumentReadSchema }],
  [
    versionedProjectTransferSchema,
    { name: 'versionedTransfer', schema: versionedProjectTransferSchema.out },
  ],
  [
    nativeTransferReadSchema,
    {
      name: 'transfer',
      schema: z.union([versionedProjectTransferSchema.out, projectTransferReadSchema]),
    },
  ],
  [
    nativeHistoryEntrySchema.shape.result,
    { name: 'recordedAck', schema: syncOperationResultReadSchema },
  ],
  [
    nativeCancellationResultSchema.options[0].shape.result,
    { name: 'recordedAck', schema: syncOperationResultReadSchema },
  ],
  [
    nativeCancellationResultSchema.options[1].shape.result,
    { name: 'cancelledAck', schema: nativeSyncOperationResultSchema },
  ],
]);
for (const option of nativeCancellationInputSchema.options) {
  const upgrade = option.shape.kind.value === 'native-upgrade';
  representations.set(option.shape.request, {
    name: upgrade ? 'upgradeIdentity' : 'requestIdentity',
    schema: upgrade ? upgradeIdentity : identity,
  });
}
const prefix = '#/definitions/ezerd_mcp_';
const cache = new WeakMap<z.ZodType, Record<string, unknown>>();

/** Describe raw readers and guarded ASTs without running a normalizing parser on the payload. */
export function mcpSchemaMetadata(schema: z.ZodType) {
  const cached = cache.get(schema);
  if (cached) return cached;
  const pending = new Map<string, z.ZodType>();
  const render = (source: z.ZodType, componentName?: string): Record<string, unknown> =>
    z.toJSONSchema(source, {
      io: 'input',
      target: 'draft-07',
      unrepresentable: 'any',
      override: ({ zodSchema, jsonSchema }) => {
        const representation = representations.get(zodSchema);
        // Cloned/derived Zod schemas can visit their original parent during conversion.
        // Expand a component's own structure instead of making a self-only reference.
        if (!representation || representation.name === componentName) return;
        pending.set(representation.name, representation.schema);
        for (const key of Object.keys(jsonSchema)) delete jsonSchema[key];
        jsonSchema.$ref = prefix + representation.name;
      },
    });
  const result = render(schema);
  const definitions: Record<string, unknown> = {};
  // Rendering one component may discover another; keep every reference at the document root.
  for (const [name, source] of pending) {
    const component = render(source, name);
    delete component.$schema;
    const rebase = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(rebase);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.entries(value).map(([key, field]) => [
          key,
          key === '$ref' &&
          typeof field === 'string' &&
          field.startsWith('#') &&
          !field.startsWith(prefix)
            ? `${prefix}${name}${field.slice(1)}`
            : rebase(field),
        ]),
      );
    };
    definitions[`ezerd_mcp_${name}`] = rebase(component);
  }
  if (pending.size)
    result.definitions = {
      ...(result.definitions && typeof result.definitions === 'object' ? result.definitions : {}),
      ...definitions,
    };
  cache.set(schema, result);
  return result;
}
