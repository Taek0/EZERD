import {
  tableSchema,
  columnSchema,
  storedColumnSchema,
  rawStoredColumnSchema,
  rawColumnSchema,
  tableKeySchema,
  tableRelationSchema,
  projectEnumSchema,
} from './relational.js';
import { z } from 'zod';
export const MAX_DOCUMENT_BYTES = 1_500_000;
function withinDocumentBudget(doc: unknown): boolean {
  let bytes = 0;
  for (const character of JSON.stringify(doc)) {
    const code = character.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes > MAX_DOCUMENT_BYTES) return false;
  }
  return true;
}
const id = z.string().trim().min(1).max(160);
const objectId = id.refine(
  (value) => value !== 'overview',
  'overview is reserved for the domain map',
);
const name = z.string().max(120);
const coordinate = z.number().min(-1e7).max(1e7);
export const domainSchema = z.strictObject({
  id: objectId,
  name,
  description: z.string().max(10000),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});
export const domainRelationSchema = z.strictObject({
  id: objectId,
  sourceDomainId: id,
  targetDomainId: id,
  name,
  direction: z.enum(['forward', 'both']),
  description: z.string().max(10000),
});
export const noteSchema = z.strictObject({
  id: objectId,
  viewId: id,
  text: z.string().max(20000),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
});
export const nodeLayoutSchema = z.strictObject({
  id,
  objectId: id,
  viewId: id,
  x: coordinate,
  y: coordinate,
  width: z.number().positive().max(10000),
  height: z.number().positive().max(10000),
});
export const viewportSchema = z.strictObject({
  viewId: id,
  x: coordinate,
  y: coordinate,
  zoom: z.number().min(0.1).max(4),
});
export const combinedViewSchema = z.strictObject({
  id: objectId,
  name,
  domainIds: z
    .array(id)
    .min(1)
    .max(2000)
    .refine((ids) => new Set(ids).size === ids.length),
});
export const relationAnchorSchema = z.strictObject({
  side: z.enum(['left', 'right', 'top', 'bottom']),
  ratio: z.number().min(0).max(1),
});
export const relationLayoutSchema = z.strictObject({
  relationId: id,
  viewId: id,
  offset: coordinate,
  bend: z.strictObject({ x: coordinate, y: coordinate }).optional(),
  sourceAnchor: relationAnchorSchema.optional(),
  targetAnchor: relationAnchorSchema.optional(),
  waypoints: z
    .array(z.strictObject({ x: coordinate, y: coordinate }))
    .max(128)
    .optional(),
});
export const storedDesignDocumentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    views: z.array(combinedViewSchema).max(1000).optional(),
    enums: z.array(projectEnumSchema).max(1000).optional(),
    tables: z.array(tableSchema).max(5000).optional(),
    columns: z.array(storedColumnSchema).max(20000).optional(),
    keys: z.array(tableKeySchema).max(10000).optional(),
    tableRelations: z.array(tableRelationSchema).max(10000).optional(),
    domains: z.array(domainSchema).max(2000),
    domainRelations: z.array(domainRelationSchema).max(10000),
    notes: z.array(noteSchema).max(10000),
    layout: z.strictObject({
      nodes: z.array(nodeLayoutSchema).max(12000),
      viewports: z.array(viewportSchema).max(3001),
      relations: z.array(relationLayoutSchema).max(20000).optional(),
    }),
  })
  .superRefine((doc, ctx) => {
    if (!withinDocumentBudget(doc))
      ctx.addIssue({
        code: 'custom',
        message: '설계 문서는 UTF-8 JSON 기준 1.5 MB까지 저장할 수 있습니다.',
      });
    const unique = (values: string[], path: string[]) => {
      if (new Set(values).size !== values.length)
        ctx.addIssue({ code: 'custom', path, message: 'Duplicate identities are not allowed.' });
    };
    unique(
      [
        ...doc.domains,
        ...(doc.views ?? []),
        ...doc.domainRelations,
        ...doc.notes,
        ...(doc.tables ?? []),
        ...(doc.columns ?? []),
        ...(doc.keys ?? []),
        ...(doc.tableRelations ?? []),
        ...(doc.enums ?? []),
      ].map((o) => o.id),
      ['domains'],
    );
    unique(
      doc.layout.nodes.map((n) => n.id),
      ['layout', 'nodes'],
    );
    unique(
      doc.layout.nodes.map((n) => JSON.stringify([n.viewId, n.objectId])),
      ['layout', 'nodes'],
    );
    unique(
      doc.layout.viewports.map((v) => v.viewId),
      ['layout', 'viewports'],
    );
    unique(
      (doc.layout.relations ?? []).map((r) => JSON.stringify([r.viewId, r.relationId])),
      ['layout', 'relations'],
    );
  });
