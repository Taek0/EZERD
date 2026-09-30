import { describe, expect, it } from 'vitest';
import type { DesignDocument, Project } from '@ezerd/contracts';
import {
  listTables,
  listViewRelations,
  projectSummary,
  projectView,
  tableDetails,
  type ProjectState,
} from '../src/mcp/mcp-read.js';

const now = new Date().toISOString();
const properties = { common: {}, logical: {}, physical: {} };
const project: Project = {
  id: crypto.randomUUID(),
  workspaceId: crypto.randomUUID(),
  name: 'Scoped reads',
  status: 'active',
  version: 7,
  createdAt: now,
  updatedAt: now,
};
const document: DesignDocument = {
  schemaVersion: 1,
  views: [{ id: 'combined', name: 'Combined', domainIds: ['sales'] }],
  domains: [
    { id: 'sales', name: 'Sales', description: 'Long domain description' },
    { id: 'identity', name: 'Identity', description: '' },
  ],
  domainRelations: [],
  tables: [
    {
      id: 'orders',
      domainId: 'sales',
      scope: 'both',
      logical: { name: 'Orders', definition: 'Long table definition' },
      physical: { name: 'orders', schema: 'public', comment: '' },
      customProperties: properties,
    },
    {
      id: 'users',
      domainId: 'identity',
      scope: 'both',
      logical: { name: 'Users', definition: '' },
      physical: { name: 'users', schema: 'public', comment: '' },
      customProperties: properties,
    },
  ],
  columns: [
    {
      id: 'order-id',
      tableId: 'orders',
      scope: 'both',
      logical: { name: 'Order ID', definition: '', semanticType: '', required: true },
      physical: {
        name: 'id',
        type: { name: 'uuid', isArray: false },
        nullable: false,
        defaultExpression: null,
        comment: '',
      },
      customProperties: properties,
    },
  ],
  keys: [
    {
      id: 'orders-pk',
      tableId: 'orders',
      scope: 'both',
      kind: 'primary',
      name: 'orders_pk',
      columnIds: ['order-id'],
    },
  ],
  tableRelations: [
    {
      id: 'orders-users',
      sourceTableId: 'orders',
      targetTableId: 'users',
      scope: 'logical',
      logical: { name: 'owner', cardinality: 'many-to-many', required: false },
      physical: null,
    },
  ],
  notes: [],
  layout: {
    nodes: [
      {
        id: 'node:orders',
        objectId: 'orders',
        viewId: 'sales',
        x: 0,
        y: 0,
        width: 240,
        height: 180,
      },
      {
        id: 'node:orders:combined',
        objectId: 'orders',
        viewId: 'combined',
        x: 0,
        y: 0,
        width: 240,
        height: 180,
      },
      {
        id: 'node:users:combined',
        objectId: 'users',
        viewId: 'combined',
        x: 300,
        y: 0,
        width: 240,
        height: 180,
      },
    ],
    viewports: [
      { viewId: 'overview', x: 0, y: 0, zoom: 1 },
      { viewId: 'sales', x: 0, y: 0, zoom: 1 },
      { viewId: 'combined', x: 0, y: 0, zoom: 1 },
    ],
  },
};
const state: ProjectState = { project, document, syncSequence: 12 };

describe('MCP scoped reads', () => {
  it('summarizes the project without returning the document', () => {
    const result = projectSummary(state);
    expect(result.project.version).toBe(7);
    expect(result.syncSequence).toBe(12);
    expect(result.counts).toMatchObject({ domains: 2, tables: 2, columns: 1 });
    expect(result.views).toContainEqual({
      id: 'combined',
      name: 'Combined',
      kind: 'combined',
      domainIds: ['sales'],
    });
    expect(result).not.toHaveProperty('document');
    expect(JSON.stringify(result)).not.toContain('Long table definition');
  });

  it('paginates short table records with stable ID cursors', () => {
    const first = listTables(state, {
      projectId: project.id,
      search: '',
      limit: 1,
    });
    expect(first.tables.map((table) => table.id)).toEqual(['orders']);
    expect(first.nextCursor).toBe('orders');
    const second = listTables(state, {
      projectId: project.id,
      search: '',
      cursor: first.nextCursor,
      limit: 1,
    });
    expect(second.tables.map((table) => table.id)).toEqual(['users']);
    expect(second.nextCursor).toBeNull();
  });

  it('uses actual view nodes so combined views include external table references', () => {
    const result = projectView(state, 'combined');
    expect(result.tables.map((table) => table.id)).toEqual(['orders', 'users']);
    expect(result.tableRelations).toEqual([
      {
        id: 'orders-users',
        sourceTableId: 'orders',
        targetTableId: 'users',
        name: 'owner',
      },
    ]);
    expect(result.nodes).toHaveLength(2);
    expect(result.totalNodes).toBe(2);
    expect(result.nextCursor).toBeNull();
    const first = projectView(state, 'combined', 1);
    expect(first.nodes).toHaveLength(1);
    expect(first.nextCursor).toBe(first.nodes[0]!.id);
    expect(projectView(state, 'combined', 1, first.nextCursor!).nodes).toHaveLength(1);
    expect(listViewRelations(state, 'combined').relations).toContainEqual(
      expect.objectContaining({ id: 'orders-users', kind: 'table' }),
    );
    expect(result).not.toHaveProperty('columns');
    expect(() => projectView(state, 'missing')).toThrow('화면을 찾을 수 없습니다.');
  });

  it('returns one table with its columns, keys and connected table names', () => {
    const result = tableDetails(state, 'orders');
    expect(result.columns.map((column) => column.id)).toEqual(['order-id']);
    expect(result.keys.map((key) => key.id)).toEqual(['orders-pk']);
    expect(result.relatedTables.map((table) => table.id)).toEqual(['users']);
    expect(result.nodes.map((node) => node.viewId)).toEqual(['sales', 'combined']);
    expect(() => tableDetails(state, 'missing')).toThrow('테이블을 찾을 수 없습니다.');
  });
});
