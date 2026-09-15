import { describe, expect, it } from 'vitest';
import { DurableSyncQueue, automaticReconnectLimitMs, localRetentionMs } from './sync-queue.js';
import { MemorySyncOperationStore, type StoredSyncOperation } from './sync-storage.js';

type Operation = { operationId: string; value: number };

describe('DurableSyncQueue', () => {
  it('persists before sending and preserves operation order', async () => {
    const store = new MemorySyncOperationStore<Operation>();
    const calls: string[] = [];
    const queue = new DurableSyncQueue(
      'p',
      store,
      {
        submit: async (operation) => {
          calls.push(`send:${operation.operationId}`);
          expect(
            (await store.list('p')).some((item) => item.operationId === operation.operationId),
          ).toBe(true);
          return operation.value;
        },
        lookup: async () => null,
      },
      (operation) => operation.operationId,
      () => Date.now(),
      () => ({ accepted: true }),
      () => {},
    );
    await queue.enqueue({ operationId: 'one', value: 1 });
    await queue.enqueue({ operationId: 'two', value: 2 });
    await queue.pump();
    expect(calls).toEqual(['send:one', 'send:two']);
  });

  it('an ACK clears only its own operation', async () => {
    const store = new MemorySyncOperationStore<Operation>();
    const acknowledged: string[] = [];
    let failSecond = true;
    const queue = new DurableSyncQueue(
      'p',
      store,
      {
        submit: async (operation) => {
          if (operation.operationId === 'two' && failSecond) throw new Error('offline');
          return operation.value;
        },
        lookup: async () => null,
      },
      (operation) => operation.operationId,
      () => Date.now(),
      () => ({ accepted: true }),
      (event) => {
        if (event.type === 'ack') acknowledged.push(event.item.operationId);
      },
    );
    await queue.enqueue({ operationId: 'one', value: 1 });
    await queue.enqueue({ operationId: 'two', value: 2 });
    await queue.pump();
    expect(acknowledged).toEqual(['one']);
    expect((await store.list('p')).map((item) => item.operationId)).toEqual(['two']);
    failSecond = false;
  });

  it('looks up an unknown result before any resend', async () => {
    const store = new MemorySyncOperationStore<Operation>();
    let sends = 0;
    const queue = new DurableSyncQueue(
      'p',
      store,
      {
        submit: async () => {
          sends++;
          return 1;
        },
        lookup: async (operationId) => (operationId === 'one' ? 1 : null),
      },
      (operation) => operation.operationId,
      () => Date.now(),
      () => ({ accepted: true }),
      () => {},
    );
    const now = Date.now();
    await store.put({
      projectId: 'p',
      operationId: 'one',
      operation: { operationId: 'one', value: 1 },
      createdAt: now,
      baselineAt: now,
      order: 1,
      state: 'unknown',
    });
    await queue.pump();
    expect(sends).toBe(0);
    expect(await store.list('p')).toEqual([]);
  });

  it('moves operations older than 24 hours to unresolved without sending', async () => {
    const store = new MemorySyncOperationStore<Operation>();
    let sends = 0;
    const queue = new DurableSyncQueue(
      'p',
      store,
      {
        submit: async () => {
          sends++;
          return 1;
        },
        lookup: async () => null,
      },
      (operation) => operation.operationId,
      () => 1,
      () => ({ accepted: true }),
      () => {},
      () => automaticReconnectLimitMs + 2,
    );
    await store.put({
      projectId: 'p',
      operationId: 'old',
      operation: { operationId: 'old', value: 1 },
      createdAt: automaticReconnectLimitMs,
      baselineAt: 1,
      order: 1,
      state: 'queued',
    });
    await queue.pump();
    expect(sends).toBe(0);
    expect((await store.list('p'))[0]?.state).toBe('unresolved');
  });

  it('waits for the sending state transaction before submitting', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sendingCommitted = false;
    class TransactionStore extends MemorySyncOperationStore<Operation> {
      override async put(value: StoredSyncOperation<Operation>) {
        if (value.state === 'sending') {
          await gate;
          sendingCommitted = true;
        }
        await super.put(value);
      }
    }
    const store = new TransactionStore();
    let sends = 0;
    const queue = new DurableSyncQueue(
      'p',
      store,
      {
        submit: async () => {
          expect(sendingCommitted).toBe(true);
          sends++;
          return 1;
        },
        lookup: async () => null,
      },
      (operation) => operation.operationId,
      () => Date.now(),
      () => ({ accepted: true }),
      () => {},
    );
    await queue.enqueue({ operationId: 'one', value: 1 });
    const pumping = queue.pump();
    await Promise.resolve();
    expect(sends).toBe(0);
    release();
    await pumping;
    expect(sends).toBe(1);
  });

  it('chains dependent operations without refreshing their replay age', async () => {
    type DependentOperation = Operation & { baseline: string };
    const store = new MemorySyncOperationStore<DependentOperation>();
    const observed: Array<{ id: string; baseline: string; baselineAt: number }> = [];
    const queue = new DurableSyncQueue(
      'p',
      store,
      {
        prepare: async (operation) =>
          operation.operationId === 'two' ? { ...operation, baseline: 'ack-one' } : operation,
        submit: async (operation) => {
          const persisted = (await store.list('p')).find(
            (item) => item.operationId === operation.operationId,
          )!;
          observed.push({
            id: operation.operationId,
            baseline: operation.baseline,
            baselineAt: persisted.baselineAt,
          });
          return operation.value;
        },
        lookup: async () => null,
      },
      (operation) => operation.operationId,
      () => 10,
      () => ({ accepted: true }),
      () => {},
      () => 20,
    );
    await queue.enqueue({ operationId: 'one', value: 1, baseline: 'original' });
    await queue.enqueue({ operationId: 'two', value: 2, baseline: 'original' });
    await queue.pump();
    expect(observed).toEqual([
      { id: 'one', baseline: 'original', baselineAt: 10 },
      { id: 'two', baseline: 'ack-one', baselineAt: 10 },
    ]);
  });

  it('checks an expired unknown operation result before deleting local state', async () => {
    const store = new MemorySyncOperationStore<Operation>();
    const events: string[] = [];
    const now = localRetentionMs + 100;
    await store.put({
      projectId: 'p',
      operationId: 'one',
      operation: { operationId: 'one', value: 1 },
      createdAt: 0,
      baselineAt: 0,
      order: 1,
      state: 'unknown',
    });
    const queue = new DurableSyncQueue(
      'p',
      store,
      {
        submit: async () => {
          throw new Error('must not resend');
        },
        lookup: async (operationId) => {
          events.push(`lookup:${operationId}`);
          return 1;
        },
      },
      (operation) => operation.operationId,
      () => 0,
      () => ({ accepted: true }),
      (event) => events.push(event.type),
      () => now,
    );
    await queue.load();
    expect(events[0]).toBe('lookup:one');
    expect(events).toContain('ack');
    expect(events).not.toContain('expired');
    expect(await store.list('p')).toEqual([]);
  });

  it('durably rebases the successor before removing its acknowledged predecessor', async () => {
    type ChainedOperation = Operation & { baseline: string };
    class InterruptingStore extends MemorySyncOperationStore<ChainedOperation> {
      failDelete = true;
      override async delete(operationId: string) {
        if (operationId === 'one' && this.failDelete) {
          this.failDelete = false;
          throw new Error('simulated reload boundary');
        }
        await super.delete(operationId);
      }
    }
    const store = new InterruptingStore();
    let acknowledged = false;
    const prepare = async (operation: ChainedOperation) =>
      acknowledged && operation.operationId === 'two'
        ? { ...operation, baseline: 'ack-one' }
        : operation;
    const firstQueue = new DurableSyncQueue(
      'p',
      store,
      {
        prepare,
        submit: async (operation) => operation.value,
        lookup: async () => null,
      },
      (operation) => operation.operationId,
      () => 1,
      () => ({ accepted: true }),
      (event) => {
        if (event.type === 'ack') acknowledged = true;
      },
      () => 2,
    );
    await firstQueue.enqueue({ operationId: 'one', value: 1, baseline: 'original' });
    await firstQueue.enqueue({ operationId: 'two', value: 2, baseline: 'original' });
    await firstQueue.pump();
    const interrupted = await store.list('p');
    expect(interrupted.find((item) => item.operationId === 'one')?.state).toBe('unknown');
    expect(interrupted.find((item) => item.operationId === 'two')?.operation.baseline).toBe(
      'ack-one',
    );

    const sent: string[] = [];
    const resumedQueue = new DurableSyncQueue(
      'p',
      store,
      {
        prepare,
        submit: async (operation) => {
          sent.push(operation.operationId);
          return operation.value;
        },
        lookup: async (operationId) => (operationId === 'one' ? 1 : null),
      },
      (operation) => operation.operationId,
      () => 1,
      () => ({ accepted: true }),
      (event) => {
        if (event.type === 'ack') acknowledged = true;
      },
      () => 2,
    );
    await resumedQueue.pump();
    expect(sent).toEqual(['two']);
    expect(await store.list('p')).toEqual([]);
  });

  it('carries durable baseline ancestry across a reload for three dependent operations', async () => {
    type ChainedOperation = Operation & { baseline: string; rebaseAncestors?: string[] };
    type Result = { value: number; nextBaseline: string };
    class ReloadStore extends MemorySyncOperationStore<ChainedOperation> {
      interrupt = true;
      override async delete(operationId: string) {
        if (operationId === 'one' && this.interrupt) {
          this.interrupt = false;
          throw new Error('reload after first ACK');
        }
        await super.delete(operationId);
      }
    }
    const store = new ReloadStore();
    const rebases = new Map<string, string>();
    const prepare = async (operation: ChainedOperation) => {
      const source = [operation.baseline, ...(operation.rebaseAncestors ?? [])].find((baseline) =>
        rebases.has(baseline),
      );
      if (!source) return operation;
      return {
        ...operation,
        rebaseAncestors: [...new Set([...(operation.rebaseAncestors ?? []), operation.baseline])],
        baseline: rebases.get(source)!,
      };
    };
    const listener = (
      event: Parameters<
        ConstructorParameters<typeof DurableSyncQueue<ChainedOperation, Result>>[6]
      >[0],
    ) => {
      if (event.type !== 'ack') return;
      for (const baseline of [
        event.item.operation.baseline,
        ...(event.item.operation.rebaseAncestors ?? []),
      ]) {
        rebases.set(baseline, event.result.nextBaseline);
      }
    };
    const first = new DurableSyncQueue<ChainedOperation, Result>(
      'p',
      store,
      {
        prepare,
        submit: async (operation) => ({
          value: operation.value,
          nextBaseline: operation.operationId === 'one' ? 'Y' : 'unused',
        }),
        lookup: async () => null,
      },
      (operation) => operation.operationId,
      () => 1,
      () => ({ accepted: true }),
      listener,
      () => 2,
    );
    await first.enqueue({ operationId: 'one', value: 1, baseline: 'X' });
    await first.enqueue({ operationId: 'two', value: 2, baseline: 'X' });
    await first.enqueue({ operationId: 'three', value: 3, baseline: 'X' });
    await first.pump();
    const interrupted = await store.list('p');
    expect(interrupted.find((item) => item.operationId === 'two')?.operation).toMatchObject({
      baseline: 'Y',
      rebaseAncestors: ['X'],
    });
    expect(interrupted.find((item) => item.operationId === 'three')?.operation.baseline).toBe('X');

    rebases.clear();
    const sent: Array<{ id: string; baseline: string }> = [];
    const resumed = new DurableSyncQueue<ChainedOperation, Result>(
      'p',
      store,
      {
        prepare,
        submit: async (operation) => {
          sent.push({ id: operation.operationId, baseline: operation.baseline });
          return {
            value: operation.value,
            nextBaseline: operation.operationId === 'two' ? 'Z' : 'W',
          };
        },
        lookup: async (operationId) =>
          operationId === 'one' ? { value: 1, nextBaseline: 'Y' } : null,
      },
      (operation) => operation.operationId,
      () => 1,
      () => ({ accepted: true }),
      listener,
      () => 2,
    );
    await resumed.pump();
    expect(sent).toEqual([
      { id: 'two', baseline: 'Y' },
      { id: 'three', baseline: 'Z' },
    ]);
    expect(await store.list('p')).toEqual([]);
  });

  it('does not send later operations while an earlier edit needs user action', async () => {
    const store = new MemorySyncOperationStore<Operation>();
    const sent: string[] = [];
    await store.put({
      projectId: 'p',
      operationId: 'one',
      operation: { operationId: 'one', value: 1 },
      createdAt: 1,
      baselineAt: 1,
      order: 1,
      state: 'unresolved',
    });
    await store.put({
      projectId: 'p',
      operationId: 'two',
      operation: { operationId: 'two', value: 2 },
      createdAt: 2,
      baselineAt: 1,
      order: 2,
      state: 'queued',
    });
    const queue = new DurableSyncQueue(
      'p',
      store,
      {
        submit: async (operation) => {
          sent.push(operation.operationId);
          return operation.value;
        },
        lookup: async () => null,
      },
      (operation) => operation.operationId,
      () => 1,
      () => ({ accepted: true }),
      () => {},
      () => 2,
    );
    await queue.pump();
    expect(sent).toEqual([]);
  });

  it('does not resurrect a queued operation discarded while prepare is in flight', async () => {
    const store = new MemorySyncOperationStore<Operation>();
    let release!: () => void;
    const preparing = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredPrepare = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let sends = 0;
    const queue = new DurableSyncQueue(
      'p',
      store,
      {
        prepare: async (operation) => {
          entered();
          await preparing;
          return operation;
        },
        submit: async (operation) => {
          sends++;
          return operation.value;
        },
        lookup: async () => null,
      },
      (operation) => operation.operationId,
      () => 1,
      () => ({ accepted: true }),
      () => {},
      () => 2,
    );
    await queue.enqueue({ operationId: 'one', value: 1 });
    const pumping = queue.pump();
    await enteredPrepare;
    expect(await queue.discard('one')).toBe(true);
    release();
    await pumping;
    expect(sends).toBe(0);
    expect(await store.list('p')).toEqual([]);
  });

  it('rechecks cancellation after a delayed durable sending transition', async () => {
    let releaseSending!: () => void;
    const sendingGate = new Promise<void>((resolve) => {
      releaseSending = resolve;
    });
    let enteredSending!: () => void;
    const sendingStarted = new Promise<void>((resolve) => {
      enteredSending = resolve;
    });
    class DelayedSendingStore extends MemorySyncOperationStore<Operation> {
      override async put(value: StoredSyncOperation<Operation>) {
        if (value.state === 'sending') {
          enteredSending();
          await sendingGate;
        }
        await super.put(value);
      }
    }
    const store = new DelayedSendingStore();
    let sends = 0;
    const queue = new DurableSyncQueue(
      'p',
      store,
      {
        submit: async (operation) => {
          sends++;
          return operation.value;
        },
        lookup: async () => null,
      },
      (operation) => operation.operationId,
      () => 1,
      () => ({ accepted: true }),
      () => {},
      () => 2,
    );
    await queue.enqueue({ operationId: 'one', value: 1 });
    const pumping = queue.pump();
    await sendingStarted;
    expect(await queue.discard('one')).toBe(true);
    releaseSending();
    await pumping;
    expect(sends).toBe(0);
    expect(await store.list('p')).toEqual([]);
  });
});
