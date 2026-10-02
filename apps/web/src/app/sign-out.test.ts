import { expect, it, vi } from 'vitest';
import { cachedIdentitySession, sessionForIdentity, clearSignIn } from './App.js';
it('revokes the session before removing only browser identity and session keys', async () => {
  const calls: string[] = [];
  const result = await clearSignIn(
    async () => {
      calls.push('revoke');
    },
    { removeItem: (key) => calls.push(key) },
    { removeItem: (key) => calls.push(key) },
  );
  expect(result).toBeNull();
  expect(calls).toEqual(['revoke', 'ezerd.userId', 'ezerd.sync.session']);
});
it('clears local sign-in after remote revocation fails', async () => {
  const remove = vi.fn();
  expect(
    await clearSignIn(
      async () => {
        throw new Error('offline');
      },
      { removeItem: remove },
      { removeItem: remove },
    ),
  ).toBe('remote');
  expect(remove.mock.calls).toEqual([['ezerd.userId'], ['ezerd.sync.session']]);
});
it('still removes the tab session when persistent storage is unavailable', async () => {
  const remove = vi.fn();
  expect(
    await clearSignIn(
      async () => {},
      {
        removeItem: () => {
          throw new Error('denied');
        },
      },
      { removeItem: remove },
    ),
  ).toBe('storage');
  expect(remove).toHaveBeenCalledWith('ezerd.sync.session');
});

const cached = {
  token: 'test-token',
  baselineIssuedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2099-01-01T00:00:00.000Z',
};
it('requires fresh PIN login when there is no validated user even if a token remains', () => {
  expect(sessionForIdentity(undefined, 'new-user', cached)).toBeNull();
  expect(sessionForIdentity('old-user', 'new-user', cached)).toBeNull();
  expect(sessionForIdentity('same-user', 'same-user', cached)).toBe(cached);
});
it('binds cached tab sessions to the persisted identity and rejects legacy or malformed sessions', () => {
  expect(
    cachedIdentitySession(JSON.stringify({ ...cached, userId: 'owner' }), 'owner'),
  ).toMatchObject(cached);
  expect(
    cachedIdentitySession(JSON.stringify({ ...cached, userId: 'owner' }), 'viewer'),
  ).toBeNull();
  expect(cachedIdentitySession(JSON.stringify(cached), 'owner')).toBeNull();
  expect(cachedIdentitySession('{', 'owner')).toBeNull();
  expect(
    cachedIdentitySession(
      JSON.stringify({ ...cached, userId: 'owner', expiresAt: '2020-01-01T00:00:00Z' }),
      'owner',
    ),
  ).toBeNull();
});
