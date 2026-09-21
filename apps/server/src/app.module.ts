import { Module } from '@nestjs/common';
import { DatabaseService } from './db/database.service.js';
import { HealthController } from './health.controller.js';
import { ReviewController } from './review/review.controller.js';
import { ReviewService } from './review/review.service.js';
import { WorkspaceController } from './workspace/workspace.controller.js';
import { SessionController, SessionService } from './identity/session.js';
import { SyncController } from './sync/sync.controller.js';
import { SyncGateway } from './sync/sync.gateway.js';
import { SyncService } from './sync/sync.service.js';
import { WorkspaceService } from './workspace/workspace.service.js';
import { RateLimitService } from './shared/rate-limit.service.js';
import { McpTokenController } from './mcp/mcp-token.controller.js';
import { McpTokenService } from './mcp/mcp-token.service.js';
import { McpController } from './mcp/mcp.controller.js';
import { McpAuthService } from './mcp/mcp-auth.service.js';
import { McpServerFactory } from './mcp/mcp-server.js';
import { McpLogger } from './mcp/logging.js';
import { McpDocumentService } from './mcp/mcp-document.service.js';
import { LanAccessService } from './network/network-access.js';

@Module({
  controllers: [
    HealthController,
    WorkspaceController,
    ReviewController,
    SessionController,
    SyncController,
    McpTokenController,
    McpController,
  ],
  providers: [
    DatabaseService,
    SessionService,
    SyncGateway,
    SyncService,
    WorkspaceService,
    ReviewService,
    RateLimitService,
    McpTokenService,
    McpAuthService,
    McpServerFactory,
    McpLogger,
    McpDocumentService,
    LanAccessService,
  ],
})
export class AppModule {}
