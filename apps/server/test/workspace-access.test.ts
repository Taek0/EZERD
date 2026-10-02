import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../src/db/database.service.js';
import { WorkspaceAccessService } from '../src/workspace/workspace-access.service.js';

describe('workspace access transactions', () => {
  for (const scope of ['project', 'workspace'] as const) {
    for (const permission of ['read', 'design', 'review', 'personal'] as const) {
      it(`${scope} ${permission} uses the appropriate transaction and checks access before callback`, async () => {
        const executor = {};
        const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
          callback(executor),
        );
        const database = { db: { transaction } } as unknown as DatabaseService;
        const service = new WorkspaceAccessService(database);
        const access = {
          workspaceId: 'workspace-id',
          role: 'owner' as const,
          status: 'active' as const,
        };
        const checked = vi
          .spyOn(service, scope === 'project' ? 'requireProject' : 'requireWorkspace')
          .mockResolvedValue(access);
        const callback = vi.fn(async (tx, granted) => {
          expect(checked).toHaveBeenCalledWith('actor-id', 'target-id', permission, tx);
          expect(granted).toBe(access);
          return 'result';
        });
        const result =
          scope === 'project'
            ? await service.runProject('actor-id', 'target-id', permission, callback)
            : await service.runWorkspace('actor-id', 'target-id', permission, callback);
        expect(result).toBe('result');
        expect(transaction).toHaveBeenCalledWith(
          expect.any(Function),
          permission === 'read'
            ? { isolationLevel: 'repeatable read', accessMode: 'read only' }
            : undefined,
        );
        expect(callback).toHaveBeenCalledWith(executor, access);
      });
    }
  }
});
