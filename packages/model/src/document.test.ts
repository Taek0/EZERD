import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  addDomain,
  updateDomain,
  removeDomain,
  upsertDomainRelation,
  addNote,
  removeNote,
  updateNodeLayout,
  setViewport,
} from './index.js';

const domain = (id: string) => ({ id, name: id, description: '' });
const seed = () =>
  addDomain(
    addDomain(createEmptyDocument(), domain('orders'), { x: 10.5, y: -20 }),
    domain('payments'),
    { x: 400, y: 50 },
  );

describe('domain document editing', () => {
  it('separates stable model identity from layout without mutating prior snapshots', () => {
    const before = seed();
    const after = updateDomain(before, 'orders', { name: '주문' });
    expect(before.domains[0]?.name).toBe('orders');
    expect(after.domains[0]).toEqual({ id: 'orders', name: '주문', description: '' });
    expect(after.layout).toEqual(before.layout);
    expect(after.layout.nodes[0]).toMatchObject({ objectId: 'orders', x: 10.5, y: -20 });
  });
  it('keeps domain business relations independent of physical foreign keys', () => {
    const after = upsertDomainRelation(seed(), {
      id: 'r',
      sourceDomainId: 'orders',
      targetDomainId: 'payments',
      name: '결제 요청',
      direction: 'forward',
      description: '',
    });
    expect(after.domainRelations).toHaveLength(1);
    expect(Object.keys(after).sort()).toEqual(
      ['schemaVersion', 'domains', 'domainRelations', 'notes', 'layout'].sort(),
    );
    expect(() =>
      upsertDomainRelation(after, { ...after.domainRelations[0]!, targetDomainId: 'missing' }),
    ).toThrow();
  });
  it('deletes incident relations, domain notes and layouts without touching unrelated objects', () => {
    let before = upsertDomainRelation(seed(), {
      id: 'r',
      sourceDomainId: 'orders',
      targetDomainId: 'payments',
      name: '',
      direction: 'both',
      description: '',
    });
    before = addNote(before, { id: 'n1', viewId: 'orders', text: 'inside' }, { x: 0, y: 0 });
    before = addNote(before, { id: 'n2', viewId: 'overview', text: 'outside' }, { x: 2, y: 4 });
    before = setViewport(before, { viewId: 'orders', x: 25, y: 40, zoom: 1.5 });
    const after = removeDomain(before, 'orders');
    expect(after.domains.map((d) => d.id)).toEqual(['payments']);
    expect(after.domainRelations).toEqual([]);
    expect(after.notes.map((n) => n.id)).toEqual(['n2']);
    expect(after.layout.nodes.map((n) => n.objectId)).toEqual(['payments', 'n2']);
    expect(after.layout.viewports.map((v) => v.viewId)).toEqual(['overview']);
    expect(before.notes).toHaveLength(2);
  });
  it('preserves per-view pan and zoom and allows unsnapped node coordinates', () => {
    const before = seed();
    const node = before.layout.nodes[0]!;
    let after = updateNodeLayout(before, node.id, { x: -12.25, width: 320 });
    after = setViewport(after, { viewId: 'overview', x: 100, y: -23.5, zoom: 0.6 });
    after = setViewport(after, { viewId: 'orders', x: 1, y: 2, zoom: 1.2 });
    expect(after.layout.nodes[0]).toMatchObject({ x: -12.25, width: 320 });
    expect(after.layout.viewports).toHaveLength(2);
    expect(before.layout.viewports[0]?.zoom).toBe(1);
    expect(() => updateNodeLayout(after, node.id, { x: Infinity })).toThrow();
    expect(() => setViewport(after, { viewId: 'orders', x: 0, y: 0, zoom: 0 })).toThrow();
  });
  it('rejects duplicate identities and unknown views while removing a note layout with its text', () => {
    const before = seed();
    expect(() => addDomain(before, domain('orders'), { x: 0, y: 0 })).toThrow();
    expect(() =>
      addNote(before, { id: 'orders', viewId: 'overview', text: '' }, { x: 0, y: 0 }),
    ).toThrow();
    expect(() =>
      addNote(before, { id: 'n', viewId: 'missing', text: '' }, { x: 0, y: 0 }),
    ).toThrow();
    const after = removeNote(
      addNote(before, { id: 'n', viewId: 'overview', text: '안내' }, { x: 0, y: 0 }),
      'n',
    );
    expect(after).toEqual(before);
  });
});
