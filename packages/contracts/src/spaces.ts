import { z } from 'zod';
import { usernameSchema } from './workspace.js';

export const workspaceRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export const workspaceStatusSchema = z.enum(['active', 'archived']);
export const createWorkspaceSchema = z.strictObject({ name: z.string().trim().min(1).max(64) });
export const updateWorkspaceSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(64).optional(),
    status: workspaceStatusSchema.optional(),
  })
  .refine((input) => input.name !== undefined || input.status !== undefined);
export const updateWorkspaceMemberSchema = z.strictObject({ role: workspaceRoleSchema });
export const createWorkspaceInvitationSchema = z.strictObject({
  username: usernameSchema,
  role: workspaceRoleSchema.default('viewer'),
});
export const workspaceSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  status: workspaceStatusSchema,
  role: workspaceRoleSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const workspaceMemberSchema = z.strictObject({
  workspaceId: z.uuid(),
  userId: z.uuid(),
  username: z.string(),
  color: z.string(),
  role: workspaceRoleSchema,
  joinedAt: z.iso.datetime(),
});
export const workspaceInvitationSchema = z.strictObject({
  id: z.uuid(),
  workspaceId: z.uuid(),
  workspaceName: z.string(),
  invitedUserId: z.uuid(),
  username: z.string(),
  invitedBy: z.uuid(),
  role: workspaceRoleSchema,
  status: z.enum(['pending', 'accepted', 'declined', 'cancelled', 'expired']),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;
export type WorkspaceStatus = z.infer<typeof workspaceStatusSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;
export type WorkspaceInvitation = z.infer<typeof workspaceInvitationSchema>;