export const designDocumentSchema = storedDesignDocumentSchema.safeExtend({
  columns: z.array(columnSchema).max(20000).optional(),
});
/** Sync checks the claimed diff against the original spellings before normalizing. */
export const rawStoredDesignDocumentSchema = storedDesignDocumentSchema.safeExtend({
  columns: z.array(rawStoredColumnSchema).max(20000).optional(),
});
export const rawDesignDocumentSchema = storedDesignDocumentSchema.safeExtend({
  columns: z.array(rawColumnSchema).max(20000).optional(),
});
export const personalStateSchema = z.strictObject({
  views: z.array(combinedViewSchema).max(1000),
  notes: z.array(noteSchema).max(10000),
  nodes: z.array(nodeLayoutSchema).max(12000),
  viewports: z.array(viewportSchema).max(3001),
  relations: z.array(relationLayoutSchema).max(20000),
});
export const personalStateSnapshotSchema = z.strictObject({
  version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  projectVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  syncSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  state: personalStateSchema,
});
export const savePersonalStateSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  state: personalStateSchema,
});
const projectName = z.string().trim().min(1).max(120);
export const usernameSchema = z.string().trim().toLowerCase().min(1).max(40);
const username = usernameSchema;
const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const userColorSchema = z
  .string()
  .length(7)
  .regex(/^#[0-9a-f]{6}$/i)
  .transform((value) => value.toLowerCase());
export const usernameInputSchema = z.strictObject({
  username,
  pin: z
    .string()
    .length(4)
    .regex(/^[0-9]{4}$/),
});
export const updateUserSchema = z
  .strictObject({ username: username.optional(), color: userColorSchema.optional() })
  .refine(
    (value) => value.username !== undefined || value.color !== undefined,
    '변경할 이름 또는 색상을 입력하세요.',
  );
export const userSchema = z.strictObject({
  id: z.uuid(),
  username,
  color: userColorSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const databaseKindSchema = z.enum(['postgresql', 'mysql', 'sqlite']);
export type DatabaseKind = z.infer<typeof databaseKindSchema>;
export const createProjectSchema = z.strictObject({
  name: z.string().trim().max(120).optional(),
  workspaceId: z.uuid(),
  databaseKind: databaseKindSchema.optional(),
});
export const updateProjectSchema = z
  .strictObject({
    expectedVersion: version,
    name: projectName.optional(),
    databaseKind: databaseKindSchema.optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .refine(
    (input) =>
      input.name !== undefined || input.status !== undefined || input.databaseKind !== undefined,
    'No update supplied.',
  );
export const projectQuerySchema = z.strictObject({
  workspaceId: z.uuid().optional(),
  status: z.enum(['active', 'archived']).default('active'),
  search: z.string().trim().max(120).default(''),
});
export const projectPreviewSchema = z.strictObject({
  tableCount: z.number().int().nonnegative(),
  relationCount: z.number().int().nonnegative(),
  tables: z
    .array(
      z.strictObject({
        name: z.string(),
        columns: z
          .array(z.strictObject({ name: z.string(), type: z.string(), primaryKey: z.boolean() }))
          .max(3),
      }),
    )
    .max(2),
});
export const projectSchema = z.strictObject({
  workspaceId: z.uuid(),
  id: z.uuid(),
  name: projectName,
  databaseKind: databaseKindSchema.default('postgresql'),
  preview: projectPreviewSchema.optional(),
  status: z.enum(['active', 'archived']),
  version,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const projectDocumentSchema = z.strictObject({
  project: projectSchema,
  document: storedDesignDocumentSchema,
});
export const saveDocumentSchema = z.strictObject({
  expectedVersion: version,
  document: designDocumentSchema,
});
export type User = z.infer<typeof userSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectDocument = z.infer<typeof projectDocumentSchema>;
export type DesignDocument = z.infer<typeof designDocumentSchema>;
export type PersonalState = z.infer<typeof personalStateSchema>;
