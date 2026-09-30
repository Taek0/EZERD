import { z } from 'zod';
import {
  databaseKinds,
  databaseProfiles,
  getDatabaseProfile,
  getDatabaseType,
  nativeBuiltinFunctionIds,
  validateDatabaseTypeParameters,
  type NativeExpression,
  type NativeDesignDocument,
  type DatabaseTypeId,
  type DatabaseTypeParameterInput,
  type TypeParameterName,
} from '@ezerd/model';
import {
  physicalTypeInputSchema,
  columnSchema,
  tableSchema,
  tableKeySchema,
  tableRelationSchema,
} from './relational.js';
import {
  MAX_DOCUMENT_BYTES,
  storedDesignDocumentSchema,
  rawStoredDesignDocumentSchema,
  databaseKindSchema,
} from './workspace.js';
import { MAX_PROJECT_TRANSFER_BYTES } from './project-transfer.js';

const id = z.string().trim().min(1).max(160);
const objectId = id.refine(
  (value) => value !== 'overview' && value !== '__tables__',
  'document.reserved-identity',
);
const database = z.enum(databaseKinds);
const profileId = z.enum(databaseProfiles.map((profile) => profile.id));
export const databaseContextSchema = z
  .strictObject({ kind: database, profileId })
  .superRefine((value, ctx) => {
    try {
      getDatabaseProfile(value);
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['profileId'],
        message: 'database.profile-unsupported',
      });
    }
  });
const name = z.string().max(120);
const array = z.strictObject({ dimensions: z.number().int().min(1).max(6) });
function definedParameters(
  input: Record<string, string | number | boolean | undefined>,
): DatabaseTypeParameterInput {
  const result: Partial<Record<TypeParameterName, string | number | boolean>> = {};
  for (const [key, value] of Object.entries(input))
    if (value !== undefined) result[key as TypeParameterName] = value;
  return result;
}
const parameters = z
  .strictObject({
    length: z.number().optional(),
    precision: z.number().optional(),
    scale: z.number().optional(),
    bitLength: z.number().optional(),
    unsigned: z.boolean().optional(),
    fields: z.string().optional(),
    srid: z.number().optional(),
  })
  .transform(definedParameters);
const builtin = z
  .strictObject({
    kind: z.literal('builtin'),
    database,
    typeId: z.string().max(160),
    parameters,
    array: array.optional(),
    declarationAlias: z.literal('boolean').optional(),
  })
  .superRefine((value, ctx) => {
    const definition = getDatabaseType(value.typeId as DatabaseTypeId);
    if (
      !definition ||
      definition.databaseKind !== value.database ||
      definition.category === 'value-list'
    ) {
      ctx.addIssue({ code: 'custom', path: ['typeId'], message: 'type.not-supported' });
      return;
    }
    for (const issue of validateDatabaseTypeParameters(definition, value.parameters))
      ctx.addIssue({ code: 'custom', path: ['parameters', issue.parameter], message: issue.code });
    if (value.array && value.database !== 'postgresql')
      ctx.addIssue({ code: 'custom', path: ['array'], message: 'type.option-not-supported' });
    if (value.declarationAlias && value.typeId !== 'mysql:tinyint')
      ctx.addIssue({
        code: 'custom',
        path: ['declarationAlias'],
        message: 'type.option-not-supported',
      });
  });
const valueList = z
  .strictObject({
    kind: z.literal('valueList'),
    database: z.literal('mysql'),
    typeId: z.enum(['mysql:enum', 'mysql:set']),
    values: z.array(z.string().max(10000)).min(1).max(1000),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.values).size !== value.values.length)
      ctx.addIssue({ code: 'custom', path: ['values'], message: 'type.duplicate-values' });
    if (
      value.typeId === 'mysql:set' &&
      (value.values.length > 64 || value.values.some((item) => item.includes(',')))
    )
      ctx.addIssue({ code: 'custom', path: ['values'], message: 'type.set-values-invalid' });
    if (value.values.some((item) => item.includes('\0')))
      ctx.addIssue({ code: 'custom', path: ['values'], message: 'type.values-invalid' });
  });
