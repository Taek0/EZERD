import { z } from 'zod';
import {
  databaseRevisionSchema,
  projectDatabaseStateSchema,
  syncPathSchema,
} from '@ezerd/contracts';

const counter = z.number().int().min(0).max(2147483647);
export const projectChangesInputSchema = z.strictObject({
  projectId: z.uuid(),
  since: counter,
  limit: z.number().int().min(1).max(100).default(25),
  untilSequence: counter.optional(),
  databaseRevision: databaseRevisionSchema.optional(),
});
const objectSchema = z.strictObject({ collection: z.string(), id: z.string() });
const cursorSchema = z.strictObject({
  since: counter,
  untilSequence: counter,
  databaseRevision: databaseRevisionSchema,
});
export const projectChangesSchema = z.strictObject({
  protocolVersion: z.literal(2),
  projectId: z.uuid(),
  version: counter,
  sequence: counter,
  untilSequence: counter,
  database: projectDatabaseStateSchema,
  resyncRequired: z.boolean(),
  reason: z
    .enum([
      'sequence-invalid',
      'database-changed',
      'format-boundary',
      'history-gap',
      'response-too-large',
      'history-invalid',
    ])
    .nullable(),
  operations: z
    .array(
      z.strictObject({
        operationId: z.uuid(),
        sequence: counter,
        status: z.enum(['accepted', 'rejected']),
        changedPaths: z.array(syncPathSchema),
      }),
    )
    .max(100),
  changedPaths: z.array(syncPathSchema),
  changedObjects: z.array(objectSchema),
  removedObjects: z.array(objectSchema),
  nextCursor: cursorSchema.nullable(),
});
export type ProjectChangesInput = z.infer<typeof projectChangesInputSchema>;
export type ChangeHistoryRow = {
  operationId: string;
  sequence: number;
  result: unknown;
  changes: unknown;
};
export type ChangeHistoryHead = {
  projectId: string;
  version: number;
  sequence: number;
  schemaVersion: unknown;
  database: z.infer<typeof projectDatabaseStateSchema>;
};
const metadataSchema = z.object({
  protocolVersion: z.literal(2),
  status: z.enum(['accepted', 'rejected']),
  databaseRevision: databaseRevisionSchema,
  reasonCode: z.string().nullable().optional(),
});
const pathsSchema = z
  .array(
    z.strictObject({
      path: syncPathSchema,
      beforeExists: z.boolean().nullable().optional(),
      afterExists: z.boolean().nullable().optional(),
    }),
  )
  .max(1000);
const collections = new Set([
  'domains',
  'domainRelations',
  'notes',
  'tables',
  'columns',
  'enums',
  'keys',
  'tableRelations',
  'indexes',
  'checks',
]);
function objectAt(path: string) {
  const parts = path
    .slice(1)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  if (collections.has(parts[0]!) && parts[1])
    return { collection: parts[0]!, id: parts[1]!, whole: parts.length === 2 };
  if (parts[0] === 'layout' && ['nodes', 'relations', 'viewports'].includes(parts[1]!) && parts[2])
    return { collection: `layout.${parts[1]}`, id: parts[2], whole: parts.length === 3 };
  return null;
}

/** Rows must be server-authored compact metadata, ordered and bounded by untilSequence. */
export function projectChanges(
  head: ChangeHistoryHead,
  input: ProjectChangesInput,
  rows: ChangeHistoryRow[],
) {
  const untilSequence = input.untilSequence ?? head.sequence;
  const base = {
    protocolVersion: 2 as const,
    projectId: head.projectId,
    version: head.version,
    sequence: head.sequence,
    untilSequence,
    database: head.database,
  };
  const reset = (reason: z.infer<typeof projectChangesSchema>['reason']) =>
    projectChangesSchema.parse({
      ...base,
      resyncRequired: true,
      reason,
      operations: [],
      changedPaths: [],
      changedObjects: [],
      removedObjects: [],
      nextCursor: null,
    });
  if (input.since > untilSequence || untilSequence > head.sequence)
    return reset('sequence-invalid');
  if (input.databaseRevision !== undefined && input.databaseRevision !== head.database.revision)
    return reset('database-changed');
  if (Number(head.schemaVersion) !== 2) return reset('format-boundary');
  const page = rows.slice(0, input.limit);
  const hasMore = rows.length > input.limit;
  let expected = input.since + 1;
  const paths = new Set<string>();
  const changed = new Map<string, { collection: string; id: string }>();
  const removed = new Map<string, { collection: string; id: string }>();
  const operations: z.infer<typeof projectChangesSchema>['operations'] = [];
  for (const row of page) {
    if (row.sequence !== expected++ || row.sequence > untilSequence) return reset('history-gap');
    const metadata = metadataSchema.safeParse(row.result);
    if (!metadata.success || metadata.data.reasonCode === 'document.upgraded')
      return reset('format-boundary');
    if (metadata.data.databaseRevision !== head.database.revision) return reset('database-changed');
    const changes = pathsSchema.safeParse(row.changes);
    if (!changes.success || (metadata.data.status === 'rejected' && changes.data.length))
      return reset('history-invalid');
    const changedPaths: string[] = [];
    for (const change of changes.data) {
      // Personal views never belong to the shared history returned by this query.
      if (/^\/views(?:\/|$)/.test(change.path)) return reset('history-invalid');
      if (/^\/(?:database|schemaVersion)(?:\/|$)/.test(change.path))
        return reset('format-boundary');
      paths.add(change.path);
      changedPaths.push(change.path);
      const object = objectAt(change.path);
      if (object) {
        const value = { collection: object.collection, id: object.id };
        const key = JSON.stringify(value);
        changed.set(key, value);
        if (object.whole && change.afterExists === false) removed.set(key, value);
        else if (object.whole) removed.delete(key);
      }
    }
    operations.push({
      operationId: row.operationId,
      sequence: row.sequence,
      status: metadata.data.status,
      changedPaths,
    });
  }
  if (
    (!hasMore && expected - 1 !== untilSequence) ||
    (hasMore && rows[input.limit]!.sequence !== expected)
  )
    return reset('history-gap');
  const output = {
    ...base,
    resyncRequired: false,
    reason: null,
    operations,
    changedPaths: [...paths],
    changedObjects: [...changed.values()],
    removedObjects: [...removed.values()],
    nextCursor: hasMore
      ? { since: page.at(-1)!.sequence, untilSequence, databaseRevision: head.database.revision }
      : null,
  };
  if (Buffer.byteLength(JSON.stringify(output), 'utf8') > 256 * 1024)
    return reset('response-too-large');
  return projectChangesSchema.parse(output);
}
