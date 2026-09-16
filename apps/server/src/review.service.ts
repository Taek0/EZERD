import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  createMessageSchema,
  createThreadSchema,
  deleteThreadSchema,
  updateNotificationSchema,
  updateThreadSchema,
} from '@ezerd/contracts';
import { DatabaseService } from './db/database.service.js';
import { messages, notifications, projects, threads, users } from './db/schema.js';
import type { AuthenticatedUser } from './session.js';
import { SyncGateway } from './sync.gateway.js';

type Transaction = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];
type Store = DatabaseService['db'] | Transaction;
const nextThreadTimestamp = sql`greatest(date_trunc('milliseconds', clock_timestamp()), date_trunc('milliseconds', ${threads.updatedAt}) + interval '1 millisecond')`;

async function operation<T>(callback: () => Promise<T>) {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException('핀을 저장할 수 없습니다. 잠시 후 다시 시도해주세요.');
  }
}
function notification(row: typeof notifications.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}
async function loadThread(db: Store, id: string) {
  const [row] = await db.select().from(threads).where(eq(threads.id, id));
  if (!row) throw new NotFoundException('댓글을 찾을 수 없습니다.');
  const replies = await db
    .select()
    .from(messages)
    .where(eq(messages.threadId, id))
    .orderBy(asc(messages.createdAt), asc(messages.id));
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messages: replies.map((message) => ({
      ...message,
      createdAt: message.createdAt.toISOString(),
    })),
  };
}
async function validatePeople(db: Store, mentionIds: string[]) {
  const ids = [...new Set(mentionIds)];
  if (!ids.length) return;
  const found = await db.select({ id: users.id }).from(users).where(inArray(users.id, ids));
  if (found.length !== ids.length) throw new BadRequestException('멘션 사용자를 찾을 수 없습니다.');
}
async function addMessage(
  db: Transaction,
  threadId: string,
  projectId: string,
  authorId: string,
  input: z.infer<typeof createMessageSchema>,
) {
  const mentionIds = [...new Set(input.mentionIds)];
  await validatePeople(db, mentionIds);
  await db.insert(messages).values({ threadId, authorId, body: input.body, mentionIds });
  const recipientIds = mentionIds.filter((id) => id !== authorId);
  if (recipientIds.length)
    await db
      .insert(notifications)
      .values(recipientIds.map((userId) => ({ userId, projectId, threadId })));
  await db.update(threads).set({ updatedAt: nextThreadTimestamp }).where(eq(threads.id, threadId));
}
async function lockActiveProject(db: Transaction, projectId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .for('update');
  if (!project) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
  if (project.status === 'archived')
    throw new ConflictException('보관된 프로젝트는 변경할 수 없습니다.');
  return project;
}
async function lockActiveThread(db: Transaction, id: string) {
  const [reference] = await db
    .select({ projectId: threads.projectId })
    .from(threads)
    .where(eq(threads.id, id));
  if (!reference) throw new NotFoundException('댓글을 찾을 수 없습니다.');
  await lockActiveProject(db, reference.projectId);
  const [thread] = await db.select().from(threads).where(eq(threads.id, id)).for('update');
  if (!thread) throw new NotFoundException('댓글을 찾을 수 없습니다.');
  return thread;
}

