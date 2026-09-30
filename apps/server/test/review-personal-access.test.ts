import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createEmptyDocument, extractPersonalState } from '@ezerd/model';
import { describe, expect, it, vi } from 'vitest';
import {
  messages,
  notifications,
  projectPersonalOperations,
  projectPersonalStates,
  projects,
  threads,
  userWorkspaces,
  workspaces,
} from '../src/db/schema.js';
import { ReviewService } from '../src/review/review.service.js';
import { McpPersonalService } from '../src/mcp/mcp-personal.service.js';
import { PersonalStateService } from '../src/workspace/personal-state.service.js';
import { WorkspaceAccessService } from '../src/workspace/workspace-access.service.js';

const actor = { id: randomUUID(), username: 'viewer', color: '#4169e1' };
const workspaceId = randomUUID();
const project = {
  id: randomUUID(),
  workspaceId,
  status: 'active',
  version: 3,
  syncSequence: 7,
  document: createEmptyDocument(),
};
const thread = {
  id: randomUUID(),
  projectId: project.id,
  viewId: 'overview',
  objectId: null,
  x: 0,
  y: 0,
  resolved: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function store(role: 'owner' | 'editor' | 'viewer' | null = 'viewer', status = 'active') {
  const rows = new Map<unknown, unknown[][]>([
    [projects, [[project]]],
    [workspaces, [[{ workspaceId, status }]]],
    [userWorkspaces, [role ? [{ role }] : []]],
    [threads, [[thread]]],
  ]);
  const queries: Array<{ table: unknown; condition?: SQL; joins: unknown[] }> = [];
  const writes: Array<{ table: unknown; value: unknown }> = [];
  const tx = {
    select: vi.fn(() => {
      const query: (typeof queries)[number] = { table: null, joins: [] };
      const builder = {
        from(table: unknown) {
          query.table = table;
          queries.push(query);
          return builder;
        },
        where(condition: SQL) {
          query.condition = condition;
          return builder;
        },
        innerJoin(table: unknown) {
          query.joins.push(table);
          return builder;
        },
        orderBy() {
          return builder;
        },
        limit() {
          return builder;
        },
        for() {
          return builder;
        },
        then(resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) {
          const choices = rows.get(query.table) ?? [[]];
          const value = choices.length > 1 ? choices.shift()! : choices[0]!;
          return Promise.resolve(value).then(resolve, reject);
        },
      };
      return builder;
    }),
    insert: vi.fn((table: unknown) => ({
      values(value: unknown) {
        writes.push({ table, value });
        const promise = Promise.resolve();
        return Object.assign(promise, {
          returning: async () => (table === threads ? [thread] : []),
        });
      },
    })),
    update: vi.fn((table: unknown) => ({
      set(value: unknown) {
        writes.push({ table, value });
        return { where: () => Object.assign(Promise.resolve(), { returning: async () => [] }) };
      },
    })),
    delete: vi.fn(() => ({ where: async () => undefined })),
  };
  const database = {
    db: { ...tx, transaction: async (callback: (executor: typeof tx) => unknown) => callback(tx) },
  };
  const access = new WorkspaceAccessService(database as never);
  const gateway = { publishReview: vi.fn() };
  return {
    rows,
    queries,
    writes,
    tx,
    gateway,
    review: new ReviewService(database as never, gateway as never, access),
    personal: new PersonalStateService(database as never, access),
  };
}

const pin = { viewId: 'overview', objectId: null, x: 0, y: 0, body: 'pin', mentionIds: [] };

describe('review membership boundaries', () => {
  it.each(['list', 'listPage', 'getThread'] as const)(
    'rejects a nonmember on %s without loading messages',
    async (method) => {
      const fixture = store(null);
      const result =
        method === 'list'
          ? fixture.review.list(project.id, actor.id)
          : method === 'listPage'
            ? fixture.review.listPage(project.id, actor.id, 10)
            : fixture.review.getThread(thread.id, actor.id);
      await expect(result).rejects.toBeInstanceOf(ForbiddenException);
      expect(fixture.queries.some((query) => query.table === messages)).toBe(false);
    },
  );

  it('allows a current viewer to create a pin and publishes after transaction completion', async () => {
    const fixture = store();
    fixture.rows.set(messages, [[]]);
    await fixture.review.create(project.id, pin, actor);
    expect(fixture.writes).toContainEqual({
      table: messages,
      value: expect.objectContaining({ authorId: actor.id }),
    });
    expect(fixture.gateway.publishReview).toHaveBeenCalledOnce();
  });

  it.each(['create', 'reply', 'update', 'remove'] as const)(
    'blocks %s writes in an archived workspace',
    async (method) => {
      const fixture = store('owner', 'archived');
      const result =
        method === 'create'
          ? fixture.review.create(project.id, pin, actor)
          : method === 'reply'
            ? fixture.review.reply(thread.id, { body: 'reply', mentionIds: [] }, actor)
            : method === 'update'
              ? fixture.review.update(thread.id, { resolved: true }, actor)
              : fixture.review.remove(
                  thread.id,
                  { expectedUpdatedAt: thread.updatedAt.toISOString() },
                  actor,
                );
      await expect(result).rejects.toBeInstanceOf(ForbiddenException);
      expect(fixture.writes).toEqual([]);
      expect(fixture.tx.delete).not.toHaveBeenCalled();
      expect(fixture.gateway.publishReview).not.toHaveBeenCalled();
    },
  );

  it('rejects mentions absent from the current project workspace before messages or notifications are inserted', async () => {
    const fixture = store();
    fixture.rows.set(userWorkspaces, [[{ role: 'viewer' }], []]);
    await expect(
      fixture.review.create(project.id, { ...pin, mentionIds: [randomUUID()] }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      fixture.queries.find((query) => query.table === userWorkspaces && query.joins.length)?.joins,
    ).toEqual([projects]);
    expect(
      fixture.writes.some((write) => write.table === messages || write.table === notifications),
    ).toBe(false);
    expect(fixture.gateway.publishReview).not.toHaveBeenCalled();
  });

  it('deduplicates current member mentions and excludes the author from notifications', async () => {
    const fixture = store();
    const recipientId = randomUUID();
    fixture.rows.set(userWorkspaces, [
      [{ role: 'viewer' }],
      [{ id: actor.id }, { id: recipientId }],
    ]);
    fixture.rows.set(messages, [[]]);
    await fixture.review.create(
      project.id,
      { ...pin, mentionIds: [actor.id, recipientId, recipientId] },
      actor,
    );
    const membershipQuery = fixture.queries.find(
      (query) => query.table === userWorkspaces && query.joins.length,
    )!;
    expect(new PgDialect().sqlToQuery(membershipQuery.condition!).params).toEqual([
      project.id,
      actor.id,
      recipientId,
    ]);
    expect(fixture.writes).toContainEqual({
      table: messages,
      value: expect.objectContaining({ mentionIds: [actor.id, recipientId] }),
    });
    expect(fixture.writes).toContainEqual({
      table: notifications,
      value: [{ userId: recipientId, projectId: project.id, threadId: thread.id }],
    });
  });

  it('filters paged notifications by current workspace membership and recipient', async () => {
    const fixture = store();
    fixture.rows.set(notifications, [[]]);
    await fixture.review.listNotificationsPage(actor.id, 10);
    const query = fixture.queries.find((item) => item.table === notifications)!;
    const compiled = new PgDialect().sqlToQuery(query.condition!);
    expect(compiled.sql).toContain('exists');
    expect(compiled.sql).toContain('"user_workspaces"');
    expect(compiled.sql).toContain('"projects"."workspace_id"');
    expect(compiled.sql).toContain('"review_notifications"."user_id"');
    expect(compiled.params).toEqual([actor.id, actor.id]);
  });

  it('validates notification recipient before authorizing its project', async () => {
    const fixture = store();
    fixture.rows.set(notifications, [[]]);
    await expect(
      fixture.review.updateNotification(randomUUID(), { read: true }, actor),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fixture.queries.map((query) => query.table)).toEqual([notifications]);
    expect(new PgDialect().sqlToQuery(fixture.queries[0]!.condition!).params).toContain(actor.id);
    expect(fixture.writes).toEqual([]);
  });

  it('blocks notification updates after membership revocation or workspace archival', async () => {
    for (const fixture of [store(null), store('viewer', 'archived')]) {
      fixture.rows.set(notifications, [[{ projectId: project.id }]]);
      await expect(
        fixture.review.updateNotification(randomUUID(), { read: true }, actor),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(fixture.writes).toEqual([]);
    }
  });
});

describe('personal state membership boundaries', () => {
  it('requires membership for reads and permits reads in archived workspaces', async () => {
    const rejected = store(null);
    await expect(rejected.personal.get(project.id, actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(rejected.queries.some((query) => query.table === projectPersonalStates)).toBe(false);
    const fixture = store('viewer', 'archived');
    fixture.rows.set(projectPersonalStates, [[]]);
    await expect(fixture.personal.get(project.id, actor)).resolves.toMatchObject({
      version: 0,
      projectVersion: 3,
    });
    const query = fixture.queries.find((item) => item.table === projectPersonalStates)!;
    expect(new PgDialect().sqlToQuery(query.condition!).params).toEqual([project.id, actor.id]);
  });

  it('allows viewer personal layout writes without changing the shared document', async () => {
    const fixture = store();
    fixture.rows.set(projectPersonalStates, [[]]);
    const original = structuredClone(project.document);
    const state = {
      ...extractPersonalState(project.document),
      viewports: [{ viewId: 'overview', x: 12, y: 0, zoom: 1 }],
    };
    await expect(fixture.personal.save(project.id, actor, 0, state)).resolves.toMatchObject({
      version: 1,
      state,
    });
    expect(fixture.writes).toEqual([
      {
        table: projectPersonalStates,
        value: expect.objectContaining({ projectId: project.id, userId: actor.id, state }),
      },
    ]);
    expect(project.document).toEqual(original);
  });

  it('rechecks MCP personal permission before loading an operation replay', async () => {
    for (const fixture of [store(null), store('owner', 'archived')]) {
      const mcp = new McpPersonalService(fixture.personal);
      await expect(
        mcp.apply(
          {
            projectId: project.id,
            expectedVersion: 0,
            operationId: randomUUID(),
            commands: [
              { type: 'set_viewport', value: { viewId: 'overview', x: 2, y: 0, zoom: 1 } },
            ],
          },
          actor,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(fixture.queries.some((query) => query.table === projectPersonalOperations)).toBe(
        false,
      );
      expect(fixture.writes).toEqual([]);
    }
  });
});
