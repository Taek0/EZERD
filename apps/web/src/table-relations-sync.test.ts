import { describe, expect, it } from 'vitest';
import { addDomain, createEmptyDocument } from '@ezerd/model';
import { applyRouteBend } from './TableRelations.js';

describe('relation route autosave', () => {
  it('applies only the final bend intent to the latest document on drag release', () => {
    const base = createEmptyDocument();
    base.layout.relations = [{ relationId: 'relation', viewId: 'orders', offset: 8, bend: { x: 1, y: 2 } }];
    const remote = addDomain(base, { id: 'remote', name: '원격 도메인', description: '' }, { x: 4, y: 5 });
    const latest = { ...remote, layout: { ...remote.layout, relations: [{ relationId: 'relation', viewId: 'orders', offset: 32, bend: { x: 3, y: 4 } }] } };

    const committed = applyRouteBend(latest, 'relation', 'orders', { x: 80, y: 90 });

    expect(committed.domains).toContainEqual(expect.objectContaining({ id: 'remote', name: '원격 도메인' }));
    expect(committed.layout.relations).toEqual([{ relationId: 'relation', viewId: 'orders', offset: 32, bend: { x: 80, y: 90 } }]);
  });
});
