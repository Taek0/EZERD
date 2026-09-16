import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service.js';
import { mcpTokens } from '../db/schema.js';
import { RateLimitService } from '../rate-limit.service.js';
import { McpLogger } from './logging.js';

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
    @Inject(McpLogger) private readonly logger: McpLogger,
  ) {}

  async create(userId: string, name: string) {
    const requestId = randomUUID();
    this.rateLimits.consume(`mcp-token:${userId}`, 10, 60 * 60 * 1000);
    const token = `${MCP_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS);
    let row: typeof mcpTokens.$inferSelect | undefined;
    try {
      [row] = await this.database.db
        .insert(mcpTokens)
        .values({ userId, name, tokenHash: hashMcpToken(token), expiresAt })
        .returning();
    } catch {
      await this.storageFailure(requestId, userId);
    }
    await this.logger.write({
      level: 'info',
      event: 'token-issued',
      requestId,
      userId,
      tokenId: row!.id,
      status: 'success',
    });
    return { ...publicToken(row!), token };
  }

  async list(userId: string) {
    const requestId = randomUUID();
    try {
      const rows = await this.database.db
        .select()
        .from(mcpTokens)
        .where(eq(mcpTokens.userId, userId))
        .orderBy(desc(mcpTokens.createdAt), desc(mcpTokens.id));
      return rows.map(publicToken);
    } catch {
      return this.storageFailure(requestId, userId);
    }
  }

  async revoke(userId: string, id: string) {
    const requestId = randomUUID();
    let row: typeof mcpTokens.$inferSelect | undefined;
    try {
      [row] = await this.database.db
        .update(mcpTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(mcpTokens.id, id), eq(mcpTokens.userId, userId)))
        .returning();
    } catch {
      await this.storageFailure(requestId, userId);
    }
    if (!row) throw new NotFoundException('MCP 토큰을 찾을 수 없습니다.');
    await this.logger.write({
      level: 'info',
      event: 'token-revoked',
      requestId,
      userId,
      tokenId: row.id,
      status: 'success',
    });
    return publicToken(row);
  }

  async removeRevoked(userId: string, id: string) {
    const requestId = randomUUID();
    let deleted: { id: string } | undefined;
    try {
      [deleted] = await this.database.db
        .delete(mcpTokens)
        .where(
          and(eq(mcpTokens.id, id), eq(mcpTokens.userId, userId), isNotNull(mcpTokens.revokedAt)),
        )
        .returning({ id: mcpTokens.id });
    } catch {
      await this.storageFailure(requestId, userId);
    }
    if (!deleted) throw new NotFoundException('삭제할 폐기된 토큰을 찾을 수 없습니다.');
    await this.logger.write({
      level: 'info',
      event: 'token-removed',
      requestId,
      userId,
      tokenId: id,
      status: 'success',
    });
    return { id, deleted: true };
  }

  private async storageFailure(requestId: string, userId: string): Promise<never> {
    await this.logger.write({
      level: 'error',
      event: 'token-failed',
      requestId,
      userId,
      status: 'error',
      errorCode: 'TOKEN_STORE_UNAVAILABLE',
    });
    throw new ServiceUnavailableException(
      `MCP 토큰 저장소를 사용할 수 없습니다. 요청 ID: ${requestId}`,
    );
  }
}
