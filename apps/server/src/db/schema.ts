import {
  boolean,
  check,
  doublePrecision,
  unique,
  uniqueIndex,
  index,
  text,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { DesignDocument, PersonalState } from '@ezerd/model';
import { sql } from 'drizzle-orm';

export const projectDatabaseKind = pgEnum('project_database_kind', [
  'postgresql',
  'mysql',
  'sqlite',
]);
export const projectStatus = pgEnum('project_status', ['active', 'archived']);
export const workspaceStatus = pgEnum('workspace_status', ['active', 'archived']);
export const workspaceRole = pgEnum('workspace_role', ['owner', 'editor', 'viewer']);
export const invitationStatus = pgEnum('workspace_invitation_status', [
  'pending',
  'accepted',
  'declined',
  'cancelled',
  'expired',
]);
export const workspaces = pgTable('workspace', {
  id: uuid('workspace_id').primaryKey().defaultRandom(),
  name: varchar('workspace_name', { length: 64 }).notNull(),
  status: workspaceStatus('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 120 }).notNull(),
    databaseKind: projectDatabaseKind('database_kind').notNull().default('postgresql'),
    status: projectStatus('status').notNull().default('active'),
    version: integer('version').notNull().default(0),
    syncSequence: integer('sync_sequence').notNull().default(0),
    document: jsonb('document')
      .$type<DesignDocument>()
      .notNull()
      .default({
        schemaVersion: 1,
        domains: [],
        domainRelations: [],
        notes: [],
        layout: { nodes: [], viewports: [{ viewId: 'overview', x: 0, y: 0, zoom: 1 }] },
      }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('projects_workspace_status_updated_idx').on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
  ],
);
export type ProjectRow = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

// Names are stored normalized and unique independently of the PIN.
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: varchar('username', { length: 40 }).notNull(),
    pinHash: varchar('pin_hash', { length: 64 }).notNull(),
    color: varchar('color', { length: 7 }).notNull().default('#4169e1'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('users_username_unique').on(table.username),
    check('users_username_normalized', sql`${table.username} = lower(btrim(${table.username}))`),
  ],
);

export const userWorkspaces = pgTable(
  'user_workspaces',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'no action' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'no action' }),
    role: workspaceRole('role').notNull().default('viewer'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index('user_workspaces_user_workspace_idx').on(table.userId, table.workspaceId),
  ],
);

export const workspaceInvitations = pgTable(
  'workspace_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    invitedUserId: uuid('invited_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'no action' }),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'no action' }),
    role: workspaceRole('role').notNull().default('viewer'),
    status: invitationStatus('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('workspace_invitations_user_status_idx').on(table.invitedUserId, table.status),
    uniqueIndex('workspace_invitations_pending_unique')
      .on(table.workspaceId, table.invitedUserId)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export const workspaceAuditEvents = pgTable(
  'workspace_audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Intentionally retain audit records after an empty workspace is deleted.
    workspaceId: uuid('workspace_id').notNull(),
    actorId: uuid('actor_id').notNull(),
    action: varchar('action', { length: 64 }).notNull(),
    targetUserId: uuid('target_user_id'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('workspace_audit_workspace_created_idx').on(table.workspaceId, table.createdAt),
  ],
);

export const projectPersonalStates = pgTable(
  'project_personal_states',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(0),
    state: jsonb('state')
      .$type<PersonalState>()
      .notNull()
      .default({ views: [], notes: [], nodes: [], viewports: [], relations: [] }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.userId] })],
);

export const projectPersonalOperations = pgTable(
  'project_personal_operations',
  {
    operationId: uuid('operation_id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
    result: jsonb('result')
      .$type<{
        version: number;
        state: PersonalState;
        projectVersion: number;
        syncSequence: number;
      }>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('project_personal_operations_project_user_idx').on(table.projectId, table.userId),
  ],
);

export const threads = pgTable(
  'review_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    viewId: text('view_id').notNull(),
    objectId: text('object_id'),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    resolved: boolean('resolved').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('review_threads_project_idx').on(table.projectId)],
);
export const messages = pgTable(
  'review_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    mentionIds: jsonb('mention_ids').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('review_messages_thread_idx').on(table.threadId)],
);
export const notifications = pgTable(
  'review_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    read: boolean('read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('review_notifications_user_idx').on(table.userId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
    index('sessions_user_idx').on(table.userId),
  ],
);

export const mcpTokens = pgTable(
  'mcp_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 80 }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('mcp_tokens_token_hash_unique').on(table.tokenHash),
    index('mcp_tokens_user_idx').on(table.userId),
  ],
);

export const syncOperations = pgTable(
  'sync_operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    operationId: uuid('operation_id').notNull(),
    groupId: uuid('group_id').notNull(),
    clientId: uuid('client_id').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    sequence: integer('sequence').notNull(),
    baseSequence: integer('base_sequence').notNull(),
    baselineIssuedAt: timestamp('baseline_issued_at', { withTimezone: true }).notNull(),
    baselineId: uuid('baseline_id').notNull(),
    kind: varchar('kind', { length: 16 }).notNull(),
    fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
    changes: jsonb('changes').$type<unknown[]>().notNull(),
    result: jsonb('result').$type<Record<string, unknown>>().notNull(),
    deletionSnapshot: jsonb('deletion_snapshot').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('sync_operations_project_operation_unique').on(table.projectId, table.operationId),
    unique('sync_operations_project_sequence_unique').on(table.projectId, table.sequence),
    index('sync_operations_project_created_idx').on(table.projectId, table.createdAt),
  ],
);

export const syncFieldVersions = pgTable(
  'sync_field_versions',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    sequence: integer('sequence').notNull(),
    operationId: uuid('operation_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('sync_field_versions_project_path_unique').on(table.projectId, table.path)],
);

export const syncClientBaselines = pgTable(
  'sync_client_baselines',
  {
    baselineId: uuid('baseline_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastSuccessfulSyncAt: timestamp('last_successful_sync_at', { withTimezone: true }).notNull(),
    lastSequence: integer('last_sequence').notNull(),
    document: jsonb('document').$type<DesignDocument>().notNull(),
  },
  (table) => [
    unique('sync_client_baselines_id_unique').on(table.projectId, table.baselineId),
    index('sync_client_baselines_identity_idx').on(table.projectId, table.clientId, table.userId),
  ],
);

export const syncTombstones = pgTable(
  'sync_tombstones',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    objectId: text('object_id').notNull(),
    operationId: uuid('operation_id').notNull(),
    sequence: integer('sequence').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('sync_tombstones_project_object_unique').on(table.projectId, table.objectId),
    index('sync_tombstones_expiry_idx').on(table.expiresAt),
  ],
);
