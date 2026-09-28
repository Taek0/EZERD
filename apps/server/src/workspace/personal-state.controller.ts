import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import { personalStateSnapshotSchema, savePersonalStateSchema } from '@ezerd/contracts';
import { requireSession, SessionService } from '../identity/session.js';
import { PersonalStateService } from './personal-state.service.js';

const idSchema = z.uuid();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('입력값을 확인해주세요.');
  return result.data;
}

@Controller('projects/:projectId/personal-state')
export class PersonalStateController {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(PersonalStateService) private readonly personal: PersonalStateService,
  ) {}

  @Get()
  async get(
    @Headers('authorization') authorization: string | undefined,
    @Param('projectId') rawProjectId: string,
  ) {
    const user = await requireSession(this.sessions, authorization);
    return personalStateSnapshotSchema.parse(
      await this.personal.get(parse(idSchema, rawProjectId), user),
    );
  }

  @Put()
  async save(
    @Headers('authorization') authorization: string | undefined,
    @Param('projectId') rawProjectId: string,
    @Body() body: unknown,
  ) {
    const user = await requireSession(this.sessions, authorization);
    const input = parse(savePersonalStateSchema, body);
    return personalStateSnapshotSchema.parse(
      await this.personal.save(
        parse(idSchema, rawProjectId),
        user,
        input.expectedVersion,
        input.state,
      ),
    );
  }
}
