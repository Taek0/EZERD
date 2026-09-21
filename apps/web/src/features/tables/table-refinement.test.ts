import { expect, it } from 'vitest';
import { reorderColumn } from './TableEditor.js';
import { tableCardMetrics } from './table-geometry.js';
import type { DesignDocument } from '@ezerd/model';
it('drag reorder preserves foreign-table positions and FK identities', () => {
  const doc = {
    columns: [
      { id: 'a', tableId: 't' },
      { id: 'x', tableId: 'u' },
      { id: 'b', tableId: 't' },
      { id: 'c', tableId: 't' },
    ],
  } as DesignDocument;
  expect(reorderColumn(doc, 'a', 'c').columns?.map((c) => c.id)).toEqual(['b', 'x', 'c', 'a']);
  expect(reorderColumn(doc, 'a', 'x')).toBe(doc);
  expect(doc.columns?.map((c) => c.id)).toEqual(['a', 'x', 'b', 'c']);
});
it('hidden NULL and comment fields do not add columns or comment-driven height', () => {
  const doc = {
    tables: [
      {
        id: 't',
        scope: 'physical',
        physical: { name: 't' },
        canvasDisplay: { showNullable: false, showComment: false },
      },
    ],
    columns: [
      {
        id: 'c',
        tableId: 't',
        scope: 'physical',
        physical: {
          name: 'id',
          type: { name: 'varchar', length: 32, isArray: false },
          comment: '설명'.repeat(500),
        },
      },
    ],
  } as DesignDocument;
  const small = {
    ...doc,
    columns: doc.columns!.map((c) => ({ ...c, physical: { ...c.physical, comment: '' } })),
  };
  expect(tableCardMetrics(doc, 't')).toEqual(tableCardMetrics(small, 't'));
  expect(tableCardMetrics(doc, 't').grid.match(/minmax/g)).toHaveLength(3);
});
