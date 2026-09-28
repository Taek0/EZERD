import { translate as t } from '../../shared/i18n/index.js';
import './translations.js';
export type QueueState = 'queued' | 'sending' | 'unknown' | 'unresolved';

export type StoredSyncOperation<T> = {
  operation: T;
  projectId: string;
  operationId: string;
  createdAt: number;
  /** Server-issued time of the last successful sync; reconnect must never refresh it. */
  baselineAt: number;
  order: number;
  state: QueueState;
  reason?: string;
};

export interface SyncOperationStore<T> {
  readonly durable: boolean;
  put(value: StoredSyncOperation<T>): Promise<void>;
  delete(operationId: string): Promise<void>;
  list(projectId: string): Promise<StoredSyncOperation<T>[]>;
}

export class MemorySyncOperationStore<T> implements SyncOperationStore<T> {
  readonly durable = false;
  private readonly values = new Map<string, StoredSyncOperation<T>>();

  async put(value: StoredSyncOperation<T>) {
    this.values.set(value.operationId, structuredClone(value));
  }

  async delete(operationId: string) {
    this.values.delete(operationId);
  }

  async list(projectId: string) {
    return [...this.values.values()]
      .filter((value) => value.projectId === projectId)
      .sort((left, right) => left.order - right.order)
      .map((value) => structuredClone(value));
  }
}

const databaseName = 'ezerd-sync';
const storeName = 'operations';

export class IndexedDbSyncOperationStore<T> implements SyncOperationStore<T> {
  readonly durable = true;
  private database?: Promise<IDBDatabase>;

  constructor(private readonly indexedDb: IDBFactory = indexedDB) {}

  private open() {
    this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.indexedDb.open(databaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(storeName)) {
          const store = database.createObjectStore(storeName, { keyPath: 'operationId' });
          store.createIndex('projectId', 'projectId');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error(t('IndexedDB를 열 수 없습니다.')));
    });
    return this.database;
  }

  private async transaction<R>(
    mode: IDBTransactionMode,
    run: (
      store: IDBObjectStore,
      resolve: (value: R) => void,
      reject: (reason?: unknown) => void,
    ) => void,
  ) {
    const database = await this.open();
    return new Promise<R>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      let result: R;
      let hasResult = false;
      transaction.onerror = () =>
        reject(transaction.error ?? new Error(t('로컬 변경을 저장할 수 없습니다.')));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error(t('로컬 변경 저장이 취소되었습니다.')));
      transaction.oncomplete = () =>
        hasResult ? resolve(result) : reject(new Error(t('로컬 변경 저장 결과가 없습니다.')));
      run(
        transaction.objectStore(storeName),
        (value) => {
          result = value;
          hasResult = true;
        },
        reject,
      );
    });
  }

  async put(value: StoredSyncOperation<T>) {
    await this.transaction<void>('readwrite', (store, resolve, reject) => {
      const request = store.put(structuredClone(value));
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async delete(operationId: string) {
    await this.transaction<void>('readwrite', (store, resolve, reject) => {
      const request = store.delete(operationId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async list(projectId: string) {
    return this.transaction<StoredSyncOperation<T>[]>('readonly', (store, resolve, reject) => {
      const request = store.index('projectId').getAll(projectId);
      request.onsuccess = () =>
        resolve(
          (request.result as StoredSyncOperation<T>[]).sort(
            (left, right) => left.order - right.order,
          ),
        );
      request.onerror = () => reject(request.error);
    });
  }
}

export async function createSyncOperationStore<T>(): Promise<{
  store: SyncOperationStore<T>;
  failure?: string;
}> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
    const store = new IndexedDbSyncOperationStore<T>();
    await store.list('__storage-check__');
    return { store };
  } catch {
    return {
      store: new MemorySyncOperationStore<T>(),
      failure: t(
        '이 브라우저에서는 편집 내용을 영구 보관할 수 없습니다. 이 탭을 닫기 전에 연결을 복구해 주세요.',
      ),
    };
  }
}
