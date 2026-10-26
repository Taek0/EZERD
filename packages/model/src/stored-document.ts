import type { DesignDocument } from './document.js';
import type { NativeDesignDocument } from './database/native-document.js';

/** Persisted JSON can be historical v1 or Native v2; narrow by schemaVersion before use. */
export type StoredDesignDocument = DesignDocument | NativeDesignDocument;

type CompactMetadataEntity<T> = T extends { customProperties?: infer Properties }
  ? Omit<T, 'customProperties'> & { customProperties?: Properties }
  : T;

export type CompactNativeDocument<T> = {
  [Key in keyof T]: Key extends 'tables' | 'columns'
    ? T[Key] extends (infer Entity)[] | undefined
      ? CompactMetadataEntity<Entity>[] | Extract<T[Key], undefined>
      : T[Key]
    : T[Key];
};

function hasEmptyCustomProperties(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const properties = value as Record<string, unknown>;
  const scopes = ['common', 'logical', 'physical'];
  return (
    Object.keys(properties).length === scopes.length &&
    scopes.every((scope) => {
      const entries = properties[scope];
      return (
        entries !== null &&
        typeof entries === 'object' &&
        !Array.isArray(entries) &&
        Object.keys(entries).length === 0
      );
    })
  );
}

/** Omit redundant Native v2 metadata in persisted JSON without changing the runtime document. */
export function compactNativeDocumentForStorage<
  T extends {
    schemaVersion: number;
    tables?: { customProperties?: unknown }[] | undefined;
    columns?: { customProperties?: unknown }[] | undefined;
  },
>(document: T): CompactNativeDocument<T> {
  if (document.schemaVersion !== 2) return document as CompactNativeDocument<T>;
  let result = document;
  for (const collection of ['tables', 'columns'] as const) {
    const entities = document[collection];
    if (!entities?.some((entity) => hasEmptyCustomProperties(entity.customProperties))) continue;
    if (result === document) result = { ...document };
    result[collection] = entities.map((entity) => {
      if (!hasEmptyCustomProperties(entity.customProperties)) return entity;
      const { customProperties: _, ...rest } = entity;
      return rest;
    });
  }
  return result as CompactNativeDocument<T>;
}

/** Restore omitted metadata while preserving raw source values and malformed explicit metadata. */
export function restoreNativeDocumentFromStorage<
  T extends {
    schemaVersion: number;
    tables?: { customProperties?: unknown }[] | undefined;
    columns?: { customProperties?: unknown }[] | undefined;
  },
>(document: T): T {
  if (document.schemaVersion !== 2) return document;
  let result = document;
  for (const collection of ['tables', 'columns'] as const) {
    const entities = document[collection];
    if (!entities?.some((entity) => !Object.hasOwn(entity, 'customProperties'))) continue;
    if (result === document) result = { ...document };
    result[collection] = entities.map((entity) =>
      Object.hasOwn(entity, 'customProperties')
        ? entity
        : { ...entity, customProperties: { common: {}, logical: {}, physical: {} } },
    );
  }
  return result;
}
