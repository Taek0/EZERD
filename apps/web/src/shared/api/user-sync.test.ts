import { afterEach, expect, it, vi } from 'vitest';
import { startUserSync } from './user-sync.js';
import {
  startNativeSyncSubscription,
  type NativeSyncEnvironment,
  type NativeSyncSocket,
} from '../../features/projects/native-sync-subscription.js';
class Socket implements NativeSyncSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  message(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}
const stops: (() => void)[] = [];
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  vi.useRealTimers();
});
function harness() {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const sockets: Socket[] = [];
  const listeners = new Set<() => void>();
  const env: NativeSyncEnvironment = {
    createSocket: () => {
      const socket = new Socket();
      sockets.push(socket);
      return socket;
    },
    now: Date.now,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout,
    listen: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  const invalidate = vi.fn();
  const recheckAccess = vi.fn();
  const transport = startUserSync({
    token: 'secret',
    baseUrl: 'https://example.test',
    environment: env,
    invalidate,
    recheckAccess,
  });
  stops.push(() => transport.stop());
  function project(id: string) {
    const refresh = vi.fn(async () => {});
    const stop = startNativeSyncSubscription({
      token: 'secret',
      baseUrl: 'https://example.test',
      projectId: id,
      getCurrentHead: () => ({ sequence: 0, databaseRevision: 0 }),
      refresh,
      accessChanged: vi.fn(),
      isOwnOperation: () => false,
      environment: transport.environment,
    });
    stops.push(stop);
    return { stop, refresh };
  }
  return { sockets, listeners, invalidate, recheckAccess, transport, project };
}
it('keeps one authenticated connection through gallery and project navigation and cleans up', async () => {
  const h = harness();
  h.sockets[0]!.onopen?.();
  expect(h.sockets[0]!.send).toHaveBeenCalledWith(JSON.stringify({ type: 'subscribe-user' }));
  h.sockets[0]!.message({ type: 'user-subscribed' });
  expect(h.invalidate).toHaveBeenCalledWith();
  const first = h.project('a');
  await vi.advanceTimersByTimeAsync(0);
  first.stop();
  expect(h.sockets[0]!.send).toHaveBeenCalledWith(
    JSON.stringify({ type: 'unsubscribe', projectId: 'a' }),
  );
  h.project('b');
  await vi.advanceTimersByTimeAsync(0);
  expect(h.sockets).toHaveLength(1);
  expect(h.sockets[0]!.close).not.toHaveBeenCalled();
  stops
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  expect(h.sockets[0]!.close).toHaveBeenCalledOnce();
  expect(h.listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
it('recovers initial and missed user changes after reconnect and ignores old sockets', async () => {
  const h = harness();
  const old = h.sockets[0]!;
  old.onopen?.();
  old.message({ type: 'user-change', resource: 'projects', workspaceId: 'workspace' });
  expect(h.invalidate).toHaveBeenCalledWith('projects', 'workspace');
  old.onclose?.({ code: 1006 });
  await vi.advanceTimersByTimeAsync(1000);
  const next = h.sockets[1]!;
  next.onopen?.();
  next.message({ type: 'user-subscribed' });
  expect(h.invalidate).toHaveBeenCalledTimes(2);
  old.message({ type: 'user-change', resource: 'notifications' });
  expect(h.invalidate).toHaveBeenCalledTimes(2);
});
it('resubscribes the project on the shared connection and retains HTTP head refresh', async () => {
  const h = harness();
  h.sockets[0]!.onopen?.();
  const project = h.project('a');
  await vi.advanceTimersByTimeAsync(0);
  h.sockets[0]!.onclose?.({ code: 1006 });
  await vi.advanceTimersByTimeAsync(1000);
  h.sockets[1]!.onopen?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.sockets).toHaveLength(2);
  expect(h.sockets[1]!.send).toHaveBeenCalledWith(
    JSON.stringify({ type: 'subscribe', projectId: 'a', notificationsOnly: true }),
  );
  h.sockets[1]!.message({ type: 'head', projectId: 'a', sequence: 1, databaseRevision: 0 });
  await vi.advanceTimersByTimeAsync(50);
  expect(project.refresh).toHaveBeenCalledOnce();
});
it('does not poll HTTP in a healthy idle gallery and recovers a half-open socket', async () => {
  const h = harness();
  h.sockets[0]!.onopen?.();
  for (let n = 0; n < 8; n++) {
    h.sockets[0]!.message({ type: 'heartbeat' });
    await vi.advanceTimersByTimeAsync(15000);
  }
  expect(h.invalidate).not.toHaveBeenCalled();
  expect(h.sockets).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(31000);
  expect(h.sockets).toHaveLength(2);
});
it('project authority invalidation unsubscribes without closing the user channel', async () => {
  const h = harness();
  h.sockets[0]!.onopen?.();
  h.project('a');
  await vi.advanceTimersByTimeAsync(0);
  h.sockets[0]!.message({ type: 'workspace-access-changed', workspaceId: 'workspace' });
  expect(h.sockets[0]!.send).toHaveBeenCalledWith(
    JSON.stringify({ type: 'unsubscribe', projectId: 'a' }),
  );
  expect(h.sockets[0]!.close).not.toHaveBeenCalled();
  h.sockets[0]!.message({ type: 'user-change', resource: 'workspaces' });
  expect(h.invalidate).toHaveBeenCalledWith('workspaces', undefined);
});
it('requests an authoritative check for a policy close in the gallery and ignores obsolete sockets', async () => {
  const h = harness();
  const old = h.sockets[0]!;
  old.onopen?.();
  old.onclose?.({ code: 1008 });
  expect(h.recheckAccess).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000);
  old.onclose?.({ code: 1008 });
  expect(h.recheckAccess).toHaveBeenCalledOnce();
  h.transport.stop();
  h.sockets[1]!.onclose?.({ code: 1008 });
  h.sockets[1]!.message({ type: 'user-change', resource: 'workspaces' });
  expect(h.recheckAccess).toHaveBeenCalledOnce();
  expect(h.invalidate).not.toHaveBeenCalled();
});
