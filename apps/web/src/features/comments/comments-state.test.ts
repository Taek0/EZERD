import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  addDomain,
  addTable,
  addNote,
  upsertCombinedView,
  normalizeSharedTableCanvas,
  TABLES_VIEW_ID,
  removeDomain,
  updateNodeLayout,
} from '@ezerd/model';
import {
  pinPosition,
  pinAttachment,
  pinVisibleInCanvas,
  selectedMentions,
  LatestRequest,
} from './comments-state.js';
describe('review pins and mentions', () => {
  it('keeps blank global pins valid and follows global table attachments without a domain', () => {
    const blank = createEmptyDocument();
    expect(pinPosition(blank, { viewId: TABLES_VIEW_ID, objectId: null, x: 7, y: 8 })).toEqual({
      x: 7,
      y: 8,
      missing: false,
    });
    const document = addTable(
      blank,
      {
        id: 't',
        domainId: null,
        scope: 'physical',
        logical: { name: '', definition: '' },
        physical: { name: 'orders', schema: 'public', comment: '' },
        customProperties: { common: {}, logical: {}, physical: {} },
      },
      { x: 100, y: 200 },
    );
    const attachment = pinAttachment(document, TABLES_VIEW_ID, 't', { x: 112, y: 224 });
    const node = document.layout.nodes.find((node) => node.objectId === 't')!;
    expect(
      pinPosition(updateNodeLayout(document, node.id, { x: 400 }), {
        ...attachment,
        viewId: TABLES_VIEW_ID,
      }),
    ).toEqual({ x: 412, y: 224, missing: false });
  });
  const doc = addDomain(
    createEmptyDocument(),
    { id: 'd', name: 'Domain', description: '' },
    { x: 100, y: 200 },
  );
  const thread = { viewId: 'overview', objectId: 'd', x: 12, y: 24 };
  it('stores object-relative pins and follows moved objects', () => {
    expect(pinAttachment(doc, 'overview', 'd', { x: 112, y: 224 })).toEqual({
      objectId: 'd',
      x: 12,
      y: 24,
    });
    expect(pinPosition(updateNodeLayout(doc, 'node:d', { x: 400 }), thread)).toEqual({
      x: 412,
      y: 224,
      missing: false,
    });
  });
  it('preserves threads with deleted targets and keeps blank pins absolute', () => {
    expect(pinPosition(removeDomain(doc, 'd'), thread).missing).toBe(true);
    expect(pinPosition(doc, { ...thread, objectId: null })).toEqual({
      x: 12,
      y: 24,
      missing: false,
    });
    expect(pinAttachment(doc, 'overview', 'missing', { x: 7, y: 8 })).toEqual({
      objectId: null,
      x: 7,
      y: 8,
    });
  });
  it('marks blank pins in deleted domain views as missing', () => {
    expect(pinPosition(doc, { viewId: 'deleted-domain', objectId: null, x: 7, y: 8 }).missing).toBe(
      true,
    );
  });
  it('mentions only selected existing IDs, not ambiguous typed names', () => {
    expect(selectedMentions(['a', 'a', 'unknown', 'b'], [{ id: 'a' }, { id: 'b' }])).toEqual([
      'a',
      'b',
    ]);
  });
  it('ignores responses from superseded navigation requests', () => {
    const gate = new LatestRequest();
    const old = gate.begin();
    const next = gate.begin();
    expect(gate.isCurrent(old)).toBe(false);
    expect(gate.isCurrent(next)).toBe(true);
    gate.begin();
    expect(gate.isCurrent(next)).toBe(false);
  });
});

describe('unified canvas legacy pins', () => {
  function seed() {
    let doc = addDomain(
      createEmptyDocument(),
      { id: 'd', name: 'Domain', description: '' },
      { x: 0, y: 0 },
    );
    doc = addTable(
      doc,
      {
        id: 't',
        domainId: 'd',
        scope: 'physical',
        logical: { name: '', definition: '' },
        physical: { name: 'orders', schema: 'public', comment: '' },
        customProperties: { common: {}, logical: {}, physical: {} },
      },
      { x: 100, y: 200 },
      TABLES_VIEW_ID,
    );
    doc = upsertCombinedView(doc, { id: 'legacy', name: 'Personal', domainIds: ['d'] });
    doc = addNote(doc, { id: 'shared', viewId: 'd', text: 'Shared' }, { x: 120, y: 220 });
    doc = addNote(doc, { id: 'private', viewId: 'legacy', text: 'Private' }, { x: 8000, y: 8000 });
    return normalizeSharedTableCanvas(doc);
  }
  it('follows canonical global table and migrated shared-note coordinates from legacy targets', () => {
    const doc = seed();
    for (const objectId of ['t', 'shared']) {
      const node = doc.layout.nodes.find(
        (n) => n.objectId === objectId && n.viewId === TABLES_VIEW_ID,
      )!;
      const moved = updateNodeLayout(doc, node.id, { x: 700, y: 900 });
      for (const viewId of ['d', TABLES_VIEW_ID])
        expect(pinPosition(moved, { viewId, objectId, x: 12, y: 24 })).toEqual({
          x: 712,
          y: 924,
          missing: false,
        });
    }
    expect(pinPosition(doc, { viewId: 'legacy', objectId: 't', x: 12, y: 24 })).toMatchObject({
      x: 112,
      y: 224,
      missing: false,
    });
  });
  it('hides table pins outside the local filter while keeping blank and shared note pins visible', () => {
    const doc = seed();
    const visible = ['shared'];
    const target = { viewId: TABLES_VIEW_ID, objectId: 't', x: 12, y: 24 };
    expect(pinVisibleInCanvas(doc, target, TABLES_VIEW_ID, visible)).toBe(false);
    expect(pinVisibleInCanvas(doc, { ...target, viewId: 'd' }, TABLES_VIEW_ID, ['t'])).toBe(true);
    expect(
      pinVisibleInCanvas(doc, { ...target, objectId: 'shared' }, TABLES_VIEW_ID, visible),
    ).toBe(true);
    expect(pinVisibleInCanvas(doc, { ...target, objectId: null }, TABLES_VIEW_ID, visible)).toBe(
      true,
    );
  });
  it('does not publish personal notes or personal absolute pins as global annotations', () => {
    const doc = seed();
    for (const objectId of ['private', null])
      expect(
        pinVisibleInCanvas(doc, { viewId: 'legacy', objectId, x: 3, y: 4 }, TABLES_VIEW_ID),
      ).toBe(false);
    expect(doc.notes.find((n) => n.id === 'private')!.viewId).toBe('legacy');
  });
});
