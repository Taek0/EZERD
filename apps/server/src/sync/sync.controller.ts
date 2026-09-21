import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { syncOperationInputSchema } from '@ezerd/contracts';
import { z } from 'zod';
import { requireSession, SessionService } from '../identity/session.js';
import { SyncService } from './sync.service.js';

const idSchema = z.uuid();
const sinceSchema = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0);
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException('입력값을 확인해주세요.');
  return result.data;
}

@Controller()
export class SyncController {
  constructor(
    @Inject(SyncService) private readonly sync: SyncService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  @Post('projects/:projectId/operations')
  async apply(
    @Param('projectId') rawProjectId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireSession(this.sessions, authorization);
    return this.sync.apply(
      parse(idSchema, rawProjectId),
      parse(syncOperationInputSchema, body),
      user,
    );
  }

  @Get('projects/:projectId/operations/:operationId')
  async lookup(
    @Param('projectId') rawProjectId: string,
    @Param('operationId') rawOperationId: string,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireSession(this.sessions, authorization);
    return this.sync.lookup(parse(idSchema, rawProjectId), parse(idSchema, rawOperationId), user);
  }

  @Get('projects/:projectId/events')
  async events(
    @Param('projectId') rawProjectId: string,
    @Query('since') rawSince: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    await requireSession(this.sessions, authorization);
    return this.sync.events(parse(idSchema, rawProjectId), parse(sinceSchema, rawSince));
  }

  @Get('projects/:projectId/history')
  async history(
    @Param('projectId') rawProjectId: string,
    @Query('since') rawSince: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    await requireSession(this.sessions, authorization);
    return this.sync.history(parse(idSchema, rawProjectId), parse(sinceSchema, rawSince));
  }

  @Post('projects/:projectId/sync-baseline')
  async baseline(
    @Param('projectId') rawProjectId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireSession(this.sessions, authorization);
    const input = parse(z.strictObject({ clientId: z.uuid() }), body);
    return this.sync.establishBaseline(parse(idSchema, rawProjectId), input.clientId, user);
  }

  @Post('projects/:projectId/deletions/:deletedOperationId/restore')
  async restore(
    @Param('projectId') rawProjectId: string,
    @Param('deletedOperationId') rawDeletedOperationId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireSession(this.sessions, authorization);
    const input = parse(
      z.strictObject({ operationId: z.uuid(), groupId: z.uuid(), clientId: z.uuid() }),
      body,
    );
    return this.sync.restore(
      parse(idSchema, rawProjectId),
      parse(idSchema, rawDeletedOperationId),
      input,
      user,
    );
  }

  @Post('projects/:projectId/operations/:sourceOperationId/undo')
  async undo(
    @Param('projectId') rawProjectId: string,
    @Param('sourceOperationId') rawSourceOperationId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireSession(this.sessions, authorization);
    const input = parse(
      z.strictObject({ operationId: z.uuid(), groupId: z.uuid(), clientId: z.uuid() }),
      body,
    );
    return this.sync.undo(
      parse(idSchema, rawProjectId),
      parse(idSchema, rawSourceOperationId),
      input,
      user,
    );
  }
}
