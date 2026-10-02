import { IDBFactory as TestIndexedDBFactory } from 'fake-indexeddb';
// Compatibility for peer tests. A missing dependency fails import; this cannot skip IDB tests.
export const nativeTestIndexedDBAvailable = true;
export function createNativeTestIndexedDB(): IDBFactory {
  return new TestIndexedDBFactory();
}
export function nativeTestDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
