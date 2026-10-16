import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessions } from '../src/db/schema.js';
import { SessionService } from '../src/identity/session.js';

const now = new Date('2026-10-16T00:00:00.000Z');
const token = 's'.repeat(43);
const actor = { id: 'user-id', username: 'actor', color: '#4169e1' };

function fixture(lastSeenAt = now) {
  const row = { sessionId: 'session-id', lastSeenAt, ...actor };
  const readRows = vi.fn(async (_condition: SQL) => [row]);
  const updateWhere = vi.fn(async (_condition: SQL) => undefined);
  const set = vi.fn((_value: { lastSeenAt: Date }) => ({ where: updateWhere }));
  const deleteWhere = vi.fn(async (_condition: SQL) => undefined);
  const db = {
    select: vi.fn(() => ({
      from: () => ({ innerJoin: () => ({ where: readRows }) }),
    })),
    update: vi.fn(() => ({ set })),
    delete: vi.fn(() => ({ where: deleteWhere })),
  };
  const service = new SessionService({ db } as never, {} as never);
  return { service, db, row, readRows, updateWhere, set, deleteWhere };
}

function query(condition: SQL) {
  return new PgDialect().sqlToQuery(condition);
}

describe('session authentication touches', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });
  afterEach(() => vi.useRealTimers());

  it.each([0, 59_999, 60_000])('skips the write when last seen %i ms ago', async (age) => {
    const f = fixture(new Date(now.getTime() - age));
    await expect(f.service.authenticateToken(token)).resolves.toEqual(actor);
    expect(f.readRows).toHaveBeenCalledTimes(1);
    expect(f.db.select).toHaveBeenCalledWith(
      expect.objectContaining({ lastSeenAt: sessions.lastSeenAt }),
    );
    expect(f.db.update).not.toHaveBeenCalled();
  });

  it('touches a session older than one minute with an atomic cutoff guard', async () => {
    const f = fixture(new Date(now.getTime() - 60_001));
    await expect(f.service.authenticateToken(token)).resolves.toEqual(actor);
    expect(f.db.update).toHaveBeenCalledTimes(1);
    expect(f.set).toHaveBeenCalledWith({ lastSeenAt: now });
    const touch = query(f.updateWhere.mock.calls[0]![0]);
    expect(touch.sql).toContain('"sessions"."id" =');
    expect(touch.sql).toContain('"sessions"."last_seen_at" <');
    expect(touch.params).toEqual(['session-id', new Date(now.getTime() - 60_000).toISOString()]);
  });

  it('keeps the atomic guard on concurrent authentications that read the same old timestamp', async () => {
    const f = fixture(new Date(now.getTime() - 60_001));
    await expect(
      Promise.all([f.service.authenticateToken(token), f.service.authenticateToken(token)]),
    ).resolves.toEqual([actor, actor]);
    expect(f.readRows).toHaveBeenCalledTimes(2);
    expect(f.updateWhere).toHaveBeenCalledTimes(2);
    for (const [condition] of f.updateWhere.mock.calls) {
      const touch = query(condition);
      expect(touch.sql).toContain('"sessions"."last_seen_at" <');
      expect(touch.params).toEqual(['session-id', new Date(now.getTime() - 60_000).toISOString()]);
    }
  });

  it('reads current token, expiry and user data on every request while skipping fresh touches', async () => {
    const f = fixture();
    await expect(f.service.authenticateHeader(`Bearer ${token}`)).resolves.toEqual(actor);
    vi.advanceTimersByTime(500);
    f.readRows.mockResolvedValue([{ ...f.row, username: 'renamed' }]);
    await expect(f.service.authenticateToken(token)).resolves.toEqual({
      ...actor,
      username: 'renamed',
    });
    expect(f.readRows).toHaveBeenCalledTimes(2);
    for (const [index, [condition]] of f.readRows.mock.calls.entries()) {
      const lookup = query(condition);
      expect(lookup.sql).toContain('"sessions"."token_hash" =');
      expect(lookup.sql).toContain('"sessions"."expires_at" >');
      expect(lookup.params).toEqual([
        createHash('sha256').update(token).digest('hex'),
        new Date(now.getTime() + index * 500).toISOString(),
      ]);
    }
    expect(f.db.update).not.toHaveBeenCalled();
  });

  it('rejects a missing or expired session without touching it', async () => {
    const f = fixture();
    f.readRows.mockResolvedValue([]);
    await expect(f.service.authenticateToken(token)).rejects.toBeInstanceOf(UnauthorizedException);
    const lookup = query(f.readRows.mock.calls[0]![0]);
    expect(lookup.sql).toContain('"sessions"."expires_at" >');
    expect(lookup.params[1]).toBe(now.toISOString());
    expect(f.db.update).not.toHaveBeenCalled();
  });

  it('rejects an invalid token immediately after a successful authentication', async () => {
    const f = fixture();
    await f.service.authenticateToken(token);
    f.readRows.mockResolvedValue([]);
    const otherToken = 't'.repeat(43);
    await expect(f.service.authenticateToken(otherToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(query(f.readRows.mock.calls[1]![0]).params[0]).toBe(
      createHash('sha256').update(otherToken).digest('hex'),
    );
    expect(f.db.update).not.toHaveBeenCalled();
  });

  it('deletes and emits revocation on logout, then rejects the same freshly seen token', async () => {
    const f = fixture();
    const revoked = vi.fn();
    f.service.onSessionRevoked(revoked);
    f.deleteWhere.mockImplementationOnce(async () => {
      f.readRows.mockResolvedValue([]);
    });
    await expect(f.service.logout(`Bearer ${token}`)).resolves.toEqual({ revoked: true });
    const tokenHash = createHash('sha256').update(token).digest('hex');
    expect(query(f.deleteWhere.mock.calls[0]![0]).params).toEqual([actor.id, tokenHash]);
    expect(revoked).toHaveBeenCalledWith(tokenHash);
    await expect(f.service.authenticateHeader(`Bearer ${token}`)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(f.readRows).toHaveBeenCalledTimes(2);
    expect(f.db.update).not.toHaveBeenCalled();
  });
});
