import { BadRequestException, Body, Controller, Get, HttpException, Inject, NotFoundException, Param, Patch, Post, ServiceUnavailableException } from '@nestjs/common';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { createThreadSchema, createMessageSchema, updateThreadSchema, updateNotificationSchema } from '@ezerd/contracts';
import { DatabaseService } from './db/database.service.js';
import { messages, notifications, projects, threads, users } from './db/schema.js';

type Transaction = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];
type Store = DatabaseService['db'] | Transaction;
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('입력값을 확인해주세요.');
  return result.data;
}
const idSchema = z.uuid();
async function operation<T>(callback: () => Promise<T>) {
  try { return await callback(); }
  catch (error) {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException('검토 대화를 저장할 수 없습니다. 잠시 후 다시 시도해주세요.');
  }
}
function notification(row: typeof notifications.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}
async function loadThread(db: Store, id: string) {
  const [row] = await db.select().from(threads).where(eq(threads.id, id));
  if (!row) throw new NotFoundException('댓글을 찾을 수 없습니다.');
  const replies = await db.select().from(messages).where(eq(messages.threadId, id)).orderBy(asc(messages.createdAt), asc(messages.id));
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), messages: replies.map(message => ({ ...message, createdAt: message.createdAt.toISOString() })) };
}
async function validatePeople(db: Store, authorId: string, mentionIds: string[]) {
  const ids = [...new Set([authorId, ...mentionIds])];
  const found = await db.select({ id: users.id }).from(users).where(inArray(users.id, ids));
  if (found.length !== ids.length) throw new BadRequestException('작성자 또는 멘션 사용자를 찾을 수 없습니다.');
}
async function addMessage(db: Transaction, threadId: string, projectId: string, input: { authorId: string; body: string; mentionIds: string[] }) {
  const mentionIds = [...new Set(input.mentionIds)];
  await validatePeople(db, input.authorId, mentionIds);
  await db.insert(messages).values({ threadId, authorId: input.authorId, body: input.body, mentionIds });
  const recipientIds = mentionIds.filter(id => id !== input.authorId);
  if (recipientIds.length) await db.insert(notifications).values(recipientIds.map(userId => ({ userId, projectId, threadId })));
  await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, threadId));
}

@Controller()
export class ReviewController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get('projects/:projectId/threads')
  list(@Param('projectId') rawId: string) {
    const projectId = parse(idSchema, rawId);
    return operation(async () => {
      const [project] = await this.database.db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
      if (!project) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
      const rows = await this.database.db.select({ id: threads.id }).from(threads).where(eq(threads.projectId, projectId)).orderBy(desc(threads.updatedAt), asc(threads.id));
      return Promise.all(rows.map(row => loadThread(this.database.db, row.id)));
    });
  }

  @Post('projects/:projectId/threads')
  create(@Param('projectId') rawId: string, @Body() body: unknown) {
    const projectId = parse(idSchema, rawId);
    const input = parse(createThreadSchema, body);
    return operation(() => this.database.db.transaction(async tx => {
      // Serialize target validation with document writes; later deletion preserves this thread.
      const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for('update');
      if (!project) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
      const doc = project.document;
      if (input.viewId !== 'overview' && !doc.domains.some(domain => domain.id === input.viewId)) throw new BadRequestException('댓글을 남길 화면을 찾을 수 없습니다.');
      if (input.objectId !== null) {
        const exists = (input.viewId === 'overview' && doc.domains.some(domain => domain.id === input.objectId)) || doc.notes.some(note => note.id === input.objectId && note.viewId === input.viewId) || (doc.tables ?? []).some(table => table.id === input.objectId);
        const placed = doc.layout.nodes.some(node => node.objectId === input.objectId && node.viewId === input.viewId);
        if (!exists || !placed) throw new BadRequestException('이 화면에서 댓글 대상을 찾을 수 없습니다.');
      }
      await validatePeople(tx, input.authorId, input.mentionIds);
      const [row] = await tx.insert(threads).values({ projectId, viewId: input.viewId, objectId: input.objectId, x: input.x, y: input.y }).returning();
      await addMessage(tx, row!.id, projectId, input);
      return loadThread(tx, row!.id);
    }));
  }

  @Post('threads/:id/messages')
  reply(@Param('id') rawId: string, @Body() body: unknown) {
    const id = parse(idSchema, rawId);
    const input = parse(createMessageSchema, body);
    return operation(() => this.database.db.transaction(async tx => {
      const [thread] = await tx.select().from(threads).where(eq(threads.id, id)).for('update');
      if (!thread) throw new NotFoundException('댓글을 찾을 수 없습니다.');
      await addMessage(tx, id, thread.projectId, input);
      return loadThread(tx, id);
    }));
  }

  @Patch('threads/:id')
  update(@Param('id') rawId: string, @Body() body: unknown) {
    const id = parse(idSchema, rawId);
    const input = parse(updateThreadSchema, body);
    return operation(() => this.database.db.transaction(async tx => {
      const [row] = await tx.update(threads).set({ ...input, updatedAt: new Date() }).where(eq(threads.id, id)).returning();
      if (!row) throw new NotFoundException('댓글을 찾을 수 없습니다.');
      return loadThread(tx, id);
    }));
  }

  @Get('users/:id/notifications')
  listNotifications(@Param('id') rawId: string) {
    const id = parse(idSchema, rawId);
    return operation(async () => {
      const [user] = await this.database.db.select({ id: users.id }).from(users).where(eq(users.id, id));
      if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');
      return (await this.database.db.select().from(notifications).where(eq(notifications.userId, id)).orderBy(desc(notifications.createdAt), asc(notifications.id))).map(notification);
    });
  }

  @Patch('notifications/:id')
  updateNotification(@Param('id') rawId: string, @Body() body: unknown) {
    const id = parse(idSchema, rawId);
    const input = parse(updateNotificationSchema, body);
    return operation(async () => {
      const [row] = await this.database.db.update(notifications).set(input).where(eq(notifications.id, id)).returning();
      if (!row) throw new NotFoundException('알림을 찾을 수 없습니다.');
      return notification(row);
    });
  }
}