const projectEnum = z.strictObject({
  kind: z.literal('projectEnum'),
  database: z.literal('postgresql'),
  enumId: id,
  array: array.optional(),
});
const declared = z.strictObject({
  kind: z.literal('declared'),
  database: z.literal('sqlite'),
  name: z
    .string()
    .min(1)
    .max(120)
    .refine((value) => !/[\0;]|--|\/\*/.test(value), 'type.declaration-invalid'),
  numericArguments: z
    .array(
      z
        .string()
        .max(100)
        .regex(/^[+-]?\d+(?:\.\d+)?$/),
    )
    .max(2),
});
export const nativeColumnTypeSchema = z.union([
  builtin,
  projectEnum,
  valueList,
  declared,
  z.strictObject({ kind: z.literal('untyped'), database: z.literal('sqlite') }),
]);
const legacyType = z.strictObject({
  kind: z.literal('legacy'),
  source: z.literal('document-v1'),
  original: physicalTypeInputSchema,
});
export const nativeStoredColumnTypeSchema = z.union([nativeColumnTypeSchema, legacyType]);

const stringLiteral = z
  .strictObject({
    kind: z.literal('literal'),
    literalType: z.enum(['string', 'number', 'binary', 'json', 'typedText']),
    value: z.string().max(10000),
  })
  .superRefine((value, ctx) => {
    if (value.value.includes('\0'))
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'literal.null-character' });
    if (
      value.literalType === 'number' &&
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.value)
    )
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'literal.number-invalid' });
    if (value.literalType === 'binary' && !/^(?:[0-9a-f]{2})*$/i.test(value.value))
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'literal.binary-invalid' });
    if (value.literalType === 'json')
      try {
        JSON.parse(value.value);
      } catch {
        ctx.addIssue({ code: 'custom', path: ['value'], message: 'literal.json-invalid' });
      }
  });
