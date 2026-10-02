import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import {
  importNativeProjectSchema,
  nativeTransferImportResultSchema,
  nativeStoredDesignDocumentSchema,
  MAX_DOCUMENT_BYTES,
  versionedProjectTransferSchema,
  type NativeTransferImportResult,
  type VersionedProjectTransfer,
} from '@ezerd/contracts';
import {
  defaultDatabaseContext,
  migrateDesignDocumentV1,
  nativeReferenceProblems,
  remapNativeDocumentIds,
  requestFingerprint,
  resolveProjectDatabaseState,
  validateDatabaseDocument,
  type DatabaseIssue,
  type NativeDesignDocument,
  type NativeIdentityRemap,
  type NativeMigrationIssue,
} from '@ezerd/model';
import { DatabaseService } from '../db/database.service.js';
import { projects, workspaceAuditEvents } from '../db/schema.js';
import { readNativeProjectDocument } from '../shared/native-document-reader.js';
import {
  importJsonSha256,
  nativeImportLegacyProvenance,
  validateNativeImportWithProvenance,
} from '../shared/native-import-provenance.js';
import { WorkspaceAccessService } from './workspace-access.service.js';

async function storageOperation<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException({ code: 'project-transfer.storage-unavailable' });
  }
}

function freshIdentities(
  document: NativeDesignDocument,
  preserveSourceIds: boolean,
): NativeIdentityRemap {
  const entities = new Map<string, string>();
  for (const collection of [
    document.domains,
    document.domainRelations,
    document.notes,
    document.views,
    document.tables,
    document.columns,
    document.enums,
    document.keys,
    document.tableRelations,
    document.indexes,
    document.checks,
  ])
    for (const item of collection ?? [])
      entities.set(item.id, preserveSourceIds ? item.id : randomUUID());
  return {
    entities,
    nodes: new Map(
      document.layout.nodes.map((node) => [node.id, preserveSourceIds ? node.id : randomUUID()]),
    ),
  };
}

function graphIssues(document: NativeDesignDocument): DatabaseIssue[] {
  return nativeReferenceProblems(document).map(({ cause: _cause, ...issue }) => ({
    ...issue,
    category: 'invalid',
    severity: 'error',
    params: {},
  }));
}

