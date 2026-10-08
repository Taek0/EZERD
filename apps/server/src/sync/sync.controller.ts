import { Controller, Get, Headers, Inject, Post } from '@nestjs/common';
import { requireSession, SessionService } from '../identity/session.js';
import { legacyApiRetired } from '../shared/legacy-api-retired.js';

/** Stable tombstones for retired clients; no legacy storage or mutation service is invoked. */
@Controller()
export class SyncController {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  @Get([
    'projects/:projectId/operations/:operationId',
    'projects/:projectId/events',
    'projects/:projectId/history',
  ])
  async read(@Headers('authorization') authorization?: string) {
    return this.retired(authorization);
  }

  @Post([
    'projects/:projectId/operations',
    'projects/:projectId/sync-baseline',
    'projects/:projectId/deletions/:deletedOperationId/restore',
    'projects/:projectId/operations/:sourceOperationId/undo',
  ])
  async write(@Headers('authorization') authorization?: string) {
    return this.retired(authorization);
  }

  private async retired(authorization?: string) {
    await requireSession(this.sessions, authorization);
    throw legacyApiRetired();
  }
}
