import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { BadRequestException, GoneException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ReviewController } from '../src/review/review.controller.js';
import { ReviewService } from '../src/review/review.service.js';
import { WorkspaceController } from '../src/workspace/workspace.controller.js';
import { PersonalStateController } from '../src/workspace/personal-state.controller.js';

const actor = { id: randomUUID(), username: 'actor', color: '#4169e1' };

function rejectingSession() {
  return {
    authenticateHeader: vi.fn(async () => {
      throw new UnauthorizedException('로그인이 필요합니다.');
    }),
  };
}

describe('authenticated write paths', () => {
  it('authenticates every project, review, and notification mutation before database access', async () => {
    const domainService = new Proxy(
      {},
      {
        get: () => {
          throw new Error('domain service must not be accessed');
        },
      },
    );
    const session = rejectingSession();
    const workspace = new WorkspaceController(
      {} as never,
      session as never,
      domainService as never,
      {} as never,
    );
    const review = new ReviewController(session as never, domainService as never);
    const personal = new PersonalStateController(session as never, domainService as never);
    const id = randomUUID();

    const writes = [
      workspace.updateUser(undefined, id, { color: '#123456' }),
      workspace.createProject(undefined, { name: 'project' }),
      workspace.updateProject(undefined, id, { expectedVersion: 0, name: 'changed' }),
      workspace.deleteProject(undefined, id, { expectedVersion: 0 }),
      workspace.saveDocument(undefined, id, {}),
      review.create(undefined, id, {
        viewId: 'overview',
        objectId: null,
        x: 0,
        y: 0,
        body: 'pin',
        mentionIds: [],
      }),
      review.reply(undefined, id, { body: 'reply', mentionIds: [] }),
      review.update(undefined, id, { resolved: true }),
      review.remove(undefined, id, { expectedUpdatedAt: new Date().toISOString() }),
      review.updateNotification(undefined, id, { read: true }),
      personal.save(undefined, id, {}),
    ];

    for (const write of writes) await expect(write).rejects.toBeInstanceOf(UnauthorizedException);
    expect(session.authenticateHeader).toHaveBeenCalledTimes(writes.length);
  });

  it('authenticates review, notifications, and personal reads before service access', async () => {
    const domainService = new Proxy(
      {},
      {
        get: () => {
          throw new Error('domain service must not be accessed');
        },
      },
    );
    const session = rejectingSession();
    const review = new ReviewController(session as never, domainService as never);
    const personal = new PersonalStateController(session as never, domainService as never);
    const id = randomUUID();
    const reads = [
      review.list(undefined, id),
      review.listNotifications(undefined, id),
      personal.get(undefined, id),
    ];
    for (const read of reads) await expect(read).rejects.toBeInstanceOf(UnauthorizedException);
    expect(session.authenticateHeader).toHaveBeenCalledTimes(reads.length);
  });

  it('returns 410 for authenticated whole-document replacement attempts', async () => {
    const session = { authenticateHeader: vi.fn(async () => actor) };
    const controller = new WorkspaceController(
      {} as never,
      session as never,
      {} as never,
      {} as never,
    );
    await expect(
      controller.saveDocument('Bearer valid-token', randomUUID(), {}),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it('rejects a spoofed body author and derives authorship from the session', async () => {
    const spoofedAuthorId = randomUUID();
    const insertedMessages: Array<Record<string, unknown>> = [];
    let selectIndex = 0;
    const project = {
      id: randomUUID(),
      status: 'active',
      document: {
        schemaVersion: 1,
        domains: [],
        domainRelations: [],
        notes: [],
        layout: { nodes: [], viewports: [] },
      },
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
    const tx = {
      select: vi.fn(() => {
        const index = selectIndex++;
        return {
          from: () => {
            if (index === 0) return { where: () => ({ for: async () => [project] }) };
            if (index === 1) return { where: async () => [thread] };
            return { where: () => ({ orderBy: async () => [] }) };
          },
        };
      }),
      insert: vi.fn((table: unknown) => ({
        values: (value: Record<string, unknown>) => {
          if (table && 'authorId' in value) insertedMessages.push(value);
          return 'projectId' in value && !('authorId' in value)
            ? { returning: async () => [thread] }
            : Promise.resolve();
        },
      })),
      update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
    };
    let committed = false;
    const database = {
      db: {
        transaction: async (callback: (value: typeof tx) => unknown) => {
          const value = await callback(tx);
          committed = true;
          return value;
        },
      },
    };
    const session = { authenticateHeader: vi.fn(async () => actor) };
    const gateway = { publishReview: vi.fn(() => expect(committed).toBe(true)) };
    const access = { requireProject: vi.fn(async () => ({ role: 'viewer', status: 'active' })) };
    const service = new ReviewService(database as never, gateway as never, access as never);
    const controller = new ReviewController(session as never, service);

    await expect(
      controller.create('Bearer valid-token', project.id, {
        authorId: spoofedAuthorId,
        viewId: 'overview',
        objectId: null,
        x: 0,
        y: 0,
        body: 'message',
        mentionIds: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const result = await controller.create('Bearer valid-token', project.id, {
      viewId: 'overview',
      objectId: null,
      x: 0,
      y: 0,
      body: 'message',
      mentionIds: [],
    });

    expect(result.messages).toEqual([]);
    expect(access.requireProject).toHaveBeenCalledWith(actor.id, project.id, 'review', tx);
    expect(insertedMessages).toContainEqual(
      expect.objectContaining({ authorId: actor.id, body: 'message' }),
    );
    expect(insertedMessages).not.toContainEqual(
      expect.objectContaining({ authorId: spoofedAuthorId }),
    );
    expect(gateway.publishReview).toHaveBeenCalledWith(
      project.id,
      expect.objectContaining({ action: 'thread-created', actorId: actor.id }),
    );
  });
});
