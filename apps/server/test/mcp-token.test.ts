import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MCP_TOKEN_PREFIX, McpTokenService, hashMcpToken } from '../src/mcp/mcp-token.service.js';
import { RateLimitService } from '../src/rate-limit.service.js';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

it('only deletes revoked token records belonging to the authenticated owner', async () => {
  const userId = crypto.randomUUID(),
    id = crypto.randomUUID();
  let predicate: SQL | undefined;
  const database = {
    db: {
      delete: () => ({
        where: (condition: SQL) => {
          predicate = condition;
          return { returning: async () => [{ id }] };
        },
      }),
    },
  };
  const logger = { write: vi.fn(async () => undefined) };
  const service = new McpTokenService(database as never, new RateLimitService(), logger as never);
  expect(await service.removeRevoked(userId, id)).toEqual({ id, deleted: true });
  const query = new PgDialect().sqlToQuery(predicate!);
  expect(query.params).toEqual([id, userId]);
  expect(query.sql).toContain('"mcp_tokens"."user_id"');
  expect(query.sql).toContain('"mcp_tokens"."revoked_at" is not null');
  expect(logger.write).toHaveBeenCalledWith(
    expect.objectContaining({ event: 'token-removed', tokenId: id }),
  );
});
it('rejects a missing, active or other-owner token without logging a deletion', async () => {
  const logger = { write: vi.fn() };
  const database = { db: { delete: () => ({ where: () => ({ returning: async () => [] }) }) } };
  const service = new McpTokenService(database as never, new RateLimitService(), logger as never);
  await expect(
    service.removeRevoked(crypto.randomUUID(), crypto.randomUUID()),
  ).rejects.toMatchObject({ status: 404 });
  expect(logger.write).not.toHaveBeenCalled();
});

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

  it('redacts token-store failures from responses and logs', async () => {
    const logger = { write: vi.fn(async () => undefined) };
    const database = {
      db: {
        insert: () => ({
          values: () => ({
            returning: async () => {
              throw new Error('postgresql://sentinel-secret@private/token-hash-sentinel');
            },
          }),
        }),
      },
    };
    const service = new McpTokenService(database as never, new RateLimitService(), logger as never);
    const error = await service.create(crypto.randomUUID(), 'private name').catch((value) => value);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.message).not.toContain('sentinel');
    expect(JSON.stringify(logger.write.mock.calls)).not.toContain('sentinel');
    expect(logger.write).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'token-failed', errorCode: 'TOKEN_STORE_UNAVAILABLE' }),
    );
  });
});