@Injectable()
export class ReviewService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SyncGateway) private readonly gateway: SyncGateway,
  ) {}

  list(projectId: string) {
    return operation(async () => {
      const [project] = await this.database.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, projectId));
      if (!project) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
      const rows = await this.database.db
        .select({ id: threads.id })
        .from(threads)
        .where(eq(threads.projectId, projectId))
        .orderBy(desc(threads.updatedAt), asc(threads.id));
      return Promise.all(rows.map((row) => loadThread(this.database.db, row.id)));
    });
  }

  create(projectId: string, input: z.infer<typeof createThreadSchema>, actor: AuthenticatedUser) {
    return operation(async () => {
      const result = await this.database.db.transaction(async (tx) => {
        const project = await lockActiveProject(tx, projectId);
        const doc = project.document;
        if (
          input.viewId !== 'overview' &&
          !doc.domains.some((domain) => domain.id === input.viewId) &&
          !doc.views?.some((view) => view.id === input.viewId)
        )
          throw new BadRequestException('댓글을 남길 화면을 찾을 수 없습니다.');
        if (input.objectId !== null) {
          const exists =
            (input.viewId === 'overview' &&
              doc.domains.some((domain) => domain.id === input.objectId)) ||
            doc.notes.some((note) => note.id === input.objectId && note.viewId === input.viewId) ||
            (doc.tables ?? []).some((table) => table.id === input.objectId);
          const placed = doc.layout.nodes.some(
            (node) => node.objectId === input.objectId && node.viewId === input.viewId,
          );
          if (!exists || !placed)
            throw new BadRequestException('이 화면에서 댓글 대상을 찾을 수 없습니다.');
        }
        const [row] = await tx
          .insert(threads)
          .values({
            projectId,
            viewId: input.viewId,
            objectId: input.objectId,
            x: input.x,
            y: input.y,
          })
          .returning();
        await addMessage(tx, row!.id, projectId, actor.id, input);
        return loadThread(tx, row!.id);
      });
      this.gateway.publishReview(projectId, {
        action: 'thread-created',
        projectId,
        actorId: actor.id,
        data: result,
      });
      return result;
    });
  }

  remove(id: string, input: z.infer<typeof deleteThreadSchema>, actor: AuthenticatedUser) {
    return operation(async () => {
      const result = await this.database.db.transaction(async (tx) => {
        const thread = await lockActiveThread(tx, id);
        if (thread.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime())
          throw new ConflictException(
            '새 답글 또는 상태 변경이 있습니다. 최신 핀을 확인한 후 삭제해주세요.',
          );
        await tx.delete(threads).where(eq(threads.id, id));
        return { projectId: thread.projectId, response: { id, deleted: true as const } };
      });
      this.gateway.publishReview(result.projectId, {
        action: 'thread-deleted',
        projectId: result.projectId,
        actorId: actor.id,
        data: result.response,
      });
      return result.response;
    });
  }

  reply(id: string, input: z.infer<typeof createMessageSchema>, actor: AuthenticatedUser) {
    return operation(async () => {
      const result = await this.database.db.transaction(async (tx) => {
        const thread = await lockActiveThread(tx, id);
        await addMessage(tx, id, thread.projectId, actor.id, input);
        return { projectId: thread.projectId, thread: await loadThread(tx, id) };
      });
      this.gateway.publishReview(result.projectId, {
        action: 'message-created',
        projectId: result.projectId,
        actorId: actor.id,
        data: result.thread,
      });
      return result.thread;
    });
  }

  update(id: string, input: z.infer<typeof updateThreadSchema>, actor: AuthenticatedUser) {
    return operation(async () => {
      const result = await this.database.db.transaction(async (tx) => {
        const thread = await lockActiveThread(tx, id);
        await tx
          .update(threads)
          .set({ ...input, updatedAt: nextThreadTimestamp })
          .where(eq(threads.id, id));
        return { projectId: thread.projectId, thread: await loadThread(tx, id) };
      });
      this.gateway.publishReview(result.projectId, {
        action: 'thread-updated',
        projectId: result.projectId,
        actorId: actor.id,
        data: result.thread,
      });
      return result.thread;
    });
  }

  listNotifications(id: string) {
    return operation(async () => {
      const [user] = await this.database.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, id));
      if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');
      return (
        await this.database.db
          .select()
          .from(notifications)
          .where(eq(notifications.userId, id))
          .orderBy(desc(notifications.createdAt), asc(notifications.id))
      ).map(notification);
    });
  }

  updateNotification(
    id: string,
    input: z.infer<typeof updateNotificationSchema>,
    actor: AuthenticatedUser,
  ) {
    return operation(() =>
      this.database.db.transaction(async (tx) => {
        const [reference] = await tx
          .select({ projectId: notifications.projectId })
          .from(notifications)
          .where(and(eq(notifications.id, id), eq(notifications.userId, actor.id)));
        if (!reference) throw new NotFoundException('알림을 찾을 수 없습니다.');
        await lockActiveProject(tx, reference.projectId);
        const [row] = await tx
          .update(notifications)
          .set(input)
          .where(and(eq(notifications.id, id), eq(notifications.userId, actor.id)))
          .returning();
        if (!row) throw new NotFoundException('알림을 찾을 수 없습니다.');
        return notification(row);
      }),
    );
  }
}
