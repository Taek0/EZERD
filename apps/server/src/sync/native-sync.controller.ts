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
import { z } from 'zod';
import { requireSession, SessionService } from '../identity/session.js';
import { NativeSyncService } from './native-sync.service.js';
const id = z.uuid();
const sequence = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const baselineInput = z.strictObject({
  clientId: id,
  expected: z.strictObject({ version: sequence, sequence, databaseRevision: sequence }).optional(),
});
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException({ code: 'sync.input-invalid' });
  return parsed.data;
}
@Controller('projects/:projectId/native-sync')
export class NativeSyncController {
  constructor(
    @Inject(NativeSyncService) private readonly sync: NativeSyncService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}
  @Post('baseline')
  async baseline(
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireSession(this.sessions, authorization),
      input = parse(baselineInput, raw);
    return this.sync.baseline(parse(id, projectId), input.clientId, user, input.expected);
  }
  @Post('operations')
  async apply(
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    return this.sync.apply(
      parse(id, projectId),
      raw,
      await requireSession(this.sessions, authorization),
    );
  }
  @Get('operations/:operationId')
  async lookup(
    @Param('projectId') projectId: string,
    @Param('operationId') operationId: string,
    @Headers('authorization') authorization?: string,
  ) {
    return this.sync.lookup(
      parse(id, projectId),
      parse(id, operationId),
      await requireSession(this.sessions, authorization),
    );
  }
  @Get('events')
  async events(
    @Param('projectId') projectId: string,
    @Query('since') since: unknown = 0,
    @Headers('authorization') authorization?: string,
  ) {
    return this.sync.events(
      parse(id, projectId),
      parse(sequence, since),
      await requireSession(this.sessions, authorization),
    );
  }
}
