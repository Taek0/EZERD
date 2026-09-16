import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  Inject,
  Param,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { z } from 'zod';
import { requireSession, SessionService } from '../session.js';
import { McpTokenService } from './mcp-token.service.js';
import { readConfig } from '../config.js';

const idSchema = z.uuid();
const createSchema = z.strictObject({ name: z.string().trim().min(1).max(80) });
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('입력값을 확인해주세요.');
  return result.data;
}

@Controller('mcp-tokens')
export class McpTokenController {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(McpTokenService) private readonly tokens: McpTokenService,
  ) {}

  @Get('config')
  config() {
    const config = readConfig();
    return {
      enabled: config.MCP_ENABLED,
      publicUrl: config.MCP_ENABLED ? (config.MCP_PUBLIC_URL ?? null) : null,
    };
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  async create(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    const actor = await requireSession(this.sessions, authorization);
    const config = readConfig();
    if (!config.MCP_ENABLED || !config.MCP_PUBLIC_URL)
      throw new ServiceUnavailableException('MCP 공개 주소가 아직 설정되지 않았습니다.');
    return this.tokens.create(actor.id, parse(createSchema, body).name);
  }

  @Get()
  async list(@Headers('authorization') authorization: string | undefined) {
    const actor = await requireSession(this.sessions, authorization);
    return this.tokens.list(actor.id);
  }

  @Delete(':id')
  async revoke(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
  ) {
    const actor = await requireSession(this.sessions, authorization);
    return this.tokens.revoke(actor.id, parse(idSchema, rawId));
  }
}
