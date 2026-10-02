import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  addDomain,
  addTable,
  type Table,
  type DesignDocument,
  TABLES_VIEW_ID,
  updateTable,
} from '@ezerd/model';
import { diagnosticTarget } from './ddl-diagnostics.js';
const table: Table = {
  id: 't',
  domainId: 'd',
  scope: 'both',
  logical: { name: '주문', definition: '' },
  physical: { name: 'orders', schema: 'public', comment: '' },
  customProperties: { common: {}, logical: {}, physical: {} },
};
const document: DesignDocument = {
  ...addTable(
    addDomain(createEmptyDocument(), { id: 'd', name: '판매', description: '' }, { x: 0, y: 0 }),
    table,
    { x: 100, y: 200 },
  ),
  keys: [
    { id: 'k', tableId: 't', scope: 'both', kind: 'primary', name: 'orders_pk', columnIds: [] },
  ],
  tableRelations: [
    {
      id: 'r',
      sourceTableId: 't',
      targetTableId: 'missing',
      scope: 'both',
      logical: { name: '고객 주문', cardinality: 'one-to-many', required: false },
      physical: null,
    },
  ],
};
describe('actionable DDL diagnostics', () => {
  it('focuses an unassigned table and its owned keys in the global canvas', () => {
    const unassigned = updateTable(document, 't', { domainId: null });
    expect(diagnosticTarget(unassigned, 't').target).toMatchObject({
      viewId: TABLES_VIEW_ID,
      objectId: 't',
    });
    expect(diagnosticTarget(unassigned, 'k').target).toEqual(
      diagnosticTarget(unassigned, 't').target,
    );
  });
  it('labels keys and relations and focuses the owning table', () => {
    const key = diagnosticTarget(document, 'k');
    expect(key.label).toBe('orders / orders_pk');
    expect(key.target).toMatchObject({ viewId: 'd', objectId: 't' });
    expect(diagnosticTarget(document, 'r').label).toBe('고객 주문');
    expect(diagnosticTarget(document, 'r').target).toEqual(key.target);
  });
  it('falls back to the owning domain if table placement is missing', () => {
    const result = diagnosticTarget(
      {
        ...document,
        layout: {
          ...document.layout,
          nodes: document.layout.nodes.filter((n) => n.objectId !== 't'),
        },
      },
      't',
    );
    expect(result.target).toMatchObject({ viewId: 'overview', objectId: 'd' });
  });
  it('does not expose unknown identifiers to the user', () => {
    expect(diagnosticTarget(document, 'unknown-private-id')).toEqual({
      label: '설계 전체',
      target: null,
    });
    expect(diagnosticTarget(createEmptyDocument(), 'document')).toEqual({
      label: '설계 전체',
      target: null,
    });
  });
});
