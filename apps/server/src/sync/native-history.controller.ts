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
import { nativeHistoryQuerySchema } from '@ezerd/contracts';
import { z } from 'zod';
import { requireSession, SessionService } from '../identity/session.js';
import { NativeHistoryService } from './native-history.service.js';

function id(raw: string) {
  const parsed = z.uuid().safeParse(raw);
  if (!parsed.success) throw new BadRequestException({ code: 'history.identity-invalid' });
  return parsed.data;
}
@Controller('projects/:projectId/native-history')
export class NativeHistoryController {
  constructor(
    @Inject(NativeHistoryService) private readonly history: NativeHistoryService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}
  @Get()
  async list(
    @Param('projectId') projectId: string,
    @Query() query: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireSession(this.sessions, authorization),
      parsed = nativeHistoryQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException({ code: 'history.query-invalid' });
    return this.history.history(id(projectId), parsed.data.since, parsed.data.limit, user);
  }
  @Post(':operationId/undo')
  async undo(
    @Param('projectId') projectId: string,
    @Param('operationId') operationId: string,
    @Body() raw: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireSession(this.sessions, authorization);
    return this.history.compensate(id(projectId), id(operationId), 'undo', raw, user);
  }
  @Post(':operationId/restore')
  async restore(
    @Param('projectId') projectId: string,
    @Param('operationId') operationId: string,
    @Body() raw: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireSession(this.sessions, authorization);
    return this.history.compensate(id(projectId), id(operationId), 'restore', raw, user);
  }
}
