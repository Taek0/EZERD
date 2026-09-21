import { describe, expect, it } from 'vitest';
import {
  addDomain,
  addTable,
  createEmptyDocument,
  upsertCombinedView,
  type DesignDocument,
} from '@ezerd/model';
import { applyDomainSelection, combinedViewName, domainViewExitTarget } from './domain-view.js';
it('leaves combined views to their originating domain with safe fallbacks', () => {
  const doc = seed();
  expect(domainViewExitTarget(doc, ['a', 'b'], 'b')).toBe('b');
  expect(domainViewExitTarget(doc, ['a'], 'b')).toBe('a');
  expect(domainViewExitTarget(doc, ['missing'], 'missing')).toBe('overview');
  expect(domainViewExitTarget(doc, ['a', 'b'], null)).toBe('a');
});
import { tableCardSize } from '../tables/table-geometry.js';
const metadata = { common: {}, logical: {}, physical: {} };
function seed() {
  let doc = createEmptyDocument();
  for (const id of ['a', 'b'])
    doc = addDomain(doc, { id, name: id.toUpperCase(), description: '' }, { x: 0, y: 0 });
  for (const item of [
    { id: 'a1', domainId: 'a', x: 100, y: -40 },
    { id: 'a2', domainId: 'a', x: 740, y: 230 },
    { id: 'b1', domainId: 'b', x: -600, y: 400 },
    { id: 'b2', domainId: 'b', x: 80, y: 80 },
  ])
    doc = addTable(
      doc,
      {
        id: item.id,
        domainId: item.domainId,
        scope: 'physical',
        logical: { name: item.id, definition: '' },
        physical: { name: item.id, schema: 'public', comment: '' },
        customProperties: metadata,
      },
      { x: item.x, y: item.y },
    );
  return doc;
}
function node(doc: DesignDocument, viewId: string, id: string) {
  return doc.layout.nodes.find((n) => n.viewId === viewId && n.objectId === id)!;
}
describe('domain selection layout', () => {
  it('keeps diagonal overview directions and separates differently sized clusters', () => {
    let source = seed();
    const b = source.layout.nodes.find((n) => n.objectId === 'b' && n.viewId === 'overview')!;
    b.x = 450;
    b.y = 650;
    source = addDomain(source, { id: 'c', name: 'C', description: '' }, { x: 1000, y: 0 });
    source = addTable(source, { ...source.tables![0]!, id: 'c1', domainId: 'c' }, { x: 0, y: 0 });
    const { document: result, viewId } = applyDomainSelection(
      source,
      ['c', 'b', 'a'],
      null,
      () => 'diagonal',
    );
    const bounds = (id: string) => {
      const items = result.layout.nodes.filter(
        (n) =>
          n.viewId === viewId && result.tables?.find((t) => t.id === n.objectId)?.domainId === id,
      );
      const left = Math.min(...items.map((n) => n.x)),
        top = Math.min(...items.map((n) => n.y));
      const right = Math.max(...items.map((n) => n.x + n.width)),
        bottom = Math.max(...items.map((n) => n.y + n.height));
      return { left, top, right, bottom, x: (left + right) / 2, y: (top + bottom) / 2 };
    };
    const a = bounds('a'),
      bb = bounds('b'),
      c = bounds('c');
    expect(bb.x).toBeGreaterThan(a.x);
    expect(bb.y).toBeGreaterThan(a.y);
    expect(c.x).toBeGreaterThan(bb.x);
    expect(c.y).toBeCloseTo(a.y);
    for (const [one, two] of [
      [a, bb],
      [a, c],
      [bb, c],
    ])
      expect(
        one!.right + 179.99 <= two!.left ||
          two!.right + 179.99 <= one!.left ||
          one!.bottom + 179.99 <= two!.top ||
          two!.bottom + 179.99 <= one!.top,
      ).toBe(true);
  });
  it('places missing map locations deterministically without invalid coordinates', () => {
    const source = seed();
    source.layout.nodes = source.layout.nodes.filter((n) => n.viewId !== 'overview');
    const one = applyDomainSelection(source, ['a', 'b'], null, () => 'fallback');
    const two = applyDomainSelection(source, ['b', 'a'], null, () => 'fallback');
    expect(one.document).toEqual(two.document);
    for (const n of one.document.layout.nodes) expect([n.x, n.y].every(Number.isFinite)).toBe(true);
  });
  it('mirrors the overview vertical direction instead of placing every domain in one row', () => {
    const source = seed();
    const b = source.layout.nodes.find((n) => n.objectId === 'b' && n.viewId === 'overview')!;
    b.y = 600;
    const { document: result, viewId } = applyDomainSelection(
      source,
      ['a', 'b'],
      null,
      () => 'vertical',
    );
    const group = (id: string) =>
      result.layout.nodes.filter(
        (n) =>
          n.viewId === viewId && result.tables?.find((t) => t.id === n.objectId)?.domainId === id,
      );
    const aNodes = group('a'),
      bNodes = group('b');
    expect(
      Math.min(...bNodes.map((n) => n.y)) - Math.max(...aNodes.map((n) => n.y + n.height)),
    ).toBeGreaterThanOrEqual(179.99);
    const centerX = (items: typeof aNodes) =>
      (Math.min(...items.map((n) => n.x)) + Math.max(...items.map((n) => n.x + n.width))) / 2;
    expect(centerX(aNodes)).toBeCloseTo(centerX(bNodes));
    expect(node(result, viewId, 'b2').x - node(result, viewId, 'b1').x).toBe(680);
  });
  it('preserves original relative distances and separates domains by actual card width', () => {
    const source = seed(),
      snapshot = structuredClone(source);
    const { document: result, viewId } = applyDomainSelection(
      source,
      ['b', 'a'],
      null,
      () => 'current',
    );
    const a1 = node(result, viewId, 'a1'),
      a2 = node(result, viewId, 'a2'),
      b1 = node(result, viewId, 'b1'),
      b2 = node(result, viewId, 'b2');
    expect([a2.x - a1.x, a2.y - a1.y]).toEqual([640, 270]);
    expect([b2.x - b1.x, b2.y - b1.y]).toEqual([680, -320]);
    const right = Math.max(
      ...[a1, a2].map((n) => n.x + tableCardSize(source, n.objectId, n.width, n.height).width),
    );
    expect(Math.min(b1.x, b2.x) - right).toBe(180);
    expect(source).toEqual(snapshot);
    expect(result.layout.nodes.filter((n) => n.viewId === 'a' || n.viewId === 'b')).toEqual(
      source.layout.nodes.filter((n) => n.viewId === 'a' || n.viewId === 'b'),
    );
  });
  it('reuses one current view for repeated selections', () => {
    const first = applyDomainSelection(seed(), ['a'], null, () => 'current'),
      second = applyDomainSelection(first.document, ['a', 'b'], null, () => 'unexpected'),
      third = applyDomainSelection(second.document, ['b'], 'current', () => 'unexpected');
    expect(second.viewId).toBe('current');
    expect(third.document.views).toHaveLength(1);
    expect(
      third.document.layout.nodes
        .filter((n) => n.viewId === 'current')
        .map((n) => n.objectId)
        .sort(),
    ).toEqual(['b1', 'b2']);
  });
  it('preserves other legacy views', () => {
    let source = upsertCombinedView(seed(), { id: 'one', name: '첫뷰', domainIds: ['a'] });
    source = upsertCombinedView(source, { id: 'two', name: '두번째', domainIds: ['b'] });
    const result = applyDomainSelection(source, ['a', 'b'], 'two', () => 'unexpected');
    expect(result.document.views).toHaveLength(2);
    expect(result.document.views?.find((v) => v.id === 'one')).toEqual(
      source.views?.find((v) => v.id === 'one'),
    );
    expect(result.document.layout.nodes.filter((n) => n.viewId === 'one')).toEqual(
      source.layout.nodes.filter((n) => n.viewId === 'one'),
    );
  });
  it('uses owner coordinates instead of cross-domain references', () => {
    let source = seed();
    source = {
      ...source,
      layout: {
        ...source.layout,
        nodes: [
          { ...node(source, 'a', 'a1'), id: 'ref', viewId: 'b', x: 9000, y: 9000 },
          ...source.layout.nodes,
        ],
      },
    };
    const result = applyDomainSelection(source, ['a', 'b'], null, () => 'current');
    expect(
      node(result.document, 'current', 'a2').x - node(result.document, 'current', 'a1').x,
    ).toBe(640);
  });
});
describe('saved view naming', () => {
  it('names the view after its domains and shortens long selections', () => {
    expect(combinedViewName([])).toBe('도메인 뷰');
    expect(combinedViewName(['주문'])).toBe('주문');
    expect(combinedViewName(['주문', '결제', '배송'])).toBe('주문 · 결제 · 배송');
    expect(combinedViewName(['주문', '결제', '배송', '회원'])).toBe('주문 · 결제 외 2개');
    expect(combinedViewName(['x'.repeat(200)])).toHaveLength(120);
  });
  it('applies the composed name to the saved view', () => {
    const { document: result, viewId } = applyDomainSelection(
      seed(),
      ['a', 'b'],
      null,
      () => 'current',
    );
    expect(result.views?.find((v) => v.id === viewId)?.name).toBe('A · B');
  });
});
