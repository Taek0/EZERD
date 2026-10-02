import { expect, it } from 'vitest';
import { TABLES_VIEW_ID } from '@ezerd/model';
import { createNativePerformanceFixture } from './native-fixture.js';
import { nativeCanvasScene } from '../../features/projects/NativeERDCanvas.js';
import { createPerformanceFixture, createHistoricalPerformanceFixture } from './fixture.js';

it('uses the shared view for current legacy fixtures and preserves historical layouts', () => {
  expect(
    createPerformanceFixture().layout.nodes.filter((n) => n.viewId === TABLES_VIEW_ID),
  ).toHaveLength(10);
  expect(
    createHistoricalPerformanceFixture().layout.nodes.filter((n) => n.viewId === 'perf'),
  ).toHaveLength(10);
});
it.each([10, 50])('builds a valid native snapshot and visible scene for %i tables', (count) => {
  const fixture = createNativePerformanceFixture(count, 10);
  const before = structuredClone(fixture);
  expect(fixture.snapshot.sourceDocument.schemaVersion).toBe(2);
  const scene = nativeCanvasScene(fixture.document, TABLES_VIEW_ID, 'physical');
  expect(scene.nodes.filter((n) => n.viewId === TABLES_VIEW_ID)).toHaveLength(count);
  expect(scene.relations).toHaveLength(count);
  expect(fixture).toEqual(before);
});
