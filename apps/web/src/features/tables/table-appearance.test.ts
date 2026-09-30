import { describe, expect, it } from 'vitest';
import { addDomain, addTable, createEmptyDocument, updateTable, type Table } from '@ezerd/model';
import {
  tableColor,
  tableDomainFromValue,
  tableDomainValue,
  tableHeaderStyle,
  UNASSIGNED_DOMAIN_VALUE,
} from './table-appearance.js';

const table: Table = {
  id: 't',
  domainId: 'd',
  scope: 'physical',
  logical: { name: 'Order', definition: '' },
  physical: { name: 'orders', schema: 'public', comment: '' },
  customProperties: { common: {}, logical: {}, physical: {} },
};

describe('table appearance and owner selection', () => {
  it('inherits the owner color and restores automatic color without changing ownership or layout', () => {
    const doc = addTable(
      addDomain(
        createEmptyDocument(),
        { id: 'd', name: 'Orders', description: '', color: '#465fff' },
        { x: 0, y: 0 },
      ),
      table,
      { x: 50, y: 70 },
    );
    expect(tableColor(doc, doc.tables![0]!)).toBe('#465fff');
    const custom = updateTable(doc, 't', { color: '#ffffff' });
    expect(tableColor(custom, custom.tables![0]!)).toBe('#ffffff');
    const unassigned = updateTable(custom, 't', { domainId: null });
    expect(tableColor(unassigned, unassigned.tables![0]!)).toBe('#ffffff');
    const reset = updateTable(unassigned, 't', { color: undefined });
    expect(tableColor(reset, reset.tables![0]!)).toBe('#8993a3');
    expect(reset.tables![0]!.domainId).toBeNull();
    expect(reset.layout).toEqual(unassigned.layout);
  });

  it('uses a nonempty sentinel and can select domain IDs that resemble it', () => {
    expect(tableDomainValue(null)).toBe(UNASSIGNED_DOMAIN_VALUE);
    expect(tableDomainFromValue(tableDomainValue(null))).toBeNull();
    for (const id of ['d', UNASSIGNED_DOMAIN_VALUE, 'domain:d']) {
      expect(tableDomainValue(id)).not.toBe(UNASSIGNED_DOMAIN_VALUE);
      expect(tableDomainFromValue(tableDomainValue(id))).toBe(id);
    }
  });

  it('keeps header text readable across custom light, dark and middle colors', () => {
    const doc = createEmptyDocument();
    const luminance = (hex: string) =>
      [1, 3, 5]
        .map((offset) => {
          const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
    for (const color of [
      '#000000',
      '#ffffff',
      '#777777',
      '#8993a3',
      '#475467',
      '#7f56d9',
      '#465fff',
      '#2e90fa',
      '#06aed4',
      '#12b76a',
      '#f79009',
      '#f04438',
      '#ee46bc',
    ]) {
      const style = tableHeaderStyle(doc, { ...table, color });
      expect(style.background).toBe(color);
      const values = [luminance(style.color), luminance(color)].sort((a, b) => a - b);
      expect((values[1]! + 0.05) / (values[0]! + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
