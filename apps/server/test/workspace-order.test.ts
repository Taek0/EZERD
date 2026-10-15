import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { reorderWorkspacesSchema } from '@ezerd/contracts';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { SpaceService } from '../src/workspace/space.service.js';
import { WorkspaceEventsService } from '../src/workspace/workspace-events.service.js';
import { userWorkspaces, users } from '../src/db/schema.js';
import { SpaceController } from '../src/workspace/space.controller.js';
import { UnauthorizedException } from '@nestjs/common';

function fixture() {
  const actor = randomUUID(),
    a = randomUUID(),
    b = randomUUID();
  const dates = { createdAt: new Date(), updatedAt: new Date() };
  const writes: { value: Record<string, unknown>; where: SQL }[] = [];
  const orderings: SQL[][] = [];
  const events = new WorkspaceEventsService();
  const listener = vi.fn();
  events.onUserChanged(listener);
  let rollback = false;
  const tx = {
    select: vi.fn(() => {
      let table: unknown;
      const q = {
        from(value: unknown) {
          table = value;
          return q;
        },
        where() {
          return q;
        },
        innerJoin() {
          return q;
        },
        for() {
          return q;
        },
        orderBy(...values: SQL[]) {
          orderings.push(values);
          return q;
        },
        then(resolve: (value: unknown) => unknown) {
          const result =
            table === users
              ? [{ id: actor }]
              : table === userWorkspaces
                ? [{ workspaceId: a }, { workspaceId: b }]
                : [
                    {
                      workspace: { id: b, name: 'B', status: 'archived', ...dates },
                      role: 'viewer',
                    },
                    { workspace: { id: a, name: 'A', status: 'active', ...dates }, role: 'owner' },
                  ];
          return Promise.resolve(result).then(resolve);
        },
      };
      return q;
    }),
    update: vi.fn(() => ({
      set: (value: Record<string, unknown>) => ({
        where: (where: SQL) => {
          writes.push({ value, where });
          return Promise.resolve();
        },
      }),
    })),
  };
  const db = {
    ...tx,
    transaction: async (run: (tx: typeof tx) => unknown) => {
      const result = await run(tx);
      expect(listener).not.toHaveBeenCalled();
      if (rollback) throw Error('rollback');
      return result;
    },
  };
  return {
    actor,
    a,
    b,
    writes,
    orderings,
    listener,
    tx,
    failCommit: () => {
      rollback = true;
    },
    service: new SpaceService({ db } as never, {} as never, events),
  };
}
describe('per-user workspace order', () => {
  it('requires authentication before a reorder reaches storage', async () => {
    const save = vi.fn();
    const controller = new SpaceController(
      {
        authenticateHeader: async () => {
          throw new UnauthorizedException();
        },
      } as never,
      { reorderWorkspaces: save } as never,
    );
    await expect(controller.reorder(undefined, { workspaceIds: [] })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(save).not.toHaveBeenCalled();
  });
  it('rejects duplicate IDs, malformed IDs and client-supplied actors', () => {
    const id = randomUUID();
    for (const input of [
      { workspaceIds: [id, id] },
      { workspaceIds: ['not-id'] },
      { workspaceIds: [id], userId: randomUUID() },
    ])
      expect(reorderWorkspacesSchema.safeParse(input).success).toBe(false);
  });
  it('atomically updates only the actor memberships and invalidates only that user after commit', async () => {
    const f = fixture();
    const result = await f.service.reorderWorkspaces(f.actor, { workspaceIds: [f.b, f.a] });
    expect(result.map((w) => w.id)).toEqual([f.b, f.a]);
    expect(f.writes).toHaveLength(1);
    const query = new PgDialect().sqlToQuery(f.writes[0]!.where);
    expect(query.sql).toContain('user_id');
    expect(query.params).toContain(f.actor);
    const position = new PgDialect().sqlToQuery(f.writes[0]!.value.sortOrder as SQL);
    expect(position.params).toEqual([f.b, 0, f.a, 1]);
    expect(f.listener).toHaveBeenCalledExactlyOnceWith({
      resource: 'workspaces',
      userIds: [f.actor],
    });
    expect(f.orderings.length).toBeGreaterThan(0);
  });
  it('rejects stale membership lists or another user workspace without writing', async () => {
    for (const mismatch of ['missing', 'foreign', 'duplicate'] as const) {
      const f = fixture();
      const ids =
        mismatch === 'missing' ? [f.a] : mismatch === 'foreign' ? [f.a, randomUUID()] : [f.a, f.a];
      await expect(f.service.reorderWorkspaces(f.actor, { workspaceIds: ids })).rejects.toThrow();
      expect(f.writes).toHaveLength(0);
      expect(f.listener).not.toHaveBeenCalled();
    }
  });
  it('does not publish on a failed transaction', async () => {
    const f = fixture();
    f.failCommit();
    await expect(
      f.service.reorderWorkspaces(f.actor, { workspaceIds: [f.b, f.a] }),
    ).rejects.toThrow('rollback');
    expect(f.listener).not.toHaveBeenCalled();
  });
});
