import { describe, expect, it } from 'vitest';
import {
  compactNativeDocumentForStorage,
  restoreNativeDocumentFromStorage,
} from './stored-document.js';

const emptyProperties = () => ({ common: {}, logical: {}, physical: {} });

describe('compactNativeDocumentForStorage', () => {
  it('removes only redundant table/column metadata without mutating the input', () => {
    const metadata = { common: { nested: [false, null, { a: 1 }] }, logical: {}, physical: {} };
    const document = {
      schemaVersion: 2,
      tables: [
        { id: 'empty', customProperties: emptyProperties() },
        { id: 'full', customProperties: metadata },
      ],
      columns: [{ id: 'column', customProperties: emptyProperties() }],
      notes: [{ customProperties: emptyProperties() }],
    };
    const original = structuredClone(document);
    const compact = compactNativeDocumentForStorage(document);
    expect(compact.tables?.[0]).toEqual({ id: 'empty' });
    expect(compact.columns?.[0]).toEqual({ id: 'column' });
    expect(compact.tables?.[1]).toBe(document.tables[1]);
    expect(compact.tables?.[1]?.customProperties).toBe(metadata);
    expect(compact.notes).toBe(document.notes);
    expect(document).toEqual(original);
    expect(compactNativeDocumentForStorage(compact)).toBe(compact);
  });

  it('preserves v1 documents and metadata with additional or incomplete scopes', () => {
    const v1 = { schemaVersion: 1, tables: [{ customProperties: emptyProperties() }] };
    expect(compactNativeDocumentForStorage(v1)).toBe(v1);
    const document = {
      schemaVersion: 2,
      tables: [
        { customProperties: { ...emptyProperties(), unknown: {} } },
        { customProperties: { common: {}, logical: {} } },
        { customProperties: { common: [], logical: {}, physical: {} } },
      ],
    };
    expect(compactNativeDocumentForStorage(document)).toBe(document);
  });

  it('restores only absent metadata without canonicalizing source evidence', () => {
    const document = {
      schemaVersion: 2,
      tables: [{ id: ' raw alias ', customProperties: null }, { id: ' other ' }],
      columns: [{ id: ' c ' }],
    };
    const restored = restoreNativeDocumentFromStorage(document);
    expect(restored.tables[0]).toBe(document.tables[0]);
    expect(restored.tables[1]).toEqual({ id: ' other ', customProperties: emptyProperties() });
    expect(restored.columns[0]).toEqual({ id: ' c ', customProperties: emptyProperties() });
    expect(document.tables[1]).not.toHaveProperty('customProperties');
    expect(restoreNativeDocumentFromStorage(restored)).toBe(restored);
  });
});
