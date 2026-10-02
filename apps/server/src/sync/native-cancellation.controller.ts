import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { requireSession, SessionService } from '../identity/session.js';
import { NativeCancellationService } from './native-cancellation.service.js';

@Controller('projects/:projectId/native-sync')
export class NativeCancellationController {
  constructor(
    @Inject(NativeCancellationService) private readonly cancellation: NativeCancellationService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}
  @Post('cancel')
  async cancel(
    @Param('projectId') projectId: string,
    @Body() raw: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireSession(this.sessions, authorization),
      id = z.uuid().safeParse(projectId);
    if (!id.success) throw new BadRequestException({ code: 'native.cancellation-input-invalid' });
    return this.cancellation.cancel(id.data, raw, user);
  }
}
