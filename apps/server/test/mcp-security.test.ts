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
  HOST: process.env.HOST,
  PORT: process.env.PORT,
  LAN_ALLOWED_CIDRS: process.env.LAN_ALLOWED_CIDRS,
};

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('MCP security boundaries', () => {
  it('accepts private LAN HTTP on the app port and rejects external or malformed HTTP', () => {
    process.env.NODE_ENV = 'production';
    process.env.HOST = '0.0.0.0';
    process.env.PORT = '3001';
    process.env.LAN_ALLOWED_CIDRS = '192.168.40.0/24';
    process.env.MCP_ENABLED = 'true';
    for (const url of [
      'http://ezerd.internal/mcp',
      'http://8.8.8.8:3001/mcp',
      'http://192.168.40.20:3002/mcp',
      'http://user:secret@192.168.40.20:3001/mcp',
      'https://user:secret@ezerd.internal/mcp',
      'https://ezerd.internal/other',
      'https://ezerd.internal/mcp?token=secret',
      'not-a-url-with-secret',
    ]) {
      process.env.MCP_PUBLIC_URL = url;
      expect(() => readConfig()).toThrow(/MCP_PUBLIC_URL/);
    }
    process.env.MCP_PUBLIC_URL = 'http://192.168.40.20:3001/mcp';
    expect(readConfig().MCP_PUBLIC_URL).toBe('http://192.168.40.20:3001/mcp');
  });

  it('fails closed for missing or invalid CIDRs on a production LAN bind', () => {
    process.env.NODE_ENV = 'production';
    process.env.HOST = '0.0.0.0';
    process.env.PORT = '3001';
    process.env.MCP_ENABLED = 'true';
    process.env.MCP_PUBLIC_URL = 'http://192.168.40.20:3001/mcp';
    for (const cidrs of ['', '8.8.8.0/24', 'not-a-cidr-secret']) {
      process.env.LAN_ALLOWED_CIDRS = cidrs;
      expect(() => readConfig()).toThrow(/LAN_ALLOWED_CIDRS/);
      try {
        readConfig();
      } catch (error) {
        expect(String(error)).not.toContain(cidrs || 'empty-value');
      }
    }
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
