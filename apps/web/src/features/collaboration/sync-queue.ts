import type { StoredSyncOperation, SyncOperationStore } from './sync-storage.js';

export const automaticReconnectLimitMs = 24 * 60 * 60 * 1000;
export const localRetentionMs = 7 * 24 * 60 * 60 * 1000;

export type QueueTransport<T, R> = {
  prepare?(operation: T): Promise<T>;
  submit(operation: T): Promise<R>;
  lookup(operationId: string): Promise<R | null>;
};

export type QueueListener<T, R> = (
  event:
    | { type: 'changed'; items: StoredSyncOperation<T>[] }
    | { type: 'ack'; item: StoredSyncOperation<T>; result: R }
    | { type: 'expired'; item: StoredSyncOperation<T> }
    | { type: 'error'; item: StoredSyncOperation<T>; error: unknown },
) => void;

export class DurableSyncQueue<T, R> {
  private pumping: Promise<void> | undefined;
  private pumpRequested = false;
  private order = 0;
  private cancelled = new Set<string>();

  constructor(
    private readonly projectId: string,
    private readonly store: SyncOperationStore<T>,
    private readonly transport: QueueTransport<T, R>,
    private readonly operationId: (operation: T) => string,
    private readonly baselineAt: (operation: T) => number,
    private readonly outcome: (result: R) => { accepted: boolean; reason?: string },
    private readonly listener: QueueListener<T, R>,
    private readonly now = () => Date.now(),
  ) {}

  async load() {
    let items = await this.store.list(this.projectId);
    for (const item of items.filter((value) => this.now() - value.createdAt >= localRetentionMs)) {
      if (item.state === 'sending' || item.state === 'unknown') {
        try {
          const known = await this.transport.lookup(item.operationId);
          if (known !== null) {
            await this.ack(item, known);
            continue;
          }
        } catch (error) {
          await this.update(item, 'unknown', '서버 처리 여부를 확인하지 못했습니다.');
          this.listener({ type: 'error', item, error });
          continue;
        }
      }
      await this.store.delete(item.operationId);
      this.listener({ type: 'expired', item });
    }
    items = await this.store.list(this.projectId);
    this.order = items.reduce((maximum, item) => Math.max(maximum, item.order), 0);
    this.listener({ type: 'changed', items });
    return items;
  }

  /** Resolves only after the operation is durable (or present in the explicit memory fallback). */
  async enqueue(operation: T) {
    const item: StoredSyncOperation<T> = {
      operation,
      operationId: this.operationId(operation),
      projectId: this.projectId,
      createdAt: this.now(),
      baselineAt: this.baselineAt(operation),
      order: ++this.order,
      state: 'queued',
    };
    await this.store.put(item);
    await this.emitChanged();
    return item;
  }

  async pump() {
    this.pumpRequested = true;
    if (this.pumping) return this.pumping;
    this.pumping = (async () => {
      while (this.pumpRequested) {
        this.pumpRequested = false;
        while (true) {
          let item = (await this.store.list(this.projectId))[0];
          if (!item || item.state === 'unresolved') break;
          if (this.cancelled.delete(item.operationId)) {
            await this.store.delete(item.operationId);
            continue;
          }
          if (item.state === 'sending' || item.state === 'unknown') {
            let known: R | null;
            try {
              known = await this.transport.lookup(item.operationId);
            } catch (error) {
              await this.update(item, 'unknown', '서버 처리 여부를 확인하지 못했습니다.');
              this.listener({ type: 'error', item, error });
              break;
            }
            if (known !== null) {
              await this.ack(item, known);
              continue;
            }
          }
          if (this.now() - item.baselineAt > automaticReconnectLimitMs) {
            await this.update(item, 'unresolved', '24시간이 지나 자동 반영하지 않았습니다.');
            continue;
          }
          if (this.transport.prepare) {
            try {
              const operation = await this.transport.prepare(item.operation);
              // The automatic replay age remains tied to the operation's original
              // last-successful-sync baseline even when an acknowledged predecessor
              // supplies a newer document/handle for dependency chaining.
              item = { ...item, operation };
              await this.store.put(item);
            } catch (error) {
              this.listener({ type: 'error', item, error });
              break;
            }
          }
          if (this.cancelled.delete(item.operationId)) {
            await this.store.delete(item.operationId);
            continue;
          }
          const sending = await this.update(item, 'sending');
          if (this.cancelled.delete(item.operationId)) {
            await this.store.delete(item.operationId);
            await this.emitChanged();
            continue;
          }
          try {
            const result = await this.transport.submit(item.operation);
            await this.ack(sending, result);
          } catch (error) {
            await this.update(sending, 'unknown', '전송 결과를 확인하지 못했습니다.');
            this.listener({ type: 'error', item: sending, error });
            break;
          }
        }
      }
    })();
    try {
      await this.pumping;
    } finally {
      this.pumping = undefined;
      await this.emitChanged();
    }
  }

  async items() {
    return this.store.list(this.projectId);
  }

  async discard(operationId: string) {
    const item = (await this.store.list(this.projectId)).find(
      (value) => value.operationId === operationId,
    );
    if (item?.state === 'sending' || item?.state === 'unknown') return false;
    this.cancelled.add(operationId);
    await this.store.delete(operationId);
    await this.emitChanged();
    return true;
  }

  async markUnresolved(operationId: string, reason: string) {
    const item = (await this.store.list(this.projectId)).find(
      (value) => value.operationId === operationId,
    );
    if (!item) return;
    await this.update(item, 'unresolved', reason);
  }

  private async ack(item: StoredSyncOperation<T>, result: R) {
    const outcome = this.outcome(result);
    if (outcome.accepted) {
      // Keep the acknowledged predecessor as a recoverable journal until its
      // immediate successor has durably adopted the new baseline. A reload can
      // then look the predecessor up and repeat this step without losing intent.
      this.listener({ type: 'ack', item, result });
      if (this.transport.prepare) {
        const successor = (await this.store.list(this.projectId)).find(
          (value) => value.order > item.order,
        );
        if (successor?.state === 'queued') {
          const operation = await this.transport.prepare(successor.operation);
          await this.store.put({ ...successor, operation });
        }
      }
      await this.store.delete(item.operationId);
    } else {
      await this.store.put({
        ...item,
        state: 'unresolved',
        reason: outcome.reason ?? '서버가 변경을 반영하지 않았습니다.',
      });
      this.listener({ type: 'ack', item, result });
    }
    await this.emitChanged();
  }

  private async update(
    item: StoredSyncOperation<T>,
    state: StoredSyncOperation<T>['state'],
    reason?: string,
  ) {
    const next = { ...item, state, ...(reason ? { reason } : {}) };
    await this.store.put(next);
    await this.emitChanged();
    return next;
  }

  private async emitChanged() {
    this.listener({ type: 'changed', items: await this.store.list(this.projectId) });
  }
}
