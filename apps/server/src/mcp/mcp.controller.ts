import { randomUUID } from 'node:crypto';
import {
  All,
  Controller,
  Headers,
  HttpException,
  Inject,
  NotFoundException,
  Req,
  Res,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readConfig } from '../config.js';
import { McpAuthService } from './mcp-auth.service.js';
import { McpLogger } from './logging.js';
import { McpServerFactory } from './mcp-server.js';

type McpRequest = IncomingMessage & { body?: unknown };

@Controller('mcp')
export class McpController {
  constructor(
    @Inject(McpAuthService) private readonly auth: McpAuthService,
    @Inject(McpServerFactory) private readonly servers: McpServerFactory,
    @Inject(McpLogger) private readonly logger: McpLogger,
  ) {}

  @All()
  async handle(
    @Headers('authorization') authorization: string | undefined,
    @Req() request: McpRequest,
    @Res() response: ServerResponse,
  ) {
    const config = readConfig();
    if (!config.MCP_ENABLED) throw new NotFoundException();
    if (request.method !== 'POST')
      throw new HttpException('MCP endpoint는 POST 요청만 지원합니다.', 405);
    const requestId = randomUUID();
    let principal;
    try {
      principal = await this.auth.authenticateHeader(authorization);
    } catch (error) {
      await this.logger.write({
        level: error instanceof UnauthorizedException ? 'warn' : 'error',
        event: 'auth-rejected',
        requestId,
        errorCode:
          error instanceof UnauthorizedException ? 'UNAUTHORIZED' : 'AUTH_STORE_UNAVAILABLE',
      });
      if (error instanceof UnauthorizedException) throw error;
      throw new ServiceUnavailableException(
        `MCP 인증 저장소를 확인할 수 없습니다. 요청 ID: ${requestId}`,
      );
    }
    const publicUrl = new URL(config.MCP_PUBLIC_URL!);
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      allowedHosts: [publicUrl.host],
      allowedOrigins: [publicUrl.origin],
      enableDnsRebindingProtection: true,
    });
    const server = this.servers.create(principal.user, principal.tokenId, requestId);
    try {
      // SDK 1.30's Node transport declaration is stricter than its Transport interface
      // under exactOptionalPropertyTypes; the runtime implementation is the official adapter.
      await server.connect(transport as never);
      await transport.handleRequest(request, response, request.body);
    } finally {
      await server.close().catch(() => undefined);
    }
  }
}
