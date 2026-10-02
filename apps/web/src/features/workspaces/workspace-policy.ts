export type WorkspaceRole = 'owner' | 'editor' | 'viewer';
export type Workspace = {
  id: string;
  name: string;
  status: 'active' | 'archived';
  role: WorkspaceRole;
  createdAt: string;
  updatedAt: string;
};

export function workspacePermissions(workspace: Workspace | undefined) {
  const active = workspace?.status === 'active';
  return {
    manage: workspace?.role === 'owner',
    edit: active && workspace?.role !== 'viewer',
    personal: active,
    review: active,
    deleteProject: active && workspace?.role === 'owner',
  };
}
