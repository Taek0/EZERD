import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyNativeDocument, defaultDatabaseContext } from '@ezerd/model';
import type { DatabaseService } from '../src/db/database.service.js';
import { WorkspaceService } from '../src/workspace/workspace.service.js';
import { WorkspaceAccessService } from '../src/workspace/workspace-access.service.js';

function fixture() {
  const database = defaultDatabaseContext('postgresql');
  return {
    id: 'project-id',
    workspaceId: 'workspace-id',
    name: 'Native',
    databaseKind: database.kind,
    databaseProfileId: database.profileId,
    databaseRevision: 0,
    status: 'active' as const,
    version: 1,
    syncSequence: 2,
    createdAt: new Date('2026-10-08T00:00:00Z'),
    updatedAt: new Date('2026-10-08T00:00:00Z'),
    document: createEmptyNativeDocument(database),
  };
}

function harness() {
  let row = fixture();
  let afterHead: (() => void) | undefined;
  const sourceRead = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
    const snapshot = structuredClone(row);
    const tx = {
      select: (fields: Record<string, unknown>) => ({
        from: () => ({
          where: async () => {
            if ('document' in fields) {
              sourceRead();
              return [{ document: snapshot.document }];
            }
            const { document: _document, ...head } = snapshot;
            afterHead?.();
            return [head];
          },
        }),
      }),
    };
    return callback(tx);
  });
  const database = { db: { transaction } } as unknown as DatabaseService;
  const access = new WorkspaceAccessService(database);
  const authorize = vi.spyOn(access, 'requireProject').mockResolvedValue({
    workspaceId: 'workspace-id',
    role: 'viewer',
    status: 'active',
  });
  const service = new WorkspaceService(database, access);
  return {
    service,
    authorize,
    sourceRead,
    transaction,
    setRow: (next: ReturnType<typeof fixture>) => {
      row = next;
    },
    afterHead: (callback: () => void) => {
      afterHead = callback;
    },
  };
}

describe('authorized lightweight native project reads', () => {
  it('rechecks actor authorization while reusing only shared immutable source', async () => {
    const h = harness();
    const first = await h.service.getNativeQueryState('first-actor', 'project-id');
    const second = await h.service.getNativeQueryState('second-actor', 'project-id');
    expect(second.document).toBe(first.document);
    expect(second.project).not.toHaveProperty('preview');
    expect(second).not.toHaveProperty('personalViewIds');
    expect(h.sourceRead).toHaveBeenCalledTimes(1);
    expect(h.authorize).toHaveBeenNthCalledWith(
      2,
      'second-actor',
      'project-id',
      'read',
      expect.anything(),
    );
    h.authorize.mockRejectedValueOnce(new ForbiddenException('revoked'));
    await expect(h.service.getNativeQueryState('first-actor', 'project-id')).rejects.toThrow(
      'revoked',
    );
    expect(h.sourceRead).toHaveBeenCalledTimes(1);
  });

  it.each(['version', 'syncSequence', 'databaseRevision'] as const)(
    'invalidates native source when %s changes',
    async (coordinate) => {
      const h = harness();
      const first = await h.service.getNativeQueryState('actor', 'project-id');
      const changed = fixture();
      changed[coordinate] += 1;
      changed.document.domains.push({ id: 'fresh', name: 'Fresh', description: '' });
      h.setRow(changed);
      const second = await h.service.getNativeQueryState('actor', 'project-id');
      expect(second.document).not.toBe(first.document);
      expect(second.document.domains[0]?.name).toBe('Fresh');
      expect(h.sourceRead).toHaveBeenCalledTimes(2);
    },
  );

  it('keeps head and source in the same repeatable-read snapshot during a concurrent update', async () => {
    const h = harness();
    const next = fixture();
    next.version += 1;
    next.syncSequence += 1;
    next.document.domains.push({ id: 'new', name: 'New', description: '' });
    h.afterHead(() => h.setRow(next));
    const first = await h.service.getNativeQueryState('actor', 'project-id');
    expect(first.project.version).toBe(1);
    expect(first.document.domains).toEqual([]);
    expect(h.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    });
    const second = await h.service.getNativeQueryState('actor', 'project-id');
    expect(second.project.version).toBe(2);
    expect(second.document.domains[0]?.name).toBe('New');
  });

  it('does not reuse a snapshot after the database profile changes', async () => {
    const h = harness();
    await h.service.getNativeQueryState('actor', 'project-id');
    const changed = fixture();
    const database = defaultDatabaseContext('mysql');
    changed.databaseKind = database.kind;
    changed.databaseProfileId = database.profileId;
    changed.document = createEmptyNativeDocument(database);
    h.setRow(changed);
    const state = await h.service.getNativeQueryState('actor', 'project-id');
    expect(state.document.database.kind).toBe('mysql');
    expect(h.sourceRead).toHaveBeenCalledTimes(2);
  });
});
