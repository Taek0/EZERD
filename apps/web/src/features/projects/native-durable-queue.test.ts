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
    for (const kind of ['commands', 'history', 'upgrade', 'databaseChange'] as const) {
      const { a } = pair(),
        pending = entry(kind);
      await a.claim(pending);
      const token = await a.beginTransmission(pending),
        guard = vi.fn();
      expect(await a.confirmPrivateCASPreconditionConsumed(pending, token, guard)).toBe(false);
      expect(guard).not.toHaveBeenCalled();
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
  it('allows exactly one actor/project pending across all five native writers', async () => {
    const { a, b } = pair();
    const first = entry('commands'),
      second = entry('history'),
      third = entry('privateCanvas'),
      fourth = entry('upgrade'),
      fifth = entry('databaseChange');
    const results = await Promise.allSettled([
      a.claim(first),
      b.claim(second),
      b.claim(third),
      a.claim(fourth),
      b.claim(fifth),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(4);
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

describe('databaseChange shares every native writer fence', () => {
  function change(): NativeDurablePending {
    const value = entry('databaseChange');
    value.payload = {
      input: {
        operationId: value.operationId,
        targetKind: 'mysql',
        expectedVersion: 7,
        expectedSequence: 11,
        expectedDatabaseRevision: 2,
      },
      sourceDatabase: { kind: 'postgresql', profileId: 'postgresql-18-v1' },
    };
    return value;
  }
  it.each(['commands', 'history', 'privateCanvas', 'upgrade'] as const)(
    'serializes databaseChange vs %s competing claims in both orders',
    async (kind) => {
      for (const databaseFirst of [true, false]) {
        const { a, b } = pair(),
          database = change(),
          other = entry(kind);
        const candidates = databaseFirst ? [database, other] : [other, database];
        const results = await Promise.allSettled([
          a.claim(candidates[0]!),
          b.claim(candidates[1]!),
        ]);
        expect(results.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
        const failure = results.find(
          (value) => value.status === 'rejected',
        ) as PromiseRejectedResult;
        expect(failure.reason).toMatchObject({ message: 'native.pending-exists' });
        const stored = await a.read('actor', 'project');
        expect(candidates).toContainEqual(stored);
        expect(await b.read('actor', 'project')).toEqual(stored);
        const loser = stored!.kind === 'databaseChange' ? other : database;
        await expect(b.beginTransmission(loser)).rejects.toThrow('native.pending-changed');
        expect(await b.acknowledge(loser)).toBe(false);
        expect(await a.read('actor', 'project')).toEqual(stored);
      }
    },
  );
  it('preserves exact DB-change payload across reopen and rejects alias, target/counter/operation and actor changes', async () => {
    const { a, b, factory, name } = pair(),
      pending = change(),
      original = structuredClone(pending);
    await a.claim(pending);
    (pending.payload as { input: { targetKind: string } }).input.targetKind = 'sqlite';
    await a.close();
    const reopened = new NativeDurableQueue(factory, name);
    queues.push(reopened);
    expect(await reopened.read('actor', 'project')).toEqual(original);
    await expect(reopened.beginTransmission(pending)).rejects.toThrow('native.pending-changed');
    for (const changed of [
      { ...original, kind: 'commands' as const },
      { ...original, operationId: nativeDurableId() },
      {
        ...original,
        payload: {
          ...(original.payload as object),
          input: { targetKind: 'mysql', expectedVersion: 8 },
        },
      },
    ]) {
      await expect(reopened.claim(changed, undefined, true)).rejects.toThrow(
        'native.pending-exists',
      );
      expect(await reopened.confirmRejected(changed)).toBe(false);
      expect(await reopened.acknowledge(changed)).toBe(false);
    }
    expect(await reopened.acknowledge({ ...original, userId: 'another-actor' })).toBe(false);
    expect(await reopened.acknowledge({ ...original, projectId: 'another-project' })).toBe(false);
    expect(await b.read('actor', 'project')).toEqual(original);
    const token = await reopened.beginTransmission(original);
    const archive = vi.fn();
    expect(await reopened.confirmPrivateCASPreconditionConsumed(original, token, archive)).toBe(
      false,
    );
    expect(archive).not.toHaveBeenCalled();
    await reopened.endTransmission(original, token);
    await expect(reopened.discard(original)).rejects.toThrow('native.transmission-unknown');
    expect(await b.acknowledge(original)).toBe(true);
    const replacement = change();
    await b.claim(replacement);
    await reopened.endTransmission(original, token);
    expect(await reopened.acknowledge(original)).toBe(false);
    expect(await reopened.read('actor', 'project')).toEqual(replacement);
  });
  it('keeps crashed DB-change request uncertain on reload and replays only it after lease expiry', async () => {
    const factory = createNativeTestIndexedDB(),
      name = nativeDurableId();
    let now = 1000;
    const a = new NativeDurableQueue(factory, name, {
        now: () => now,
        leaseMs: 100,
        ownerId: 'old-tab',
      }),
      b = new NativeDurableQueue(factory, name, {
        now: () => now,
        leaseMs: 100,
        ownerId: 'new-tab',
      });
    queues.push(a, b);
    const pending = change();
    await a.claim(pending);
    const oldToken = await a.beginTransmission(pending);
    await a.close();
    expect(await b.read('actor', 'project')).toEqual(pending);
    expect(b.state('actor', 'project')).toBe('sending');
    await expect(b.beginTransmission(pending)).rejects.toThrow('native.transmission-busy');
    now = 1101;
    expect(await b.read('actor', 'project')).toEqual(pending);
    expect(b.state('actor', 'project')).toBe('unknown');
    await expect(b.discard(pending)).rejects.toThrow('native.transmission-unknown');
    for (const kind of [
      'commands',
      'history',
      'privateCanvas',
      'upgrade',
      'databaseChange',
    ] as const)
      await expect(b.claim(entry(kind))).rejects.toThrow('native.pending-exists');
    await expect(
      b.beginTransmission({ ...pending, payload: { input: { targetKind: 'sqlite' } } }),
    ).rejects.toThrow('native.pending-changed');
    const resumed = await b.beginTransmission(pending);
    expect(resumed).not.toBe(oldToken);
    await a.endTransmission(pending, oldToken);
    expect(await a.renewTransmission(pending, oldToken)).toBe(false);
    await expect(a.beginTransmission(pending)).rejects.toThrow('native.transmission-busy');
    const release = vi.fn();
    expect(await b.confirmPrivateCASPreconditionConsumed(pending, resumed, release)).toBe(false);
    expect(release).not.toHaveBeenCalled();
    await b.endTransmission(pending, resumed);
    await expect(b.discard(pending)).rejects.toThrow('native.transmission-unknown');
    expect(await b.confirmRejected(pending)).toBe(true); // caller already validated a terminal endpoint rejection
    expect(await b.discard(pending)).toBe(true);
    expect(await a.read('actor', 'project')).toBeNull();
  });
  it('allows the new runtime kind but rejects unknown kinds at transactional admission', async () => {
    const { a, b } = pair(),
      pending = change();
    await a.claim(pending);
    expect(await b.read('actor', 'project')).toEqual(pending);
    const { a: invalid, b: reader } = pair();
    await expect(
      invalid.claim({ ...pending, kind: 'unregistered-change' } as unknown as NativeDurablePending),
    ).rejects.toThrow('native.pending-storage-unknown');
    expect(invalid.state('actor', 'project')).toBe('unknown');
    expect(await reader.read('actor', 'project')).toBeNull();
  });
});

describe('databaseChange no-new-mutation precondition proof fence', () => {
  function timedPair() {
    const factory = createNativeTestIndexedDB(),
      name = nativeDurableId();
    let time = 1000;
    const a = new NativeDurableQueue(factory, name, {
        now: () => time,
        leaseMs: 100,
        ownerId: 'proof-owner-a',
      }),
      b = new NativeDurableQueue(factory, name, {
        now: () => time,
        leaseMs: 100,
        ownerId: 'proof-owner-b',
      });
    queues.push(a, b);
    return {
      a,
      b,
      factory,
      name,
      advance: (value: number) => {
        time = value;
      },
    };
  }
  const change = () => {
    const pending = entry('databaseChange');
    pending.payload = {
      input: {
        operationId: pending.operationId,
        targetKind: 'mysql',
        expectedVersion: 7,
        expectedSequence: 11,
        expectedDatabaseRevision: 2,
      },
    };
    return pending;
  };
  it('archives once under the live owner fence, retains original row and only enables explicit discard after end', async () => {
    const { a, b } = timedPair(),
      pending = change(),
      archive = new Map<string, string>();
    await a.claim(pending);
    const token = await a.beginTransmission(pending);
    const guard = vi.fn(() => {
      archive.set(pending.operationId, JSON.stringify(pending));
      expect(archive.get(pending.operationId)).toBe(JSON.stringify(pending));
    });
    expect(await b.confirmDatabaseChangePreconditionConsumed(pending, token, guard)).toBe(false);
    expect(guard).not.toHaveBeenCalled();
    // Competing transactions on the same owner/token may consume its uncertainty just once.
    const outcomes = await Promise.all([
      a.confirmDatabaseChangePreconditionConsumed(pending, token, guard),
      a.confirmDatabaseChangePreconditionConsumed(pending, token, guard),
    ]);
    expect(outcomes.sort()).toEqual([false, true]);
    expect(guard).toHaveBeenCalledOnce();
    expect(await b.read('actor', 'project')).toEqual(pending);
    expect(b.state('actor', 'project')).toBe('sending');
    await expect(b.discard(pending)).rejects.toThrow('native.transmission-busy');
    await a.endTransmission(pending, token);
    expect(await b.read('actor', 'project')).toEqual(pending);
    expect(b.state('actor', 'project')).toBe('pending');
    expect(await b.discard(pending)).toBe(true);
    expect(await a.read('actor', 'project')).toBeNull();
    expect(JSON.parse(archive.get(pending.operationId)!)).toEqual(pending);
  });
  it.each(['commands', 'history', 'privateCanvas', 'upgrade'] as const)(
    'cannot release %s through a DB-change proof or run its archive guard',
    async (kind) => {
      const { a, b } = timedPair(),
        pending = entry(kind),
        guard = vi.fn();
      await a.claim(pending);
      const token = await a.beginTransmission(pending);
      expect(await a.confirmDatabaseChangePreconditionConsumed(pending, token, guard)).toBe(false);
      expect(guard).not.toHaveBeenCalled();
      await a.endTransmission(pending, token);
      await expect(b.discard(pending)).rejects.toThrow('native.transmission-unknown');
      expect(await b.read('actor', 'project')).toEqual(pending);
    },
  );
  it('never runs the proof for altered exact payload/op/kind/actor/project or a wrong token', async () => {
    const { a, b } = timedPair(),
      pending = change(),
      guard = vi.fn();
    await a.claim(pending);
    const token = await a.beginTransmission(pending);
    for (const changed of [
      { ...pending, payload: { input: { targetKind: 'sqlite' } } },
      { ...pending, operationId: nativeDurableId() },
      { ...pending, kind: 'privateCanvas' as const },
      { ...pending, userId: 'changed-actor' },
      { ...pending, projectId: 'changed-project' },
    ])
      expect(await a.confirmDatabaseChangePreconditionConsumed(changed, token, guard)).toBe(false);
    expect(await a.confirmDatabaseChangePreconditionConsumed(pending, 'wrong-token', guard)).toBe(
      false,
    );
    expect(guard).not.toHaveBeenCalled();
    expect(await b.read('actor', 'project')).toEqual(pending);
    await a.endTransmission(pending, token);
    expect(await a.confirmDatabaseChangePreconditionConsumed(pending, token, guard)).toBe(false);
    await expect(b.discard(pending)).rejects.toThrow('native.transmission-unknown');
    expect(guard).not.toHaveBeenCalled();
  });
  it.each([
    'stale-proof',
    'actor-context-changed',
    'archive-quota',
    'archive-readback-failed',
  ] as const)('aborts %s guard and preserves unknown original on reload', async (failure) => {
    const { a, b, factory, name } = timedPair(),
      pending = change(),
      archive = new Map<string, string>();
    await a.claim(pending);
    const token = await a.beginTransmission(pending);
    const guard = vi.fn(() => {
      if (failure === 'archive-readback-failed')
        archive.set(pending.operationId, JSON.stringify(pending));
      throw Error(failure);
    });
    await expect(
      a.confirmDatabaseChangePreconditionConsumed(pending, token, guard),
    ).rejects.toThrow(failure);
    expect(guard).toHaveBeenCalledOnce();
    expect(await b.read('actor', 'project')).toEqual(pending);
    await a.endTransmission(pending, token);
    await a.close();
    const reopened = new NativeDurableQueue(factory, name);
    queues.push(reopened);
    expect(await reopened.read('actor', 'project')).toEqual(pending);
    expect(reopened.state('actor', 'project')).toBe('unknown');
    await expect(reopened.discard(pending)).rejects.toThrow('native.transmission-unknown');
    // An archive side effect before a later failure cannot itself release the durable row.
    if (failure === 'archive-readback-failed')
      expect(JSON.parse(archive.get(pending.operationId)!)).toEqual(pending);
  });
  it('rejects expired proof, old token/current-owner mismatch and a newly uncertain retransmission', async () => {
    const { a, b, advance } = timedPair(),
      pending = change(),
      guard = vi.fn();
    await a.claim(pending);
    const oldToken = await a.beginTransmission(pending);
    advance(1100); // exact expiration is not live
    expect(await a.confirmDatabaseChangePreconditionConsumed(pending, oldToken, guard)).toBe(false);
    expect(guard).not.toHaveBeenCalled();
    const next = await b.beginTransmission(pending);
    expect(await a.confirmDatabaseChangePreconditionConsumed(pending, oldToken, guard)).toBe(false);
    expect(await a.confirmDatabaseChangePreconditionConsumed(pending, next, guard)).toBe(false);
    expect(guard).not.toHaveBeenCalled();
    await a.endTransmission(pending, oldToken);
    expect(await b.confirmDatabaseChangePreconditionConsumed(pending, next, guard)).toBe(true);
    expect(guard).toHaveBeenCalledOnce();
    await b.endTransmission(pending, next);
    const retry = await a.beginTransmission(pending);
    expect(await b.confirmDatabaseChangePreconditionConsumed(pending, next, guard)).toBe(false);
    expect(guard).toHaveBeenCalledOnce();
    await a.endTransmission(pending, retry);
    expect(await b.read('actor', 'project')).toEqual(pending);
    await expect(b.discard(pending)).rejects.toThrow('native.transmission-unknown');
  });
  it('requires a synchronous guard and aborts rather than accepting a thenable archive', async () => {
    const { a, b } = timedPair(),
      pending = change();
    await a.claim(pending);
    const token = await a.beginTransmission(pending);
    await expect(
      a.confirmDatabaseChangePreconditionConsumed(pending, token, () => Promise.resolve()),
    ).rejects.toThrow('native.database-change-proof-guard-async');
    await a.endTransmission(pending, token);
    expect(await b.read('actor', 'project')).toEqual(pending);
    await expect(b.discard(pending)).rejects.toThrow('native.transmission-unknown');
  });
});
