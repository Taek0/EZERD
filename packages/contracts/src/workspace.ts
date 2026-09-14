import { tableSchema, columnSchema, tableKeySchema, tableRelationSchema } from './relational.js';
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
const objectId = id.refine(value => value !== 'overview', 'overview is reserved for the domain map');
const name = z.string().max(120);
const coordinate = z.number().min(-1e7).max(1e7);
export const domainSchema = z.strictObject({ id: objectId, name, description: z.string().max(10000), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() });
export const domainRelationSchema = z.strictObject({ id: objectId, sourceDomainId: id, targetDomainId: id, name, direction: z.enum(['forward', 'both']), description: z.string().max(10000) });
export const noteSchema = z.strictObject({ id: objectId, viewId: id, text: z.string().max(20000) });
export const nodeLayoutSchema = z.strictObject({ id, objectId: id, viewId: id, x: coordinate, y: coordinate, width: z.number().positive().max(10000), height: z.number().positive().max(10000) });
export const viewportSchema = z.strictObject({ viewId: id, x: coordinate, y: coordinate, zoom: z.number().min(0.1).max(4) });
export const designDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  tables: z.array(tableSchema).max(5000).optional(),
  columns: z.array(columnSchema).max(20000).optional(),
  keys: z.array(tableKeySchema).max(10000).optional(),
  tableRelations: z.array(tableRelationSchema).max(10000).optional(),
  domains: z.array(domainSchema).max(2000),
  domainRelations: z.array(domainRelationSchema).max(10000),
  notes: z.array(noteSchema).max(10000),
  layout: z.strictObject({ nodes: z.array(nodeLayoutSchema).max(12000), viewports: z.array(viewportSchema).max(2001) }),
}).superRefine((doc, ctx) => {
  if (!withinDocumentBudget(doc)) ctx.addIssue({ code: 'custom', message: '설계 문서는 UTF-8 JSON 기준 1.5 MB까지 저장할 수 있습니다.' });
  const unique = (values: string[], path: string[]) => { if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', path, message: 'Duplicate identities are not allowed.' }); };
  unique([...doc.domains, ...doc.domainRelations, ...doc.notes, ...(doc.tables ?? []), ...(doc.columns ?? []), ...(doc.keys ?? []), ...(doc.tableRelations ?? [])].map(o => o.id), ['domains']);
  unique(doc.layout.nodes.map(n => n.id), ['layout', 'nodes']);
  unique(doc.layout.nodes.map(n => JSON.stringify([n.viewId, n.objectId])), ['layout', 'nodes']);
  unique(doc.layout.viewports.map(v => v.viewId), ['layout', 'viewports']);
});
const projectName = z.string().trim().min(1).max(120);
const username = z.string().trim().min(1).max(40);
const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const usernameInputSchema = z.strictObject({ username });
export const userSchema = z.strictObject({ id: z.uuid(), username, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() });
export const createProjectSchema = z.strictObject({ name: projectName });
export const updateProjectSchema = z.strictObject({ expectedVersion: version, name: projectName.optional(), status: z.enum(['active', 'archived']).optional() }).refine(input => input.name !== undefined || input.status !== undefined, 'No update supplied.');
export const projectQuerySchema = z.strictObject({ status: z.enum(['active', 'archived']).default('active'), search: z.string().trim().max(120).default('') });
export const projectSchema = z.strictObject({ id: z.uuid(), name: projectName, status: z.enum(['active', 'archived']), version, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() });
export const projectDocumentSchema = z.strictObject({ project: projectSchema, document: designDocumentSchema });
export const saveDocumentSchema = z.strictObject({ expectedVersion: version, document: designDocumentSchema });
export type User = z.infer<typeof userSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectDocument = z.infer<typeof projectDocumentSchema>;
export type DesignDocument = z.infer<typeof designDocumentSchema>;




