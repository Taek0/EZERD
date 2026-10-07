import { expect, it } from 'vitest';

import { tableCardMetrics } from './table-geometry.js';
import type { DesignDocument } from '@ezerd/model';
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
