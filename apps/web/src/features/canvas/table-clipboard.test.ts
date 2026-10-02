import { describe, expect, it } from 'vitest';
import { designDocumentSchema } from '@ezerd/contracts';
import { removeTable, updateTable, ensureTableCanvasLayout, TABLES_VIEW_ID } from '@ezerd/model';
import { createTestDocument } from '../../test-utils/diagram-fixture.js';
import {
  acknowledgeSystemTableClipboard,
  copyTables,
  localTablePasteFallback,
  parseTableClipboard,
  pasteTables,
  rememberTableClipboard,
} from './table-clipboard.js';

const generator = () => {
  let index = 0;
  return () => `copy-${++index}`;
};
function fixture() {
  const doc = createTestDocument();
  doc.enums = [{ id: 'enum', name: 'status', schema: 'public', values: ['open', 'closed'] }];
  doc.columns![2]!.physical.type = { name: 'enum', enumId: 'enum', isArray: true };
  return doc;
}
function snapshot(doc = fixture()) {
  return parseTableClipboard(
    copyTables(
      doc,
      ['t0', 't1'],
      doc.layout.nodes.filter((n) => n.viewId === 'perf'),
    ),
  )!;
}

describe('table clipboard', () => {
  it('keeps a local paste fallback until the matching system clipboard write completes', () => {
    rememberTableClipboard('first', true);
    rememberTableClipboard('second', true);
    acknowledgeSystemTableClipboard('first');
    expect(localTablePasteFallback()).toBe('second');
    acknowledgeSystemTableClipboard('second');
    expect(localTablePasteFallback()).toBe('');
    rememberTableClipboard('native');
    expect(localTablePasteFallback()).toBe('');
  });
  it('copies only selected tables, their owned data and internal relations', () => {
    const data = snapshot();
    expect(data.tables?.map((t) => t.id)).toEqual(['t0', 't1']);
    expect(data.columns).toHaveLength(10);
    expect(data.keys).toHaveLength(2);
    expect(data.enums).toHaveLength(1);
    expect(data.tableRelations?.map((r) => r.id)).toEqual(['r0']);
    expect(data.layout.nodes).toHaveLength(2);
  });

  it('copies mixed assigned and unassigned global tables with colors and pastes them as unassigned', () => {
    let doc = ensureTableCanvasLayout(fixture());
    doc = updateTable(doc, 't0', { color: '#ffffff' });
    doc = updateTable(doc, 't1', { domainId: null, color: '#465fff' });
    const global = doc.layout.nodes.filter((node) => node.viewId === TABLES_VIEW_ID);
    const data = parseTableClipboard(copyTables(doc, ['t0', 't1'], global))!;
    expect(data).not.toBeNull();
    expect(data.tables!.map((table) => table.domainId)).toEqual(['perf', null]);
    expect(data.layout.nodes.filter((node) => node.objectId === 't0')).toHaveLength(2);
    expect(data.layout.nodes.filter((node) => node.objectId === 't1')).toHaveLength(1);
    const before = structuredClone(doc);
    const result = pasteTables(doc, data, null, { x: 100, y: 200 }, generator());
    expect(doc).toEqual(before);
    expect(result.document.tables!.slice(-2).map((table) => [table.domainId, table.color])).toEqual(
      [
        [null, '#ffffff'],
        [null, '#465fff'],
      ],
    );
    const nodes = result.document.layout.nodes.filter((node) => result.ids.includes(node.objectId));
    expect(nodes).toHaveLength(2);
    expect(nodes.every((node) => node.viewId === TABLES_VIEW_ID)).toBe(true);
    expect(nodes[0]).toMatchObject({
      x: 100,
      y: 200,
      width: global[0]!.width,
      height: global[0]!.height,
    });
    expect(nodes[1]!.x - nodes[0]!.x).toBe(global[1]!.x - global[0]!.x);
    expect(result.document.tableRelations!.at(-1)!.sourceTableId).toBe(result.ids[0]);
    expect(designDocumentSchema.safeParse(result.document).success).toBe(true);
  });

  it('retains separate global and owner positions and sizes when pasting into an owner view', () => {
    const doc = ensureTableCanvasLayout(fixture());
    const owner = doc.layout.nodes.find(
      (node) => node.objectId === 't0' && node.viewId === 'perf',
    )!;
    const global = doc.layout.nodes.find(
      (node) => node.objectId === 't0' && node.viewId === TABLES_VIEW_ID,
    )!;
    Object.assign(owner, { x: 20, y: 30, width: 700, height: 400 });
    Object.assign(global, { x: 800, y: 500, width: 900, height: 600 });
    doc.tables![0]!.color = '#ee46bc';
    doc.domains.push({ id: 'other', name: 'Other', description: '' });
    const fragment = parseTableClipboard(copyTables(doc, ['t0'], [owner]))!;
    const result = pasteTables(doc, fragment, 'other', { x: 100, y: 200 }, generator());
    const nodes = result.document.layout.nodes.filter((node) => node.objectId === result.ids[0]);
    expect(nodes).toHaveLength(2);
    expect(nodes.find((node) => node.viewId === 'other')).toMatchObject({
      x: 100,
      y: 200,
      width: 700,
      height: 400,
    });
    expect(nodes.find((node) => node.viewId === TABLES_VIEW_ID)).toMatchObject({
      x: 880,
      y: 670,
      width: 900,
      height: 600,
    });
    expect(result.document.tables!.at(-1)).toMatchObject({ domainId: 'other', color: '#ee46bc' });
  });

  it('uses the active global snapshot when pasting unassigned tables into a domain', () => {
    const doc = updateTable(ensureTableCanvasLayout(fixture()), 't0', { domainId: null });
    const global = doc.layout.nodes.find(
      (node) => node.objectId === 't0' && node.viewId === TABLES_VIEW_ID,
    )!;
    Object.assign(global, { width: 950, height: 430 });
    const fragment = parseTableClipboard(copyTables(doc, ['t0'], [global]))!;
    const result = pasteTables(doc, fragment, 'perf', { x: 30, y: 40 }, generator());
    const nodes = result.document.layout.nodes.filter((node) => node.objectId === result.ids[0]);
    expect(nodes).toHaveLength(2);
    expect(
      nodes.every(
        (node) => node.width === 950 && node.height === 430 && node.x === 30 && node.y === 40,
      ),
    ).toBe(true);
    expect(result.document.tables!.at(-1)!.domainId).toBe('perf');
  });

  it('rejects unassigned owner placements, duplicated placements and unsupported clipboard views', () => {
    const doc = updateTable(ensureTableCanvasLayout(fixture()), 't0', { domainId: null });
    const global = doc.layout.nodes.find(
      (node) => node.objectId === 't0' && node.viewId === TABLES_VIEW_ID,
    )!;
    const fragment = parseTableClipboard(copyTables(doc, ['t0'], [global]))!;
    for (const nodes of [
      [{ ...fragment.layout.nodes[0]!, viewId: 'perf' }],
      [...fragment.layout.nodes, { ...fragment.layout.nodes[0]!, id: 'duplicate' }],
      [{ ...fragment.layout.nodes[0]!, viewId: 'other' }],
    ]) {
      expect(
        parseTableClipboard(
          JSON.stringify({
            format: 'ezerd/tables-v1',
            document: { ...fragment, layout: { ...fragment.layout, nodes } },
          }),
        ),
      ).toBeNull();
    }
  });

  it('remaps every owned ID and preserves relative placement, types and constraints', () => {
    const doc = fixture();
    const before = JSON.stringify(doc);
    const data = snapshot(doc);
    const result = pasteTables(doc, data, 'perf', { x: 100, y: 200 }, generator());
    const next = result.document;
    expect(JSON.stringify(doc)).toBe(before);
    expect(next.tables).toHaveLength(12);
    expect(next.tables!.slice(-2).map((t) => t.physical.name)).toEqual([
      'table_0_copy',
      'table_1_copy',
    ]);
    const columns = next.columns!.filter((c) => result.ids.includes(c.tableId));
    const keys = next.keys!.filter((k) => result.ids.includes(k.tableId));
    const relation = next.tableRelations!.at(-1)!;
    expect(columns).toHaveLength(10);
    expect(keys).toHaveLength(2);
    expect(keys.map((k) => k.name)).toEqual(['t0_pk_copy', 't1_pk_copy']);
    expect(relation.sourceTableId).toBe(result.ids[0]);
    expect(relation.targetTableId).toBe(result.ids[1]);
    expect(
      relation.physical!.sourceColumnIds.every((id) =>
        columns.some((c) => c.id === id && c.tableId === result.ids[0]),
      ),
    ).toBe(true);
    expect(
      keys.every((key) =>
        key.columnIds.every((id) => columns.some((c) => c.id === id && c.tableId === key.tableId)),
      ),
    ).toBe(true);
    expect(next.enums).toHaveLength(1);
    expect(columns[2]!.physical.type).toEqual({ name: 'enum', enumId: 'enum', isArray: true });
    const nodes = next.layout.nodes.filter(
      (n) => result.ids.includes(n.objectId) && n.viewId === 'perf',
    );
    expect(nodes[0]).toMatchObject({ x: 100, y: 200 });
    expect(nodes[1]!.x - nodes[0]!.x).toBe(data.layout.nodes[1]!.x - data.layout.nodes[0]!.x);
    expect(designDocumentSchema.safeParse(next).success).toBe(true);
  });

  it('supports cutting and pasting into another domain without retaining dangling references', () => {
    const doc = fixture();
    doc.domains.push({ id: 'other', name: 'Other', description: '' });
    const data = snapshot(doc);
    const cut = ['t0', 't1'].reduce((value, id) => removeTable(value, id), doc);
    expect(cut.tables).toHaveLength(8);
    expect(
      cut.tableRelations?.some((r) =>
        [r.sourceTableId, r.targetTableId].some((id) => id === 't0' || id === 't1'),
      ),
    ).toBe(false);
    const result = pasteTables(cut, data, 'other', { x: 0, y: 0 }, generator());
    expect(result.document.tables!.slice(-2).every((t) => t.domainId === 'other')).toBe(true);
    expect(result.document.tables!.slice(-2).map((t) => t.physical.name)).toEqual([
      'table_0',
      'table_1',
    ]);
    expect(result.document.tableRelations).toHaveLength(8);
  });

  it('imports enums into another project and disambiguates conflicting enum names', () => {
    const doc = fixture();
    doc.enums![0]!.values = ['different'];
    const result = pasteTables(doc, snapshot(), 'perf', { x: 0, y: 0 }, generator());
    expect(result.document.enums!.at(-1)!.name).toBe('status_copy');
    const type = result.document.columns!.find(
      (c) => c.tableId === result.ids[0] && c.physical.type.enumId,
    )!.physical.type;
    expect(type.enumId).toBe(result.document.enums!.at(-1)!.id);
  });

  it('rejects unrelated, malformed and oversized clipboard contents and broken references', () => {
    for (const text of ['', 'plain text', '{}', 'x'.repeat(2_000_001)])
      expect(parseTableClipboard(text)).toBeNull();
    const data = snapshot();
    data.keys![0]!.columnIds = ['missing'];
    expect(
      parseTableClipboard(JSON.stringify({ format: 'ezerd/tables-v1', document: data })),
    ).toBeNull();
  });

  it('rejects an invalid destination atomically', () => {
    const doc = fixture();
    expect(() =>
      pasteTables(doc, snapshot(doc), 'overview', { x: 0, y: 0 }, generator()),
    ).toThrow();
    expect(() => pasteTables(doc, snapshot(doc), 'perf', { x: 1e9, y: 0 }, generator())).toThrow();
    expect(doc.tables).toHaveLength(10);
  });
  it('creates fresh IDs and non-conflicting names on repeated paste', () => {
    const doc = fixture();
    const data = snapshot(doc);
    const ids = generator();
    const first = pasteTables(doc, data, 'perf', { x: 0, y: 0 }, ids);
    const second = pasteTables(first.document, data, 'perf', { x: 32, y: 32 }, ids);
    expect(second.document.tables!.slice(-2).map((t) => t.physical.name)).toEqual([
      'table_0_copy2',
      'table_1_copy2',
    ]);
    expect(first.ids.some((id) => second.ids.includes(id))).toBe(false);
    expect(designDocumentSchema.safeParse(second.document).success).toBe(true);
  });
});