const literal = z.union([
  stringLiteral,
  z.strictObject({
    kind: z.literal('literal'),
    literalType: z.literal('boolean'),
    value: z.boolean(),
  }),
]);
const rawExpression: z.ZodType<NativeExpression> = z.lazy(() =>
  z.union([
    literal,
    z.strictObject({ kind: z.literal('null') }),
    z.strictObject({ kind: z.literal('column'), columnId: id }),
    z.strictObject({
      kind: z.literal('call'),
      functionId: z.enum(nativeBuiltinFunctionIds),
      args: z.array(rawExpression).max(64),
    }),
    z.strictObject({
      kind: z.literal('unary'),
      operator: z.enum(['NOT', '+', '-']),
      operand: rawExpression,
    }),
    z.strictObject({
      kind: z.literal('binary'),
      operator: z.enum(['+', '-', '*', '/', '%', '=', '<>', '<', '<=', '>', '>=', 'AND', 'OR']),
      left: rawExpression,
      right: rawExpression,
    }),
    z.strictObject({ kind: z.literal('isNull'), operand: rawExpression, negate: z.boolean() }),
    z.strictObject({
      kind: z.literal('in'),
      operand: rawExpression,
      values: z.array(rawExpression).min(1).max(1000),
      negate: z.boolean(),
    }),
  ]),
);
/** Reject depth/cycles before Zod's recursive parser can overflow the stack. */
function withinExpressionBudget(input: unknown): boolean {
  const pending: { value: unknown; depth: number }[] = [{ value: input, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (current.depth > 32 || ++count > 2048) return false;
    if (!current.value || typeof current.value !== 'object' || Array.isArray(current.value))
      continue;
    const node = current.value as Record<string, unknown>;
    const add = (value: unknown) => pending.push({ value, depth: current.depth + 1 });
    if (node.kind === 'call' && Array.isArray(node.args)) node.args.forEach(add);
    if (node.kind === 'unary' || node.kind === 'isNull' || node.kind === 'in') add(node.operand);
    if (node.kind === 'binary') {
      add(node.left);
      add(node.right);
    }
    if (node.kind === 'in' && Array.isArray(node.values)) node.values.forEach(add);
  }
  return true;
}
export const nativeExpressionSchema = z.preprocess((input, ctx) => {
  if (!withinExpressionBudget(input)) {
    ctx.addIssue({ code: 'custom', message: 'expression.complexity-limit' });
    return z.NEVER;
  }
  return input;
}, rawExpression);
export const nativeDefaultValueSchema = z.union([
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('null') }),
  literal,
  z.strictObject({ kind: z.literal('expression'), expression: nativeExpressionSchema }),
]);
export const nativeStoredDefaultValueSchema = z.union([
  nativeDefaultValueSchema,
  z.strictObject({
    kind: z.literal('legacyExpression'),
    source: z.literal('document-v1'),
    original: z.string().max(10000),
  }),
]);
export const nativeGenerationSchema = z.union([
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('serial'), database: z.literal('postgresql') }),
  z.strictObject({
    kind: z.literal('identity'),
    database: z.literal('postgresql'),
    mode: z.enum(['always', 'byDefault']),
    sequence: z
      .strictObject({
        start: z
          .string()
          .regex(/^[+-]?\d+$/)
          .max(100)
          .optional(),
        increment: z
          .string()
          .regex(/^[+-]?\d+$/)
          .max(100)
          .optional(),
        min: z
          .string()
          .regex(/^[+-]?\d+$/)
          .max(100)
          .optional(),
        max: z
          .string()
          .regex(/^[+-]?\d+$/)
          .max(100)
          .optional(),
        cache: z.number().int().positive().max(2147483647).optional(),
        cycle: z.boolean().optional(),
      })
      .optional(),
  }),
  z.strictObject({ kind: z.literal('autoIncrement'), database: z.enum(['mysql', 'sqlite']) }),
  z.strictObject({
    kind: z.literal('computed'),
    database,
    storage: z.enum(['stored', 'virtual']),
    expression: nativeExpressionSchema,
  }),
]);
export const nativeNamespaceSchema = z.union([
  z.strictObject({ kind: z.literal('postgresSchema'), name }),
  z.strictObject({ kind: z.literal('mysqlCurrentDatabase') }),
  z.strictObject({ kind: z.literal('sqliteMain') }),
]);
const storedNamespace = z.union([
  nativeNamespaceSchema,
  z.strictObject({
    kind: z.literal('legacyNamespace'),
    source: z.literal('document-v1'),
    original: name,
  }),
]);
const tableOptions = z.union([
  z.strictObject({ database: z.literal('postgresql') }),
  z.strictObject({
    database: z.literal('mysql'),
    engine: z.literal('InnoDB'),
    charset: name.optional(),
    collation: name.optional(),
  }),
  z.strictObject({ database: z.literal('sqlite'), strict: z.boolean(), withoutRowid: z.boolean() }),
]);
const columnOptions = z.union([
  z.strictObject({ database: z.literal('postgresql'), collation: name.optional() }),
  z.strictObject({
    database: z.literal('mysql'),
    charset: name.optional(),
    collation: name.optional(),
    onUpdate: nativeExpressionSchema.optional(),
  }),
  z.strictObject({
    database: z.literal('sqlite'),
    collation: z.enum(['BINARY', 'NOCASE', 'RTRIM']).optional(),
  }),
]);
export const nativeStoredTableSchema = tableSchema.omit({ physical: true }).extend({
  physical: z.strictObject({
    name,
    namespace: storedNamespace,
    comment: z.string().max(10000),
    options: tableOptions,
  }),
});
export const nativeStoredColumnSchema = columnSchema.omit({ physical: true }).extend({
  physical: z.strictObject({
    name,
    type: nativeStoredColumnTypeSchema,
    nullable: z.boolean(),
    comment: z.string().max(10000),
    generation: nativeGenerationSchema,
    defaultValue: nativeStoredDefaultValueSchema,
    options: columnOptions,
  }),
});
const scope = z.enum(['both', 'logical', 'physical']);
const deferrable = z.strictObject({ initially: z.enum(['immediate', 'deferred']) });
const nativeKey = tableKeySchema.extend({
  deferrable: deferrable.optional(),
  nullsNotDistinct: z.boolean().optional(),
});
const nativeRelation = tableRelationSchema.extend({ deferrable: deferrable.optional() });
const nativeEnum = z.strictObject({
  id: objectId,
  name,
  schema: name,
  values: z.array(z.string().max(10000)).min(1).max(1000),
});
const nativeCheck = z.strictObject({
  id: objectId,
  tableId: id,
  name,
  scope,
  expression: nativeExpressionSchema,
});
const nativeIndex = z.strictObject({
  id: objectId,
  tableId: id,
  name,
  scope,
  unique: z.boolean(),
  parts: z
    .array(
      z.strictObject({
        expression: nativeExpressionSchema,
        direction: z.enum(['asc', 'desc']),
        prefixLength: z.number().int().positive().max(65535).optional(),
      }),
    )
    .min(1)
    .max(32),
  options: z.union([
    z.strictObject({
      database: z.literal('postgresql'),
      method: z.enum(['btree', 'hash', 'gist', 'spgist', 'gin', 'brin']),
      predicate: nativeExpressionSchema.optional(),
      includeColumnIds: z.array(id).max(32).optional(),
      nullsNotDistinct: z.boolean().optional(),
    }),
    z.strictObject({
      database: z.literal('mysql'),
      kind: z.enum(['btree', 'fulltext', 'spatial']),
      invisible: z.boolean().optional(),
    }),
    z.strictObject({ database: z.literal('sqlite'), predicate: nativeExpressionSchema.optional() }),
  ]),
});
function withinJsonBudget(input: unknown, max: number): boolean {
  let bytes = 0;
  for (const character of JSON.stringify(input)) {
    const code = character.codePointAt(0)!;
    bytes += code <= 127 ? 1 : code <= 2047 ? 2 : code <= 65535 ? 3 : 4;
    if (bytes > max) return false;
  }
  return true;
}
/** Read/candidate shape; server write policies additionally protect existing legacy values. */
export const nativeStoredDesignDocumentSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    database: databaseContextSchema,
    views: storedDesignDocumentSchema.shape.views,
    domains: storedDesignDocumentSchema.shape.domains,
    domainRelations: storedDesignDocumentSchema.shape.domainRelations,
    notes: storedDesignDocumentSchema.shape.notes,
    layout: storedDesignDocumentSchema.shape.layout,
    tables: z.array(nativeStoredTableSchema).max(5000).optional(),
    columns: z.array(nativeStoredColumnSchema).max(20000).optional(),
    enums: z.array(nativeEnum).max(1000).optional(),
    keys: z.array(nativeKey).max(10000).optional(),
    tableRelations: z.array(nativeRelation).max(10000).optional(),
    indexes: z.array(nativeIndex).max(10000).optional(),
    checks: z.array(nativeCheck).max(10000).optional(),
  })
  .superRefine((document, ctx) => {
    if (!withinJsonBudget(document, MAX_DOCUMENT_BYTES))
      ctx.addIssue({ code: 'custom', message: 'document.size-limit' });
    const identities = [
      ...document.domains,
      ...(document.views ?? []),
      ...document.domainRelations,
      ...document.notes,
      ...(document.tables ?? []),
      ...(document.columns ?? []),
      ...(document.enums ?? []),
      ...(document.keys ?? []),
      ...(document.tableRelations ?? []),
      ...(document.indexes ?? []),
      ...(document.checks ?? []),
    ];
    if (new Set(identities.map((item) => item.id)).size !== identities.length)
      ctx.addIssue({ code: 'custom', message: 'document.duplicate-identities' });
    const nodes = document.layout.nodes;
    if (
      new Set(nodes.map((node) => node.id)).size !== nodes.length ||
      new Set(nodes.map((node) => JSON.stringify([node.viewId, node.objectId]))).size !==
        nodes.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['layout', 'nodes'],
        message: 'document.duplicate-placement',
      });
    if (
      new Set(document.layout.viewports.map((view) => view.viewId)).size !==
      document.layout.viewports.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['layout', 'viewports'],
        message: 'document.duplicate-viewport',
      });
    const routes = document.layout.relations ?? [];
    if (
      new Set(routes.map((route) => JSON.stringify([route.viewId, route.relationId]))).size !==
      routes.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['layout', 'relations'],
        message: 'document.duplicate-route',
      });
  })
  .transform((value) => value as NativeDesignDocument);

