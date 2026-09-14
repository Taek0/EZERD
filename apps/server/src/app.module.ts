import { Module } from '@nestjs/common';
import { DatabaseService } from './db/database.service.js';
import { HealthController } from './health.controller.js';
import { ReviewController } from './review.controller.js';
import { WorkspaceController } from './workspace.controller.js';

@Module({ controllers: [HealthController, WorkspaceController, ReviewController], providers: [DatabaseService] })
export class AppModule {}

