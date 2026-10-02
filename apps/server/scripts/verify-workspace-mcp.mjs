import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { approvedTransfer } from './workspace-transfer.mjs';

async function main() {
  const codexRoot = process.env.CODEX_HOME ?? resolve(process.env.USERPROFILE, '.codex');
  // Read the existing configured credential only in memory. Never print it or errors
  // carrying request headers, and never create a replacement operational token.
  const settings = await readFile(resolve(codexRoot, 'config.toml'), 'utf8');
  const server = settings.match(/\[mcp_servers\.ezerd\]([\s\S]*?)(?=\n\[|$)/)?.[1];
  const headers = settings.match(/\[mcp_servers\.ezerd\.http_headers\]([\s\S]*?)(?=\n\[|$)/)?.[1];
  const endpoint = server?.match(/^url\s*=\s*"([^"]+)"/m)?.[1];
  const authorization = headers?.match(/^"?authorization"?\s*=\s*"([^"]+)"/im)?.[1];
  if (!endpoint || !authorization) throw new Error('Configured MCP connection unavailable.');
  const client = new Client({ name: 'workspace-readonly-verification', version: '1.0' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: { headers: { authorization } },
      }),
    );
    const tools = await client.listTools();
    const identity = await client.callTool({ name: 'whoami', arguments: {} });
    const spaces = await client.callTool({ name: 'list_workspaces', arguments: {} });
    const projects = await client.callTool({
      name: 'list_projects',
      arguments: { status: 'active', limit: 100 },
    });
    if (identity.isError || spaces.isError || projects.isError)
      throw new Error('MCP read verification failed.');
    if (identity.structuredContent?.userId !== approvedTransfer.ownerId)
      throw new Error('MCP owner no longer matches approved identity.');
    const projectRows = projects.structuredContent.projects;
    for (const space of approvedTransfer.spaces)
      for (const expected of space.projects) {
        const actual = projectRows.find((project) => project.id === expected.id);
        if (actual?.name !== expected.name || actual.workspaceId !== space.id)
          throw new Error('MCP workspace assignment mismatch.');
      }
    for (const space of approvedTransfer.spaces) {
      const actual = spaces.structuredContent.workspaces.find(
        (workspace) => workspace.id === space.id,
      );
      if (actual?.name !== space.name || actual.role !== 'owner')
        throw new Error('MCP owner membership mismatch.');
    }
    console.log(
      JSON.stringify(
        {
          verified: true,
          toolCount: tools.tools.length,
          ownerId: identity.structuredContent.userId,
          workspaces: spaces.structuredContent.workspaces,
          projects: projectRows,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close();
  }
}
main().catch(() => {
  console.error('Read-only MCP verification failed; no credentials or raw request details logged.');
  process.exitCode = 1;
});
