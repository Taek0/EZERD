import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { McpServerFactory } from '../src/mcp/mcp-server.js';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

const now = new Date().toISOString();
const project = {
  id: crypto.randomUUID(),
  workspaceId: crypto.randomUUID(),
  name: 'MCP project',
  status: 'active' as const,
  version: 0,
  createdAt: now,
  updatedAt: now,
};
const document = {
  schemaVersion: 1 as const,
  domains: [],
  domainRelations: [],
  notes: [],
  layout: { nodes: [], viewports: [{ viewId: 'overview', x: 0, y: 0, zoom: 1 }] },
};

describe('MCP server tools', () => {
  it('registers validated read tools with safe annotations and structured output', async () => {
    const workspace = {
      listProjects: vi.fn(async () => [project]),
      listProjectsPage: vi.fn(async () => ({ projects: [project], nextCursor: null })),
      getProject: vi.fn(async () => ({ project, document })),
      getProjectState: vi.fn(async () => ({ project, document, syncSequence: 0 })),
    };
    const reviewThread = {
      id: crypto.randomUUID(),
      projectId: project.id,
      viewId: 'overview',
      objectId: null,
      x: 0,
      y: 0,
      resolved: false,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    const reviews = {
      list: vi.fn(async () => []),
      listPage: vi.fn(async () => ({ threads: [], nextCursor: null })),
      getThread: vi.fn(async () => reviewThread),
      create: vi.fn(async () => reviewThread),
    };
    const logger = { write: vi.fn(async () => undefined) };
    const sync = { history: vi.fn(async () => []) };
    const documents = { apply: vi.fn() };
    const personal = {
      get: vi.fn(async () => ({
        version: 0,
        projectVersion: 0,
        syncSequence: 0,
        state: {
          views: [],
          notes: [],
          nodes: [],
          viewports: document.layout.viewports,
          relations: [],
        },
      })),
      apply: vi.fn(),
    };
    const factory = new McpServerFactory(
      workspace as never,
      reviews as never,
      logger as never,
      sync as never,
      documents as never,
      personal as never,
      {} as never,
      { assertActiveToken: vi.fn(async () => undefined) } as never,
    );
    const actor = { id: crypto.randomUUID(), username: 'actor', color: '#4169e1' };
    const server = factory.create(actor, crypto.randomUUID(), crypto.randomUUID());
    const client = new Client({ name: 'test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport as never);
    await client.connect(clientTransport as never);
    try {
      const tools = await client.listTools();
      expect(client.getInstructions()).toContain('최소 40px');
      expect(client.getInstructions()).toContain('PK→FK 방향');
      expect(client.getInstructions()).toContain('관계선 교차');
      expect(client.getInstructions()).toContain('브라우저 스킬이나 스크린샷 대신');
      expect(client.getInstructions()).toContain('x·y·width·height');
      expect(client.getInstructions()).toContain('불필요한 폭·높이·빈 공간을 줄여');
      expect(client.getInstructions()).toContain('구조적 계층');
      expect(client.getInstructions()).toContain('겹침을 확인하고 수정');
      expect(
        tools.tools.find((tool) => tool.name === 'apply_project_changes')?.description,
      ).toContain('겹침 없이');
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        'whoami',
        'create_workspace',
        'list_workspaces',
        'get_workspace',
        'update_workspace',
        'delete_workspace',
        'list_workspace_members',
        'update_workspace_member',
        'remove_workspace_member',
        'leave_workspace',
        'create_workspace_invitation',
        'list_workspace_invitations',
        'list_my_workspace_invitations',
        'accept_workspace_invitation',
        'decline_workspace_invitation',
        'cancel_workspace_invitation',
        'list_projects',
        'get_project',
        'get_project_summary',
        'list_tables',
        'get_project_view',
        'list_view_relations',
        'get_personal_state',
        'get_table_details',
        'list_review_threads',
        'get_review_thread',
        'list_notifications',
        'update_notification',
        'create_project',
        'import_project',
        'export_project',
        'update_project',
        'delete_project',
        'create_review_thread',
        'reply_review_thread',
        'update_review_thread',
        'delete_review_thread',
        'diagnose_project',
        'diagnose_layout',
        'apply_project_changes',
        'apply_personal_changes',
        'get_project_history',
        'undo_project_operation',
        'restore_project_deletion',
      ]);
      expect(
        tools.tools
          .filter((tool) => ['list_projects', 'get_project', 'whoami'].includes(tool.name))
          .every((tool) => tool.annotations?.readOnlyHint === true),
      ).toBe(true);
      expect(
        tools.tools.find((tool) => tool.name === 'delete_project')?.annotations?.destructiveHint,
      ).toBe(true);
      const result = await client.callTool({ name: 'list_projects', arguments: {} });
      expect(result.structuredContent).toEqual({ projects: [project], nextCursor: null });
      expect(workspace.listProjectsPage).toHaveBeenCalledWith(actor.id, {
        status: 'active',
        search: '',
        limit: 50,
      });
      expect(logger.write).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'tool-finished',
          tool: 'list_projects',
          status: 'success',
        }),
      );
      const spoofed = await client.callTool({
        name: 'create_review_thread',
        arguments: {
          projectId: project.id,
          thread: {
            authorId: crypto.randomUUID(),
            viewId: 'overview',
            objectId: null,
            x: 0,
            y: 0,
            body: 'review',
            mentionIds: [],
          },
        },
      });
      expect(spoofed.isError).toBe(true);
      expect(reviews.create).not.toHaveBeenCalled();
      const written = await client.callTool({
        name: 'create_review_thread',
        arguments: {
          projectId: project.id,
          thread: {
            viewId: 'overview',
            objectId: null,
            x: 0,
            y: 0,
            body: 'review',
            mentionIds: [],
          },
        },
      });
      expect(written.structuredContent).toEqual(reviewThread);
      expect(reviews.create).toHaveBeenCalledWith(
        project.id,
        expect.objectContaining({ body: 'review' }),
        actor,
      );
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe('MCP workspace authorization', () => {
  const actor = { id: crypto.randomUUID(), username: 'workspace-owner', color: '#4169e1' };
  const tokenId = crypto.randomUUID();
  const space = {
    id: project.workspaceId,
    name: 'Team',
    status: 'active',
    role: 'owner',
    createdAt: now,
    updatedAt: now,
  };
  const member = {
    workspaceId: space.id,
    userId: crypto.randomUUID(),
    username: 'member',
    color: '#4169e1',
    role: 'editor',
    joinedAt: now,
  };
  const invitation = {
    id: crypto.randomUUID(),
    workspaceId: space.id,
    workspaceName: space.name,
    invitedUserId: member.userId,
    username: member.username,
    invitedBy: actor.id,
    role: 'editor',
    status: 'pending',
    expiresAt: now,
    createdAt: now,
    updatedAt: now,
  };
  async function connected(overrides: Record<string, unknown> = {}) {
    const workspace = {
      getProjectState: vi.fn(async () => ({ project, document, syncSequence: 0 })),
      createProject: vi.fn(async () => project),
      importProject: vi.fn(async () => project),
      ...(overrides.workspace as object),
    };
    const spaces = Object.fromEntries(
      [
        ['createWorkspace', space],
        ['listWorkspaces', [space]],
        ['getWorkspace', space],
        ['updateWorkspace', space],
        ['deleteWorkspace', { deleted: true }],
        ['listMembers', [member]],
        ['updateMember', member],
        ['removeMember', { removed: true }],
        ['leaveWorkspace', { removed: true }],
        ['createInvitation', invitation],
        ['listInvitations', [invitation]],
        ['invitationInbox', [invitation]],
        ['acceptInvitation', invitation],
        ['declineInvitation', invitation],
        ['cancelInvitation', invitation],
      ].map(([name, result]) => [name, vi.fn(async () => result)]),
    );
    const reviews = {
      listPage: vi.fn(async () => ({ threads: [], nextCursor: null })),
      getThread: vi.fn(),
    };
    const sync = { historyPage: vi.fn(async () => ({ history: [], nextSince: null })) };
    const personal = {
      get: vi.fn(async () => ({
        state: { views: [], notes: [], nodes: [], viewports: [], relations: [] },
      })),
    };
    const auth = { assertActiveToken: vi.fn(async () => undefined) };
    const factory = new McpServerFactory(
      workspace as never,
      reviews as never,
      { write: vi.fn(async () => undefined) } as never,
      sync as never,
      {} as never,
      personal as never,
      spaces as never,
      auth as never,
    );
    const server = factory.create(actor, tokenId, crypto.randomUUID());
    const client = new Client({ name: 'authorization-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport as never);
    await client.connect(clientTransport as never);
    return {
      client,
      server,
      workspace,
      spaces,
      reviews,
      sync,
      personal,
      auth,
      close: async () => {
        await client.close();
        await server.close();
      },
    };
  }

  it('binds every workspace lifecycle tool to the token actor and validated identifiers', async () => {
    const harness = await connected();
    const cases: Array<[string, string, Record<string, unknown>, unknown[]]> = [
      ['create_workspace', 'createWorkspace', { name: 'Team' }, [{ name: 'Team' }]],
      ['list_workspaces', 'listWorkspaces', {}, []],
      ['get_workspace', 'getWorkspace', { workspaceId: space.id }, [space.id]],
      [
        'update_workspace',
        'updateWorkspace',
        { workspaceId: space.id, update: { status: 'archived' } },
        [space.id, { status: 'archived' }],
      ],
      ['delete_workspace', 'deleteWorkspace', { workspaceId: space.id }, [space.id]],
      ['list_workspace_members', 'listMembers', { workspaceId: space.id }, [space.id]],
      [
        'update_workspace_member',
        'updateMember',
        { workspaceId: space.id, userId: member.userId, update: { role: 'viewer' } },
        [space.id, member.userId, { role: 'viewer' }],
      ],
      [
        'remove_workspace_member',
        'removeMember',
        { workspaceId: space.id, userId: member.userId },
        [space.id, member.userId],
      ],
      ['leave_workspace', 'leaveWorkspace', { workspaceId: space.id }, [space.id]],
      [
        'create_workspace_invitation',
        'createInvitation',
        { workspaceId: space.id, invitation: { username: member.username, role: 'editor' } },
        [space.id, { username: member.username, role: 'editor' }],
      ],
      ['list_workspace_invitations', 'listInvitations', { workspaceId: space.id }, [space.id]],
      ['list_my_workspace_invitations', 'invitationInbox', {}, []],
      [
        'accept_workspace_invitation',
        'acceptInvitation',
        { invitationId: invitation.id },
        [invitation.id],
      ],
      [
        'decline_workspace_invitation',
        'declineInvitation',
        { invitationId: invitation.id },
        [invitation.id],
      ],
      [
        'cancel_workspace_invitation',
        'cancelInvitation',
        { workspaceId: space.id, invitationId: invitation.id },
        [space.id, invitation.id],
      ],
    ];
    try {
      for (const [tool, method, args, expected] of cases) {
        expect((await harness.client.callTool({ name: tool, arguments: args })).isError).not.toBe(
          true,
        );
        expect(harness.spaces[method]).toHaveBeenCalledWith(actor.id, ...expected);
      }
      expect(harness.auth.assertActiveToken).toHaveBeenCalledTimes(cases.length);
      expect(harness.auth.assertActiveToken).toHaveBeenCalledWith(tokenId, actor.id);
      const spoof = await harness.client.callTool({
        name: 'create_workspace',
        arguments: { name: 'Team', actorId: member.userId },
      });
      expect(spoof.isError).toBe(true);
      expect(harness.spaces.createWorkspace).toHaveBeenCalledTimes(1);
    } finally {
      await harness.close();
    }
  });

  it('uses the authenticated identity for whoami and rejects a token revoked after connection', async () => {
    const harness = await connected();
    try {
      const result = await harness.client.callTool({ name: 'whoami', arguments: {} });
      expect(result.structuredContent).toEqual({
        userId: actor.id,
        username: actor.username,
        color: actor.color,
      });
      expect(result.structuredContent).not.toHaveProperty('tokenId');
      harness.auth.assertActiveToken.mockRejectedValue(new UnauthorizedException('폐기된 토큰'));
      expect((await harness.client.callTool({ name: 'whoami', arguments: {} })).isError).toBe(true);
      expect(
        (
          await harness.client.callTool({
            name: 'create_project',
            arguments: { workspaceId: space.id, name: 'Forbidden' },
          })
        ).isError,
      ).toBe(true);
      expect(harness.workspace.createProject).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it('rechecks membership for snapshot helpers and passes the actor to review and history reads', async () => {
    const harness = await connected();
    try {
      expect(
        (
          await harness.client.callTool({
            name: 'get_project_summary',
            arguments: { projectId: project.id },
          })
        ).isError,
      ).not.toBe(true);
      expect(harness.workspace.getProjectState).toHaveBeenCalledWith(actor.id, project.id);
      harness.workspace.getProjectState.mockRejectedValue(
        new ForbiddenException('공간 접근 권한이 없습니다.'),
      );
      for (const [name, args] of [
        ['get_project', {}],
        ['get_project_summary', {}],
        ['list_tables', {}],
        ['get_project_view', { viewId: 'overview' }],
        ['list_view_relations', { viewId: 'overview' }],
        ['get_table_details', { tableId: 'missing' }],
        ['diagnose_project', {}],
        ['diagnose_layout', {}],
      ] as const) {
        const result = await harness.client.callTool({
          name,
          arguments: { projectId: project.id, ...args },
        });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toBeUndefined();
      }
      await harness.client.callTool({
        name: 'list_review_threads',
        arguments: { projectId: project.id },
      });
      expect(harness.reviews.listPage).toHaveBeenCalledWith(project.id, actor.id, 50, undefined);
      const threadId = crypto.randomUUID();
      await harness.client.callTool({ name: 'get_review_thread', arguments: { threadId } });
      expect(harness.reviews.getThread).toHaveBeenCalledWith(threadId, actor.id);
      await harness.client.callTool({
        name: 'get_project_history',
        arguments: { projectId: project.id },
      });
      expect(harness.sync.historyPage).toHaveBeenCalledWith(actor.id, project.id, 0, 50);
    } finally {
      await harness.close();
    }
  });
});
