import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq } from 'drizzle-orm';
import { ConflictException, ForbiddenException, GoneException } from '@nestjs/common';
import { readConfig } from '../src/config.js';
import * as schema from '../src/db/schema.js';
import type { DatabaseService } from '../src/db/database.service.js';
import { SpaceService } from '../src/workspace/space.service.js';
import {
  WorkspaceAccessService,
  hasWorkspacePermission,
} from '../src/workspace/workspace-access.service.js';
import { WorkspaceEventsService } from '../src/workspace/workspace-events.service.js';

describe('workspace role policy', () => {
  it('permits viewer reviews/personal state while restricting design and archived writes', () => {
    expect(hasWorkspacePermission('viewer', 'active', 'review')).toBe(true);
    expect(hasWorkspacePermission('viewer', 'active', 'personal')).toBe(true);
    expect(hasWorkspacePermission('viewer', 'active', 'design')).toBe(false);
    expect(hasWorkspacePermission('editor', 'active', 'deleteProject')).toBe(false);
    expect(hasWorkspacePermission('owner', 'archived', 'manageWorkspace')).toBe(true);
    for (const role of ['owner', 'editor', 'viewer'] as const) {
      expect(hasWorkspacePermission(role, 'archived', 'read')).toBe(true);
      for (const permission of [
        'design',
        'review',
        'personal',
        'createProject',
        'manageProject',
        'deleteProject',
      ] as const) {
        expect(hasWorkspacePermission(role, 'archived', permission)).toBe(false);
      }
    }
  });
});

