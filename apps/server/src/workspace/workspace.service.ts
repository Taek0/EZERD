import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, asc, desc, eq, gt, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  projectTransferSchema,
  type ProjectTransfer,
  projectDatabaseCapabilitiesSchema,
  projectDocumentStateSchema,
} from '@ezerd/contracts';
import {
  defaultDatabaseContext,
  resolveProjectDatabaseState,
  hasPhysicalDatabaseDesign,
  nextDatabaseRevision,
  projectDatabaseCapabilities,
  createEmptyNativeDocument,
  sharedDocument,
} from '@ezerd/model';
import type {
  createProjectSchema,
  deleteProjectSchema,
  projectQuerySchema,
  updateProjectSchema,
  Project,
} from '@ezerd/contracts';
import {
  normalizeServerDocument,
  requireLegacyServerDocument,
} from '../shared/normalize-document.js';
import { readNativeProjectDocument } from '../shared/native-document-reader.js';
import { DatabaseService } from '../db/database.service.js';
import {
  projects,
  userWorkspaces,
  workspaceAuditEvents,
  syncClientBaselines,
} from '../db/schema.js';
import { WorkspaceEventsService } from './workspace-events.service.js';
import { WorkspaceAccessService } from './workspace-access.service.js';
import type { ProjectRow } from '../db/schema.js';
import { projectPreview } from './project-preview.js';
import { ProjectPreviewCache } from './project-preview-cache.js';
import { nextAutomaticProjectName } from './project-name.js';
import { decodeUpdatedCursor, encodeUpdatedCursor } from '../shared/updated-cursor.js';
import { NativeQueryCache } from '../mcp/native-query-cache.js';
import type { NativeProjectState } from '../mcp/mcp-native-read.js';

const projectListFields = {
  id: projects.id,
  workspaceId: projects.workspaceId,
  name: projects.name,
  databaseKind: projects.databaseKind,
  databaseProfileId: projects.databaseProfileId,
  databaseRevision: projects.databaseRevision,
  status: projects.status,
  version: projects.version,
  syncSequence: projects.syncSequence,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
};

function project(
  row: Omit<ProjectRow, 'document'> & {
    document?: ProjectRow['document'];
    preview?: ReturnType<typeof projectPreview>;
  },
): Project {
  const database = resolveProjectDatabaseState({
    ...row,
    databaseKind: row.databaseKind ?? 'postgresql',
  });
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    databaseKind: row.databaseKind,
    databaseProfileId: database.profileId,
    databaseRevision: database.revision,
    ...(row.preview
      ? { preview: row.preview }
      : row.document
        ? { preview: projectPreview(row.document) }
        : {}),
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function operation<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException(
      '저장소에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.',
    );
  }
}

