import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureNativeActorApi } from './native-actor-api.js';
import { request } from '../../shared/api/client.js';
const actor = '00000000-0000-4000-8000-000000000001',
  other = '00000000-0000-4000-8000-000000000002';
function session(userId = actor, token = 'test-token-a') {
  return JSON.stringify({
    userId,
    token,
    expiresAt: '2099-01-01T00:00:00Z',
    baselineIssuedAt: '2026-10-02T00:00:00Z',
  });
}
afterEach(() => vi.unstubAllGlobals());
describe('native default transport pins actor and authentication before awaits', () => {
  it('refuses a wrong actor, missing/expired session or inaccessible session storage before fetch', () => {
    const fetcher = vi.fn();
    for (const raw of [
      session(other),
      null,
      '{broken',
      JSON.stringify({ userId: actor, token: 'token', expiresAt: '2000-01-01T00:00:00Z' }),
    ]) {
      expect(() =>
        captureNativeActorApi(actor, request, {
          sessionStorage: { getItem: () => raw },
          fetcher: fetcher as typeof fetch,
        }),
      ).toThrow();
    }
    expect(() =>
      captureNativeActorApi(actor, request, {
        sessionStorage: {
          getItem() {
            throw Error('Denied');
          },
        },
        fetcher: fetcher as typeof fetch,
      }),
    ).toThrow('native.actor-session-unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not POST after account switching or same-account credential replacement during await', async () => {
    let raw = session();
    const fetcher = vi.fn(),
      storage = { getItem: () => raw };
    const bound = captureNativeActorApi(actor, request, {
      sessionStorage: storage,
      fetcher: fetcher as typeof fetch,
    });
    await Promise.resolve();
    raw = session(other, 'test-token-b');
    await expect(bound('/mutation', { method: 'POST' })).rejects.toThrow('native.actor-mismatch');
    raw = session(actor, 'replacement-token');
    await expect(bound('/mutation', { method: 'POST' })).rejects.toThrow(
      'native.actor-session-changed',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('overrides caller/live client auth with the captured actor auth for Headers/tuple/object inputs', async () => {
    const captured = { getItem: () => session() },
      fetcher = vi.fn().mockImplementation(async () => new Response('{"ok":true}'));
    vi.stubGlobal('sessionStorage', { getItem: () => session(other, 'test-token-b') });
    const bound = captureNativeActorApi(actor, request, {
      sessionStorage: captured,
      fetcher: fetcher as typeof fetch,
    });
    for (const headers of [
      new Headers({ authorization: 'wrong' }),
      [['authorization', 'wrong']] as [string, string][],
      { Authorization: 'wrong' },
    ]) {
      await bound('/mutation', { method: 'POST', headers, body: '{"operationId":"stable"}' });
    }
    for (const call of fetcher.mock.calls) {
      expect(new Headers(call[1].headers).get('Authorization')).toBe('Bearer test-token-a');
      expect(call[1].body).toBe('{"operationId":"stable"}');
    }
    expect(JSON.stringify(bound)).toBeUndefined();
  });
  it('checks again at the real fetch boundary when client auth lookup changes the session', async () => {
    let reads = 0;
    const fetcher = vi.fn();
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        reads++;
        return reads <= 2 ? session() : session(other, 'test-token-b');
      },
    });
    const bound = captureNativeActorApi(actor, request, { fetcher: fetcher as typeof fetch });
    await expect(bound('/mutation', { method: 'POST' })).rejects.toThrow('native.actor-mismatch');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('treats an explicit injected actor-bound API as authority without accessing session storage', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem() {
        throw Error('Denied');
      },
    });
    const api = vi.fn().mockResolvedValue({ ok: true });
    expect(captureNativeActorApi(actor, api as typeof request)).toBe(api);
  });
});