@Injectable()
export class NativeTransferService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
  ) {}

  exportProject(actorId: string, projectId: string): Promise<VersionedProjectTransfer> {
    return storageOperation(() =>
      // Identical to document-state: one read-only repeatable-read snapshot, including access.
      // PostgreSQL READ ONLY prohibits row locks; MVCC pins the entire row consistently.
      this.access.runProject(actorId, projectId, 'read', async (tx) => {
        const [row] = await tx.select().from(projects).where(eq(projects.id, projectId));
        if (!row) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
        const database = resolveProjectDatabaseState(row);
        const read = readNativeProjectDocument(row.document, database);
        const parsed = versionedProjectTransferSchema.safeParse({
          format: 'ezerd-project',
          formatVersion: 2,
          exportedAt: new Date().toISOString(),
          project: {
            name: row.name,
            databaseKind: database.kind,
            databaseProfileId: database.profileId,
          },
          source: {
            projectId: row.id,
            version: row.version,
            sequence: row.syncSequence,
            databaseRevision: database.revision,
          },
          sourceDocument: read.rawSource,
          native:
            read.status === 'available'
              ? {
                  status: 'available',
                  document: read.preview,
                  migrationIssues: read.migrationIssues,
                  issues: read.issues,
                }
              : { status: 'unavailable', code: read.code },
        });
        if (!parsed.success)
          throw new UnprocessableEntityException({
            code: 'project-transfer.export-invalid',
            issues: parsed.error.issues,
          });
        return parsed.data;
      }),
    );
  }

  importProject(actorId: string, raw: unknown): Promise<NativeTransferImportResult> {
    const parsed = importNativeProjectSchema.safeParse(raw);
    if (!parsed.success)
      throw new BadRequestException({
        code: 'project-transfer.input-invalid',
        issues: parsed.error.issues,
      });
    const { workspaceId, transfer } = parsed.data;
    return storageOperation(() =>
      this.access.runWorkspace(actorId, workspaceId, 'createProject', async (tx) => {
        const context =
          transfer.formatVersion === 1
            ? defaultDatabaseContext(transfer.project.databaseKind ?? 'postgresql')
            : {
                kind: transfer.project.databaseKind,
                profileId: transfer.project.databaseProfileId,
              };
        const original = 'sourceDocument' in transfer ? transfer.sourceDocument : transfer.document;
        let source: NativeDesignDocument;
        let migrationIssues: NativeMigrationIssue[] = [];
        let previous: NativeDesignDocument | undefined;
        if (original.schemaVersion === 1) {
          // Sole recovery exception: derive BOTH the candidate and previous on the server from v1.
          // Never authorize an arbitrary native document using source coordinates or client diagnostics.
          const migration = migrateDesignDocumentV1(original, context);
          source = migration.document;
          previous = structuredClone(migration.document);
          migrationIssues = migration.issues;
        } else {
          source = structuredClone(original);
          const canonical = nativeStoredDesignDocumentSchema.safeParse(source);
          if (
            !canonical.success ||
            requestFingerprint(canonical.data) !== requestFingerprint(source)
          )
            throw new UnprocessableEntityException({
              code: 'project-transfer.native-canonical-required',
            });
        }

        if ('native' in transfer) {
          if (transfer.native.status === 'unavailable')
            throw new UnprocessableEntityException({ code: transfer.native.code });
          const derived = readNativeProjectDocument(original, { ...context, revision: 0 });
          if (
            derived.status !== 'available' ||
            requestFingerprint(derived.preview) !== requestFingerprint(transfer.native.document)
          )
            throw new UnprocessableEntityException({ code: 'project-transfer.preview-mismatch' });
        }

        // Graph errors cannot be grandfathered by the recovery policy, even in v1 migration.
        const graph = graphIssues(source);
        if (graph.length)
          throw new UnprocessableEntityException({
            code: 'project-transfer.graph-invalid',
            issues: graph,
          });
        let document: NativeDesignDocument;
        // Immutable legacy enum evidence may retain an enumId. The entire document's IDs
        // live inside the newly generated project UUID namespace; ordinary restores do not.
        const preserveSourceIds = (source.columns ?? []).some(
          (column) =>
            column.physical.type.kind === 'legacy' &&
            column.physical.type.original.enumId !== undefined,
        );
        const mapping = freshIdentities(source, preserveSourceIds);
        try {
          document = remapNativeDocumentIds(source, mapping);
          if (previous) previous = remapNativeDocumentIds(previous, mapping);
        } catch {
          throw new UnprocessableEntityException({ code: 'project-transfer.remap-invalid' });
        }
        const shape = nativeStoredDesignDocumentSchema.safeParse(document);
        if (
          !shape.success ||
          Buffer.byteLength(JSON.stringify(document), 'utf8') > MAX_DOCUMENT_BYTES
        )
          throw new UnprocessableEntityException({
            code: 'project-transfer.document-invalid',
            issues: shape.success ? [{ code: 'document.size-limit' }] : shape.error.issues,
          });
        // Persist the remapped raw representation, never the Zod-trimmed/normalized preview.
        const remappedGraph = graphIssues(document);
        if (remappedGraph.length)
          throw new UnprocessableEntityException({
            code: 'project-transfer.graph-invalid',
            issues: remappedGraph,
          });
        const provenance =
          original.schemaVersion === 2
            ? nativeImportLegacyProvenance(document, context)
            : undefined;
        const writeIssues = provenance
          ? validateNativeImportWithProvenance(document, context, provenance)
          : validateDatabaseDocument(document, context, {
              mode: 'write',
              ...(previous ? { previous } : {}),
            });
        if (writeIssues.some((issue) => issue.severity === 'error'))
          throw new UnprocessableEntityException({
            code: 'database.validation-failed',
            issues: writeIssues,
          });
        const [row] = await tx
          .insert(projects)
          .values({
            workspaceId,
            name: transfer.project.name.trim(),
            databaseKind: context.kind,
            databaseProfileId: context.profileId,
            document: sql`${JSON.stringify(document)}::jsonb`,
          })
          .returning();
        await tx.insert(workspaceAuditEvents).values({
          workspaceId,
          actorId,
          action: 'project.imported',
          details: {
            projectId: row!.id,
            name: row!.name,
            formatVersion: transfer.formatVersion,
            sourceSchemaVersion: original.schemaVersion,
            // Source metadata is informational; it grants no trusted origin on later imports.
            ...('source' in transfer ? { source: transfer.source } : {}),
            importProvenance: {
              policyVersion: 1,
              authority:
                original.schemaVersion === 1 ? 'server-v1-migration' : 'validated-v1-legacy-mask',
              hashEncoding: 'canonical-json-utf8',
              sourceDocument: structuredClone(original),
              sourceDocumentSha256: importJsonSha256(original),
              transferSha256: importJsonSha256(transfer),
              context,
              targetProjectId: row!.id,
              mappingPolicy: preserveSourceIds
                ? 'preserve-source-project-namespace'
                : 'fresh-project-object-ids',
              identityMappingSha256: importJsonSha256({
                entities: [...mapping.entities],
                nodes: [...mapping.nodes],
              }),
              legacyMaskSha256: provenance
                ? importJsonSha256(provenance.mask)
                : previous
                  ? importJsonSha256(previous)
                  : null,
              trustedLegacyPaths: provenance ? [...provenance.fieldPaths].sort() : [],
            },
          },
        });
        // Diagnostics must use target IDs/paths, not source IDs from the uploaded file.
        migrationIssues = migrationIssues.map((issue) => ({
          ...issue,
          objectId: mapping.entities.get(issue.objectId)!,
          path: issue.path.replace(
            '/' + issue.objectId.replaceAll('~', '~0').replaceAll('/', '~1') + '/',
            '/' + mapping.entities.get(issue.objectId)! + '/',
          ),
        }));
        return nativeTransferImportResultSchema.parse({
          project: {
            id: row!.id,
            workspaceId,
            name: row!.name,
            databaseKind: context.kind,
            databaseProfileId: context.profileId,
            databaseRevision: row!.databaseRevision,
            status: row!.status,
            version: row!.version,
            createdAt: row!.createdAt.toISOString(),
            updatedAt: row!.updatedAt.toISOString(),
          },
          sequence: row!.syncSequence,
          migrationIssues,
          issues: validateDatabaseDocument(document, context, { mode: 'read' }),
        });
      }),
    );
  }
}