@Injectable()
export class WorkspaceService {
  private readonly nativeQueryCache = new NativeQueryCache();
  private readonly projectPreviewCache = new ProjectPreviewCache();

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
    @Inject(WorkspaceEventsService) private readonly events?: WorkspaceEventsService,
  ) {}

  createProject(actorId: string, input: z.infer<typeof createProjectSchema>) {
    return operation(async () => {
      if (input.formatVersion !== undefined && input.formatVersion !== 2)
        throw new BadRequestException('새 프로젝트는 Native 설계로만 생성할 수 있습니다.');
      const result = await this.access.runWorkspace(
        actorId,
        input.workspaceId,
        'createProject',
        async (tx) => {
          const context = defaultDatabaseContext(input.databaseKind ?? 'postgresql');
          const name =
            input.name?.trim() ||
            nextAutomaticProjectName(
              (
                await tx
                  .select({ name: projects.name })
                  .from(projects)
                  .where(eq(projects.workspaceId, input.workspaceId))
              ).map((row) => row.name),
            );
          const [row] = await tx
            .insert(projects)
            .values({
              workspaceId: input.workspaceId,
              databaseKind: context.kind,
              name,
              databaseProfileId: context.profileId,
              document: sharedDocument(createEmptyNativeDocument(context)),
              databaseRevision: 0,
            })
            .returning();
          await tx.insert(workspaceAuditEvents).values({
            workspaceId: input.workspaceId,
            actorId,
            action: 'project.created',
            details: { projectId: row!.id, name: row!.name },
          });
          return project(row!);
        },
      );
      this.events?.userChanged({ resource: 'projects', workspaceId: result.workspaceId });
      return result;
    });
  }

  async exportProject(actorId: string, id: string): Promise<ProjectTransfer> {
    const snapshot = await this.readLegacyExportDocument(actorId, id);
    return projectTransferSchema.parse({
      format: 'ezerd-project',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      project: { name: snapshot.project.name, databaseKind: snapshot.project.databaseKind },
      document: snapshot.document,
    });
  }

  listProjects(actorId: string, input: z.infer<typeof projectQuerySchema>) {
    return operation(() =>
      this.database.db.transaction(
        async (tx) => {
          const escapedSearch = input.search?.replace(/[\\%_]/g, '\\$&');
          const rows = await tx
            .select({
              project: projectListFields,
            })
            .from(projects)
            .innerJoin(
              userWorkspaces,
              and(
                eq(userWorkspaces.workspaceId, projects.workspaceId),
                eq(userWorkspaces.userId, actorId),
              ),
            )
            .where(
              and(
                eq(projects.status, input.status ?? 'active'),
                input.workspaceId ? eq(projects.workspaceId, input.workspaceId) : undefined,
                escapedSearch ? ilike(projects.name, `%${escapedSearch}%`) : undefined,
              ),
            )
            .orderBy(desc(projects.updatedAt), asc(projects.id));
          return this.addProjectPreviews(
            tx,
            rows.map((row) => row.project),
          );
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      ),
    );
  }

  listProjectsPage(
    actorId: string,
    input: z.infer<typeof projectQuerySchema> & { limit: number; cursor?: string | undefined },
  ) {
    return operation(() =>
      this.database.db.transaction(
        async (tx) => {
          const cursor = decodeUpdatedCursor(input.cursor);
          const escapedSearch = input.search?.replace(/[\\%_]/g, '\\$&');
          const orderedTime = sql<Date>`date_trunc('milliseconds', ${projects.updatedAt})`;
          const rows = await tx
            .select({
              project: projectListFields,
            })
            .from(projects)
            .innerJoin(
              userWorkspaces,
              and(
                eq(userWorkspaces.workspaceId, projects.workspaceId),
                eq(userWorkspaces.userId, actorId),
              ),
            )
            .where(
              and(
                eq(projects.status, input.status ?? 'active'),
                input.workspaceId ? eq(projects.workspaceId, input.workspaceId) : undefined,
                escapedSearch ? ilike(projects.name, `%${escapedSearch}%`) : undefined,
                cursor
                  ? or(
                      lt(orderedTime, new Date(cursor.updatedAt)),
                      and(eq(orderedTime, new Date(cursor.updatedAt)), gt(projects.id, cursor.id)),
                    )
                  : undefined,
              ),
            )
            .orderBy(desc(orderedTime), asc(projects.id))
            .limit(input.limit + 1);
          const page = rows.slice(0, input.limit).map((row) => row.project);
          return {
            projects: await this.addProjectPreviews(tx, page),
            nextCursor:
              rows.length > input.limit
                ? encodeUpdatedCursor({
                    updatedAt: page.at(-1)!.updatedAt.toISOString(),
                    id: page.at(-1)!.id,
                  })
                : null,
          };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      ),
    );
  }

  private async addProjectPreviews(
    tx: Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0],
    rows: Omit<ProjectRow, 'document'>[],
  ) {
    const previews = new Map<string, ReturnType<typeof projectPreview>>();
    const missing = rows.filter((row) => {
      const cached = this.projectPreviewCache.get(row);
      if (!cached) return true;
      previews.set(row.id, cached);
      return false;
    });
    // A cold/unbounded REST list must not build a second unbounded document result.
    for (let offset = 0; offset < missing.length; offset += 16) {
      const batch = missing.slice(offset, offset + 16);
      const documents = await tx
        .select({ id: projects.id, document: projects.document })
        .from(projects)
        .where(
          inArray(
            projects.id,
            batch.map((row) => row.id),
          ),
        );
      const byId = new Map(documents.map((row) => [row.id, row.document]));
      for (const row of batch) {
        const document = byId.get(row.id);
        if (!document) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
        const preview = projectPreview(document);
        this.projectPreviewCache.set(row, preview);
        previews.set(row.id, preview);
      }
    }
    return rows.map((row) => project({ ...row, preview: previews.get(row.id)! }));
  }

  private readLegacyExportDocument(actorId: string, id: string) {
    return this.readProject(actorId, id, (row) => ({
      project: project(row),
      document: normalizeServerDocument(row.document),
    }));
  }

  private readProject<T>(actorId: string, id: string, read: (row: ProjectRow) => T) {
    return operation(() =>
      this.access.runProject(actorId, id, 'read', async (tx) => {
        const [row] = await tx.select().from(projects).where(eq(projects.id, id));
        if (!row) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
        return read(row);
      }),
    );
  }

  getVersionedProjectState(actorId: string, id: string) {
    return this.readProject(actorId, id, (row) => {
      const result = readNativeProjectDocument(row.document, resolveProjectDatabaseState(row));
      return projectDocumentStateSchema.parse({
        protocolVersion: 2,
        project: project(row),
        sequence: row.syncSequence,
        sourceDocument: result.rawSource,
        native:
          result.status === 'available'
            ? {
                status: 'available',
                document: result.preview,
                migrationIssues: result.migrationIssues,
                issues: result.issues,
              }
            : { status: 'unavailable', code: result.code },
      });
    });
  }

  /** MCP queries need a validated native source, without full preview/diagnostic construction. */
  getNativeQueryState(actorId: string, id: string): Promise<NativeProjectState> {
    return operation(() =>
      this.access.runProject(actorId, id, 'read', async (tx) => {
        // Authorization and the current head are checked even when the source is cached.
        // Both reads share the access service's repeatable-read snapshot.
        const [head] = await tx
          .select({
            id: projects.id,
            workspaceId: projects.workspaceId,
            name: projects.name,
            databaseKind: projects.databaseKind,
            databaseProfileId: projects.databaseProfileId,
            databaseRevision: projects.databaseRevision,
            status: projects.status,
            version: projects.version,
            syncSequence: projects.syncSequence,
            createdAt: projects.createdAt,
            updatedAt: projects.updatedAt,
          })
          .from(projects)
          .where(eq(projects.id, id));
        if (!head) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
        const database = resolveProjectDatabaseState(head);
        const key = JSON.stringify([
          head.id,
          head.workspaceId,
          head.createdAt.toISOString(),
          head.updatedAt.toISOString(),
          head.version,
          head.syncSequence,
          database.revision,
          database.kind,
          database.profileId,
        ]);
        let document = this.nativeQueryCache.get(key);
        if (!document) {
          const [source] = await tx
            .select({ document: projects.document })
            .from(projects)
            .where(eq(projects.id, id));
          if (!source) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
          document = this.nativeQueryCache.parse(key, source.document, database);
        }
        return {
          project: {
            ...project(head),
            databaseProfileId: database.profileId,
            databaseRevision: database.revision,
          },
          syncSequence: head.syncSequence,
          document,
        };
      }),
    );
  }

  private async missingOrConflict(id: string): Promise<never> {
    const [row] = await this.database.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, id));
    if (!row) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
    throw new ConflictException(
      '프로젝트가 변경되었거나 보관되었습니다. 다시 열어 최신 내용을 확인해주세요.',
    );
  }

  getDatabaseCapabilities(actorId: string, id: string) {
    return this.readProject(actorId, id, (row) =>
      projectDatabaseCapabilitiesSchema.parse({
        projectId: id,
        version: row.version,
        sequence: row.syncSequence,
        ...projectDatabaseCapabilities(
          resolveProjectDatabaseState(row),
          row.document.schemaVersion,
        ),
      }),
    );
  }

  updateProject(actorId: string, id: string, input: z.infer<typeof updateProjectSchema>) {
    const { expectedVersion, ...changes } = input;
    return operation(async () => {
      const result = await this.access.runProject(actorId, id, 'manageProject', async (tx) => {
        const [current] = await tx.select().from(projects).where(eq(projects.id, id)).for('update');
        if (!current) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
        const databaseChanged =
          changes.databaseKind !== undefined && changes.databaseKind !== current.databaseKind;
        if (databaseChanged) requireLegacyServerDocument(current.document);
        if (databaseChanged && hasPhysicalDatabaseDesign(current.document))
          throw new ConflictException({
            code: 'database.conversion-required',
            message: '물리 설계가 있는 프로젝트는 DB 종류 변경 전에 변환이 필요합니다.',
          });
        const database = resolveProjectDatabaseState(current);
        let databaseRevision = database.revision;
        if (databaseChanged) {
          try {
            databaseRevision = nextDatabaseRevision(database);
          } catch {
            throw new ConflictException({
              code: 'database.revision-limit',
              message: 'DB 설정 변경 한도를 초과했습니다.',
            });
          }
        }
        const unarchivesWithoutOtherEdits =
          changes.status === 'active' &&
          changes.name === undefined &&
          changes.databaseKind === undefined;
        const [row] = await tx
          .update(projects)
          .set({
            ...changes,
            ...(databaseChanged && {
              databaseRevision,
              databaseProfileId: defaultDatabaseContext(changes.databaseKind!).profileId,
            }),
            version: sql`${projects.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(projects.id, id),
              eq(projects.version, expectedVersion),
              unarchivesWithoutOtherEdits ? undefined : eq(projects.status, 'active'),
            ),
          )
          .returning();
        if (!row) return this.missingOrConflict(id);
        if (databaseChanged)
          await tx.delete(syncClientBaselines).where(eq(syncClientBaselines.projectId, id));
        await tx.insert(workspaceAuditEvents).values({
          workspaceId: row.workspaceId,
          actorId,
          action: 'project.updated',
          details: { projectId: id, expectedVersion, version: row.version, ...changes },
        });
        return project(row);
      });
      this.events?.userChanged({ resource: 'projects', workspaceId: result.workspaceId });
      return result;
    });
  }

  deleteProject(actorId: string, id: string, input: z.infer<typeof deleteProjectSchema>) {
    return operation(async () => {
      let workspaceId: string | undefined;
      const result = await this.access.runProject(
        actorId,
        id,
        'deleteProject',
        async (tx, access) => {
          const [removed] = await tx
            .delete(projects)
            .where(
              and(
                eq(projects.id, id),
                eq(projects.version, input.expectedVersion),
                eq(projects.status, 'archived'),
              ),
            )
            .returning({ id: projects.id });
          if (removed) {
            workspaceId = access.workspaceId;
            await tx.insert(workspaceAuditEvents).values({
              workspaceId: access.workspaceId,
              actorId,
              action: 'project.deleted',
              details: { projectId: id, expectedVersion: input.expectedVersion },
            });
            return { id: removed.id, deleted: true as const };
          }
          const [current] = await tx
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.id, id));
          if (!current) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
          throw new ConflictException(
            '보관된 프로젝트의 최신 버전만 삭제할 수 있습니다. 목록을 새로 확인해주세요.',
          );
        },
      );
      if (workspaceId) {
        this.events?.userChanged({ resource: 'projects', workspaceId });
        this.events?.userChanged({ resource: 'notifications', workspaceId });
      }
      return result;
    });
  }
}
