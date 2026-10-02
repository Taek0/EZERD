import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { requireSession, SessionService } from '../identity/session.js';
import { NativeTransferService } from './native-transfer.service.js';

@Controller('projects')
export class NativeTransferController {
  constructor(
    @Inject(NativeTransferService) private readonly transfer: NativeTransferService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  @Get(':projectId/native-transfer')
  async exportProject(
    @Param('projectId') id: string,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireSession(this.sessions, authorization);
    const parsed = z.uuid().safeParse(id);
    if (!parsed.success)
      throw new BadRequestException({ code: 'project-transfer.project-id-invalid' });
    return this.transfer.exportProject(user.id, parsed.data);
  }

  @Post('native-transfer/import')
  async importProject(@Body() raw: unknown, @Headers('authorization') authorization?: string) {
    const user = await requireSession(this.sessions, authorization);
    return this.transfer.importProject(user.id, raw);
  }
}