// Explicit opt-in creates and drops only a fresh, uniquely named local test database.
describe.runIf(process.env.EZERD_WORKSPACE_DB_TEST === '1')(
  'isolated PostgreSQL workspace domain',
  () => {
    const databaseName = `ezerd_workspace_test_${randomUUID().replaceAll('-', '')}`;
    let admin: pg.Pool;
    let pool: pg.Pool;
    let database: DatabaseService;
    let spaces: SpaceService;
    let access: WorkspaceAccessService;
    let owner: typeof schema.users.$inferSelect;
    let peer: typeof schema.users.$inferSelect;
    let stranger: typeof schema.users.$inferSelect;
    let created = false;

    beforeAll(async () => {
      const url = new URL(readConfig().DATABASE_URL);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
        throw new Error('Workspace QA requires local PostgreSQL.');
      admin = new pg.Pool({ connectionString: url.toString() });
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      created = true;
      url.pathname = `/${databaseName}`;
      pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
      const db = drizzle(pool, { schema });
      await migrate(db, {
        migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
      });
      database = { db } as DatabaseService;
      access = new WorkspaceAccessService(database);
      spaces = new SpaceService(database, access, new WorkspaceEventsService());
      const users = await db
        .insert(schema.users)
        .values(
          ['owner', 'peer', 'stranger'].map((username) => ({ username, pinHash: '0'.repeat(64) })),
        )
        .returning();
      owner = users[0]!;
      peer = users[1]!;
      stranger = users[2]!;
    }, 20000);

    afterAll(async () => {
      await pool?.end();
      if (created) {
        if (!/^ezerd_workspace_test_[a-f0-9]{32}$/.test(databaseName))
          throw new Error('Invalid isolated test database name.');
        await admin.query(`DROP DATABASE "${databaseName}"`);
      }
      await admin?.end();
    });

    it('creates workspace and owner atomically, scopes lists and allows READ ONLY snapshots', async () => {
      const workspace = await spaces.createWorkspace(owner.id, { name: 'Same name' });
      await spaces.createWorkspace(peer.id, { name: 'Same name' });
      expect((await spaces.listWorkspaces(owner.id)).every((row) => row.role === 'owner')).toBe(
        true,
      );
      expect(await spaces.listWorkspaces(stranger.id)).toEqual([]);
      expect((await spaces.getWorkspace(owner.id, workspace.id)).id).toBe(workspace.id);
      expect((await spaces.listMembers(owner.id, workspace.id))[0]!.userId).toBe(owner.id);
      await expect(spaces.getWorkspace(stranger.id, workspace.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      const before = await spaces.listWorkspaces(owner.id);
      await expect(spaces.createWorkspace(randomUUID(), { name: 'Rollback' })).rejects.toThrow();
      expect(await spaces.listWorkspaces(owner.id)).toEqual(before);
      expect(
        await database.db
          .select()
          .from(schema.workspaces)
          .where(eq(schema.workspaces.name, 'Rollback')),
      ).toEqual([]);
    });

    it('creates membership only on acceptance and concurrent acceptance is idempotent', async () => {
      const workspace = await spaces.createWorkspace(owner.id, { name: 'Accept twice' });
      const invitation = await spaces.createInvitation(owner.id, workspace.id, {
        username: peer.username,
        role: 'editor',
      });
      expect(await spaces.listWorkspaces(peer.id)).not.toContainEqual(
        expect.objectContaining({ id: workspace.id }),
      );
      await expect(spaces.acceptInvitation(stranger.id, invitation.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        spaces.createInvitation(owner.id, workspace.id, {
          username: peer.username,
          role: 'viewer',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      const accepted = await Promise.all([
        spaces.acceptInvitation(peer.id, invitation.id),
        spaces.acceptInvitation(peer.id, invitation.id),
      ]);
      expect(accepted.map((row) => row.status)).toEqual(['accepted', 'accepted']);
      expect(
        (await spaces.listMembers(owner.id, workspace.id)).filter((row) => row.userId === peer.id),
      ).toHaveLength(1);
      const audit = await database.db
        .select()
        .from(schema.workspaceAuditEvents)
        .where(
          and(
            eq(schema.workspaceAuditEvents.workspaceId, workspace.id),
            eq(schema.workspaceAuditEvents.action, 'invitation.accepted'),
          ),
        );
      expect(audit).toHaveLength(1);
    });

    it('serializes two owner demotions and retains a last owner', async () => {
      const workspace = await spaces.createWorkspace(owner.id, { name: 'Two owners' });
      const invitation = await spaces.createInvitation(owner.id, workspace.id, {
        username: peer.username,
        role: 'owner',
      });
      await spaces.acceptInvitation(peer.id, invitation.id);
      const results = await Promise.allSettled([
        spaces.updateMember(owner.id, workspace.id, owner.id, { role: 'editor' }),
        spaces.updateMember(peer.id, workspace.id, peer.id, { role: 'editor' }),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const memberships = await database.db
        .select()
        .from(schema.userWorkspaces)
        .where(eq(schema.userWorkspaces.workspaceId, workspace.id));
      const remainingOwner = memberships.filter((row) => row.role === 'owner');
      expect(remainingOwner).toHaveLength(1);
      await expect(
        spaces.leaveWorkspace(remainingOwner[0]!.userId, workspace.id),
      ).rejects.toBeInstanceOf(ConflictException);
      const leaveSpace = await spaces.createWorkspace(owner.id, { name: 'Concurrent owner leave' });
      const leaveInvite = await spaces.createInvitation(owner.id, leaveSpace.id, {
        username: peer.username,
        role: 'owner',
      });
      await spaces.acceptInvitation(peer.id, leaveInvite.id);
      const leaves = await Promise.allSettled([
        spaces.leaveWorkspace(owner.id, leaveSpace.id),
        spaces.leaveWorkspace(peer.id, leaveSpace.id),
      ]);
      expect(leaves.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const afterLeave = await database.db
        .select()
        .from(schema.userWorkspaces)
        .where(eq(schema.userWorkspaces.workspaceId, leaveSpace.id));
      expect(afterLeave).toHaveLength(1);
      expect(afterLeave[0]!.role).toBe('owner');
    });

    it('expires invitations durably, supports decline/cancel, and never creates membership', async () => {
      const workspace = await spaces.createWorkspace(owner.id, { name: 'Expired' });
      const expired = await spaces.createInvitation(owner.id, workspace.id, {
        username: peer.username,
        role: 'viewer',
      });
      await database.db
        .update(schema.workspaceInvitations)
        .set({ expiresAt: new Date(0) })
        .where(eq(schema.workspaceInvitations.id, expired.id));
      await expect(spaces.acceptInvitation(peer.id, expired.id)).rejects.toBeInstanceOf(
        GoneException,
      );
      expect(
        (await spaces.invitationInbox(peer.id)).find((row) => row.id === expired.id)!.status,
      ).toBe('expired');
      const declined = await spaces.createInvitation(owner.id, workspace.id, {
        username: peer.username,
        role: 'viewer',
      });
      expect((await spaces.declineInvitation(peer.id, declined.id)).status).toBe('declined');
      await expect(spaces.acceptInvitation(peer.id, declined.id)).rejects.toBeInstanceOf(
        ConflictException,
      );
      const cancelled = await spaces.createInvitation(owner.id, workspace.id, {
        username: peer.username,
        role: 'viewer',
      });
      expect((await spaces.cancelInvitation(owner.id, workspace.id, cancelled.id)).status).toBe(
        'cancelled',
      );
      expect(await spaces.listMembers(owner.id, workspace.id)).toHaveLength(1);
    });

    it('waits for in-flight writes before archiving then blocks writes and retains delete audit', async () => {
      const workspace = await spaces.createWorkspace(owner.id, { name: 'Serialize writes' });
      let releaseWrite!: () => void;
      const barrier = new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      let acquired!: () => void;
      const locked = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const write = access.runWorkspace(owner.id, workspace.id, 'createProject', async () => {
        acquired();
        await barrier;
      });
      await locked;
      let archived = false;
      const archive = spaces
        .updateWorkspace(owner.id, workspace.id, { status: 'archived' })
        .then(() => {
          archived = true;
        });
      // A third DB connection observes the waiting row lock, avoiding a timing-only assertion.
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const result = await pool.query(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
        );
        if (result.rows[0].count > 0) break;
        if (attempt === 99) throw new Error('Archive did not wait for write lock.');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(archived).toBe(false);
      releaseWrite();
      await Promise.all([write, archive]);
      await expect(
        access.runWorkspace(owner.id, workspace.id, 'personal', async () => undefined),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await spaces.updateWorkspace(owner.id, workspace.id, { status: 'active' });
      await database.db
        .insert(schema.projects)
        .values({ workspaceId: workspace.id, name: 'Delete guard' });
      await expect(spaces.deleteWorkspace(owner.id, workspace.id)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await database.db
        .delete(schema.projects)
        .where(eq(schema.projects.workspaceId, workspace.id));
      expect(await spaces.deleteWorkspace(owner.id, workspace.id)).toEqual({ deleted: true });
      const events = await database.db
        .select()
        .from(schema.workspaceAuditEvents)
        .where(
          and(
            eq(schema.workspaceAuditEvents.workspaceId, workspace.id),
            eq(schema.workspaceAuditEvents.action, 'workspace.deleted'),
          ),
        );
      expect(events).toHaveLength(1);
    });
  },
);
