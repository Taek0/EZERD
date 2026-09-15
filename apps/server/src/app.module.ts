import { Module } from '@nestjs/common';
import { DatabaseService } from './db/database.service.js';
import { HealthController } from './health.controller.js';
import { ReviewController } from './review.controller.js';
import { WorkspaceController } from './workspace.controller.js';
import { SessionController, SessionService } from './session.js';
import { SyncController } from './sync.controller.js';
import { SyncGateway } from './sync.gateway.js';
import { SyncService } from './sync.service.js';

@Module({ controllers: [HealthController, WorkspaceController, ReviewController, SessionController, SyncController], providers: [DatabaseService, SessionService, SyncGateway, SyncService] })
export class AppModule {}

