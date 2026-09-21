import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { projectTransferSchema, type ProjectTransfer } from '@ezerd/contracts';
import { diagnoseDocument } from '@ezerd/model';
import type {
  createProjectSchema,
  deleteProjectSchema,
  projectQuerySchema,
  updateProjectSchema,
  Project,
} from '@ezerd/contracts';
import { DatabaseService } from '../db/database.service.js';
import { projects } from '../db/schema.js';
import type { ProjectRow } from '../db/schema.js';

function project(row: ProjectRow): Project {
  return {
    id: row.id,
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
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  createProject(input: z.infer<typeof createProjectSchema>) {
    return operation(async () => {
      const [row] = await this.database.db.insert(projects).values(input).returning();
      return project(row!);
    });
  }

  async exportProject(id: string): Promise<ProjectTransfer> {
    const snapshot = await this.getProject(id);
    return projectTransferSchema.parse({
      format: 'ezerd-project',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      project: { name: snapshot.project.name },
      document: snapshot.document,
    });
  }

  importProject(raw: unknown) {
    const parsed = projectTransferSchema.safeParse(raw);
    if (!parsed.success)
      throw new BadRequestException('프로젝트 파일 형식, 버전 또는 크기를 확인해 주세요.');
    const input = parsed.data;
    const issue = diagnoseDocument(input.document)[0];
    if (issue) throw new BadRequestException(`설계 데이터를 확인해 주세요: ${issue.message}`);
    return operation(async () => {
      // One row contains the whole design: insertion is atomic, with fresh DB defaults.
      const [row] = await this.database.db
        .insert(projects)
        .values({
          name: input.project.name,
          document: input.document,
        })
        .returning();
      return project(row!);
    });
  }

  listProjects(input: z.infer<typeof projectQuerySchema>) {
    return operation(async () => {
      const escapedSearch = input.search?.replace(/[\\%_]/g, '\\$&');
      const rows = await this.database.db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.status, input.status ?? 'active'),
            escapedSearch ? ilike(projects.name, `%${escapedSearch}%`) : undefined,
          ),
        )
        .orderBy(desc(projects.updatedAt), asc(projects.id));
      return rows.map(project);
    });
  }

  getProject(id: string) {
    return operation(async () => {
      const [row] = await this.database.db.select().from(projects).where(eq(projects.id, id));
      if (!row) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
      return { project: project(row), document: row.document };
    });
  }

  getProjectState(id: string) {
    return operation(async () => {
      const [row] = await this.database.db.select().from(projects).where(eq(projects.id, id));
      if (!row) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
      return { project: project(row), document: row.document, syncSequence: row.syncSequence };
    });
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

  updateProject(id: string, input: z.infer<typeof updateProjectSchema>) {
    const { expectedVersion, ...changes } = input;
    return operation(async () => {
      const unarchivesWithoutOtherEdits = changes.status === 'active' && changes.name === undefined;
      const [row] = await this.database.db
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
      return project(row);
    });
  }

  deleteProject(id: string, input: z.infer<typeof deleteProjectSchema>) {
    return operation(async () => {
      const [removed] = await this.database.db
        .delete(projects)
        .where(
          and(
            eq(projects.id, id),
            eq(projects.version, input.expectedVersion),
            eq(projects.status, 'archived'),
          ),
        )
        .returning({ id: projects.id });
      if (removed) return { id: removed.id, deleted: true as const };
      const [current] = await this.database.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, id));
      if (!current) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
      throw new ConflictException(
        '보관된 프로젝트의 최신 버전만 삭제할 수 있습니다. 목록을 새로 확인해주세요.',
      );
    });
  }
}
