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
import { McpPersonalService } from './mcp/mcp-personal.service.js';
import { LanAccessService } from './network/network-access.js';
import { PersonalStateController } from './workspace/personal-state.controller.js';
import { PersonalStateService } from './workspace/personal-state.service.js';
import { SpaceController } from './workspace/space.controller.js';
import { SpaceService } from './workspace/space.service.js';
import { WorkspaceAccessService } from './workspace/workspace-access.service.js';
import { WorkspaceEventsService } from './workspace/workspace-events.service.js';
import { ProjectDatabaseService } from './workspace/project-database.service.js';

@Module({
  controllers: [
    HealthController,
    WorkspaceController,
    ReviewController,
    SessionController,
    SyncController,
    McpTokenController,
    McpController,
    PersonalStateController,
    SpaceController,
  ],
  providers: [
    DatabaseService,
    SessionService,
    SyncGateway,
    SyncService,
    WorkspaceService,
    ProjectDatabaseService,
    ReviewService,
    RateLimitService,
    McpTokenService,
    McpAuthService,
    McpServerFactory,
    McpLogger,
    McpDocumentService,
    McpPersonalService,
    LanAccessService,
    PersonalStateService,
    SpaceService,
    WorkspaceAccessService,
    WorkspaceEventsService,
  ],
})
export class AppModule {}
