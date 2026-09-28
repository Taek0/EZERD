import { expect, it } from 'vitest';
import { diagnoseDocument } from '@ezerd/model';
import { createPerformanceFixture, fixtureFingerprint } from './fixture.js';

it('builds repeatable valid schemas without overlapping cards', () => {
  for (const count of [10, 50, 100, 300]) {
    const doc = createPerformanceFixture(count, 10);
    expect(diagnoseDocument(doc)).toEqual([]);
    expect(doc.columns).toHaveLength(count * 10);
    expect(doc.tableRelations).toHaveLength(count);
    expect(fixtureFingerprint(doc)).toBe(fixtureFingerprint(createPerformanceFixture(count, 10)));
    const [a, b] = doc.layout.nodes;
    expect(b!.x).toBeGreaterThan(a!.x + a!.width);
  }
});
