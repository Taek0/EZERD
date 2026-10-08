import { afterEach, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { SyncRetentionService } from '../src/sync/sync-retention.service.js';
import { syncClientBaselines, syncOperations, syncTombstones } from '../src/db/schema.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('preserves the shared tombstone, operation and baseline retention predicates', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-07T00:00:00Z'));
  const predicates: unknown[] = [];
  const deletion = vi.fn((_table: unknown) => ({
    where: async (condition: any) => {
      predicates.push(new PgDialect().sqlToQuery(condition));
    },
  }));
  const service = new SyncRetentionService({ db: { delete: deletion } } as never);
  await service.cleanupExpired();
  expect(deletion.mock.calls.map(([table]) => table)).toEqual([
    syncTombstones,
    syncOperations,
    syncClientBaselines,
  ]);
  expect(predicates).toMatchObject([
    { sql: expect.stringContaining('"expires_at" <'), params: ['2026-10-07T00:00:00.000Z'] },
    { sql: expect.stringContaining('"created_at" <'), params: ['2026-09-30T00:00:00.000Z'] },
    {
      sql: expect.stringContaining('"last_successful_sync_at" <'),
      params: ['2026-09-30T00:00:00.000Z'],
    },
  ]);
});

it('runs at startup and hourly, retries after failures, and stops on shutdown', async () => {
  vi.useFakeTimers();
  const service = new SyncRetentionService({} as never);
  const cleanup = vi
    .spyOn(service, 'cleanupExpired')
    .mockRejectedValueOnce(Error('offline'))
    .mockResolvedValue(undefined);
  service.onModuleInit();
  expect(cleanup).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
  expect(cleanup).toHaveBeenCalledTimes(2);
  service.onApplicationShutdown();
  await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
  expect(cleanup).toHaveBeenCalledTimes(2);
});
