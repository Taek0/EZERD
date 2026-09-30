import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type Column, type Table, type TableRelation } from '@ezerd/model';
import { projectPreview } from '../src/workspace/project-preview.js';

const table = (id: string, scope: Table['scope'] = 'physical'): Table => ({
  id,
  domainId: `domain-${id}`,
  scope,
  logical: { name: `Logical ${id}`, definition: '' },
  physical: { name: id, schema: 'public', comment: '' },
  customProperties: { common: {}, logical: {}, physical: {} },
});

const column = (id: string, tableId = 'users', scope: Column['scope'] = 'physical'): Column => ({
  id,
  tableId,
  scope,
  logical: { name: id, definition: '', semanticType: '', required: false },
  physical: {
    name: id,
    type: { name: 'int4', isArray: false },
    nullable: false,
    defaultExpression: null,
    comment: '',
  },
  customProperties: { common: {}, logical: {}, physical: {} },
});

const relation = (
  id: string,
  targetTableId: string,
  scope: TableRelation['scope'] = 'physical',
): TableRelation => ({
  id,
  sourceTableId: 'users',
  targetTableId,
  scope,
  logical: { name: id, cardinality: 'one-to-many', required: false },
  physical: {
    name: id,
    sourceColumnIds: [],
    targetColumnIds: [],
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  },
});

describe('project gallery preview', () => {
  it('returns actual empty counts without invented tables', () => {
    expect(projectPreview(createEmptyDocument())).toEqual({
      tableCount: 0,
      relationCount: 0,
      tables: [],
    });
  });

  it('bounds physical tables and columns while counting the entire saved project', () => {
    const document = createEmptyDocument();
    document.tables = [
      table('logical', 'logical'),
      table('users', 'both'),
      table('orders'),
      table('items'),
    ];
    document.columns = [
      column('hidden', 'users', 'logical'),
      column('id', 'users', 'both'),
      column('status'),
      column('amount'),
      column('omitted'),
      column('order_id', 'orders'),
    ];
    document.enums = [
      { id: 'status-enum', name: 'order_status', schema: 'public', values: ['new'] },
    ];
    document.columns[2]!.physical.type = { name: 'enum', enumId: 'status-enum', isArray: true };
    document.columns[3]!.physical.type = {
      name: 'numeric',
      precision: 10,
      scale: 2,
      isArray: false,
    };
    document.keys = [
      { id: 'pk', tableId: 'users', scope: 'both', kind: 'primary', name: '', columnIds: ['id'] },
      {
        id: 'logical-pk',
        tableId: 'users',
        scope: 'logical',
        kind: 'primary',
        name: '',
        columnIds: ['status'],
      },
      {
        id: 'unique',
        tableId: 'users',
        scope: 'physical',
        kind: 'unique',
        name: '',
        columnIds: ['amount'],
      },
    ];
    document.tableRelations = [
      relation('orders-fk', 'orders'),
      relation('items-fk', 'items', 'both'),
      relation('logical-fk', 'orders', 'logical'),
      relation('hidden-target', 'logical'),
      relation('missing-target', 'missing'),
      { ...relation('no-physical', 'orders'), physical: null },
    ];
    const before = structuredClone(document);
    expect(projectPreview(document)).toEqual({
      tableCount: 3,
      relationCount: 2,
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'INTEGER', primaryKey: true },
            { name: 'status', type: 'ORDER_STATUS[]', primaryKey: false },
            { name: 'amount', type: 'NUMERIC(10,2)', primaryKey: false },
          ],
        },
        { name: 'orders', columns: [{ name: 'order_id', type: 'INTEGER', primaryKey: false }] },
      ],
    });
    expect(document).toEqual(before);
  });
});
