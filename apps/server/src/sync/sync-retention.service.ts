import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { lt } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service.js';
import { syncClientBaselines, syncOperations, syncTombstones } from '../db/schema.js';

const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Shared ledger retention remains active independently of retired v1 editing. */
@Injectable()
export class SyncRetentionService implements OnModuleInit, OnApplicationShutdown {
  private cleanupTimer?: NodeJS.Timeout;
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  onModuleInit(): void {
    void this.cleanupExpired().catch(() => undefined);
    this.cleanupTimer = setInterval(
      () => void this.cleanupExpired().catch(() => undefined),
      60 * 60 * 1000,
    );
    this.cleanupTimer.unref();
  }

  onApplicationShutdown(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async cleanupExpired(): Promise<void> {
    const cutoff = new Date(Date.now() - HISTORY_RETENTION_MS);
    await this.database.db.delete(syncTombstones).where(lt(syncTombstones.expiresAt, new Date()));
    await this.database.db.delete(syncOperations).where(lt(syncOperations.createdAt, cutoff));
    await this.database.db
      .delete(syncClientBaselines)
      .where(lt(syncClientBaselines.lastSuccessfulSyncAt, cutoff));
  }
}
