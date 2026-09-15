import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  GoneException,
  Headers,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  createProjectSchema,
  deleteProjectSchema,
  projectQuerySchema,
  updateProjectSchema,
  usernameInputSchema,
  updateUserSchema,
} from '@ezerd/contracts';
import type { Project, User } from '@ezerd/contracts';
import { DatabaseService } from './db/database.service.js';
import { projects, users } from './db/schema.js';
import { isUsernameConflict } from './user-conflicts.js';
import type { ProjectRow } from './db/schema.js';
import { requireSession, SessionService } from './session.js';

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('입력값을 확인해주세요.');
  return result.data;
}
const idSchema = z.uuid();
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
function user(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    username: row.username,
    color: row.color,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
async function databaseOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof HttpException) throw error;
    if (isUsernameConflict(error))
      throw new ConflictException(
        '이미 사용 중인 이름입니다. 기존 PIN으로 접속하거나 다른 이름을 입력해주세요.',
      );
    throw new ServiceUnavailableException(
      '저장소에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.',
    );
  }
}

@Controller()
export class WorkspaceController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  @Post('users')
  createUser(@Body() body: unknown) {
    const input = parse(usernameInputSchema, body);
    return databaseOperation(async () => {
      const pinHash = createHash('sha256').update(input.pin).digest('hex');
      const [row] = await this.database.db
        .insert(users)
        .values({
          username: input.username,
          pinHash,
        })
        .onConflictDoUpdate({
          target: users.username,
          set: { username: input.username },
          setWhere: eq(users.pinHash, pinHash),
        })
        .returning();
      if (!row) throw new ConflictException('사용자 이름과 PIN을 확인해주세요.');
      return user(row);
    });
  }

  @Get('users')
  listUsers() {
    return databaseOperation(async () =>
      (await this.database.db.select().from(users).orderBy(asc(users.username), asc(users.id))).map(
        user,
      ),
    );
  }

  @Get('users/:id')
  getUser(@Param('id') rawId: string) {
    const id = parse(idSchema, rawId);
    return databaseOperation(async () => {
      const [row] = await this.database.db.select().from(users).where(eq(users.id, id));
      if (!row) throw new NotFoundException('사용자를 찾을 수 없습니다.');
      return user(row);
    });
  }

  @Patch('users/:id')
  async updateUser(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Body() body: unknown,
  ) {
    const actor = await requireSession(this.sessions, authorization);
    const id = parse(idSchema, rawId);
    if (actor.id !== id) throw new ForbiddenException('본인의 프로필만 변경할 수 있습니다.');
    const input = parse(updateUserSchema, body);
    return databaseOperation(async () => {
      const [row] = await this.database.db
        .update(users)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();
      if (!row) throw new NotFoundException('사용자를 찾을 수 없습니다.');
      return user(row);
    });
  }

  @Post('projects')
  async createProject(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    await requireSession(this.sessions, authorization);
    const input = parse(createProjectSchema, body);
    return databaseOperation(async () => {
      const [row] = await this.database.db.insert(projects).values(input).returning();
      return project(row!);
    });
  }

  @Get('projects')
  listProjects(@Query() query: unknown) {
    const input = parse(projectQuerySchema, query);
    return databaseOperation(async () => {
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

  @Get('projects/:id')
  getProject(@Param('id') rawId: string) {
    const id = parse(idSchema, rawId);
    return databaseOperation(async () => {
      const [row] = await this.database.db.select().from(projects).where(eq(projects.id, id));
      if (!row) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
      return { project: project(row), document: row.document };
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

  @Patch('projects/:id')
  async updateProject(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Body() body: unknown,
  ) {
    await requireSession(this.sessions, authorization);
    const id = parse(idSchema, rawId);
    const { expectedVersion, ...changes } = parse(updateProjectSchema, body);
    return databaseOperation(async () => {
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

  @Delete('projects/:id')
  async deleteProject(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Body() body: unknown,
  ) {
    await requireSession(this.sessions, authorization);
    const id = parse(idSchema, rawId);
    const { expectedVersion } = parse(deleteProjectSchema, body);
    return databaseOperation(async () => {
      // CAS and archived state are checked atomically. FK cascades remove pins/replies/notifications.
      const [removed] = await this.database.db
        .delete(projects)
        .where(
          and(
            eq(projects.id, id),
            eq(projects.version, expectedVersion),
            eq(projects.status, 'archived'),
          ),
        )
        .returning({ id: projects.id });
      if (removed) return { id: removed.id, deleted: true };
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

  @Put('projects/:id/document')
  async saveDocument(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Body() _body: unknown,
  ) {
    await requireSession(this.sessions, authorization);
    parse(idSchema, rawId);
    throw new GoneException('전체 문서 교체 API는 종료되었습니다. 동기화 작업 API를 사용해주세요.');
  }
}
