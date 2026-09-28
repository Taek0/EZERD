import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { McpServerFactory } from '../src/mcp/mcp-server.js';

const now = new Date().toISOString();
const project = {
  id: crypto.randomUUID(),
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
      expect(tools.tools.slice(0, 3).every((tool) => tool.annotations?.readOnlyHint === true)).toBe(
        true,
      );
      expect(
        tools.tools.find((tool) => tool.name === 'delete_project')?.annotations?.destructiveHint,
      ).toBe(true);
      const result = await client.callTool({ name: 'list_projects', arguments: {} });
      expect(result.structuredContent).toEqual({ projects: [project], nextCursor: null });
      expect(workspace.listProjectsPage).toHaveBeenCalledWith({
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
