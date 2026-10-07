import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { describe, expect, it, vi } from 'vitest';
import { McpServerFactory } from '../src/mcp/mcp-server.js';
import { NativeCancellationService } from '../src/sync/native-cancellation.service.js';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import {
  createEmptyNativeDocument,
  defaultDatabaseContext,
  projectDatabaseCapabilities,
  resolveProjectDatabaseState,
} from '@ezerd/model';

const now = new Date().toISOString();
const project = {
  id: crypto.randomUUID(),
  workspaceId: crypto.randomUUID(),
  name: 'MCP project',
  databaseKind: 'postgresql' as const,
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
      getVersionedProjectState: vi.fn(async () => ({
        protocolVersion: 2,
        project: { ...project, databaseProfileId: 'postgresql-18-v1', databaseRevision: 0 },
        sequence: 0,
        sourceDocument: document,
        native: {
          status: 'available',
          document: createEmptyNativeDocument(defaultDatabaseContext('postgresql')),
          migrationIssues: [],
          issues: [],
        },
      })),
      getDatabaseCapabilities: vi.fn(async () => ({
        projectId: project.id,
        version: 0,
        sequence: 0,
        ...projectDatabaseCapabilities(
          resolveProjectDatabaseState({ databaseKind: project.databaseKind }),
          1,
        ),
      })),
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
      personal as never,
      { apply: vi.fn() } as never,
      {} as never,
      { assertActiveToken: vi.fn(async () => undefined) } as never,
      { upgrade: vi.fn() } as never,
      { exportProject: vi.fn() } as never,
      { history: vi.fn(), compensate: vi.fn() } as never,
      { baseline: vi.fn() } as never,
      { importProject: vi.fn(async () => ({ project })), exportProject: vi.fn() } as never,
      { cancel: vi.fn() } as never,
    );
    const actor = { id: crypto.randomUUID(), username: 'actor', color: '#4169e1' };
    const server = factory.create(actor, crypto.randomUUID(), crypto.randomUUID());
    const client = new Client({ name: 'test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport as never);
    await client.connect(clientTransport as never);
    try {
      const tools = await client.listTools();
      const jsonValidator = new AjvJsonSchemaValidator();
      expect(tools.tools).toHaveLength(42);
      for (const tool of tools.tools) {
        expect(() => jsonValidator.getValidator(tool.inputSchema), tool.name).not.toThrow();
        expect(tool.outputSchema, tool.name).toBeDefined();
        expect(tool.annotations, tool.name).toMatchObject({
          readOnlyHint: expect.any(Boolean),
          destructiveHint: expect.any(Boolean),
          openWorldHint: false,
        });
      }
      expect(client.getInstructions()).toContain('최소 40px');
      expect(client.getInstructions()).toContain('PK→FK 방향');
      expect(client.getInstructions()).toContain('관계선 교차');
      expect(client.getInstructions()).toContain('브라우저 스킬이나 스크린샷 대신');
      expect(client.getInstructions()).toContain('x·y·width·height');
      expect(client.getInstructions()).toContain('불필요한 폭·높이·빈 공간을 줄여');
      expect(client.getInstructions()).toContain('구조적 계층');
      expect(client.getInstructions()).toContain('겹침을 확인하고 수정');
      for (const name of [
        'get_project',
        'get_project_summary',
        'list_tables',
        'get_project_view',
        'list_view_relations',
        'get_table_details',
        'diagnose_project',
        'diagnose_layout',
        'apply_project_changes',
        'get_project_history',
        'undo_project_operation',
        'restore_project_deletion',
      ]) {
        expect(tools.tools.some((tool) => tool.name === name)).toBe(false);
        expect(
          (await client.callTool({ name, arguments: { projectId: project.id } })).isError,
        ).toBe(true);
      }
      expect(documents.apply).not.toHaveBeenCalled();
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
        'get_project_document_state',
        'export_project_ddl',
        'get_project_database_capabilities',
        'get_personal_state',
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
        'upgrade_project_document',
        'apply_native_project_changes',
        'apply_personal_changes',
        'get_native_project_baseline',
        'get_native_project_history',
        'undo_native_project_operation',
        'restore_native_project_deletion',
        'cancel_native_project_request',
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
      const capabilities = await client.callTool({
        name: 'get_project_database_capabilities',
        arguments: { projectId: project.id },
      });
      expect(capabilities.isError).not.toBe(true);
      expect(capabilities.structuredContent).toMatchObject({
        database: { kind: 'postgresql', revision: 0 },
        documentSchemaVersion: 1,
      });
      expect(workspace.getDatabaseCapabilities).toHaveBeenCalledWith(actor.id, project.id);
      const versioned = await client.callTool({
        name: 'get_project_document_state',
        arguments: { projectId: project.id },
      });
      expect(versioned.isError).not.toBe(true);
      expect(versioned.structuredContent).toMatchObject({
        protocolVersion: 2,
        sourceDocument: document,
        project: { databaseRevision: 0 },
        native: { status: 'available', document: { schemaVersion: 2 } },
      });
      expect(workspace.getVersionedProjectState).toHaveBeenCalledWith(actor.id, project.id);
      expect(tools.tools.find((tool) => tool.name === 'get_project_document_state')).toMatchObject({
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        outputSchema: { type: 'object' },
      });
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
    const transfer = (overrides.transfer ?? {
      importProject: vi.fn(async () => ({ project })),
      exportProject: vi.fn(),
    }) as { importProject: ReturnType<typeof vi.fn>; exportProject: ReturnType<typeof vi.fn> };
    const factory = new McpServerFactory(
      workspace as never,
      reviews as never,
      { write: vi.fn(async () => undefined) } as never,
      personal as never,
      { apply: vi.fn() } as never,
      spaces as never,
      auth as never,
      { upgrade: vi.fn() } as never,
      { exportProject: vi.fn() } as never,
      { history: vi.fn(), compensate: vi.fn() } as never,
      { baseline: vi.fn() } as never,
      transfer as never,
      (overrides.cancellation ?? { cancel: vi.fn() }) as never,
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
      transfer,
      auth,
      close: async () => {
        await client.close();
        await server.close();
      },
    };
  }

  it('publishes all three import envelopes, guarded expressions and cancellation identities without rewriting raw inputs', async () => {
    const harness = await connected();
    try {
      const tools = (await harness.client.listTools()).tools;
      const validator = new AjvJsonSchemaValidator();
      const importTool = tools.find((tool) => tool.name === 'import_project')!;
      const validate = validator.getValidator(importTool.inputSchema);
      const native = createEmptyNativeDocument(defaultDatabaseContext('sqlite'));
      const files = [
        {
          format: 'ezerd-project',
          formatVersion: 1,
          exportedAt: now,
          project: { name: ' Raw legacy ' },
          document,
        },
        {
          format: 'ezerd-project',
          formatVersion: 2,
          exportedAt: now,
          project: {
            name: ' Native ',
            databaseKind: 'sqlite',
            databaseProfileId: 'sqlite-3.45-v1',
          },
          document: native,
        },
        {
          format: 'ezerd-project',
          formatVersion: 2,
          exportedAt: now,
          project: {
            name: ' Native ',
            databaseKind: 'sqlite',
            databaseProfileId: 'sqlite-3.45-v1',
          },
          source: { projectId: project.id, version: 1, sequence: 1, databaseRevision: 0 },
          sourceDocument: native,
          native: { status: 'available', document: native, migrationIssues: [], issues: [] },
        },
      ];
      for (const file of files)
        expect(validate({ workspaceId: space.id, transfer: file }).valid).toBe(true);
      expect(
        validate({ workspaceId: space.id, transfer: { format: 'ezerd-project', formatVersion: 2 } })
          .valid,
      ).toBe(false);
      const changes = tools.find((tool) => tool.name === 'apply_native_project_changes')!;
      expect(JSON.stringify(changes.inputSchema)).toContain('ezerd_mcp_expression');
      expect(JSON.stringify(changes.inputSchema)).toContain('sqlite:current_timestamp');
      const input = {
        projectId: project.id,
        operationId: crypto.randomUUID(),
        clientId: crypto.randomUUID(),
        groupId: crypto.randomUUID(),
        expectedVersion: 0,
        expectedSequence: 0,
        expectedDatabaseRevision: 0,
        commands: [
          {
            type: 'add_check',
            value: {
              id: 'check',
              tableId: 'table',
              name: 'positive',
              scope: 'physical',
              expression: {
                kind: 'binary',
                operator: '>',
                left: { kind: 'column', columnId: 'column' },
                right: { kind: 'literal', literalType: 'number', value: '0' },
              },
            },
          },
        ],
      };
      const validateChanges = validator.getValidator(changes.inputSchema);
      expect(validateChanges(input).valid).toBe(true);
      input.commands[0]!.value.expression.right.value = 0 as never;
      expect(validateChanges(input).valid).toBe(false);
      const cancellation = tools.find((tool) => tool.name === 'cancel_native_project_request')!;
      const validateCancellation = validator.getValidator(cancellation.inputSchema);
      const request = JSON.parse(
        `{"operationId":"${project.id}","groupId":"${project.id}","clientId":"${project.id}","__proto__":{"raw":" value "}}`,
      );
      const original = JSON.stringify(request);
      expect(
        validateCancellation({ projectId: project.id, kind: 'native-command', request }).valid,
      ).toBe(true);
      expect(
        validateCancellation({ projectId: project.id, kind: 'history-undo', request }).valid,
      ).toBe(false);
      expect(
        validateCancellation({
          projectId: project.id,
          kind: 'native-upgrade',
          request: {
            operationId: project.id,
            clientId: project.id,
          },
        }).valid,
      ).toBe(true);
      expect(JSON.stringify(request)).toBe(original);
      expect(
        JSON.stringify(tools.find((tool) => tool.name === 'export_project')!.outputSchema),
      ).toContain('sourceDocument');
      expect(
        JSON.stringify(
          tools.find((tool) => tool.name === 'get_native_project_history')!.outputSchema,
        ),
      ).toContain('recordedAck');
    } finally {
      await harness.close();
    }
  });

  it('returns a recorded v1 cancellation ACK verbatim without requiring protocolVersion', async () => {
    const operationId = crypto.randomUUID();
    const result = {
      operationId,
      groupId: crypto.randomUUID(),
      sequence: 1,
      status: 'accepted',
      actor: { id: actor.id, username: ' historical actor ', color: '#4169e1' },
      changedPaths: ['/domains/legacy'],
      createdAt: now,
      nextBaseline: { baselineId: crypto.randomUUID(), baseSequence: 1, baselineIssuedAt: now },
    };
    const cancellation = { cancel: vi.fn(async () => ({ outcome: 'recorded', result })) };
    const harness = await connected({ cancellation });
    try {
      await harness.client.listTools();
      const response = await harness.client.callTool({
        name: 'cancel_native_project_request',
        arguments: {
          projectId: project.id,
          kind: 'protocol-operation',
          request: {
            operationId,
            groupId: result.groupId,
            clientId: crypto.randomUUID(),
          },
        },
      });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      expect(response.structuredContent).toEqual({ outcome: 'recorded', result });
    } finally {
      await harness.close();
    }
  });

  it('returns cancellation input errors with field paths before accessing the database', async () => {
    const transaction = vi.fn();
    const cancellation = new NativeCancellationService(
      { db: { transaction } } as never,
      {} as never,
    );
    const harness = await connected({ cancellation });
    try {
      for (const [input, path] of [
        [{ kind: 'native-command', request: { operationId: 'invalid' } }, ['request']],
        [
          {
            kind: 'history-undo',
            request: { operationId: project.id, groupId: project.id, clientId: project.id },
          },
          ['sourceOperationId'],
        ],
      ] as const) {
        const result = await harness.client.callTool({
          name: 'cancel_native_project_request',
          arguments: { projectId: project.id, ...input },
        });
        expect(result.isError).toBe(true);
        const error = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
        expect(error).toMatchObject({ status: 400, code: 'native.cancellation-input-invalid' });
        expect(error.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
      }
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it('passes raw v1 evidence and compact v2 input through the Native transfer service', async () => {
    const transfer = { importProject: vi.fn(async () => ({ project })), exportProject: vi.fn() };
    const harness = await connected({ transfer });
    try {
      for (const version of [1, 2]) {
        const raw = {
          format: 'ezerd-project',
          formatVersion: version,
          exportedAt: now,
          project: {
            name: ' Raw file ',
            ...(version === 2
              ? { databaseKind: 'postgresql', databaseProfileId: 'postgresql-18-v1' }
              : {}),
          },
          document:
            version === 1
              ? {
                  ...document,
                  domains: [{ id: 'domain', name: '  原文  ', description: ' trailing ' }],
                }
              : createEmptyNativeDocument(defaultDatabaseContext('postgresql')),
        };
        const result = await harness.client.callTool({
          name: 'import_project',
          arguments: { workspaceId: space.id, transfer: raw },
        });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toEqual(project);
        expect(transfer.importProject).toHaveBeenLastCalledWith(actor.id, {
          workspaceId: space.id,
          transfer: raw,
        });
      }
    } finally {
      await harness.close();
    }
  });
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

  it('validates complete native output despite opaque SDK document metadata, and rejects spoofed input', async () => {
    const state = {
      protocolVersion: 2,
      project: { ...project, databaseProfileId: 'postgresql-18-v1', databaseRevision: 0 },
      sequence: 0,
      sourceDocument: document,
      native: {
        status: 'available',
        document: createEmptyNativeDocument(defaultDatabaseContext('postgresql')),
        migrationIssues: [],
        issues: [],
      },
    };
    const read = vi.fn(async () => state);
    const harness = await connected({ workspace: { getVersionedProjectState: read } });
    try {
      const call = () =>
        harness.client.callTool({
          name: 'get_project_document_state',
          arguments: { projectId: project.id },
        });
      expect((await call()).isError).not.toBe(true);
      expect(read).toHaveBeenCalledWith(actor.id, project.id);
      const count = read.mock.calls.length;
      expect(
        (
          await harness.client.callTool({
            name: 'get_project_document_state',
            arguments: { projectId: project.id, actorId: member.userId },
          })
        ).isError,
      ).toBe(true);
      expect(read).toHaveBeenCalledTimes(count);
      state.native.document.checks = [
        {
          id: 'check',
          tableId: 't',
          name: '',
          scope: 'physical',
          expression: 'RAW_SQL_SECRET' as never,
        },
      ];
      const result = await call();
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain('RAW_SQL_SECRET');
      expect(harness.workspace.getProjectState).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it('rechecks native snapshot membership and token revocation before exposing source data', async () => {
    const read = vi.fn(async () => {
      throw new ForbiddenException('공간 접근 권한이 없습니다.');
    });
    const harness = await connected({ workspace: { getVersionedProjectState: read } });
    try {
      const call = () =>
        harness.client.callTool({
          name: 'get_project_document_state',
          arguments: { projectId: project.id },
        });
      const denied = await call();
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent).toBeUndefined();
      expect(read).toHaveBeenCalledWith(actor.id, project.id);
      harness.auth.assertActiveToken.mockRejectedValue(new UnauthorizedException('폐기된 토큰'));
      const revoked = await call();
      expect(revoked.isError).toBe(true);
      expect(revoked.structuredContent).toBeUndefined();
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      await harness.close();
    }
  });
  it('documents and forwards explicit native creation while preserving omitted legacy input', async () => {
    const harness = await connected();
    try {
      const tool = (await harness.client.listTools()).tools.find(
        (tool) => tool.name === 'create_project',
      )!;
      expect(tool.description).toContain('formatVersion: 2');
      expect(tool.inputSchema.properties).toHaveProperty('formatVersion');
      const native = await harness.client.callTool({
        name: 'create_project',
        arguments: { workspaceId: project.workspaceId, databaseKind: 'mysql', formatVersion: 2 },
      });
      expect(native.isError).not.toBe(true);
      expect(harness.workspace.createProject).toHaveBeenCalledWith(actor.id, {
        workspaceId: project.workspaceId,
        databaseKind: 'mysql',
        formatVersion: 2,
      });
      await harness.client.callTool({
        name: 'create_project',
        arguments: { workspaceId: project.workspaceId },
      });
      expect(harness.workspace.createProject).toHaveBeenLastCalledWith(actor.id, {
        workspaceId: project.workspaceId,
      });
      const invalid = await harness.client.callTool({
        name: 'create_project',
        arguments: { workspaceId: project.workspaceId, formatVersion: 1 },
      });
      expect(invalid.isError).toBe(true);
      expect(harness.workspace.createProject).toHaveBeenCalledTimes(2);
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

  it('passes the token actor to review reads', async () => {
    const harness = await connected();
    try {
      await harness.client.callTool({
        name: 'list_review_threads',
        arguments: { projectId: project.id },
      });
      expect(harness.reviews.listPage).toHaveBeenCalledWith(project.id, actor.id, 50, undefined);
      const threadId = crypto.randomUUID();
      await harness.client.callTool({ name: 'get_review_thread', arguments: { threadId } });
      expect(harness.reviews.getThread).toHaveBeenCalledWith(threadId, actor.id);
    } finally {
      await harness.close();
    }
  });
});
