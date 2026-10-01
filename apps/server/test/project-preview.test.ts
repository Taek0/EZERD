import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  defaultDatabaseContext,
  migrateDesignDocumentV1,
  type Column,
  type Table,
  type TableRelation,
} from '@ezerd/model';
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
  it('reads native catalog/ENUM/arrays/legacy instead of treating a native type as v1 text', () => {
    const source = createEmptyDocument();
    source.tables = [table('users'), table('orders')];
    source.columns = [column('a'), column('b'), column('c'), column('d', 'orders')];
    source.enums = [{ id: 'enum', name: 'state', schema: 'public', values: ['ok'] }];
    const native = migrateDesignDocumentV1(source, defaultDatabaseContext('postgresql')).document;
    native.columns![0]!.physical.type = {
      kind: 'builtin',
      database: 'postgresql',
      typeId: 'postgresql:integer',
      parameters: {},
      array: { dimensions: 2 },
    };
    native.columns![1]!.physical.type = {
      kind: 'projectEnum',
      database: 'postgresql',
      enumId: 'enum',
      array: { dimensions: 1 },
    };
    native.columns![2]!.physical.type = {
      kind: 'legacy',
      source: 'document-v1',
      original: { name: ' RAW_TYPE ', isArray: false },
    };
    native.columns![3]!.physical.type = {
      kind: 'valueList',
      database: 'mysql',
      typeId: 'mysql:set',
      values: ['a', 'b'],
    };
    expect(
      projectPreview(native).tables.map((item) => item.columns.map((column) => column.type)),
    ).toEqual([['INTEGER[][]', 'state[]', ' RAW_TYPE '], ['SET("a", "b")']]);
  });
  it('includes unassigned tables without relying on domain membership or card color', () => {
    const document = createEmptyDocument();
    document.tables = [{ ...table('users'), domainId: null, color: '#123456' }];
    document.columns = [column('id')];
    expect(projectPreview(document)).toEqual({
      tableCount: 1,
      relationCount: 0,
      tables: [{ name: 'users', columns: [{ name: 'id', type: 'INTEGER', primaryKey: false }] }],
    });
  });
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
