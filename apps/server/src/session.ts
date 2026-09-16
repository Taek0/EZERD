import { createHash, randomBytes } from 'node:crypto';
import {
  Body,
  Controller,
  Headers,
  Inject,
  Injectable,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { usernameSchema } from '@ezerd/contracts';
import { DatabaseService } from './db/database.service.js';
import { sessions, users } from './db/schema.js';
import { RateLimitService } from './rate-limit.service.js';

const pinSchema = z.string().regex(/^\d{4}$/);
const createSessionSchema = z.union([
  z.strictObject({ userId: z.uuid(), pin: pinSchema }),
  z.strictObject({ username: usernameSchema, pin: pinSchema }),
]);
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export type AuthenticatedUser = { id: string; username: string; color: string };

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RateLimitService) private readonly rateLimits: RateLimitService,
  ) {}

  async create(body: unknown, clientAddress = 'unknown') {
    const parsed = createSessionSchema.safeParse(body);
    if (!parsed.success) throw new UnauthorizedException('사용자와 PIN을 확인해주세요.');
    const identityKey = 'userId' in parsed.data ? parsed.data.userId : parsed.data.username;
    this.rateLimits.consume(`login:${clientAddress}:${identityKey}`, 10, 15 * 60 * 1000);
    const identity =
      'userId' in parsed.data
        ? eq(users.id, parsed.data.userId)
        : eq(users.username, parsed.data.username);
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(and(identity, eq(users.pinHash, hash(parsed.data.pin))));
    if (!user) throw new UnauthorizedException('사용자와 PIN을 확인해주세요.');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    await this.database.db
      .insert(sessions)
      .values({ userId: user.id, tokenHash: hash(token), expiresAt });
    return {
      token,
      expiresAt: expiresAt.toISOString(),
      baselineIssuedAt: new Date().toISOString(),
      user: { id: user.id, username: user.username, color: user.color },
    };
  }

  async authenticateHeader(authorization: string | undefined): Promise<AuthenticatedUser> {
    const match = /^Bearer ([A-Za-z0-9_-]{40,})$/.exec(authorization ?? '');
    if (!match) throw new UnauthorizedException('로그인이 필요합니다.');
    return this.authenticateToken(match[1]!);
  }

  async authenticateToken(token: string): Promise<AuthenticatedUser> {
    const [row] = await this.database.db
      .select({
        sessionId: sessions.id,
        id: users.id,
        username: users.username,
        color: users.color,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, hash(token)), gt(sessions.expiresAt, new Date())));
    if (!row) throw new UnauthorizedException('세션이 만료되었습니다. 다시 로그인해주세요.');
    await this.database.db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, row.sessionId));
    return { id: row.id, username: row.username, color: row.color };
  }
}

@Controller()
export class SessionController {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}
  @Post('sessions') create(@Body() body: unknown, @Req() request: { ip?: string }) {
    return this.sessions.create(body, request.ip);
  }
}

export async function requireSession(service: SessionService, authorization: string | undefined) {
  return service.authenticateHeader(authorization);
}
