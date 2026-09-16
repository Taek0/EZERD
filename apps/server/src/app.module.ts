import { Module } from '@nestjs/common';
import { DatabaseService } from './db/database.service.js';
import { HealthController } from './health.controller.js';
import { ReviewController } from './review.controller.js';
import { ReviewService } from './review.service.js';
import { WorkspaceController } from './workspace.controller.js';
import { SessionController, SessionService } from './session.js';
import { SyncController } from './sync.controller.js';
import { SyncGateway } from './sync.gateway.js';
import { SyncService } from './sync.service.js';
import { WorkspaceService } from './workspace.service.js';
import { RateLimitService } from './rate-limit.service.js';
import { McpTokenController } from './mcp/mcp-token.controller.js';
import { McpTokenService } from './mcp/mcp-token.service.js';

@Module({
  controllers: [
    HealthController,
    WorkspaceController,
    ReviewController,
    SessionController,
    SyncController,
    McpTokenController,
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
  ],
})
export class AppModule {}
