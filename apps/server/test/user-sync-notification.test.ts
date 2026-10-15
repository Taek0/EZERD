import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { SyncGateway } from '../src/sync/sync.gateway.js';
import { WorkspaceEventsService } from '../src/workspace/workspace-events.service.js';
import { SpaceService } from '../src/workspace/space.service.js';

afterEach(() => vi.useRealTimers());

function setup() {
  vi.useFakeTimers();
  const events = new WorkspaceEventsService();
  const query = { from: vi.fn(), where: vi.fn(async () => [{ userId: 'member' }]) };
  query.from.mockReturnValue(query);
  const database = { db: { select: vi.fn(() => query) } };
  const sessions = {
    authenticateToken: vi.fn(async () => ({ id: 'member' })),
    onSessionRevoked: () => () => {},
  };
  const access = { requireProject: vi.fn(async () => ({ workspaceId: 'w' })) };
  const gateway = new SyncGateway(
    database as never,
    sessions as never,
    {} as never,
    access as never,
    events,
  );
  const internals = gateway as unknown as {
    connect(socket: unknown, actor: unknown, token: string): void;
    sendHeads(): Promise<void>;
  };
  function socket(userId: string, subscribed = true) {
    const ws = Object.assign(new EventEmitter(), {
      readyState: 1,
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    });
    internals.connect(ws, { id: userId }, 'token');
    if (subscribed) ws.emit('message', JSON.stringify({ type: 'subscribe-user' }));
    ws.send.mockClear();
    return ws;
  }
  return { events, gateway, database, internals, socket, access, query, sessions };
}

it('targets explicit invitation recipients including nonmembers, isolates other users and coalesces bursts', async () => {
  const { events, gateway, socket, database } = setup();
  const invited = socket('invitee');
  const unrelated = socket('other');
  const unsubscribed = socket('invitee', false);
  for (let i = 0; i < 20; i++)
    events.userChanged({ resource: 'invitations', userIds: ['invitee'], workspaceId: 'w' });
  await vi.advanceTimersByTimeAsync(25);
  expect(invited.send).toHaveBeenCalledExactlyOnceWith(
    JSON.stringify({ type: 'user-change', resource: 'invitations', workspaceId: 'w' }),
  );
  expect(unrelated.send).not.toHaveBeenCalled();
  expect(unsubscribed.send).not.toHaveBeenCalled();
  expect(database.db.select).not.toHaveBeenCalled();
  gateway.onApplicationShutdown();
});

it('sends workspace invalidations only to current members and keeps gallery heartbeat free of project polling', async () => {
  const { events, gateway, socket, database, internals } = setup();
  const member = socket('member');
  const other = socket('other');
  events.userChanged({ resource: 'projects', workspaceId: 'w' });
  await vi.advanceTimersByTimeAsync(25);
  expect(member.send).toHaveBeenCalledOnce();
  expect(other.send).not.toHaveBeenCalled();
  database.db.select.mockClear();
  await internals.sendHeads();
  expect(database.db.select).not.toHaveBeenCalled();
  expect(member.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'heartbeat' }));
  gateway.onApplicationShutdown();
});

it('preserves the user channel after project unsubscribe and closes slow consumers', async () => {
  const { events, gateway, socket } = setup();
  const ws = socket('member');
  ws.emit('message', JSON.stringify({ type: 'unsubscribe', projectId: 'p' }));
  expect(ws.send).toHaveBeenLastCalledWith(
    JSON.stringify({ type: 'unsubscribed', projectId: 'p' }),
  );
  events.userChanged({ resource: 'workspaces', userIds: ['member'] });
  await vi.advanceTimersByTimeAsync(25);
  expect(ws.send).toHaveBeenLastCalledWith(
    JSON.stringify({ type: 'user-change', resource: 'workspaces' }),
  );
  ws.bufferedAmount = 1024 * 1024 + 1;
  events.userChanged({ resource: 'notifications', userIds: ['member'] });
  await vi.advanceTimersByTimeAsync(25);
  expect(ws.close).toHaveBeenCalledWith(1008);
  gateway.onApplicationShutdown();
});

it('publishes queued workspace events only after successful commit, never after rollback', async () => {
  const events = new WorkspaceEventsService();
  const listener = vi.fn();
  events.onUserChanged(listener);
  const tx = {};
  let rollback = true;
  const service = new SpaceService(
    {
      db: {
        transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
          const result = await callback(tx);
          expect(listener).not.toHaveBeenCalled();
          if (rollback) throw new Error('rollback');
          return result;
        },
      },
    } as never,
    {} as never,
    events,
  );
  const internals = service as unknown as {
    transaction(callback: (tx: object) => Promise<string>): Promise<string>;
    pendingEvents: WeakMap<object, unknown[]>;
  };
  const mutation = async (executor: object) => {
    internals.pendingEvents.get(executor)!.push({ resource: 'invitations', userIds: ['invitee'] });
    return 'ok';
  };
  await expect(internals.transaction(mutation)).rejects.toThrow('rollback');
  expect(listener).not.toHaveBeenCalled();
  rollback = false;
  await expect(internals.transaction(mutation)).resolves.toBe('ok');
  expect(listener).toHaveBeenCalledExactlyOnceWith({
    resource: 'invitations',
    userIds: ['invitee'],
  });
});

it('cancels an in-flight project subscription on navigation and never polls its head', async () => {
  const { gateway, socket, access, database, query, internals } = setup();
  const ws = socket('member');
  let grant!: (value: { workspaceId: string }) => void;
  access.requireProject.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  );
  query.where.mockResolvedValue([{ status: 'active', sequence: 0, databaseRevision: 0 }] as never);
  ws.emit('message', JSON.stringify({ type: 'subscribe', projectId: 'p' }));
  ws.emit('message', JSON.stringify({ type: 'unsubscribe', projectId: 'p' }));
  grant({ workspaceId: 'w' });
  await vi.advanceTimersByTimeAsync(0);
  expect(ws.send.mock.calls.map(([message]) => JSON.parse(message).type)).toEqual(['unsubscribed']);
  database.db.select.mockClear();
  await internals.sendHeads();
  expect(database.db.select).not.toHaveBeenCalled();
  gateway.onApplicationShutdown();
});

it('revalidates expired gallery sessions and removes them from user delivery', async () => {
  const { gateway, socket, sessions, internals, events } = setup();
  const ws = socket('member');
  sessions.authenticateToken.mockRejectedValueOnce(new Error('expired'));
  await vi.advanceTimersByTimeAsync(60_001);
  await internals.sendHeads();
  expect(ws.close).toHaveBeenCalledWith(1008);
  events.userChanged({ resource: 'notifications', userIds: ['member'] });
  await vi.advanceTimersByTimeAsync(25);
  expect(ws.send).not.toHaveBeenCalled();
  gateway.onApplicationShutdown();
});
