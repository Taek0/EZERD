import { BadRequestException, Controller, Get, Headers, Inject, Param } from '@nestjs/common';
import { z } from 'zod';
import { requireSession, SessionService } from '../identity/session.js';
import { NativeDDLService } from './native-ddl.service.js';
@Controller('projects')
export class NativeDDLController {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(NativeDDLService) private readonly ddl: NativeDDLService,
  ) {}
  @Get(':projectId/ddl')
  async exportProject(
    @Param('projectId') raw: string,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireSession(this.sessions, authorization),
      id = z.uuid().safeParse(raw);
    if (!id.success) throw new BadRequestException({ code: 'project.id-invalid' });
    return this.ddl.exportProject(user.id, id.data);
  }
}
