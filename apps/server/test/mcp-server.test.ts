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
      getProject: vi.fn(async () => ({ project, document })),
    };
    const reviews = { list: vi.fn(async () => []) };
    const logger = { write: vi.fn(async () => undefined) };
    const factory = new McpServerFactory(workspace as never, reviews as never, logger as never);
    const server = factory.create(
      { id: crypto.randomUUID(), username: 'actor', color: '#4169e1' },
      crypto.randomUUID(),
      crypto.randomUUID(),
    );
    const client = new Client({ name: 'test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport as never);
    await client.connect(clientTransport as never);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        'list_projects',
        'get_project',
        'list_review_threads',
      ]);
      expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
      const result = await client.callTool({ name: 'list_projects', arguments: {} });
      expect(result.structuredContent).toEqual({ projects: [project] });
      expect(workspace.listProjects).toHaveBeenCalledWith({ status: 'active', search: '' });
      expect(logger.write).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'tool-finished',
          tool: 'list_projects',
          status: 'success',
        }),
      );
    } finally {
      await client.close();
      await server.close();
    }
  });
});
