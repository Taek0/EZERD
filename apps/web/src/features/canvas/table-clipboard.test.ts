import { describe, expect, it } from 'vitest';
import { designDocumentSchema } from '@ezerd/contracts';
import { removeTable } from '@ezerd/model';
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
    const nodes = next.layout.nodes.filter((n) => result.ids.includes(n.objectId));
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
