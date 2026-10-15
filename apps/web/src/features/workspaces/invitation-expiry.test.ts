import { afterEach, expect, it, vi } from 'vitest';
import { watchInvitationExpiry } from './invitation-expiry.js';
afterEach(() => vi.useRealTimers());
it('rerenders once per upcoming expiry and cancels its only timer on cleanup', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const expire = vi.fn();
  const stop = watchInvitationExpiry(
    [
      { status: 'pending', expiresAt: new Date(1000).toISOString() },
      { status: 'pending', expiresAt: new Date(2000).toISOString() },
      { status: 'accepted', expiresAt: new Date(500).toISOString() },
    ],
    expire,
  );
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(expire).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(1);
  stop();
  await vi.advanceTimersByTimeAsync(2000);
  expect(expire).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
