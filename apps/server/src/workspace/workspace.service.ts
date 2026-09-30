import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, asc, desc, eq, gt, ilike, lt, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { importProjectSchema, projectTransferSchema, type ProjectTransfer } from '@ezerd/contracts';
import { diagnoseDocument, normalizeDocumentPhysicalTypes } from '@ezerd/model';
import type {
  createProjectSchema,
  deleteProjectSchema,
  projectQuerySchema,
  updateProjectSchema,
  Project,
} from '@ezerd/contracts';
import { DatabaseService } from '../db/database.service.js';
import { projects, userWorkspaces, workspaceAuditEvents } from '../db/schema.js';
import { WorkspaceAccessService } from './workspace-access.service.js';
import type { ProjectRow } from '../db/schema.js';
import { decodeUpdatedCursor, encodeUpdatedCursor } from '../shared/updated-cursor.js';

function project(row: ProjectRow): Project {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
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
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
  ) {}

  createProject(actorId: string, input: z.infer<typeof createProjectSchema>) {
    return operation(async () => {
      return this.access.runWorkspace(actorId, input.workspaceId, 'createProject', async (tx) => {
        const [row] = await tx.insert(projects).values(input).returning();
        await tx.insert(workspaceAuditEvents).values({
          workspaceId: input.workspaceId,
          actorId,
          action: 'project.created',
          details: { projectId: row!.id, name: row!.name },
        });
        return project(row!);
      });
    });
  }

  async exportProject(actorId: string, id: string): Promise<ProjectTransfer> {
    const snapshot = await this.getProject(actorId, id);
    return projectTransferSchema.parse({
      format: 'ezerd-project',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      project: { name: snapshot.project.name },
      document: snapshot.document,
    });
  }

  importProject(actorId: string, raw: unknown) {
    const parsed = importProjectSchema.safeParse(raw);
    if (!parsed.success)
      throw new BadRequestException('프로젝트 파일 형식, 버전 또는 크기를 확인해 주세요.');
    const { transfer: input, workspaceId } = parsed.data;
    const issue = diagnoseDocument(input.document)[0];
    if (issue) throw new BadRequestException(`설계 데이터를 확인해 주세요: ${issue.message}`);
    return operation(async () => {
      // One row contains the whole design: insertion is atomic, with fresh DB defaults.
      return this.access.runWorkspace(actorId, workspaceId, 'createProject', async (tx) => {
        const [row] = await tx
          .insert(projects)
          .values({
            name: input.project.name,
            workspaceId,
            document: input.document,
          })
          .returning();
        await tx.insert(workspaceAuditEvents).values({
          workspaceId,
          actorId,
          action: 'project.imported',
          details: { projectId: row!.id, name: row!.name },
        });
        return project(row!);
      });
    });
  }

  listProjects(actorId: string, input: z.infer<typeof projectQuerySchema>) {
    return operation(async () => {
      const escapedSearch = input.search?.replace(/[\\%_]/g, '\\$&');
      const rows = await this.database.db
        .select({ project: projects })
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
      return rows.map((row) => project(row.project));
    });
  }

  listProjectsPage(
    actorId: string,
    input: z.infer<typeof projectQuerySchema> & { limit: number; cursor?: string | undefined },
  ) {
    return operation(async () => {
      const cursor = decodeUpdatedCursor(input.cursor);
      const escapedSearch = input.search?.replace(/[\\%_]/g, '\\$&');
      const orderedTime = sql<Date>`date_trunc('milliseconds', ${projects.updatedAt})`;
      const rows = await this.database.db
        .select({ project: projects })
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
        projects: page.map(project),
        nextCursor:
          rows.length > input.limit
            ? encodeUpdatedCursor({
                updatedAt: page.at(-1)!.updatedAt.toISOString(),
                id: page.at(-1)!.id,
              })
            : null,
      };
    });
  }

  getProject(actorId: string, id: string) {
    return operation(() =>
      this.access.runProject(actorId, id, 'read', async (tx) => {
        const [row] = await tx.select().from(projects).where(eq(projects.id, id));
        if (!row) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
        return { project: project(row), document: normalizeDocumentPhysicalTypes(row.document) };
      }),
    );
  }

  getProjectState(actorId: string, id: string) {
    return operation(() =>
      this.access.runProject(actorId, id, 'read', async (tx) => {
        const [row] = await tx.select().from(projects).where(eq(projects.id, id));
        if (!row) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
        return {
          project: project(row),
          document: normalizeDocumentPhysicalTypes(row.document),
          syncSequence: row.syncSequence,
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

  updateProject(actorId: string, id: string, input: z.infer<typeof updateProjectSchema>) {
    const { expectedVersion, ...changes } = input;
    return operation(() =>
      this.access.runProject(actorId, id, 'manageProject', async (tx) => {
        const unarchivesWithoutOtherEdits =
          changes.status === 'active' && changes.name === undefined;
        const [row] = await tx
          .update(projects)
          .set({ ...changes, version: sql`${projects.version} + 1`, updatedAt: new Date() })
          .where(
            and(
              eq(projects.id, id),
              eq(projects.version, expectedVersion),
              unarchivesWithoutOtherEdits ? undefined : eq(projects.status, 'active'),
            ),
          )
          .returning();
        if (!row) return this.missingOrConflict(id);
        await tx.insert(workspaceAuditEvents).values({
          workspaceId: row.workspaceId,
          actorId,
          action: 'project.updated',
          details: { projectId: id, expectedVersion, version: row.version, ...changes },
        });
        return project(row);
      }),
    );
  }

  deleteProject(actorId: string, id: string, input: z.infer<typeof deleteProjectSchema>) {
    return operation(() =>
      this.access.runProject(actorId, id, 'deleteProject', async (tx, access) => {
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
      }),
    );
  }
}
