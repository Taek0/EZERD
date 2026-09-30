import { describe, expect, it } from 'vitest';
import type { DesignDocument, Project } from '@ezerd/contracts';
import { TABLES_VIEW_ID } from '@ezerd/model';
import { normalizeServerDocument } from '../src/shared/normalize-document.js';
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
const state: ProjectState = {
  project,
  document: normalizeServerDocument(document),
  syncSequence: 12,
};

describe('MCP scoped reads', () => {
  it('keeps global positions, shared notes and routes under domain filters without private geometry', () => {
    const input = structuredClone(state.document);
    input.tables![1]!.domainId = 'sales';
    input.notes = [
      { id: 'shared-note', viewId: TABLES_VIEW_ID, text: 'Shared' },
      { id: 'private-note', viewId: 'combined', text: 'Private' },
    ];
    input.layout.nodes.push(
      {
        id: 'shared-note-node',
        objectId: 'shared-note',
        viewId: TABLES_VIEW_ID,
        x: 45,
        y: 65,
        width: 200,
        height: 120,
      },
      {
        id: 'private-note-node',
        objectId: 'private-note',
        viewId: 'combined',
        x: 999,
        y: 999,
        width: 200,
        height: 120,
      },
    );
    const globalOrder = input.layout.nodes.find(
      (node) => node.objectId === 'orders' && node.viewId === TABLES_VIEW_ID,
    )!;
    globalOrder.x = 720;
    globalOrder.y = 480;
    input.layout.relations = [
      {
        relationId: 'orders-users',
        viewId: TABLES_VIEW_ID,
        offset: 77,
        waypoints: [{ x: 300, y: 400 }],
      },
      { relationId: 'orders-users', viewId: 'combined', offset: 999 },
    ];
    input.layout.viewports.push({ viewId: TABLES_VIEW_ID, x: 24, y: 48, zoom: 0.8 });
    const filteredState = { ...state, document: input };
    const global = projectView(filteredState, TABLES_VIEW_ID);
    for (const viewId of ['sales', 'combined']) {
      const filtered = projectView(filteredState, viewId);
      expect(filtered.nodes).toEqual(global.nodes);
      expect(filtered.nodes).toContainEqual(globalOrder);
      expect(filtered.notes).toEqual([
        { id: 'shared-note', viewId: TABLES_VIEW_ID, text: 'Shared' },
      ]);
      expect(filtered.relationLayouts).toEqual([input.layout.relations[0]]);
      expect(filtered.viewport).toEqual(global.viewport);
      expect(listViewRelations(filteredState, viewId).relations).toEqual(
        listViewRelations(filteredState, TABLES_VIEW_ID).relations,
      );
      const first = projectView(filteredState, viewId, 1);
      const second = projectView(filteredState, viewId, 1, first.nextCursor!);
      expect(first.nodes).not.toEqual(second.nodes);
      expect(first.tableRelations).toEqual([]);
    }
    const emptyDomain = projectView(filteredState, 'identity');
    expect(emptyDomain.tables).toEqual([]);
    expect(emptyDomain.notes).toEqual(global.notes);
    expect(emptyDomain.tableRelations).toEqual([]);
    expect(listViewRelations(filteredState, 'identity').relations).toEqual([]);
    expect(input.notes.some((note) => note.id === 'private-note')).toBe(true);
  });

  it('keeps the domain overview independent from table canvas filters', () => {
    const input = structuredClone(state.document);
    input.layout.nodes.push({
      id: 'domain-node',
      objectId: 'sales',
      viewId: 'overview',
      x: 90,
      y: 80,
      width: 240,
      height: 140,
    });
    const result = projectView({ ...state, document: input }, 'overview');
    expect(result.domains.map((domain) => domain.id)).toEqual(['sales']);
    expect(result.nodes.map((node) => node.id)).toEqual(['domain-node']);
    expect(result.tables).toEqual([]);
  });

  it('exposes the global tables view and filters unassigned tables with explicit null', () => {
    const direct = structuredClone(document);
    direct.tables![1]!.domainId = null;
    direct.tables![1]!.color = '#123456';
    const directState = { ...state, document: normalizeServerDocument(direct) };
    expect(projectSummary(directState).views).toContainEqual({
      id: TABLES_VIEW_ID,
      name: 'Tables',
      kind: 'tables',
      domainIds: [],
    });
    const filtered = listTables(directState, {
      projectId: project.id,
      domainId: null,
      search: '',
      limit: 50,
    });
    expect(filtered.tables).toEqual([
      expect.objectContaining({ id: 'users', domainId: null, color: '#123456' }),
    ]);
    expect(tableDetails(directState, 'users')).toMatchObject({
      table: { domainId: null, color: '#123456' },
      domain: null,
    });
    expect(projectView(directState, TABLES_VIEW_ID).tables).toHaveLength(2);
    expect(listViewRelations(directState, TABLES_VIEW_ID).relations).toContainEqual(
      expect.objectContaining({ id: 'orders-users', kind: 'table' }),
    );
  });
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

  it('projects legacy combined metadata as a domain filter using shared nodes', () => {
    const result = projectView(state, 'combined');
    expect(result.tables.map((table) => table.id)).toEqual(['orders']);
    expect(result.tableRelations).toEqual([]);
    expect(result.nodes).toEqual(projectView(state, 'sales').nodes);
    expect(result.nodes.every((node) => node.viewId === TABLES_VIEW_ID)).toBe(true);
    expect(result.totalNodes).toBe(1);
    expect(result.nextCursor).toBeNull();
    const first = projectView(state, TABLES_VIEW_ID, 1);
    expect(first.nodes).toHaveLength(1);
    expect(first.nextCursor).toBe(first.nodes[0]!.id);
    expect(projectView(state, TABLES_VIEW_ID, 1, first.nextCursor!).nodes).toHaveLength(1);
    expect(listViewRelations(state, 'combined').relations).toEqual([]);
    expect(result).not.toHaveProperty('columns');
    expect(() => projectView(state, 'missing')).toThrow('화면을 찾을 수 없습니다.');
  });

  it('returns one table with its columns, keys and connected table names', () => {
    const result = tableDetails(state, 'orders');
    expect(result.columns.map((column) => column.id)).toEqual(['order-id']);
    expect(result.keys.map((key) => key.id)).toEqual(['orders-pk']);
    expect(result.relatedTables.map((table) => table.id)).toEqual(['users']);
    expect(result.nodes.map((node) => node.viewId)).toEqual(['sales', 'combined', TABLES_VIEW_ID]);
    expect(() => tableDetails(state, 'missing')).toThrow('테이블을 찾을 수 없습니다.');
  });
});
