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
import { SessionService, requireSession } from '../identity/session.js';
import { NativeUpgradeService } from './native-upgrade.service.js';
@Controller('projects/:projectId/document')
export class NativeUpgradeController {
  constructor(
    @Inject(NativeUpgradeService) private readonly upgrade: NativeUpgradeService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}
  @Post('upgrade')
  async apply(
    @Param('projectId') id: string,
    @Body() raw: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireSession(this.sessions, authorization),
      parsed = z.uuid().safeParse(id);
    if (!parsed.success) throw new BadRequestException({ code: 'document.upgrade-input-invalid' });
    return this.upgrade.upgrade(parsed.data, raw, user);
  }
}
