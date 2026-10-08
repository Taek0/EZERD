import { describe, expect, it } from 'vitest';
import {
  createEmptyNativeDocument,
  createNativeColumn,
  createNativeTable,
  defaultDatabaseContext,
  nativeTableCanvasMetrics,
} from '@ezerd/model';
import { diagnoseLayout } from '../src/mcp/mcp-layout-diagnostics.js';

describe('MCP layout diagnostics', () => {
  it('uses rendered card bounds for overlap and 40px gaps', () => {
    const document = createEmptyNativeDocument(defaultDatabaseContext('postgresql'));
    document.notes = ['a', 'b', 'c'].map((id) => ({
      id,
      viewId: 'overview',
      text: id,
    }));
    document.layout.nodes = [
      { id: 'node:a', objectId: 'a', viewId: 'overview', x: 0, y: 0, width: 160, height: 110 },
      { id: 'node:b', objectId: 'b', viewId: 'overview', x: 150, y: 0, width: 160, height: 110 },
      { id: 'node:c', objectId: 'c', viewId: 'overview', x: 345, y: 0, width: 160, height: 110 },
    ];
    const result = diagnoseLayout(document, 'overview', 10);
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      'card-overlap',
      'card-gap-too-small',
    ]);
    expect(result.diagnostics[1]?.message).toContain('가로 35px');
    expect(result.truncated).toBe(false);
    expect(diagnoseLayout(document, 'overview', 1).truncated).toBe(true);
  });

  it('reports when table content renders larger than saved bounds', () => {
    const document = createEmptyNativeDocument(defaultDatabaseContext('postgresql'));
    document.domains = [{ id: 'sales', name: 'Sales', description: '' }];
    document.tables = [createNativeTable(document.database, 'orders', 'sales')];
    document.layout.nodes = [
      {
        id: 'node:orders',
        objectId: 'orders',
        viewId: 'sales',
        x: 0,
        y: 0,
        width: 280,
        height: 180,
      },
    ];
    expect(diagnoseLayout(document, 'sales', 10).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'card-expanded', objectId: 'orders' }),
    );
    expect(diagnoseLayout(document, 'overview', 10).diagnostics).toEqual([]);
  });

  it('measures native database types and respects hidden nullable and comment columns', () => {
    const document = createEmptyNativeDocument(defaultDatabaseContext('mysql'));
    const table = createNativeTable(document.database, 'orders');
    table.scope = 'physical';
    const column = createNativeColumn(document.database, table, 'value');
    column.physical.type = {
      kind: 'builtin',
      database: 'mysql',
      typeId: 'mysql:decimal',
      parameters: { precision: 65, scale: 30, unsigned: true },
    };
    column.physical.comment = '설명'.repeat(100);
    document.tables = [table];
    document.columns = [column];
    const shown = nativeTableCanvasMetrics(document, table, 'physical');
    expect(shown.rows[0]?.type).toContain('DECIMAL');
    document.notes = [{ id: 'note', viewId: '__tables__', text: '' }];
    document.layout.nodes = [
      {
        id: 'table',
        objectId: table.id,
        viewId: '__tables__',
        x: 0,
        y: 0,
        width: 280,
        height: 220,
      },
      { id: 'note', objectId: 'note', viewId: '__tables__', x: 0, y: 320, width: 160, height: 110 },
    ];
    expect(diagnoseLayout(document, '__tables__', 10).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'card-overlap' }),
    );
    table.canvasDisplay = { showNullable: false, showComment: false };
    const hidden = nativeTableCanvasMetrics(document, table, 'physical');
    expect(hidden.width).toBeLessThan(shown.width);
    expect(hidden.height).toBeLessThan(shown.height);
    expect(diagnoseLayout(document, '__tables__', 10).diagnostics.map((item) => item.code)).toEqual(
      ['card-expanded'],
    );
  });

  it('includes logical row sizes when no display mode is supplied and honors parent visibility', () => {
    const document = createEmptyNativeDocument(defaultDatabaseContext('sqlite'));
    const table = createNativeTable(document.database, 'records');
    const column = createNativeColumn(document.database, table, 'description');
    column.scope = 'logical';
    column.logical.definition = 'Logical definition\n'.repeat(12);
    document.tables = [table];
    document.columns = [column];
    document.notes = [{ id: 'note', viewId: '__tables__', text: '' }];
    document.layout.nodes = [
      {
        id: 'table',
        objectId: table.id,
        viewId: '__tables__',
        x: 0,
        y: 0,
        width: 560,
        height: 220,
      },
      { id: 'note', objectId: 'note', viewId: '__tables__', x: 0, y: 320, width: 160, height: 110 },
    ];
    expect(diagnoseLayout(document, '__tables__', 10).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'card-overlap' }),
    );
    table.scope = 'physical';
    expect(diagnoseLayout(document, '__tables__', 10).diagnostics).toEqual([]);
  });

  it('clamps expanded content to native canvas limits', () => {
    const document = createEmptyNativeDocument(defaultDatabaseContext('postgresql'));
    const table = createNativeTable(document.database, 'records');
    table.physical.name = 'x'.repeat(1000);
    const column = createNativeColumn(document.database, table, 'description');
    column.physical.comment = 'line\n'.repeat(1000);
    document.tables = [table];
    document.columns = [column];
    document.notes = [{ id: 'note', viewId: '__tables__', text: '' }];
    document.layout.nodes = [
      {
        id: 'table',
        objectId: table.id,
        viewId: '__tables__',
        x: 0,
        y: 0,
        width: 10000,
        height: 10000,
      },
      {
        id: 'note',
        objectId: 'note',
        viewId: '__tables__',
        x: 10040,
        y: 0,
        width: 160,
        height: 110,
      },
    ];
    expect(diagnoseLayout(document, '__tables__', 10).diagnostics).toEqual([]);
  });
});