export const designDocumentReadSchema = z.union([
  rawStoredDesignDocumentSchema,
  nativeStoredDesignDocumentSchema,
]);
export const nativeProjectTransferSchema = z
  .strictObject({
    format: z.literal('ezerd-project'),
    formatVersion: z.literal(2),
    exportedAt: z.iso.datetime(),
    project: z.strictObject({
      name: z.string().trim().min(1).max(120),
      databaseKind: databaseKindSchema,
      databaseProfileId: profileId,
    }),
    document: nativeStoredDesignDocumentSchema,
  })
  .superRefine((file, ctx) => {
    if (
      file.project.databaseKind !== file.document.database.kind ||
      file.project.databaseProfileId !== file.document.database.profileId
    )
      ctx.addIssue({ code: 'custom', path: ['project'], message: 'database.context-mismatch' });
    if (!withinJsonBudget(file, MAX_PROJECT_TRANSFER_BYTES))
      ctx.addIssue({ code: 'custom', message: 'project-transfer.size-limit' });
  });
export type NativeProjectTransfer = z.infer<typeof nativeProjectTransferSchema>;

const legacyProjectTransferReadSchema = z
  .strictObject({
    format: z.literal('ezerd-project'),
    formatVersion: z.literal(1),
    exportedAt: z.iso.datetime(),
    project: z.strictObject({
      name: z.string().trim().min(1).max(120),
      databaseKind: databaseKindSchema.optional(),
    }),
    document: rawStoredDesignDocumentSchema,
  })
  .superRefine((file, ctx) => {
    if (!withinJsonBudget(file, MAX_PROJECT_TRANSFER_BYTES))
      ctx.addIssue({ code: 'custom', message: 'project-transfer.size-limit' });
  });
export const projectTransferReadSchema = z.union([
  legacyProjectTransferReadSchema,
  nativeProjectTransferSchema,
]);
export type ProjectTransferRead = z.infer<typeof projectTransferReadSchema>;
