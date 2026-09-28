import { expect, it } from 'vitest';
import { diagnoseDocument } from '@ezerd/model';
import { createTestDocument } from './diagram-fixture.js';

it('creates valid deterministic schemas for geometry regression tests', () => {
  for (const count of [10, 50, 100, 300]) {
    const doc = createTestDocument(count, 10);
    expect(diagnoseDocument(doc)).toEqual([]);
    expect(doc).toEqual(createTestDocument(count, 10));
    expect(doc.columns).toHaveLength(count * 10);
  }
});
