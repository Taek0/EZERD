import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@ezerd/model';
import { diagnoseLayout } from '../src/mcp/mcp-layout-diagnostics.js';

describe('MCP layout diagnostics', () => {
  it('uses rendered card bounds for overlap and 40px gaps', () => {
    const document = createEmptyDocument();
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
    const document = createEmptyDocument();
    document.domains = [{ id: 'sales', name: 'Sales', description: '' }];
    document.tables = [
      {
        id: 'orders',
        domainId: 'sales',
        scope: 'both',
        logical: { name: 'Orders', definition: '' },
        physical: { name: 'orders', schema: 'public', comment: '' },
        customProperties: { common: {}, logical: {}, physical: {} },
      },
    ];
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
});
