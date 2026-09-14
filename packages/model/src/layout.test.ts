import { describe, expect, it } from 'vitest';
import { autoLayoutView } from './layout.js';
import { createEmptyDocument, type DesignDocument, type NodeLayout } from './document.js';

function fixture(ids: string[], edges: [string, string][]): DesignDocument {
  return { ...createEmptyDocument(), domains: ids.map(id => ({ id, name: id, description: '' })),
    domainRelations: edges.map(([sourceDomainId, targetDomainId], i) => ({ id: `r${i}`, sourceDomainId, targetDomainId, direction: 'forward', name: '', description: '' })),
    layout: { nodes: ids.map((objectId, i) => ({ id: `n:${objectId}`, objectId, viewId: 'overview', x: 3, y: 7, width: 240 + i * 30, height: 180 + i * 50 })), viewports: [{ viewId: 'overview', x: 22, y: -10, zoom: 0.7 }] } };
}
function noOverlap(nodes: NodeLayout[]) {
  for (let i = 0; i < nodes.length; i++) for (const b of nodes.slice(i + 1)) {
    const a = nodes[i]!;
    expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
  }
}

describe('manual relationship flow layout', () => {
  it('places branched flow left to right using real card dimensions, without mutating the snapshot', () => {
    const before = fixture(['a', 'b', 'c', 'd'], [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']]);
    const snapshot = structuredClone(before);
    const after = autoLayoutView(before, 'overview');
    const nodes = new Map(after.layout.nodes.map(n => [n.objectId, n]));
    for (const relation of before.domainRelations) expect(nodes.get(relation.sourceDomainId)!.x + nodes.get(relation.sourceDomainId)!.width).toBeLessThan(nodes.get(relation.targetDomainId)!.x);
    noOverlap(after.layout.nodes);
    expect(before).toEqual(snapshot);
    expect(after.domains).toBe(before.domains);
    expect(after.layout.viewports).toBe(before.layout.viewports);
  });
  it('handles cycles, both-direction edges, parallel edges, self loops and disconnected nodes deterministically', () => {
    const before = fixture(['z', 'a', 'b', 'c', 'isolated'], [['a', 'b'], ['b', 'c'], ['c', 'a'], ['c', 'z'], ['c', 'z'], ['z', 'z']]);
    before.domainRelations.push({ id: 'both', sourceDomainId: 'a', targetDomainId: 'b', direction: 'both', name: '', description: '' });
    const after = autoLayoutView(before, 'overview');
    noOverlap(after.layout.nodes);
    expect(autoLayoutView(after, 'overview')).toEqual(after);
    const reordered = autoLayoutView({ ...before, domains: [...before.domains].reverse(), domainRelations: [...before.domainRelations].reverse(), layout: { ...before.layout, nodes: [...before.layout.nodes].reverse() } }, 'overview');
    expect(reordered.layout.nodes.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual(after.layout.nodes.toSorted((a, b) => a.id.localeCompare(b.id)));
  });
  it('includes external table placements but preserves ownership, notes, unknown placements and every other view', () => {
    const before = fixture(['d1', 'd2'], []);
    const properties = { common: {}, logical: {}, physical: {} };
    before.tables = ['t1', 't2'].map((id, i) => ({ id, domainId: `d${i + 1}`, scope: 'both', logical: { name: id, definition: '' }, physical: { name: id, schema: 'public', comment: '' }, customProperties: properties }));
    before.tableRelations = [{ id: 'fk', sourceTableId: 't1', targetTableId: 't2', scope: 'both', logical: { name: '', cardinality: 'one-to-many', required: false }, physical: null }];
    before.notes = [{ id: 'note', viewId: 'd1', text: 'keep' }];
    for (const [objectId, viewId] of [['t1', 'd1'], ['t2', 'd1'], ['t2', 'd2'], ['note', 'd1'], ['missing', 'd1']] as const) before.layout.nodes.push({ id: `${objectId}:${viewId}`, objectId, viewId, x: 12, y: 34, width: 340, height: 310 });
    const after = autoLayoutView(before, 'd1');
    const selected = after.layout.nodes.filter(n => n.viewId === 'd1' && n.objectId.startsWith('t'));
    noOverlap(selected);
    noOverlap([...selected, after.layout.nodes.find(n => n.objectId === 'note')!]);
    expect(selected[0]!.x + selected[0]!.width).toBeLessThan(selected[1]!.x);
    expect(after.tables).toBe(before.tables);
    expect(after.notes).toBe(before.notes);
    for (const n of before.layout.nodes.filter(n => !selected.some(s => s.id === n.id))) expect(after.layout.nodes.find(a => a.id === n.id)).toBe(n);
  });
  it('returns unchanged empty views and rejects an unknown view', () => {
    const empty = createEmptyDocument();
    expect(autoLayoutView(empty, 'overview')).toBe(empty);
    expect(() => autoLayoutView(empty, 'missing')).toThrow();
  });
  it('handles a long relationship chain without recursive stack exhaustion', () => {
    const ids = Array.from({ length: 3000 }, (_, i) => `d${i}`);
    const before = fixture(ids, ids.slice(1).map((id, i) => [ids[i]!, id]));
    before.layout.nodes = before.layout.nodes.map(n => ({ ...n, width: 240, height: 180 }));
    const after = autoLayoutView(before, 'overview');
    expect(after.layout.nodes[2999]!.x).toBeGreaterThan(after.layout.nodes[0]!.x);
    expect(after.layout.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
  });
});
