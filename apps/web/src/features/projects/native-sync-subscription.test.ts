import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  nativeSyncSocketUrl,
  startNativeSyncSubscription,
  type NativeSyncEnvironment,
  type NativeSyncHead,
  type NativeSyncSocket,
} from './native-sync-subscription.js';

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
const ownId = '11111111-1111-4111-8111-111111111111';
const foreignId = '22222222-2222-4222-8222-222222222222';
const head = (sequence: number, databaseRevision = 0) => ({
  type: 'head',
  projectId: 'project',
  sequence,
  databaseRevision,
});
const operation = (sequence: number, operationId = foreignId) => ({
  type: 'operation',
  projectId: 'project',
  event: { protocolVersion: 2, status: 'accepted', operationId, sequence, databaseRevision: 0 },
});
function harness() {
  let current: NativeSyncHead = { sequence: 1, databaseRevision: 0 };
  let wake: (() => void) | undefined;
  const sockets: Socket[] = [];
  const unlisten = vi.fn();
  const createSocket = vi.fn(() => {
    const socket = new Socket();
    sockets.push(socket);
    return socket;
  });
  const environment: NativeSyncEnvironment = {
    createSocket,
    now: Date.now,
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (timer) => clearTimeout(timer),
    listen: (callback) => {
      wake = callback;
      return unlisten;
    },
  };
  const refresh = vi.fn(async () => {});
  const accessChanged = vi.fn();
  const stop = startNativeSyncSubscription({
    projectId: 'project',
    workspaceId: 'workspace',
    token: 'secret',
    baseUrl: 'https://example.test',
    getCurrentHead: () => current,
    refresh,
    accessChanged,
    isOwnOperation: (id) => id === ownId,
    environment,
  });
  return {
    sockets,
    createSocket,
    unlisten,
    refresh,
    accessChanged,
    stop,
    setHead: (head: NativeSyncHead) => {
      current = head;
    },
    wake: () => wake?.(),
  };
}
const stops: (() => void)[] = [];
const start = () => {
  const value = harness();
  stops.push(value.stop);
  return value;
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('native notification subscription', () => {
  it('does not poll full documents while current head notifications remain healthy', async () => {
    const h = start();
    for (let index = 0; index < 5; index++) {
      await vi.advanceTimersByTimeAsync(14000);
      h.sockets[0]!.message(head(1));
    }
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.sockets).toHaveLength(1);
  });
  it('skips a queued invalidation if an HTTP ACK already contains that newer state', async () => {
    const h = start();
    h.sockets[0]!.message(operation(2));
    h.setHead({ sequence: 3, databaseRevision: 0 });
    await vi.advanceTimersByTimeAsync(50);
    expect(h.refresh).not.toHaveBeenCalled();
  });
  it('builds secure proxy URLs and subscribes on open, then disposes once', async () => {
    expect(nativeSyncSocketUrl('https://example.test/proxy/?old=1#fragment', 'a &b')).toBe(
      'wss://example.test/proxy/api/sync?token=a+%26b',
    );
    expect(nativeSyncSocketUrl('http://localhost:3000', 'token')).toBe(
      'ws://localhost:3000/api/sync?token=token',
    );
    const h = start();
    h.sockets[0]!.onopen?.();
    expect(h.sockets[0]!.send).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ type: 'subscribe', projectId: 'project', notificationsOnly: true }),
    );
    h.sockets[0]!.message(head(2));
    h.stop();
    h.stop();
    h.wake();
    h.sockets[0]!.onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.unlisten).toHaveBeenCalledOnce();
    expect(h.sockets[0]!.close).toHaveBeenCalledOnce();
    expect(h.sockets).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('ignores malformed, foreign-project, rejected, and legacy frames', async () => {
    const h = start(),
      socket = h.sockets[0]!;
    socket.onmessage?.({ data: 'invalid JSON' });
    socket.onmessage?.({ data: { sequence: 99 } });
    for (const frame of [
      null,
      [],
      { ...head(2), projectId: 'other' },
      head(-1),
      head(1.2),
      head(2, -1),
      { ...head(2), databaseRevision: undefined },
      { ...operation(2), event: { ...operation(2).event, status: 'rejected' } },
      { ...operation(2), event: { ...operation(2).event, protocolVersion: 1 } },
      { ...operation(2), event: { ...operation(2).event, operationId: 'bad' } },
      { type: 'review', projectId: 'project', sequence: 2 },
    ])
      socket.message(frame);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.refresh).not.toHaveBeenCalled();
  });
  it('coalesces head bursts and duplicates, and ignores heads already applied', async () => {
    const h = start(),
      socket = h.sockets[0]!;
    socket.message(operation(2));
    socket.message(operation(2));
    socket.message(head(3));
    socket.message(head(4));
    await vi.advanceTimersByTimeAsync(50);
    expect(h.refresh).toHaveBeenCalledOnce();
    h.setHead({ sequence: 4, databaseRevision: 0 });
    socket.message(operation(2));
    socket.message(head(4));
    socket.message(head(3));
    await vi.advanceTimersByTimeAsync(100);
    expect(h.refresh).toHaveBeenCalledOnce();
    socket.message(head(4, 1));
    await vi.advanceTimersByTimeAsync(50);
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });
  it('lets own HTTP ACK update the head during the echo grace period', async () => {
    const h = start();
    h.sockets[0]!.message(operation(2, ownId));
    await vi.advanceTimersByTimeAsync(500);
    expect(h.refresh).not.toHaveBeenCalled();
    h.setHead({ sequence: 2, databaseRevision: 0 });
    await vi.advanceTimersByTimeAsync(1600);
    expect(h.refresh).not.toHaveBeenCalled();
  });
  it('refreshes when own ACK never arrives and never delays a foreign edit behind own grace', async () => {
    const h = start();
    h.sockets[0]!.message(operation(2, ownId));
    await vi.advanceTimersByTimeAsync(2100);
    expect(h.refresh).toHaveBeenCalledOnce();
    h.sockets[0]!.message(operation(3, '33333333-3333-4333-8333-333333333333'));
    await vi.advanceTimersByTimeAsync(50);
    expect(h.refresh).toHaveBeenCalledTimes(2);
    h.stop();
    const next = start();
    next.sockets[0]!.message(operation(2, ownId));
    await vi.advanceTimersByTimeAsync(100);
    next.sockets[0]!.message(operation(3));
    await vi.advanceTimersByTimeAsync(50);
    expect(next.refresh).toHaveBeenCalledOnce();
  });
  it('queues only one follow-up while a refresh is running', async () => {
    const h = start();
    let finish!: () => void;
    h.refresh.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    h.sockets[0]!.message(head(2));
    await vi.advanceTimersByTimeAsync(50);
    h.sockets[0]!.message(head(3));
    h.sockets[0]!.message(head(4));
    await vi.advanceTimersByTimeAsync(100);
    expect(h.refresh).toHaveBeenCalledOnce();
    finish();
    await vi.advanceTimersByTimeAsync(50);
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });
  it('reconnects with backoff and catches up from the subscribed head', async () => {
    const h = start();
    h.sockets[0]!.onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(999);
    expect(h.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1]!.onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(1999);
    expect(h.sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sockets).toHaveLength(3);
    h.sockets[2]!.message({ ...head(8), type: 'subscribed' });
    await vi.advanceTimersByTimeAsync(50);
    expect(h.refresh).toHaveBeenCalledOnce();
    h.sockets[0]!.message(head(99));
    await vi.advanceTimersByTimeAsync(100);
    expect(h.refresh).toHaveBeenCalledOnce();
    h.sockets[2]!.onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sockets).toHaveLength(4);
  });
  it('recovers socket errors and reconnects immediately on online/focus', async () => {
    const h = start();
    h.sockets[0]!.onerror?.();
    expect(h.sockets[0]!.close).toHaveBeenCalledOnce();
    h.wake();
    expect(h.sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(50);
    expect(h.refresh).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sockets).toHaveLength(2);
  });
  it('periodically refreshes missed notifications and replaces silent sockets', async () => {
    const h = start();
    await vi.advanceTimersByTimeAsync(30_050);
    expect(h.refresh).toHaveBeenCalledOnce();
    expect(h.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.refresh).toHaveBeenCalledTimes(2);
    expect(h.sockets[0]!.close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(950);
    expect(h.sockets).toHaveLength(2);
  });
  it.each(['policy', 'workspace'])(
    'stops and reports access exactly once after %s denial',
    async (reason) => {
      const h = start();
      if (reason === 'policy') h.sockets[0]!.onclose?.({ code: 1008 });
      else {
        h.sockets[0]!.message({ type: 'workspace-access-changed', workspaceId: 'other' });
        expect(h.accessChanged).not.toHaveBeenCalled();
        h.sockets[0]!.message({ type: 'workspace-access-changed', workspaceId: 'workspace' });
      }
      h.sockets[0]!.onclose?.({ code: 1008 });
      h.wake();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(h.accessChanged).toHaveBeenCalledOnce();
      expect(h.sockets).toHaveLength(1);
      expect(h.refresh).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it('adapts browser events without relying on WebSocket callback signatures', async () => {
    const events = new Map<string, (event?: any) => void>();
    const send = vi.fn(),
      close = vi.fn(),
      removeEventListener = vi.fn();
    vi.stubGlobal(
      'WebSocket',
      class {
        send = send;
        close = close;
        addEventListener(name: string, callback: (event: any) => void) {
          events.set(name, callback);
        }
      },
    );
    vi.stubGlobal('window', {
      location: { origin: 'https://example.test' },
      addEventListener: vi.fn(),
      removeEventListener,
    });
    const refresh = vi.fn(async () => {}),
      accessChanged = vi.fn();
    const stop = startNativeSyncSubscription({
      projectId: 'project',
      token: 'token',
      getCurrentHead: () => ({ sequence: 1, databaseRevision: 0 }),
      refresh,
      accessChanged,
      isOwnOperation: () => false,
    });
    stops.push(stop);
    events.get('open')?.();
    expect(send).toHaveBeenCalledOnce();
    events.get('message')?.({ data: JSON.stringify(head(2)) });
    await vi.advanceTimersByTimeAsync(50);
    expect(refresh).toHaveBeenCalledOnce();
    events.get('close')?.({ code: 1008 });
    expect(accessChanged).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledTimes(2);
  });
});
