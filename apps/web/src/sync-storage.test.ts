import { describe, expect, it } from 'vitest';
import { IndexedDbSyncOperationStore, type StoredSyncOperation } from './sync-storage.js';

describe('IndexedDbSyncOperationStore', () => {
  it('resolves a write only after its transaction completes', async () => {
    let transaction: Partial<IDBTransaction> | undefined;
    const database = {
      objectStoreNames: { contains: () => true },
      transaction: () => {
        const request: Partial<IDBRequest> = {};
        transaction = {
          objectStore: () =>
            ({
              put: () => {
                queueMicrotask(() =>
                  (request.onsuccess as ((event: Event) => void) | null)?.(new Event('success')),
                );
                return request as IDBRequest;
              },
            }) as unknown as IDBObjectStore,
        };
        return transaction as IDBTransaction;
      },
    } as unknown as IDBDatabase;
    const openRequest: Partial<IDBOpenDBRequest> = {};
    const indexedDb = {
      open: () => {
        Object.defineProperty(openRequest, 'result', { value: database });
        queueMicrotask(() =>
          (openRequest.onsuccess as ((event: Event) => void) | null)?.(new Event('success')),
        );
        return openRequest as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;
    const store = new IndexedDbSyncOperationStore<{ operationId: string }>(indexedDb);
    const item: StoredSyncOperation<{ operationId: string }> = {
      projectId: 'p',
      operationId: 'one',
      operation: { operationId: 'one' },
      createdAt: 1,
      baselineAt: 1,
      order: 1,
      state: 'queued',
    };
    let settled = false;
    const writing = store.put(item).then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    (transaction?.oncomplete as ((event: Event) => void) | null)?.(new Event('complete'));
    await writing;
    expect(settled).toBe(true);
  });
});
