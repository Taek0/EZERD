import { it, expect } from 'vitest';
import {
  compactNativeDocumentForStorage,
  createEmptyNativeDocument,
  createNativeTable,
  defaultDatabaseContext,
} from '@ezerd/model';
import { restoreNativeStoredResult } from '../src/shared/native-storage-read.js';
it('restores only omitted metadata in a historical result without trimming historical fields', () => {
  const context = defaultDatabaseContext('postgresql');
  const doc = createEmptyNativeDocument(context);
  const table = createNativeTable(context, 't');
  table.physical.comment = '  original  ';
  doc.tables = [table];
  const stored = {
    document: compactNativeDocumentForStorage(doc),
    actor: { username: '  ORIGINAL  ' },
    operationId: 'UPPER-ID',
  };
  const before = structuredClone(stored);
  const restored = restoreNativeStoredResult(stored);
  expect(restored.document).toEqual(doc);
  expect(restored.actor).toEqual(stored.actor);
  expect(stored).toEqual(before);
});
