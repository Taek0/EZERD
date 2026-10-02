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
import { McpNativeDocumentService } from '../mcp/mcp-native-document.service.js';
import { requireSession, SessionService } from '../identity/session.js';
@Controller('projects/:projectId/native-sync')
export class NativeCommandController {
  constructor(
    @Inject(McpNativeDocumentService) private readonly commands: McpNativeDocumentService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}
  @Post('commands')
  async apply(
    @Param('projectId') id: string,
    @Body() raw: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const user = await requireSession(this.sessions, authorization),
      projectId = z.uuid().safeParse(id);
    if (
      !projectId.success ||
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      'projectId' in raw
    )
      throw new BadRequestException({ code: 'native.command-invalid' });
    return this.commands.apply({ ...raw, projectId: projectId.data }, user);
  }
}
