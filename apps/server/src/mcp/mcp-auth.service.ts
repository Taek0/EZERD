import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service.js';
import { mcpTokens, users } from '../db/schema.js';
import type { AuthenticatedUser } from '../identity/session.js';
import { hashMcpToken, MCP_TOKEN_PREFIX } from './mcp-token.service.js';

export type McpPrincipal = { user: AuthenticatedUser; tokenId: string };

@Injectable()
export class McpAuthService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async assertActiveToken(tokenId: string, userId: string): Promise<void> {
    const [token] = await this.database.db
      .select({ id: mcpTokens.id })
      .from(mcpTokens)
      .innerJoin(users, eq(users.id, mcpTokens.userId))
      .where(
        and(
          eq(mcpTokens.id, tokenId),
          eq(mcpTokens.userId, userId),
          gt(mcpTokens.expiresAt, new Date()),
          isNull(mcpTokens.revokedAt),
        ),
      );
    if (!token) throw new UnauthorizedException('MCP 토큰이 만료되었거나 폐기되었습니다.');
  }

  async authenticateHeader(authorization: string | undefined): Promise<McpPrincipal> {
    const pattern = new RegExp(`^Bearer (${MCP_TOKEN_PREFIX}[A-Za-z0-9_-]{43})$`);
    const match = pattern.exec(authorization ?? '');
    if (!match) throw new UnauthorizedException('유효한 MCP 토큰이 필요합니다.');
    const now = new Date();
    const [row] = await this.database.db
      .select({
        tokenId: mcpTokens.id,
        lastUsedAt: mcpTokens.lastUsedAt,
        id: users.id,
        username: users.username,
        color: users.color,
      })
      .from(mcpTokens)
      .innerJoin(users, eq(users.id, mcpTokens.userId))
      .where(
        and(
          eq(mcpTokens.tokenHash, hashMcpToken(match[1]!)),
          gt(mcpTokens.expiresAt, now),
          isNull(mcpTokens.revokedAt),
        ),
      );
    if (!row) throw new UnauthorizedException('MCP 토큰이 만료되었거나 폐기되었습니다.');
    if (!row.lastUsedAt || row.lastUsedAt.getTime() < now.getTime() - 60_000)
      await this.database.db
        .update(mcpTokens)
        .set({ lastUsedAt: now })
        .where(
          and(
            eq(mcpTokens.id, row.tokenId),
            or(
              isNull(mcpTokens.lastUsedAt),
              lt(mcpTokens.lastUsedAt, new Date(now.getTime() - 60_000)),
            ),
          ),
        );
    return {
      tokenId: row.tokenId,
      user: { id: row.id, username: row.username, color: row.color },
    };
  }
}
