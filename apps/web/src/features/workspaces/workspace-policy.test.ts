import { describe, expect, it } from 'vitest';
import { workspacePermissions, type Workspace } from './workspace-policy.js';
const space = (role: Workspace['role'], status: Workspace['status'] = 'active'): Workspace => ({
  id: 'space',
  name: 'Team',
  role,
  status,
  createdAt: '',
  updatedAt: '',
});
describe('workspace permissions', () => {
  it('allows active viewers personal state and review only', () => {
    expect(workspacePermissions(space('viewer'))).toEqual({
      manage: false,
      edit: false,
      personal: true,
      review: true,
      deleteProject: false,
    });
  });
  it('reserves permanent project deletion for owners', () => {
    expect(workspacePermissions(space('editor'))).toMatchObject({
      edit: true,
      deleteProject: false,
    });
    expect(workspacePermissions(space('owner'))).toMatchObject({ edit: true, deleteProject: true });
  });
  it.each(['owner', 'editor', 'viewer'] as const)(
    'blocks all project writes in archived spaces for %s',
    (role) => {
      expect(workspacePermissions(space(role, 'archived'))).toEqual({
        manage: role === 'owner',
        edit: false,
        personal: false,
        review: false,
        deleteProject: false,
      });
    },
  );
  it('fails closed before membership is loaded', () => {
    expect(workspacePermissions(undefined)).toEqual({
      manage: false,
      edit: false,
      personal: false,
      review: false,
      deleteProject: false,
    });
  });
});
