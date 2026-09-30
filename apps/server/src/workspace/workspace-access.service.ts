import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { WorkspaceRole, WorkspaceStatus } from '@ezerd/contracts';
import { DatabaseService } from '../db/database.service.js';
import { projects, userWorkspaces, workspaces } from '../db/schema.js';

export type WorkspacePermission =
  | 'read'
  | 'design'
  | 'review'
  | 'personal'
  | 'createProject'
  | 'manageProject'
  | 'deleteProject'
  | 'manageWorkspace';
export type WorkspaceExecutor =
  DatabaseService['db'] | Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];
export type WorkspaceAccess = { workspaceId: string; role: WorkspaceRole; status: WorkspaceStatus };

export function hasWorkspacePermission(
  role: WorkspaceRole,
  status: WorkspaceStatus,
  permission: WorkspacePermission,
): boolean {
  if (permission === 'read') return true;
  if (permission === 'manageWorkspace') return role === 'owner';
  if (status === 'archived') return false;
  if (permission === 'review' || permission === 'personal') return true;
  if (permission === 'deleteProject') return role === 'owner';
  return role === 'owner' || role === 'editor';
}

@Injectable()
export class WorkspaceAccessService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async requireWorkspace(
    userId: string,
    workspaceId: string,
    permission: WorkspacePermission,
    executor: WorkspaceExecutor = this.database.db,
  ): Promise<WorkspaceAccess> {
    const query = executor
      .select({ workspaceId: workspaces.id, status: workspaces.status })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    // Reads also run in PostgreSQL READ ONLY snapshots, which reject row locks.
    // Writes hold SHARE until commit so owner/status changes wait for them.
    // Project creation takes UPDATE immediately to serialize automatic name allocation.
    // Upgrading SHARE inside the callback would deadlock concurrent creators.
    const [workspace] =
      executor === this.database.db || permission === 'read'
        ? await query
        : await query.for(permission === 'createProject' ? 'update' : 'share');
    if (!workspace) throw new NotFoundException('워크스페이스를 찾을 수 없습니다.');
    const [membership] = await executor
      .select({ role: userWorkspaces.role })
      .from(userWorkspaces)
      .where(and(eq(userWorkspaces.workspaceId, workspaceId), eq(userWorkspaces.userId, userId)));
    if (!membership || !hasWorkspacePermission(membership.role, workspace.status, permission))
      throw new ForbiddenException('워크스페이스 접근 권한이 없습니다.');
    return { ...workspace, role: membership.role };
  }

  async requireProject(
    userId: string,
    projectId: string,
    permission: WorkspacePermission,
    executor: WorkspaceExecutor = this.database.db,
  ): Promise<WorkspaceAccess> {
    const [project] = await executor
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!project) throw new NotFoundException('프로젝트를 찾을 수 없습니다.');
    return this.requireWorkspace(userId, project.workspaceId, permission, executor);
  }

  runProject<T>(
    userId: string,
    projectId: string,
    permission: WorkspacePermission,
    callback: (
      tx: Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0],
      access: WorkspaceAccess,
    ) => Promise<T>,
  ): Promise<T> {
    return this.database.db.transaction(
      async (tx) => callback(tx, await this.requireProject(userId, projectId, permission, tx)),
      permission === 'read'
        ? { isolationLevel: 'repeatable read', accessMode: 'read only' }
        : undefined,
    );
  }

  runWorkspace<T>(
    userId: string,
    workspaceId: string,
    permission: WorkspacePermission,
    callback: (
      tx: Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0],
      access: WorkspaceAccess,
    ) => Promise<T>,
  ): Promise<T> {
    return this.database.db.transaction(
      async (tx) => callback(tx, await this.requireWorkspace(userId, workspaceId, permission, tx)),
      permission === 'read'
        ? { isolationLevel: 'repeatable read', accessMode: 'read only' }
        : undefined,
    );
  }
}
