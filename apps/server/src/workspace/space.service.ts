import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, lte } from 'drizzle-orm';
import type {
  Workspace,
  WorkspaceInvitation,
  WorkspaceMember,
  WorkspaceRole,
} from '@ezerd/contracts';
import { DatabaseService } from '../db/database.service.js';
import {
  projects,
  users,
  userWorkspaces,
  workspaceAuditEvents,
  workspaceInvitations,
  workspaces,
} from '../db/schema.js';
import { WorkspaceAccessService, type WorkspaceExecutor } from './workspace-access.service.js';
import { WorkspaceEventsService } from './workspace-events.service.js';

type Tx = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];
type WorkspaceRow = typeof workspaces.$inferSelect;
type InvitationRow = typeof workspaceInvitations.$inferSelect;
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function workspace(row: WorkspaceRow, role: WorkspaceRole): Workspace {
  return {
    ...row,
    role,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class SpaceService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
    @Inject(WorkspaceEventsService) private readonly events: WorkspaceEventsService,
  ) {}

  private async audit(
    tx: Tx,
    workspaceId: string,
    actorId: string,
    action: string,
    details: Record<string, unknown> = {},
    targetUserId?: string,
  ) {
    await tx
      .insert(workspaceAuditEvents)
      .values({ workspaceId, actorId, action, details, targetUserId });
  }

  private async lock(tx: Tx, id: string) {
    const [row] = await tx.select().from(workspaces).where(eq(workspaces.id, id)).for('update');
    if (!row) throw new NotFoundException('워크스페이스를 찾을 수 없습니다.');
    return row;
  }

  private async owner(tx: Tx, actorId: string, id: string) {
    const row = await this.lock(tx, id);
    await this.access.requireWorkspace(actorId, id, 'manageWorkspace', tx);
    return row;
  }

  async createWorkspace(actorId: string, input: { name: string }): Promise<Workspace> {
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx.insert(workspaces).values({ name: input.name }).returning();
      await tx
        .insert(userWorkspaces)
        .values({ workspaceId: row!.id, userId: actorId, role: 'owner' });
      await this.audit(tx, row!.id, actorId, 'workspace.created', { name: row!.name });
      return workspace(row!, 'owner');
    });
  }

  async listWorkspaces(actorId: string): Promise<Workspace[]> {
    const rows = await this.database.db
      .select({ workspace: workspaces, role: userWorkspaces.role })
      .from(workspaces)
      .innerJoin(
        userWorkspaces,
        and(eq(userWorkspaces.workspaceId, workspaces.id), eq(userWorkspaces.userId, actorId)),
      )
      .orderBy(asc(workspaces.name), asc(workspaces.id));
    return rows.map((row) => workspace(row.workspace, row.role));
  }

  async getWorkspace(actorId: string, id: string): Promise<Workspace> {
    return this.database.db.transaction(
      async (tx) => {
        const access = await this.access.requireWorkspace(actorId, id, 'read', tx);
        const [row] = await tx.select().from(workspaces).where(eq(workspaces.id, id));
        return workspace(row!, access.role);
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async updateWorkspace(
    actorId: string,
    id: string,
    input: { name?: string | undefined; status?: 'active' | 'archived' | undefined },
  ): Promise<Workspace> {
    const result = await this.database.db.transaction(async (tx) => {
      const previous = await this.owner(tx, actorId, id);
      const [row] = await tx
        .update(workspaces)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(workspaces.id, id))
        .returning();
      await this.audit(tx, id, actorId, 'workspace.updated', {
        previous: { name: previous.name, status: previous.status },
        ...input,
      });
      return workspace(row!, 'owner');
    });
    this.events.accessChanged({ workspaceId: id });
    return result;
  }

  async deleteWorkspace(actorId: string, id: string) {
    await this.database.db.transaction(async (tx) => {
      const row = await this.owner(tx, actorId, id);
      const [project] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.workspaceId, id))
        .limit(1);
      if (project)
        throw new ConflictException('프로젝트가 있는 워크스페이스는 삭제할 수 없습니다.');
      await this.audit(tx, id, actorId, 'workspace.deleted', { name: row.name });
      await tx.delete(userWorkspaces).where(eq(userWorkspaces.workspaceId, id));
      await tx.delete(workspaces).where(eq(workspaces.id, id));
    });
    this.events.accessChanged({ workspaceId: id });
    return { deleted: true as const };
  }

  private async members(executor: WorkspaceExecutor, id: string): Promise<WorkspaceMember[]> {
    const rows = await executor
      .select({
        workspaceId: userWorkspaces.workspaceId,
        userId: users.id,
        username: users.username,
        color: users.color,
        role: userWorkspaces.role,
        joinedAt: userWorkspaces.joinedAt,
      })
      .from(userWorkspaces)
      .innerJoin(users, eq(users.id, userWorkspaces.userId))
      .where(eq(userWorkspaces.workspaceId, id))
      .orderBy(asc(users.username), asc(users.id));
    return rows.map((row) => ({ ...row, joinedAt: row.joinedAt.toISOString() }));
  }

  async listMembers(actorId: string, id: string) {
    return this.database.db.transaction(
      async (tx) => {
        await this.access.requireWorkspace(actorId, id, 'read', tx);
        return this.members(tx, id);
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  private async protectLastOwner(tx: Tx, id: string, userId: string, nextRole?: WorkspaceRole) {
    const [member] = await tx
      .select()
      .from(userWorkspaces)
      .where(and(eq(userWorkspaces.workspaceId, id), eq(userWorkspaces.userId, userId)));
    if (!member) throw new NotFoundException('멤버를 찾을 수 없습니다.');
    if (member.role === 'owner' && nextRole !== 'owner') {
      const owners = await tx
        .select({ userId: userWorkspaces.userId })
        .from(userWorkspaces)
        .where(and(eq(userWorkspaces.workspaceId, id), eq(userWorkspaces.role, 'owner')));
      if (owners.length <= 1)
        throw new ConflictException('마지막 owner는 제거하거나 역할을 변경할 수 없습니다.');
    }
    return member;
  }

  async updateMember(
    actorId: string,
    id: string,
    userId: string,
    input: { role: WorkspaceRole },
  ): Promise<WorkspaceMember> {
    const result = await this.database.db.transaction(async (tx) => {
      await this.owner(tx, actorId, id);
      const previous = await this.protectLastOwner(tx, id, userId, input.role);
      await tx
        .update(userWorkspaces)
        .set({ role: input.role })
        .where(and(eq(userWorkspaces.workspaceId, id), eq(userWorkspaces.userId, userId)));
      await this.audit(
        tx,
        id,
        actorId,
        'member.role_changed',
        { previousRole: previous.role, role: input.role },
        userId,
      );
      return (await this.members(tx, id)).find((member) => member.userId === userId)!;
    });
    this.events.accessChanged({ workspaceId: id, userId });
    return result;
  }

  async removeMember(actorId: string, id: string, userId: string) {
    return this.remove(actorId, id, userId, false);
  }

  async leaveWorkspace(actorId: string, id: string) {
    return this.remove(actorId, id, actorId, true);
  }

  private async remove(actorId: string, id: string, userId: string, self: boolean) {
    await this.database.db.transaction(async (tx) => {
      if (self) {
        await this.lock(tx, id);
        await this.access.requireWorkspace(actorId, id, 'read', tx);
      } else await this.owner(tx, actorId, id);
      const previous = await this.protectLastOwner(tx, id, userId);
      await tx
        .delete(userWorkspaces)
        .where(and(eq(userWorkspaces.workspaceId, id), eq(userWorkspaces.userId, userId)));
      await this.audit(
        tx,
        id,
        actorId,
        self ? 'member.left' : 'member.removed',
        { role: previous.role },
        userId,
      );
    });
    this.events.accessChanged({ workspaceId: id, userId });
    return { removed: true as const };
  }

  private async invitation(
    executor: WorkspaceExecutor,
    row: InvitationRow,
  ): Promise<WorkspaceInvitation> {
    const [space] = await executor
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, row.workspaceId));
    const [user] = await executor
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, row.invitedUserId));
    return {
      ...row,
      workspaceName: space!.name,
      username: user!.username,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async expire(tx: Tx, actorId: string, workspaceId?: string, invitedUserId?: string) {
    const rows = await tx
      .update(workspaceInvitations)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(
        and(
          eq(workspaceInvitations.status, 'pending'),
          lte(workspaceInvitations.expiresAt, new Date()),
          workspaceId ? eq(workspaceInvitations.workspaceId, workspaceId) : undefined,
          invitedUserId ? eq(workspaceInvitations.invitedUserId, invitedUserId) : undefined,
        ),
      )
      .returning();
    for (const row of rows)
      await this.audit(
        tx,
        row.workspaceId,
        actorId,
        'invitation.expired',
        { invitationId: row.id },
        row.invitedUserId,
      );
  }

  async createInvitation(
    actorId: string,
    id: string,
    input: { username: string; role: WorkspaceRole },
  ): Promise<WorkspaceInvitation> {
    return this.database.db.transaction(async (tx) => {
      await this.owner(tx, actorId, id);
      await this.expire(tx, actorId, id);
      const [user] = await tx.select().from(users).where(eq(users.username, input.username));
      if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');
      const [member] = await tx
        .select()
        .from(userWorkspaces)
        .where(and(eq(userWorkspaces.workspaceId, id), eq(userWorkspaces.userId, user.id)));
      if (member) throw new ConflictException('이미 워크스페이스 멤버입니다.');
      const [pending] = await tx
        .select()
        .from(workspaceInvitations)
        .where(
          and(
            eq(workspaceInvitations.workspaceId, id),
            eq(workspaceInvitations.invitedUserId, user.id),
            eq(workspaceInvitations.status, 'pending'),
          ),
        );
      if (pending) throw new ConflictException('이미 대기 중인 초대가 있습니다.');
      const [row] = await tx
        .insert(workspaceInvitations)
        .values({
          workspaceId: id,
          invitedUserId: user.id,
          invitedBy: actorId,
          role: input.role,
          expiresAt: new Date(Date.now() + INVITATION_LIFETIME_MS),
        })
        .returning();
      await this.audit(
        tx,
        id,
        actorId,
        'invitation.created',
        { invitationId: row!.id, role: input.role },
        user.id,
      );
      return this.invitation(tx, row!);
    });
  }

  async listInvitations(actorId: string, id: string): Promise<WorkspaceInvitation[]> {
    return this.database.db.transaction(async (tx) => {
      await this.owner(tx, actorId, id);
      await this.expire(tx, actorId, id);
      const rows = await tx
        .select()
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.workspaceId, id))
        .orderBy(asc(workspaceInvitations.createdAt));
      const invitations: WorkspaceInvitation[] = [];
      for (const row of rows) invitations.push(await this.invitation(tx, row));
      return invitations;
    });
  }

  async invitationInbox(actorId: string): Promise<WorkspaceInvitation[]> {
    return this.database.db.transaction(async (tx) => {
      await this.expire(tx, actorId, undefined, actorId);
      const rows = await tx
        .select()
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.invitedUserId, actorId))
        .orderBy(asc(workspaceInvitations.createdAt));
      const invitations: WorkspaceInvitation[] = [];
      for (const row of rows) invitations.push(await this.invitation(tx, row));
      return invitations;
    });
  }

  async acceptInvitation(actorId: string, invitationId: string): Promise<WorkspaceInvitation> {
    return this.respond(actorId, invitationId, 'accepted');
  }

  async declineInvitation(actorId: string, invitationId: string): Promise<WorkspaceInvitation> {
    return this.respond(actorId, invitationId, 'declined');
  }

  async cancelInvitation(
    actorId: string,
    workspaceId: string,
    invitationId: string,
  ): Promise<WorkspaceInvitation> {
    return this.respond(actorId, invitationId, 'cancelled', workspaceId);
  }

  private async respond(
    actorId: string,
    invitationId: string,
    status: 'accepted' | 'declined' | 'cancelled',
    workspaceId?: string,
  ): Promise<WorkspaceInvitation> {
    // Resolve the workspace before locking; always lock workspace before invitation.
    const [initial] = await this.database.db
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.id, invitationId));
    if (!initial || (workspaceId && initial.workspaceId !== workspaceId))
      throw new NotFoundException('초대를 찾을 수 없습니다.');
    const result = await this.database.db.transaction(async (tx) => {
      await this.lock(tx, initial.workspaceId);
      if (status === 'cancelled')
        await this.access.requireWorkspace(actorId, initial.workspaceId, 'manageWorkspace', tx);
      const [current] = await tx
        .select()
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.id, invitationId))
        .for('update');
      if (!current) throw new NotFoundException('초대를 찾을 수 없습니다.');
      if (status !== 'cancelled' && current.invitedUserId !== actorId)
        throw new ForbiddenException('본인의 초대만 처리할 수 있습니다.');
      if (current.status === status) return this.invitation(tx, current);
      if (current.status === 'expired') return null;
      if (current.status !== 'pending') throw new ConflictException('이미 처리된 초대입니다.');
      if (current.expiresAt.getTime() <= Date.now()) {
        await this.expire(tx, actorId, current.workspaceId);
        return null;
      }
      if (status === 'accepted') {
        // Existing membership keeps its current role; an old invitation cannot elevate it.
        await tx
          .insert(userWorkspaces)
          .values({ workspaceId: current.workspaceId, userId: actorId, role: current.role })
          .onConflictDoNothing();
      }
      const [row] = await tx
        .update(workspaceInvitations)
        .set({ status, updatedAt: new Date() })
        .where(eq(workspaceInvitations.id, invitationId))
        .returning();
      await this.audit(
        tx,
        row!.workspaceId,
        actorId,
        `invitation.${status}`,
        { invitationId, role: row!.role },
        row!.invitedUserId,
      );
      return this.invitation(tx, row!);
    });
    if (!result) throw new GoneException('초대가 만료되었습니다.');
    if (status === 'accepted')
      this.events.accessChanged({ workspaceId: result.workspaceId, userId: actorId });
    return result;
  }
}
