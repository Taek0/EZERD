import { legacyApiRetired } from '../shared/legacy-api-retired.js';
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  createProjectSchema,
  deleteProjectSchema,
  projectQuerySchema,
  updateProjectSchema,
  usernameInputSchema,
  updateUserSchema,
  previewProjectDatabaseSchema,
  changeProjectDatabaseSchema,
} from '@ezerd/contracts';
import type { User } from '@ezerd/contracts';
import { DatabaseService } from '../db/database.service.js';
import { users } from '../db/schema.js';
import { isUsernameConflict } from '../identity/user-conflicts.js';
import { requireSession, SessionService } from '../identity/session.js';
import { WorkspaceService } from './workspace.service.js';
import { ProjectDatabaseService } from './project-database.service.js';
import { RateLimitService } from '../shared/rate-limit.service.js';

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('입력값을 확인해주세요.');
  return result.data;
}
const idSchema = z.uuid();
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
    @Inject(WorkspaceService) private readonly workspace: WorkspaceService,
    @Inject(RateLimitService) private readonly rateLimits: RateLimitService,
    @Inject(ProjectDatabaseService) private readonly projectDatabase?: ProjectDatabaseService,
  ) {}

  @Post('users')
  createUser(@Body() body: unknown, @Req() request: { ip?: string }) {
    const input = parse(usernameInputSchema, body);
    this.rateLimits.consume(
      `identify:${request.ip ?? 'unknown'}:${input.username}`,
      10,
      15 * 60 * 1000,
    );
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
  async listUsers(@Headers('authorization') authorization: string | undefined) {
    await requireSession(this.sessions, authorization);
    return databaseOperation(async () =>
      (await this.database.db.select().from(users).orderBy(asc(users.username), asc(users.id))).map(
        user,
      ),
    );
  }

  @Get('users/:id')
  async getUser(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
  ) {
    await requireSession(this.sessions, authorization);
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
    const actor = await requireSession(this.sessions, authorization);
    const input = parse(createProjectSchema, body);
    return this.workspace.createProject(actor.id, input);
  }

  @Get('projects')
  async listProjects(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: unknown,
  ) {
    const actor = await requireSession(this.sessions, authorization);
    const input = parse(projectQuerySchema, query);
    return this.workspace.listProjects(actor.id, input);
  }

  @Post('projects/import')
  async importProject(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const actor = await requireSession(this.sessions, authorization);
    return this.workspace.importProject(actor.id, body);
  }

  @Get('projects/:id/export')
  async exportProject(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
  ) {
    const actor = await requireSession(this.sessions, authorization);
    return this.workspace.exportProject(actor.id, parse(idSchema, rawId));
  }

  @Get('projects/:id')
  async getProject(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
  ) {
    const actor = await requireSession(this.sessions, authorization);
    const id = parse(idSchema, rawId);
    throw legacyApiRetired();
  }

  @Get('projects/:id/document-state')
  async getProjectDocumentState(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
  ) {
    const actor = await requireSession(this.sessions, authorization);
    return this.workspace.getVersionedProjectState(actor.id, parse(idSchema, rawId));
  }

  @Patch('projects/:id')
  async updateProject(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Body() body: unknown,
  ) {
    const actor = await requireSession(this.sessions, authorization);
    const id = parse(idSchema, rawId);
    return this.workspace.updateProject(actor.id, id, parse(updateProjectSchema, body));
  }

  @Delete('projects/:id')
  async deleteProject(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Body() body: unknown,
  ) {
    const actor = await requireSession(this.sessions, authorization);
    const id = parse(idSchema, rawId);
    return this.workspace.deleteProject(actor.id, id, parse(deleteProjectSchema, body));
  }

  @Get('projects/:id/database/capabilities')
  async databaseCapabilities(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
  ) {
    const actor = await requireSession(this.sessions, authorization);
    return this.workspace.getDatabaseCapabilities(actor.id, parse(idSchema, rawId));
  }

  @Post('projects/:id/database/preview')
  async previewDatabase(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Body() input: unknown,
  ) {
    const actor = await requireSession(this.sessions, authorization);
    if (!this.projectDatabase)
      throw new ServiceUnavailableException('DB 설정 기능을 불러올 수 없습니다.');
    return this.projectDatabase.preview(
      actor.id,
      parse(idSchema, rawId),
      parse(previewProjectDatabaseSchema, input),
    );
  }

  @Post('projects/:id/database/change')
  async changeDatabase(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Body() input: unknown,
  ) {
    const actor = await requireSession(this.sessions, authorization);
    if (!this.projectDatabase)
      throw new ServiceUnavailableException('DB 설정 기능을 불러올 수 없습니다.');
    return this.projectDatabase.change(
      actor.id,
      parse(idSchema, rawId),
      parse(changeProjectDatabaseSchema, input),
    );
  }

  @Put('projects/:id/document')
  async saveDocument(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Body() _body: unknown,
  ) {
    await requireSession(this.sessions, authorization);
    parse(idSchema, rawId);
    throw legacyApiRetired();
  }
}
