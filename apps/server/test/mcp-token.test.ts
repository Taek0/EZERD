import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MCP_TOKEN_PREFIX, McpTokenService, hashMcpToken } from '../src/mcp/mcp-token.service.js';
import { RateLimitService } from '../src/rate-limit.service.js';

describe('MCP tokens', () => {
  it('returns the secret once while storing only its SHA-256 hash', async () => {
    let inserted: Record<string, unknown> | undefined;
    const database = {
      db: {
        insert: () => ({
          values: (value: Record<string, unknown>) => {
            inserted = value;
            return {
              returning: async () => [
                {
                  id: crypto.randomUUID(),
                  userId: value.userId,
                  name: value.name,
                  tokenHash: value.tokenHash,
                  createdAt: new Date(),
                  expiresAt: value.expiresAt,
                  revokedAt: null,
                  lastUsedAt: null,
                },
              ],
            };
          },
        }),
      },
    };
    const logger = { write: vi.fn(async () => undefined) };
    const service = new McpTokenService(database as never, new RateLimitService(), logger as never);
    const result = await service.create(crypto.randomUUID(), 'client');

    expect(result.token).toMatch(/^ezmcp_[A-Za-z0-9_-]{43}$/);
    expect(result.token.startsWith(MCP_TOKEN_PREFIX)).toBe(true);
    expect(inserted?.tokenHash).toBe(hashMcpToken(result.token));
    expect(JSON.stringify(inserted)).not.toContain(result.token);
    expect(logger.write).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'token-issued', tokenId: result.id }),
    );
  });

  it('limits repeated issuance and login-style attempts', () => {
    const limiter = new RateLimitService();
    for (let index = 0; index < 2; index += 1) limiter.consume('identity', 2, 60_000);
    expect(() => limiter.consume('identity', 2, 60_000)).toThrow(HttpException);
  });
});
