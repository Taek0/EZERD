import { expect, it } from 'vitest';

import { selectionRect, intersectingObjects } from './canvas-selection.js';
it('selects intersecting cards in either drag direction', () => {
  const rect = selectionRect({ x: 300, y: 220 }, { x: 0, y: 0 });
  expect(
    intersectingObjects(rect, [
      { objectId: 'one', x: 10, y: 10, width: 100, height: 100 },
      { objectId: 'two', x: 250, y: 100, width: 100, height: 100 },
      { objectId: 'other', x: 400, y: 400, width: 50, height: 50 },
    ]),
  ).toEqual(['one', 'two']);
  expect(intersectingObjects(selectionRect({ x: 0, y: 0 }, { x: 0, y: 0 }), [])).toEqual([]);
});
