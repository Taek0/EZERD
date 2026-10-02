import { nativeTestDeferred } from './native-durable-test-environment.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NativeDurableQueue,
  nativeDurableId,
  type NativeDurablePending,
} from './native-durable-queue.js';
import { createNativeTestIndexedDB } from './native-durable-test-environment.js';

const queues: NativeDurableQueue[] = [];
afterEach(async () => {
  for (const queue of queues.splice(0)) await queue.close();
  vi.unstubAllGlobals();
});
const entry = (
  kind: NativeDurablePending['kind'] = 'commands',
  userId = 'actor',
  projectId = 'project',
): NativeDurablePending => ({
  userId,
  projectId,
  kind,
  operationId: nativeDurableId(),
  payload: { request: { literal: '-unfinished', large: '9007199254740993' } },
});
function pair() {
  const factory = createNativeTestIndexedDB(),
    name = nativeDurableId();
  const a = new NativeDurableQueue(factory, name),
    b = new NativeDurableQueue(factory, name);
  queues.push(a, b);
  return { a, b, factory, name };
}
describe('native IndexedDB transaction claims across two connections', () => {
  it('fences private CAS resolution by the exact live transmission and preserves uncertain input on failure', async () => {
    const { a, b } = pair(),
      pending = entry('privateCanvas');
    await a.claim(pending);
    const token = await a.beginTransmission(pending),
      archive = vi.fn();
    expect(await b.confirmPrivateCASPreconditionConsumed(pending, token, archive)).toBe(false);
    expect(
      await a.confirmPrivateCASPreconditionConsumed(
        { ...pending, payload: { changed: true } },
        token,
        archive,
      ),
    ).toBe(false);
    expect(archive).not.toHaveBeenCalled();
    await expect(
      a.confirmPrivateCASPreconditionConsumed(pending, token, () => {
        throw Error('archive denied');
      }),
    ).rejects.toThrow('archive denied');
    await a.endTransmission(pending, token);
    await expect(a.discard(pending)).rejects.toThrow('native.transmission-unknown');
    const second = await b.beginTransmission(pending);
    expect(await a.confirmPrivateCASPreconditionConsumed(pending, token, archive)).toBe(false);
    expect(await b.confirmPrivateCASPreconditionConsumed(pending, second, archive)).toBe(true);
    expect(archive).toHaveBeenCalledOnce();
    await b.endTransmission(pending, second);
    expect(await b.discard(pending)).toBe(true);
    expect(await a.read(pending.userId, pending.projectId)).toBeNull();
  });
  it('does not apply a private CAS observation to command or upgrade requests', async () => {
    for (const kind of ['commands', 'history', 'upgrade'] as const) {
      const { a } = pair(),
        pending = entry(kind);
      await a.claim(pending);
      const token = await a.beginTransmission(pending);
      expect(await a.confirmPrivateCASPreconditionConsumed(pending, token)).toBe(false);
      await a.endTransmission(pending, token);
      await expect(a.discard(pending)).rejects.toThrow('native.transmission-unknown');
    }
  });
  it('requires a nonexpired private proof lease even if its token remains stored', async () => {
    let time = 0;
    const a = new NativeDurableQueue(createNativeTestIndexedDB(), nativeDurableId(), {
      now: () => time,
      leaseMs: 10,
    });
    queues.push(a);
    const pending = entry('privateCanvas');
    await a.claim(pending);
    const token = await a.beginTransmission(pending),
      archive = vi.fn();
    time = 11;
    expect(await a.confirmPrivateCASPreconditionConsumed(pending, token, archive)).toBe(false);
    expect(archive).not.toHaveBeenCalled();
    await a.endTransmission(pending, token);
    await expect(a.discard(pending)).rejects.toThrow('native.transmission-unknown');
  });
  it('allows exactly one actor/project pending across command/history/private canvas racers', async () => {
    const { a, b } = pair();
    const first = entry('commands'),
      second = entry('history'),
      third = entry('privateCanvas'),
      fourth = entry('upgrade');
    const results = await Promise.allSettled([
      a.claim(first),
      b.claim(second),
      b.claim(third),
      a.claim(fourth),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(3);
    expect(await a.read('actor', 'project')).toEqual(await b.read('actor', 'project'));
    expect(await b.read('actor', 'project')).toEqual(first);
  });
  it('keeps a format-v1 upgrade in the same actor/project lock without changing its immutable payload', async () => {
    const { a, b } = pair(),
      value = entry('upgrade');
    value.payload = {
      sourceFormatVersion: 1,
      request: { operationId: value.operationId, databaseRevision: 0 },
    };
    await a.claim(value);
    await expect(b.claim(entry('commands'))).rejects.toThrow('native.pending-exists');
    await expect(b.claim(entry('history'))).rejects.toThrow('native.pending-exists');
    const token = await b.beginTransmission(value);
    expect(await a.read('actor', 'project')).toEqual(value);
    await b.endTransmission(value, token);
    await expect(a.discard(value)).rejects.toThrow('native.transmission-unknown');
    await a.acknowledge(value);
  });
  it('commits a complete immutable request before any transmission and refuses mutation', async () => {
    const { a, b } = pair(),
      value = entry();
    await a.claim(value);
    value.payload = { request: { literal: 'changed' } };
    await expect(b.beginTransmission(value)).rejects.toThrow('native.pending-changed');
    expect((await a.read('actor', 'project'))!.payload).toEqual({
      request: { literal: '-unfinished', large: '9007199254740993' },
    });
  });
  it('does not allow concurrent API transmit claims or expiry-based stealing', async () => {
    const { a, b } = pair(),
      value = entry();
    await a.claim(value);
    const claims = await Promise.allSettled([
      a.beginTransmission(value),
      b.beginTransmission(value),
    ]);
    expect(claims.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(b.discard(value)).rejects.toThrow('native.transmission-busy');
    await b.endTransmission(value, 'wrong-token');
    await expect(b.beginTransmission(value)).rejects.toThrow('native.transmission-busy');
    const token = (claims.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<string>)
      .value;
    await a.endTransmission(value, token);
    expect(typeof (await b.beginTransmission(value))).toBe('string');
  });
  it('ACK matching preserves a replacement and ignores old transmission finalizers', async () => {
    const { a, b } = pair(),
      old = entry(),
      next = entry('history');
    await a.claim(old);
    const token = await a.beginTransmission(old);
    expect(await b.acknowledge({ ...old, operationId: 'wrong' })).toBe(false);
    expect(await b.acknowledge(old)).toBe(true);
    await b.claim(next);
    await a.endTransmission(old, token);
    expect(await a.read('actor', 'project')).toEqual(next);
    expect(await a.acknowledge(old)).toBe(false);
  });
  it('aborts a failed guard before commit and never reports an empty durable success', async () => {
    const { a, b } = pair(),
      value = entry();
    await expect(
      a.claim(value, () => {
        throw Error('Quota');
      }),
    ).rejects.toThrow('Quota');
    expect(a.state('actor', 'project')).toBe('unknown');
    expect(await b.read('actor', 'project')).toBeNull();
    await b.claim(value);
    expect(await a.read('actor', 'project')).toEqual(value);
  });
  it('isolates actor/project and keeps pending across connection teardown/reopen', async () => {
    const { a, b, factory, name } = pair(),
      value = entry();
    await a.claim(value);
    await a.close();
    await b.claim(entry('history', 'other', 'project'));
    await b.claim(entry('privateCanvas', 'actor', 'other'));
    const reopened = new NativeDurableQueue(factory, name);
    queues.push(reopened);
    expect(await reopened.read('actor', 'project')).toEqual(value);
    expect(await reopened.read('other', 'project')).not.toBeNull();
  });
  it('replays only the same immutable pending after a crashed connection lease expires', async () => {
    const factory = createNativeTestIndexedDB(),
      name = nativeDurableId();
    let now = 1000;
    const a = new NativeDurableQueue(factory, name, {
        now: () => now,
        leaseMs: 100,
        ownerId: 'tab-a',
      }),
      b = new NativeDurableQueue(factory, name, {
        now: () => now,
        leaseMs: 100,
        ownerId: 'tab-b',
      });
    queues.push(a, b);
    const value = entry();
    await a.claim(value);
    const oldToken = await a.beginTransmission(value);
    await a.close();
    await expect(b.beginTransmission(value)).rejects.toThrow('native.transmission-busy');
    now = 1101;
    expect(await b.read('actor', 'project')).toEqual(value);
    expect(b.state('actor', 'project')).toBe('unknown');
    await expect(b.claim(entry('history'))).rejects.toThrow('native.pending-exists');
    await expect(b.discard(value)).rejects.toThrow('native.transmission-unknown');
    await expect(b.beginTransmission({ ...value, payload: { changed: true } })).rejects.toThrow(
      'native.pending-changed',
    );
    const newToken = await b.beginTransmission(value);
    expect(newToken).not.toBe(oldToken);
    await a.endTransmission(value, oldToken);
    expect(await a.renewTransmission(value, oldToken)).toBe(false);
    await expect(a.beginTransmission(value)).rejects.toThrow('native.transmission-busy');
    await b.endTransmission(value, newToken);
    await expect(b.discard(value)).rejects.toThrow('native.transmission-unknown');
    expect(await b.acknowledge(value)).toBe(true);
    expect(await a.read('actor', 'project')).toBeNull();
  });
  it('uses crypto.getRandomValues when LAN HTTP does not expose randomUUID', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    expect(nativeDurableId()).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
    );
  });
  it('refreshes another connection from a BroadcastChannel invalidation rather than trusting its payload', async () => {
    vi.stubGlobal('window', new EventTarget());
    const { a, b } = pair(),
      value = entry();
    await b.read('actor', 'project');
    const pending = nativeTestDeferred<void>();
    const unsubscribe = b.subscribe('actor', 'project', () => {
      if (b.state('actor', 'project') === 'pending') pending.resolve();
    });
    await a.claim(value);
    await pending.promise;
    expect(await b.read('actor', 'project')).toEqual(value);
    unsubscribe();
  });
});
