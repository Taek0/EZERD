import { describe, expect, it } from 'vitest';
import {
  addDomain,
  addTable,
  addNote,
  createEmptyDocument,
  upsertCombinedView,
  TABLES_VIEW_ID,
  updateNodeLayout,
} from '@ezerd/model';
import {
  domainCanvasTarget,
  domainFilterNames,
  domainFilterOwner,
  matchesDomainFilter,
  type DomainFilter,
} from './domain-view.js';

function seed() {
  let doc = createEmptyDocument();
  for (const id of ['a', 'b'])
    doc = addDomain(doc, { id, name: id.toUpperCase(), description: '' }, { x: 0, y: 0 });
  for (const domainId of ['a', 'b', null])
    doc = addTable(
      doc,
      {
        id: domainId ? `t-${domainId}` : 'unassigned',
        domainId,
        scope: 'physical',
        logical: { name: '', definition: '' },
        physical: { name: domainId ?? 'free', schema: 'public', comment: '' },
        customProperties: { common: {}, logical: {}, physical: {} },
      },
      { x: domainId === 'a' ? 100 : 500, y: 200 },
      TABLES_VIEW_ID,
    );
  return upsertCombinedView(doc, { id: 'legacy', name: 'Legacy', domainIds: ['a', 'b'] });
}

describe('local domain filters on one shared canvas', () => {
  it('supports all, single, multiple, unassigned and mixed selections without changing the document', () => {
    const doc = seed(),
      before = structuredClone(doc);
    const cases: [DomainFilter, string[]][] = [
      [null, ['t-a', 't-b', 'unassigned']],
      [{ domainIds: ['a'], unassigned: false }, ['t-a']],
      [{ domainIds: ['a', 'b'], unassigned: false }, ['t-a', 't-b']],
      [{ domainIds: [], unassigned: true }, ['unassigned']],
      [{ domainIds: ['b'], unassigned: true }, ['t-b', 'unassigned']],
      [{ domainIds: [], unassigned: false }, []],
    ];
    for (const [filter, expected] of cases)
      expect(doc.tables!.filter((t) => matchesDomainFilter(t, filter)).map((t) => t.id)).toEqual(
        expected,
      );
    expect(doc).toEqual(before);
    expect(domainFilterNames(doc, { domainIds: ['b', 'a'], unassigned: true })).toEqual(['A', 'B']);
  });
  it('assigns an owner only for a single valid domain, keeping domain-first creation at the exact global pointer', () => {
    const doc = seed();
    const filter = domainCanvasTarget(doc, 'a').filter;
    expect(domainFilterOwner(doc, filter)).toBe('a');
    const next = addTable(
      doc,
      { ...doc.tables![0]!, id: 'new', domainId: domainFilterOwner(doc, filter) },
      { x: 125, y: 240 },
      TABLES_VIEW_ID,
    );
    expect(next.tables!.find((t) => t.id === 'new')!.domainId).toBe('a');
    expect(
      next.layout.nodes.find((n) => n.objectId === 'new' && n.viewId === TABLES_VIEW_ID),
    ).toMatchObject({ x: 125, y: 240 });
    for (const filter of [
      null,
      { domainIds: ['a', 'b'], unassigned: false },
      { domainIds: ['a'], unassigned: true },
      { domainIds: [], unassigned: true },
      { domainIds: ['deleted'], unassigned: false },
    ])
      expect(domainFilterOwner(doc, filter)).toBeNull();
  });
  it('redirects legacy domain and combined links without creating personal views or changing placements', () => {
    const doc = seed(),
      before = structuredClone(doc);
    expect(domainCanvasTarget(doc, 'a')).toEqual({
      viewId: TABLES_VIEW_ID,
      filter: { domainIds: ['a'], unassigned: false },
    });
    expect(domainCanvasTarget(doc, 'legacy')).toEqual({
      viewId: TABLES_VIEW_ID,
      filter: { domainIds: ['a', 'b'], unassigned: false },
    });
    expect(domainCanvasTarget(doc, TABLES_VIEW_ID)).toEqual({
      viewId: TABLES_VIEW_ID,
      filter: null,
    });
    expect(domainCanvasTarget(doc, 'removed')).toEqual({ viewId: TABLES_VIEW_ID, filter: null });
    expect(domainCanvasTarget(doc, 'overview')).toEqual({ viewId: 'overview', filter: null });
    expect(doc).toEqual(before);
  });
  it('keeps all future tables visible in the all filter and editing uses the same shared node through every filter', () => {
    const doc = addNote(
      seed(),
      { id: 'shared-note', viewId: TABLES_VIEW_ID, text: 'Shared' },
      { x: 50, y: 80 },
    );
    const node = doc.layout.nodes.find((n) => n.objectId === 't-a' && n.viewId === TABLES_VIEW_ID)!;
    const next = updateNodeLayout(doc, node.id, { x: 900, width: 440 });
    for (const filter of [
      null,
      domainCanvasTarget(next, 'a').filter,
      domainCanvasTarget(next, 'legacy').filter,
    ]) {
      expect(matchesDomainFilter(next.tables![0]!, filter)).toBe(true);
      expect(next.layout.nodes.find((n) => n.id === node.id)).toMatchObject({ x: 900, width: 440 });
    }
    expect(next.layout.nodes.filter((n) => n.viewId === 'legacy')).toEqual(
      doc.layout.nodes.filter((n) => n.viewId === 'legacy'),
    );
    expect(next.notes).toEqual(doc.notes);
  });
});
