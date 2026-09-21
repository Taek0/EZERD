import { expect, it } from 'vitest';
import { addDomain, createEmptyDocument } from '@ezerd/model';
import { selectionRect, intersectingObjects, translateSelectedNodes } from './canvas-selection.js';
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
it('moves a group without changing its internal spacing or unrelated data', () => {
  let doc = addDomain(
    createEmptyDocument(),
    { id: 'a', name: 'A', description: '' },
    { x: 0, y: 0 },
  );
  doc = addDomain(doc, { id: 'b', name: 'B', description: '' }, { x: 400, y: 200 });
  const next = translateSelectedNodes(doc, doc.layout.nodes, 30, -20);
  expect(next.layout.nodes.map((n) => [n.x, n.y])).toEqual([
    [30, -20],
    [430, 180],
  ]);
  expect(next.domains).toEqual(doc.domains);
  expect(doc.layout.nodes[0]!.x).toBe(0);
});
