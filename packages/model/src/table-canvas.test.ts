import { describe, expect, it } from 'vitest';
import {
  TABLES_VIEW_ID,
  addDomain,
  addTable,
  addNote,
  createEmptyDocument,
  diagnoseDocument,
  extractPersonalState,
  normalizeSharedTableCanvas,
  sharedDocument,
  updateNodeLayout,
  upsertCombinedView,
  upsertRelationLayout,
  upsertTableRelation,
  type Table,
} from './index.js';

function fixture() {
  let doc = addDomain(
    createEmptyDocument(),
    { id: 'sales', name: 'Sales', description: '' },
    { x: 0, y: 0 },
  );
  const table: Table = {
    id: 'orders',
    domainId: 'sales',
    scope: 'both',
    logical: { name: '', definition: '' },
    physical: { name: 'orders', schema: 'public', comment: '' },
    customProperties: { common: {}, logical: {}, physical: {} },
  };
  doc = addTable(doc, table, { x: 10, y: 20 });
  const global = doc.layout.nodes.find((node) => node.viewId === TABLES_VIEW_ID)!;
  doc = updateNodeLayout(doc, global.id, { x: 510, y: 620 });
  doc = upsertTableRelation(doc, {
    id: 'self',
    sourceTableId: 'orders',
    targetTableId: 'orders',
    scope: 'logical',
    logical: { name: '', cardinality: 'one-to-many', required: false },
    physical: null,
  });
  doc = addNote(
    doc,
    { id: 'shared-note', viewId: 'sales', text: 'Domain annotation' },
    { x: 30, y: 40 },
  );
  return doc;
}

describe('unified shared table canvas normalization', () => {
  it('migrates shared domain notes and routes to global coordinates without changing table IDs or domain map notes', () => {
    let doc = fixture();
    doc = addNote(
      doc,
      { id: 'overview-note', viewId: 'overview', text: 'Map annotation' },
      { x: 20, y: 30 },
    );
    doc = upsertRelationLayout(doc, {
      relationId: 'self',
      viewId: 'sales',
      offset: 12,
      bend: { x: 50, y: 60 },
      waypoints: [{ x: 70, y: 80 }],
    });
    const before = structuredClone(doc);
    const normalized = normalizeSharedTableCanvas(doc);
    expect(normalized.notes.find((note) => note.id === 'shared-note')).toEqual({
      id: 'shared-note',
      viewId: TABLES_VIEW_ID,
      text: 'Domain annotation',
    });
    expect(normalized.layout.nodes.find((node) => node.objectId === 'shared-note')).toMatchObject({
      id: 'node:shared-note',
      viewId: TABLES_VIEW_ID,
      x: 530,
      y: 640,
    });
    expect(normalized.layout.relations).toEqual([
      {
        relationId: 'self',
        viewId: TABLES_VIEW_ID,
        offset: 12,
        bend: { x: 550, y: 660 },
        waypoints: [{ x: 570, y: 680 }],
      },
    ]);
    expect(normalized.tables).toEqual(doc.tables);
    expect(normalized.tableRelations).toEqual(doc.tableRelations);
    expect(normalized.notes.find((note) => note.id === 'overview-note')).toEqual(
      doc.notes.find((note) => note.id === 'overview-note'),
    );
    expect(diagnoseDocument(normalized)).toEqual([]);
    expect(normalizeSharedTableCanvas(normalized)).toBe(normalized);
    expect(doc).toEqual(before);
  });

  it('preserves existing global routes and does not publish personal view annotations', () => {
    let doc = upsertCombinedView(fixture(), {
      id: 'personal',
      name: 'Private',
      domainIds: ['sales'],
    });
    doc = addNote(
      doc,
      { id: 'private-note', viewId: 'personal', text: 'Personal annotation' },
      { x: 50, y: 60 },
    );
    doc = upsertRelationLayout(doc, { relationId: 'self', viewId: 'sales', offset: 12 });
    doc = upsertRelationLayout(doc, { relationId: 'self', viewId: TABLES_VIEW_ID, offset: 24 });
    doc = upsertRelationLayout(doc, { relationId: 'self', viewId: 'personal', offset: 36 });
    const normalized = normalizeSharedTableCanvas(doc);
    expect(
      normalized.layout.relations!.find((route) => route.viewId === TABLES_VIEW_ID)!.offset,
    ).toBe(24);
    expect(normalized.layout.relations!.filter((route) => route.viewId === 'sales')).toEqual([]);
    expect(extractPersonalState(normalized).notes).toEqual([
      { id: 'private-note', viewId: 'personal', text: 'Personal annotation' },
    ]);
    const shared = sharedDocument(normalized);
    expect(shared.notes.map((note) => note.id)).toEqual(['shared-note']);
    expect(shared.layout.relations).toEqual([
      { relationId: 'self', viewId: TABLES_VIEW_ID, offset: 24 },
    ]);
    expect(diagnoseDocument(normalized)).toEqual([]);
  });

  it('keeps an explicitly chosen global creation position even when the selected domain has overlapping owner coordinates', () => {
    const doc = fixture();
    const owned = { ...doc.tables![0]!, id: 'new-order' };
    const next = addTable(doc, owned, { x: 510, y: 620 }, TABLES_VIEW_ID);
    expect(
      next.layout.nodes.find(
        (node) => node.objectId === owned.id && node.viewId === TABLES_VIEW_ID,
      ),
    ).toMatchObject({ x: 510, y: 620 });
    expect(next.tables!.find((table) => table.id === owned.id)!.domainId).toBe('sales');
    expect(() => addTable(doc, owned, { x: 0, y: 0 }, 'missing')).toThrow();
  });
});
