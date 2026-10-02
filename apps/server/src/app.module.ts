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
import { NativeSyncService } from './sync/native-sync.service.js';
import { NativeSyncController } from './sync/native-sync.controller.js';
import { McpNativeDocumentService } from './mcp/mcp-native-document.service.js';
import { NativeUpgradeService } from './workspace/native-upgrade.service.js';
import { NativeUpgradeController } from './workspace/native-upgrade.controller.js';
import { NativeCommandController } from './sync/native-command.controller.js';
import { NativeTransferController } from './workspace/native-transfer.controller.js';
import { NativeTransferService } from './workspace/native-transfer.service.js';
import { NativeDDLService } from './workspace/native-ddl.service.js';
import { NativeDDLController } from './workspace/native-ddl.controller.js';
import { NativeHistoryService } from './sync/native-history.service.js';
import { NativeHistoryController } from './sync/native-history.controller.js';
import { NativeCancellationService } from './sync/native-cancellation.service.js';
import { NativeCancellationController } from './sync/native-cancellation.controller.js';

@Module({
  controllers: [
    HealthController,
    WorkspaceController,
    ReviewController,
    SessionController,
    SyncController,
    NativeSyncController,
    NativeUpgradeController,
    NativeCommandController,
    NativeTransferController,
    NativeDDLController,
    NativeHistoryController,
    NativeCancellationController,
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
    NativeSyncService,
    NativeUpgradeService,
    NativeTransferService,
    NativeDDLService,
    NativeHistoryService,
    NativeCancellationService,
    McpNativeDocumentService,
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
