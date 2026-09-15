import { boolean, doublePrecision, unique, index, text, integer, jsonb, pgEnum, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { DesignDocument } from '@ezerd/model';

export const projectStatus = pgEnum('project_status', ['active', 'archived']);
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  status: projectStatus('status').notNull().default('active'),
  version: integer('version').notNull().default(0),
  document: jsonb('document').$type<DesignDocument>().notNull().default({ schemaVersion: 1, domains: [], domainRelations: [], notes: [], layout: { nodes: [], viewports: [{ viewId: 'overview', x: 0, y: 0, zoom: 1 }] } }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export type ProjectRow = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

// Registration is unique by trimmed name and PIN digest; public users keep stable IDs.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 40 }).notNull(),
  pinHash: varchar('pin_hash', { length: 64 }).notNull(),
  color: varchar('color', { length: 7 }).notNull().default('#4169e1'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [unique('users_username_pin_unique').on(table.username,table.pinHash)]);

export const threads = pgTable('review_threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  viewId: text('view_id').notNull(),
  objectId: text('object_id'),
  x: doublePrecision('x').notNull(),
  y: doublePrecision('y').notNull(),
  resolved: boolean('resolved').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('review_threads_project_idx').on(table.projectId)]);
export const messages = pgTable('review_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: uuid('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').notNull().references(() => users.id),
  body: text('body').notNull(),
  mentionIds: jsonb('mention_ids').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('review_messages_thread_idx').on(table.threadId)]);
export const notifications = pgTable('review_notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  threadId: uuid('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('review_notifications_user_idx').on(table.userId)]);
