import { describe, expect, it } from 'vitest';
import {
  TABLES_VIEW_ID,
  addTable,
  addDomain,
  addColumn,
  addNote,
  autoLayoutView,
  createEmptyDocument,
  diagnoseDocument,
  ensureTableCanvasLayout,
  exportPostgres,
  extractPersonalState,
  reconcilePersonalState,
  removeTableReference,
  sharedDocument,
  updateNodeLayout,
  updateTable,
  upsertCombinedView,
  upsertKey,
  upsertTableRelation,
  upsertRelationLayout,
  type Table,
  type Column,
} from './index.js';

const table = (id: string, domainId: string | null = null): Table => ({
  id,
  domainId,
  scope: 'physical',
  logical: { name: id, definition: '' },
  physical: { name: id, schema: 'public', comment: '' },
  customProperties: { common: {}, logical: {}, physical: {} },
});
const column = (id: string, tableId: string): Column => ({
  id,
  tableId,
  scope: 'physical',
  logical: { name: id, definition: '', semanticType: '', required: true },
  physical: {
    name: id,
    type: { name: 'integer', isArray: false },
    nullable: false,
    defaultExpression: null,
    comment: '',
  },
  customProperties: { common: {}, logical: {}, physical: {} },
});

describe('direct table canvas', () => {
  it('creates a complete physical model and FK with zero domains', () => {
    let doc = addTable(createEmptyDocument(), table('parent'), { x: 0, y: 0 });
    doc = addTable(doc, table('child'), { x: 500, y: 0 });
    doc = addColumn(addColumn(doc, column('id', 'parent')), column('parent_id', 'child'));
    doc = upsertKey(doc, {
      id: 'pk',
      tableId: 'parent',
      scope: 'physical',
      kind: 'primary',
      name: 'parent_pk',
      columnIds: ['id'],
    });
    doc = upsertTableRelation(doc, {
      id: 'fk',
      sourceTableId: 'child',
      targetTableId: 'parent',
      scope: 'physical',
      logical: { name: '', cardinality: 'one-to-many', required: true },
      physical: {
        name: 'child_parent_fk',
        sourceColumnIds: ['parent_id'],
        targetColumnIds: ['id'],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
    });
    doc = upsertRelationLayout(doc, { relationId: 'fk', viewId: TABLES_VIEW_ID, offset: 20 });
    expect(doc.domains).toEqual([]);
    expect(diagnoseDocument(doc)).toEqual([]);
    const ddl = exportPostgres(doc);
    expect(ddl.diagnostics).toEqual([]);
    expect(ddl.sql).toContain('FOREIGN KEY');
    expect(ddl.sql).toContain('"child"');
    const arranged = autoLayoutView(doc, TABLES_VIEW_ID);
    expect(diagnoseDocument(arranged)).toEqual([]);
    expect(arranged.tables).toEqual(doc.tables);
    expect(() => removeTableReference(doc, doc.layout.nodes[0]!.id)).toThrow();
  });

  it('assigns, moves and unassigns ownership while preserving global identity, color and routes', () => {
    let doc = addDomain(
      createEmptyDocument(),
      { id: 'a', name: 'A', description: '', color: '#12b76a' },
      { x: 0, y: 0 },
    );
    doc = addDomain(doc, { id: 'b', name: 'B', description: '' }, { x: 300, y: 0 });
    doc = addTable(doc, { ...table('t'), color: '#465fff' }, { x: 123, y: 456 });
    const global = doc.layout.nodes.find((node) => node.viewId === TABLES_VIEW_ID)!;
    const assigned = updateTable(doc, 't', { domainId: 'a' });
    let viewed = upsertCombinedView(assigned, {
      id: 'combined',
      name: 'Together',
      domainIds: ['a'],
    });
    const owner = viewed.layout.nodes.find((node) => node.viewId === 'a' && node.objectId === 't')!;
    viewed = updateNodeLayout(viewed, owner.id, { x: 900, y: 800 });
    const moved = updateTable(viewed, 't', { domainId: 'b' });
    expect(moved.layout.nodes.find((node) => node.viewId === TABLES_VIEW_ID)).toEqual(global);
    const unassigned = updateTable(moved, 't', { domainId: null });
    expect(unassigned.layout.nodes.filter((node) => node.objectId === 't')).toEqual([global]);
    expect(unassigned.tables![0]).toEqual({ ...doc.tables![0], domainId: null });
    expect(diagnoseDocument(unassigned)).toEqual([]);
    expect(updateTable(unassigned, 't', { color: undefined }).tables![0]!.color).toBeUndefined();
    expect(doc.tables![0]!.color).toBe('#465fff');
  });

  it('normalizes legacy domain layouts deterministically and preserves independent existing placements', () => {
    let doc = addDomain(
      createEmptyDocument(),
      { id: 'a', name: 'A', description: '' },
      { x: 0, y: 0 },
    );
    doc = addTable(doc, table('t', 'a'), { x: 10, y: 20 });
    doc = addTable(doc, table('u', 'a'), { x: 10, y: 20 });
    const legacy = {
      ...doc,
      layout: {
        ...doc.layout,
        nodes: doc.layout.nodes.filter((node) => node.viewId !== TABLES_VIEW_ID),
      },
    };
    expect(diagnoseDocument(legacy)).toEqual([]);
    const normalized = ensureTableCanvasLayout(legacy);
    expect(ensureTableCanvasLayout(normalized)).toBe(normalized);
    expect(ensureTableCanvasLayout(structuredClone(legacy))).toEqual(normalized);
    expect(normalized.layout.nodes.filter((node) => node.viewId !== TABLES_VIEW_ID)).toEqual(
      legacy.layout.nodes,
    );
    expect(normalized.layout.nodes.filter((node) => node.viewId === TABLES_VIEW_ID)).toHaveLength(
      2,
    );
    expect(diagnoseDocument(normalized)).toEqual([]);
    expect(legacy.layout.nodes).toHaveLength(3);
  });

  it('shares global notes and layouts while retaining the personal global viewport', () => {
    let doc = addTable(createEmptyDocument(), table('t'), { x: 0, y: 0 });
    doc = addNote(doc, { id: 'note', viewId: TABLES_VIEW_ID, text: 'shared' }, { x: 400, y: 0 });
    doc = {
      ...doc,
      layout: { ...doc.layout, viewports: [{ viewId: TABLES_VIEW_ID, x: 12, y: 34, zoom: 2 }] },
    };
    const personal = extractPersonalState(doc);
    expect(personal.nodes).toEqual([]);
    expect(personal.notes).toEqual([]);
    const shared = sharedDocument(doc);
    expect(shared.layout.nodes).toEqual(doc.layout.nodes);
    expect(shared.notes).toEqual(doc.notes);
    expect(shared.layout.viewports).toEqual([]);
    expect(reconcilePersonalState(shared, personal).viewports).toEqual(doc.layout.viewports);
  });

  it('rejects unknown domains, invalid colors and reserved table/view identities', () => {
    expect(() => addTable(createEmptyDocument(), table('t', 'missing'), { x: 0, y: 0 })).toThrow();
    expect(() =>
      addTable(createEmptyDocument(), { ...table('t'), color: 'red' }, { x: 0, y: 0 }),
    ).toThrow();
    expect(() => addTable(createEmptyDocument(), table(TABLES_VIEW_ID), { x: 0, y: 0 })).toThrow();
    const doc = addTable(createEmptyDocument(), table('t'), { x: 0, y: 0 });
    expect(() => updateTable(doc, 't', { domainId: 'missing' })).toThrow();
    expect(() => updateTable(doc, 't', { color: '#xyzxyz' })).toThrow();
    const broken = { ...doc, tables: [{ ...doc.tables![0]!, color: 'red' }] };
    expect(diagnoseDocument(broken).map((issue) => issue.code)).toContain('invalid-table-color');
  });
});
