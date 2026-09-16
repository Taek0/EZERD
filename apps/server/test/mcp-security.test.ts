import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.js';
import { McpLogger } from '../src/mcp/logging.js';

const original = {
  NODE_ENV: process.env.NODE_ENV,
  MCP_ENABLED: process.env.MCP_ENABLED,
  MCP_PUBLIC_URL: process.env.MCP_PUBLIC_URL,
  MCP_LOG_DIR: process.env.MCP_LOG_DIR,
};

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('MCP security boundaries', () => {
  it('requires a credential-free HTTPS /mcp public URL in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.MCP_ENABLED = 'true';
    for (const url of [
      'http://ezerd.internal/mcp',
      'https://user:secret@ezerd.internal/mcp',
      'https://ezerd.internal/other',
      'https://ezerd.internal/mcp?token=secret',
      'not-a-url-with-secret',
    ]) {
      process.env.MCP_PUBLIC_URL = url;
      expect(() => readConfig()).toThrow(/MCP_PUBLIC_URL/);
    }
    process.env.MCP_PUBLIC_URL = 'https://ezerd.internal/mcp';
    expect(readConfig().MCP_PUBLIC_URL).toBe('https://ezerd.internal/mcp');
  });

  it('serializes only the explicit log allowlist at runtime', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ezerd-mcp-log-'));
    process.env.MCP_LOG_DIR = directory;
    const logger = new McpLogger();
    try {
      await logger.write({
        level: 'info',
        event: 'tool-finished',
        requestId: 'request',
        tool: 'list_projects',
        status: 'success',
        authorization: 'Bearer secret',
        arguments: { secret: true },
      } as never);
      const content = await readFile(
        join(directory, `${new Date().toISOString().slice(0, 10)}.jsonl`),
        'utf8',
      );
      expect(content).toContain('list_projects');
      expect(content).not.toContain('Bearer secret');
      expect(content).not.toContain('arguments');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
