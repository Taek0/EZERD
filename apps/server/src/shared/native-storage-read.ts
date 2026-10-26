import { restoreNativeDocumentFromStorage, type NativeDesignDocument } from '@ezerd/model';

/** Call after ACK validation. Restore storage defaults without rewriting historical actor/IDs. */
export function restoreNativeStoredResult<T extends { document?: unknown }>(value: T): T {
  const result = structuredClone(value);
  const document = result.document as NativeDesignDocument | undefined;
  if (document?.schemaVersion === 2) result.document = restoreNativeDocumentFromStorage(document);
  return result;
}
