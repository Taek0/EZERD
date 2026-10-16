import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  createEmptyDocument,
  createEmptyNativeDocument,
  defaultDatabaseContext,
  TABLES_VIEW_ID,
} from '@ezerd/model';
import { describe, expect, it, vi } from 'vitest';
import {
  messages,
  notifications,
  projects,
  threads,
  userWorkspaces,
  workspaces,
} from '../src/db/schema.js';
import { ReviewService } from '../src/review/review.service.js';
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
  const queries: Array<{
    table: unknown;
    fields?: Record<string, unknown>;
    condition?: SQL;
    joins: unknown[];
    joinConditions?: SQL[];
    order?: SQL[];
    lock?: string;
  }> = [];
  const writes: Array<{ table: unknown; value: unknown }> = [];
  const tx = {
    select: vi.fn((fields?: Record<string, unknown>) => {
      const query: (typeof queries)[number] = { table: null, fields, joins: [] };
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
        innerJoin(table: unknown, condition: SQL) {
          query.joins.push(table);
          (query.joinConditions ??= []).push(condition);
          return builder;
        },
        orderBy(...order: SQL[]) {
          query.order = order;
          return builder;
        },
        limit() {
          return builder;
        },
        for(lock: string) {
          query.lock = lock;
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
  const transaction = vi.fn(async (callback: (executor: typeof tx) => unknown) => callback(tx));
  const database = { db: { ...tx, transaction } };
  const access = new WorkspaceAccessService(database as never);
  const gateway = { publishReview: vi.fn() };
  return {
    rows,
    queries,
    writes,
    tx,
    transaction,
    gateway,
    review: new ReviewService(database as never, gateway as never, access),
  };
}

const pin = { viewId: 'overview', objectId: null, x: 0, y: 0, body: 'pin', mentionIds: [] };

describe('review membership boundaries', () => {
  it('validates domain object pins using global placements while preserving domain context', async () => {
    const fixture = store();
    const document = createEmptyDocument();
    document.domains = [
      { id: 'sales', name: 'Sales', description: '' },
      { id: 'identity', name: 'Identity', description: '' },
    ];
    document.tables = [
      {
        id: 'orders',
        domainId: 'sales',
        scope: 'both',
        logical: { name: 'Orders', definition: '' },
        physical: { name: 'orders', schema: 'public', comment: '' },
        customProperties: { common: {}, logical: {}, physical: {} },
      },
    ];
    document.notes = [{ id: 'note', viewId: TABLES_VIEW_ID, text: 'Shared' }];
    document.layout.nodes = [
      {
        id: 'order-global',
        objectId: 'orders',
        viewId: TABLES_VIEW_ID,
        x: 600,
        y: 700,
        width: 320,
        height: 260,
      },
      {
        id: 'note-global',
        objectId: 'note',
        viewId: TABLES_VIEW_ID,
        x: 400,
        y: 500,
        width: 200,
        height: 120,
      },
    ];
    fixture.rows.set(projects, [[{ ...project, document }]]);
    fixture.rows.set(messages, [[]]);
    for (const objectId of ['orders', 'note', null]) {
      await fixture.review.create(
        project.id,
        { ...pin, viewId: 'sales', objectId, x: 615, y: 725 },
        actor,
      );
      expect(fixture.writes).toContainEqual({
        table: threads,
        value: expect.objectContaining({ viewId: 'sales', objectId, x: 615, y: 725 }),
      });
    }
    await expect(
      fixture.review.create(project.id, { ...pin, viewId: 'identity', objectId: 'orders' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      fixture.review.create(project.id, { ...pin, viewId: 'missing', objectId: null }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('retains old personal pin metadata on reads without reclassifying it as shared', async () => {
    const fixture = store();
    fixture.rows.set(threads, [
      [{ ...thread, viewId: 'private-view', objectId: 'orders', x: 987, y: 654 }],
    ]);
    fixture.rows.set(messages, [[]]);
    expect(await fixture.review.getThread(thread.id, actor.id)).toMatchObject({
      viewId: 'private-view',
      objectId: 'orders',
      x: 987,
      y: 654,
    });
    expect(fixture.writes).toEqual([]);
  });

  it('allows pins on a legacy table normalized into the global canvas', async () => {
    const fixture = store();
    const legacy = createEmptyDocument();
    legacy.domains = [{ id: 'sales', name: 'Sales', description: '' }];
    legacy.tables = [
      {
        id: 'orders',
        domainId: 'sales',
        scope: 'both',
        logical: { name: 'Orders', definition: '' },
        physical: { name: 'orders', schema: 'public', comment: '' },
        customProperties: { common: {}, logical: {}, physical: {} },
      },
    ];
    legacy.layout.nodes = [
      {
        id: 'node:orders',
        objectId: 'orders',
        viewId: 'sales',
        x: 10,
        y: 20,
        width: 320,
        height: 260,
      },
    ];
    fixture.rows.set(projects, [[{ ...project, document: legacy }]]);
    fixture.rows.set(messages, [[]]);
    await fixture.review.create(
      project.id,
      {
        ...pin,
        viewId: TABLES_VIEW_ID,
        objectId: 'orders',
      },
      actor,
    );
    expect(fixture.writes).toContainEqual({
      table: threads,
      value: expect.objectContaining({ viewId: TABLES_VIEW_ID, objectId: 'orders' }),
    });
    expect(legacy.layout.nodes).toHaveLength(1);
  });
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

function nativeStore() {
  const fixture = store();
  const native = createEmptyNativeDocument(defaultDatabaseContext('postgresql'));
  fixture.rows.set(projects, [
    [
      {
        ...project,
        document: native,
        databaseKind: 'postgresql',
        databaseProfileId: 'postgresql-18-v1',
        databaseRevision: 0,
      },
    ],
  ]);
  return {
    ...fixture,
    native,
    context: {
      expectedDatabaseRevision: 0,
      expectedProjectVersion: project.version,
      expectedSyncSequence: project.syncSequence,
    },
  };
}

describe('bulk review queries and project lock projections', () => {
  it.each([0, 1, 50, 1_000])(
    'loads %i REST threads with a constant query budget and preserves message grouping',
    async (count) => {
      const fixture = store();
      const createdAt = new Date('2026-10-16T00:00:00.000Z');
      const rows = Array.from({ length: count }, (_, index) => ({
        ...thread,
        id: `thread-${String(index).padStart(4, '0')}`,
        // Equal timestamps must retain the database's ID tie-break order.
        createdAt,
        updatedAt: createdAt,
        viewId: index === 0 ? 'private-view' : 'overview',
        objectId: index === 0 ? 'legacy-object' : null,
      }));
      const replies = rows.slice(0, -1).map((row, index) => ({
        id: `message-${String(index).padStart(4, '0')}`,
        threadId: row.id,
        authorId: actor.id,
        body: `body-${index}`,
        mentionIds: [],
        createdAt,
      }));
      if (replies.length) {
        replies.push({ ...replies[0]!, id: 'message-z', body: 'last reply' });
      }
      fixture.rows.set(threads, [rows]);
      fixture.rows.set(messages, [replies]);
      const result = await fixture.review.list(project.id, actor.id);
      expect(fixture.transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'repeatable read',
        accessMode: 'read only',
      });
      expect(result).toEqual(
        rows.map((row) => ({
          ...row,
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
          messages: replies
            .filter((reply) => reply.threadId === row.id)
            .map((reply) => ({ ...reply, createdAt: createdAt.toISOString() })),
        })),
      );
      const dataQueries = fixture.queries.filter(
        (query) => query.table === threads || query.table === messages,
      );
      expect(dataQueries).toHaveLength(count ? 2 : 1);
      // Project/workspace/membership checks remain outside the data query budget.
      expect(fixture.queries).toHaveLength(count ? 5 : 4);
      const dialect = new PgDialect();
      const listQuery = dataQueries[0]!;
      expect(listQuery.fields).toBeUndefined();
      expect(dialect.sqlToQuery(listQuery.condition!).params).toEqual([project.id]);
      expect(listQuery.order!.map((order) => dialect.sqlToQuery(order).sql)).toEqual([
        '"review_threads"."updated_at" desc',
        '"review_threads"."id" asc',
      ]);
      if (count) {
        const messageQuery = dataQueries[1]!;
        expect(messageQuery.fields).toMatchObject({ id: messages.id, threadId: messages.threadId });
        expect(messageQuery.fields).not.toHaveProperty('document');
        expect(messageQuery.joins).toEqual([threads]);
        expect(dialect.sqlToQuery(messageQuery.joinConditions![0]!).sql).toBe(
          '"review_threads"."id" = "review_messages"."thread_id"',
        );
        // Project-scoped join uses one bind parameter even for a large thread list.
        expect(dialect.sqlToQuery(messageQuery.condition!).params).toEqual([project.id]);
        expect(messageQuery.order!.map((order) => dialect.sqlToQuery(order).sql)).toEqual([
          '"review_messages"."created_at" asc',
          '"review_messages"."id" asc',
        ]);
      }
      expect(fixture.writes).toEqual([]);
    },
  );

  it.each(['reply', 'update', 'remove', 'notification'] as const)(
    'uses a metadata-only project UPDATE lock for %s',
    async (method) => {
      const fixture = store();
      fixture.rows.set(messages, [[]]);
      const alert = {
        id: randomUUID(),
        userId: actor.id,
        projectId: project.id,
        threadId: thread.id,
        read: true,
        createdAt: new Date(),
      };
      fixture.rows.set(notifications, [[alert]]);
      if (method === 'reply') {
        await fixture.review.reply(thread.id, { body: 'reply', mentionIds: [] }, actor);
      } else if (method === 'update') {
        await fixture.review.update(thread.id, { resolved: true }, actor);
      } else if (method === 'remove') {
        await fixture.review.remove(
          thread.id,
          { expectedUpdatedAt: thread.updatedAt.toISOString() },
          actor,
        );
      } else {
        fixture.tx.update.mockReturnValueOnce({
          set: () => ({
            where: () => Object.assign(Promise.resolve(), { returning: async () => [alert] }),
          }),
        });
        expect(await fixture.review.updateNotification(alert.id, { read: true }, actor)).toEqual({
          ...alert,
          createdAt: alert.createdAt.toISOString(),
        });
      }
      const lock = fixture.queries.find((query) => query.table === projects && query.lock)!;
      expect(lock.lock).toBe('update');
      expect(lock.fields).toEqual({ status: projects.status });
      expect(
        fixture.queries.filter((query) => query.table === projects).every((query) => query.fields),
      ).toBe(true);
      if (method !== 'notification') {
        expect(
          fixture.queries.findIndex((query) => query.table === threads && query.lock),
        ).toBeGreaterThan(fixture.queries.indexOf(lock));
        expect(fixture.gateway.publishReview).toHaveBeenCalledOnce();
      }
    },
  );

  it('keeps the document-bearing UPDATE lock for create validation', async () => {
    const fixture = store();
    fixture.rows.set(messages, [[]]);
    await fixture.review.create(project.id, pin, actor);
    const lock = fixture.queries.find((query) => query.table === projects && query.lock)!;
    expect(lock.lock).toBe('update');
    expect(lock.fields).toBeUndefined();
  });

  it.each(['create', 'reply', 'update', 'remove', 'notification'] as const)(
    'rejects %s after project archival without writing or publishing',
    async (method) => {
      const fixture = store();
      fixture.rows.set(projects, [[project], [{ ...project, status: 'archived' }]]);
      fixture.rows.set(notifications, [[{ projectId: project.id }]]);
      const operation =
        method === 'create'
          ? fixture.review.create(project.id, pin, actor)
          : method === 'reply'
            ? fixture.review.reply(thread.id, { body: 'reply', mentionIds: [] }, actor)
            : method === 'update'
              ? fixture.review.update(thread.id, { resolved: true }, actor)
              : method === 'remove'
                ? fixture.review.remove(
                    thread.id,
                    { expectedUpdatedAt: thread.updatedAt.toISOString() },
                    actor,
                  )
                : fixture.review.updateNotification(randomUUID(), { read: true }, actor);
      await expect(operation).rejects.toBeInstanceOf(ConflictException);
      expect(fixture.writes).toEqual([]);
      expect(fixture.tx.delete).not.toHaveBeenCalled();
      expect(fixture.gateway.publishReview).not.toHaveBeenCalled();
    },
  );

  it('retains stale-delete protection after taking project and thread locks', async () => {
    const fixture = store();
    await expect(
      fixture.review.remove(
        thread.id,
        {
          expectedUpdatedAt: new Date(thread.updatedAt.getTime() - 1).toISOString(),
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.queries.filter((query) => query.lock).map((query) => query.table)).toEqual([
      workspaces,
      projects,
      threads,
    ]);
    expect(fixture.tx.delete).not.toHaveBeenCalled();
    expect(fixture.gateway.publishReview).not.toHaveBeenCalled();
  });
});
