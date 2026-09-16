import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service.js';
import { mcpTokens } from '../db/schema.js';
import { RateLimitService } from '../rate-limit.service.js';

const TOKEN_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
export const MCP_TOKEN_PREFIX = 'ezmcp_';

export function hashMcpToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function publicToken(row: typeof mcpTokens.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class McpTokenService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RateLimitService) private readonly rateLimits: RateLimitService,
  ) {}

  async create(userId: string, name: string) {
    this.rateLimits.consume(`mcp-token:${userId}`, 10, 60 * 60 * 1000);
    const token = `${MCP_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS);
    const [row] = await this.database.db
      .insert(mcpTokens)
      .values({ userId, name, tokenHash: hashMcpToken(token), expiresAt })
      .returning();
    return { ...publicToken(row!), token };
  }

  async list(userId: string) {
    const rows = await this.database.db
      .select()
      .from(mcpTokens)
      .where(eq(mcpTokens.userId, userId))
      .orderBy(desc(mcpTokens.createdAt), desc(mcpTokens.id));
    return rows.map(publicToken);
  }

  async revoke(userId: string, id: string) {
    const [row] = await this.database.db
      .update(mcpTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(mcpTokens.id, id), eq(mcpTokens.userId, userId)))
      .returning();
    if (!row) throw new NotFoundException('MCP 토큰을 찾을 수 없습니다.');
    return publicToken(row);
  }
}
