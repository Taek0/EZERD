import { describe, expect, it } from 'vitest';
import { type DesignDocument } from '@ezerd/model';
import { primaryKeyChangeReason, setColumnPrimaryKey } from './column-primary-key.js';
const seed = () =>
  ({
    tables: [{ id: 't' }],
    columns: ['a', 'b'].map((id) => ({
      id,
      tableId: 't',
      scope: 'physical',
      physical: { nullable: true },
    })),
    keys: [
      { id: 'pk', tableId: 't', scope: 'physical', kind: 'primary', name: '', columnIds: ['a'] },
    ],
  }) as unknown as DesignDocument;
describe('direct PK editing', () => {
  it('clears a NULL default when promoting a column to PK', () => {
    const doc = seed();
    doc.columns![1]!.physical.defaultExpression = 'NULL';
    expect(setColumnPrimaryKey(doc, 'b', true).columns![1]!.physical.defaultExpression).toBeNull();
  });
  it('appends composite members, forces NOT NULL and removes the final key', () => {
    let doc = setColumnPrimaryKey(seed(), 'b', true);
    expect(doc.keys?.[0]?.columnIds).toEqual(['a', 'b']);
    expect(doc.columns?.[1]?.physical.nullable).toBe(false);
    doc = setColumnPrimaryKey(doc, 'a', false);
    expect(doc.keys?.[0]?.columnIds).toEqual(['b']);
    expect(setColumnPrimaryKey(doc, 'b', false).keys).toEqual([]);
  });
  it('blocks a referenced PK change, but permits an equivalent unique reference', () => {
    const doc = seed();
    doc.tableRelations = [
      { scope: 'physical', targetTableId: 't', physical: { targetColumnIds: ['a'] } },
    ] as never;
    expect(primaryKeyChangeReason(doc, 'b')).toContain('FK');
    expect(() => setColumnPrimaryKey(doc, 'a', false)).toThrow('FK');
    doc.keys!.push({ ...doc.keys![0]!, id: 'uq', kind: 'unique' });
    expect(primaryKeyChangeReason(doc, 'b')).toBeUndefined();
    expect(setColumnPrimaryKey(doc, 'b', true).keys?.[0]?.columnIds).toEqual(['a', 'b']);
  });
  it('does not create writes for an unchanged checkbox', () => {
    const doc = seed();
    expect(setColumnPrimaryKey(doc, 'a', true)).toBe(doc);
    expect(setColumnPrimaryKey(doc, 'b', false)).toBe(doc);
  });
});
