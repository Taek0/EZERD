import { describe, expect, it } from 'vitest';
import {
  addColumn,
  addDomain,
  addTable,
  addTableReference,
  createEmptyDocument,
  diagnoseDocument,
  removeColumn,
  removeDomain,
  removeTableReference,
  updateColumn,
  updateTable,
  upsertKey,
  upsertTableRelation,
  type Table,
  type Column,
} from './index.js';

const properties = () => ({ common: {}, logical: {}, physical: {} });
const table = (id: string, domainId = 'a'): Table => ({
  id,
  domainId,
  scope: 'both',
  logical: { name: id, definition: '' },
  physical: { name: id, schema: 'public', comment: '' },
  customProperties: properties(),
});
const column = (id: string, tableId: string): Column => ({
  id,
  tableId,
  scope: 'both',
  logical: { name: id, definition: '', semanticType: '', required: false },
  physical: {
    name: id,
    type: { name: 'integer', isArray: false },
    nullable: false,
    defaultExpression: null,
    comment: '',
  },
  customProperties: properties(),
});
const seed = () =>
  ['a', 'b'].reduce(
    (doc, id) => addDomain(doc, { id, name: id, description: '' }, { x: 0, y: 0 }),
    createEmptyDocument(),
  );

describe('relational model snapshots', () => {
  it('shares stable table identity across independent view placements and logical edits', () => {
    let doc = addTable(seed(), table('t'), { x: 10, y: 20 });
    doc = addColumn(doc, column('c', 't'));
    doc = addTableReference(doc, 't', 'b', { x: 50, y: 60 });
    const edited = updateColumn(doc, 'c', {
      logical: { ...doc.columns![0]!.logical, name: '논리 이름' },
    });
    expect(edited.columns![0]!.physical).toEqual(doc.columns![0]!.physical);
    expect(doc.columns![0]!.logical.name).toBe('c');
    expect(edited.layout.nodes.filter((n) => n.objectId === 't').map((n) => n.id)).toEqual([
      'node:t:a',
      'node:t:b',
    ]);
    expect(diagnoseDocument(edited)).toEqual([]);
    expect(removeTableReference(edited, 'node:t:b').tables).toHaveLength(1);
    expect(() => removeTableReference(edited, 'node:t:a')).toThrow();
  });
  it('cascades domain ownership while preserving external source tables', () => {
    let doc = addTable(addTable(seed(), table('t'), { x: 0, y: 0 }), table('u', 'b'), {
      x: 0,
      y: 0,
    });
    doc = addTableReference(doc, 'u', 'a', { x: 0, y: 0 });
    doc = addColumn(doc, column('c', 't'));
    doc = upsertKey(doc, {
      id: 'pk',
      tableId: 't',
      scope: 'both',
      kind: 'primary',
      name: 'pk',
      columnIds: ['c'],
    });
    doc = upsertTableRelation(doc, {
      id: 'fk',
      sourceTableId: 't',
      targetTableId: 'u',
      scope: 'both',
      logical: { name: '', cardinality: 'many-to-many', required: false },
      physical: null,
    });
    const after = removeDomain(doc, 'a');
    expect(after.tables!.map((t) => t.id)).toEqual(['u']);
    expect(after.columns).toEqual([]);
    expect(after.keys).toEqual([]);
    expect(after.tableRelations).toEqual([]);
    expect(after.layout.nodes.filter((n) => n.objectId === 'u').map((n) => n.viewId)).toEqual([
      'b',
    ]);
    expect(doc.tables).toHaveLength(2);
  });
  it('removes dependent composite constraints when a column is deleted', () => {
    let doc = addColumn(addTable(seed(), table('t'), { x: 0, y: 0 }), column('c', 't'));
    doc = upsertKey(doc, {
      id: 'pk',
      tableId: 't',
      scope: 'both',
      kind: 'primary',
      name: 'pk',
      columnIds: ['c'],
    });
    expect(removeColumn(doc, 'c').keys).toEqual([]);
    expect(doc.keys).toHaveLength(1);
  });
  it('diagnoses contradictory scopes and dangling column references in persisted drafts', () => {
    let doc = addTable(seed(), { ...table('t'), scope: 'logical' }, { x: 0, y: 0 });
    doc = addColumn(doc, { ...column('c', 't'), scope: 'physical' });
    doc = upsertKey(doc, {
      id: 'pk',
      tableId: 't',
      scope: 'both',
      kind: 'primary',
      name: 'pk',
      columnIds: ['missing'],
    });
    const codes = diagnoseDocument(doc).map((d) => d.code);
    expect(codes).toContain('scope-conflict');
    expect(codes).toContain('missing-key-column');
  });
});

describe('relational ownership and independent properties', () => {
  it('isolates caller-owned nested metadata and moves ownership without cloning a table', () => {
    const input = table('t');
    let doc = addTable(seed(), input, { x: 12, y: 34 });
    input.customProperties.common.review = 'changed outside document';
    expect(doc.tables![0]!.customProperties.common).toEqual({});
    doc = updateTable(doc, 't', {
      domainId: 'b',
      physical: { name: 'sql_name', schema: 'sales', comment: '' },
    });
    expect(doc.tables).toHaveLength(1);
    expect(doc.tables![0]!.logical.name).toBe('t');
    expect(doc.layout.nodes.filter((node) => node.objectId === 't')).toHaveLength(2);
    const after = removeDomain(doc, 'a');
    expect(after.tables![0]!.id).toBe('t');
    expect(diagnoseDocument(after)).toEqual([]);
  });

  it('rejects cross-kind duplicate identities and reference placements without an owning domain', () => {
    const doc = addTable(seed(), table('t'), { x: 0, y: 0 });
    expect(() => addColumn(doc, column('a', 't'))).toThrow();
    expect(() => addTableReference(doc, 't', 'a', { x: 0, y: 0 })).toThrow();
    expect(() => addTableReference(doc, 't', 'overview', { x: 0, y: 0 })).toThrow();
    expect(() => addTableReference(doc, 't', 'b', { x: Infinity, y: 0 })).toThrow();
  });

  it('removes deleted-column FK mappings while preserving independent logical relations', () => {
    let doc = addTable(addTable(seed(), table('t'), { x: 0, y: 0 }), table('u', 'b'), {
      x: 0,
      y: 0,
    });
    doc = addColumn(addColumn(doc, column('c', 't')), column('d', 'u'));
    doc = upsertKey(doc, {
      id: 'pk',
      tableId: 'u',
      scope: 'both',
      kind: 'primary',
      name: 'pk',
      columnIds: ['d'],
    });
    doc = upsertTableRelation(doc, {
      id: 'fk',
      sourceTableId: 't',
      targetTableId: 'u',
      scope: 'both',
      logical: { name: '업무 관계', cardinality: 'one-to-many', required: false },
      physical: {
        name: 'fk',
        sourceColumnIds: ['c'],
        targetColumnIds: ['d'],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
    });
    expect(diagnoseDocument(doc)).toEqual([]);
    const after = removeColumn(doc, 'c');
    expect(after.tableRelations![0]!.physical).toBeNull();
    expect(after.tableRelations![0]!.logical).toEqual(doc.tableRelations![0]!.logical);
    expect(doc.tableRelations![0]!.physical!.sourceColumnIds).toEqual(['c']);
  });
});
