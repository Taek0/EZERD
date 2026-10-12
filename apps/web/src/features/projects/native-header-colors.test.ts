import { describe, expect, it } from 'vitest';
import { decorationFixture } from './native-canvas-decoration-test-fixtures.js';
import { nativeTableHeaderColor, nativeTableHeaderTextColor } from './native-canvas-style.js';

describe('table header palette', () => {
  it('uses a neutral default and keeps custom table/domain colors with readable text', () => {
    const doc = decorationFixture();
    const table = doc.tables![0]!;
    delete table.color;
    for (const domain of doc.domains) delete domain.color;
    expect(nativeTableHeaderColor(doc, table)).toBe('#edf2f8');
    expect(nativeTableHeaderTextColor(doc, table)).toBe('#243248');
    table.color = '#123456';
    const before = structuredClone(doc);
    expect(nativeTableHeaderColor(doc, table)).toBe('#123456');
    expect(nativeTableHeaderTextColor(doc, table)).toBe('#ffffff');
    expect(doc).toEqual(before);
    table.color = '#ffffff';
    expect(nativeTableHeaderTextColor(doc, table)).toBe('#243248');
    delete table.color;
    const domain = doc.domains.find((domain) => domain.id === table.domainId)!;
    domain.color = '#123456';
    expect(nativeTableHeaderColor(doc, table)).toBe('#123456');
    expect(nativeTableHeaderTextColor(doc, table)).toBe('#ffffff');
  });
});
