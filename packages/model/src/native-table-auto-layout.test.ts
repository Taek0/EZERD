import { describe, expect, it } from 'vitest';
import type { NodeLayout } from './document-base.js';
import { arrangeNativeTableNodes } from './native-table-auto-layout.js';

type Reference = { sourceTableId: string; targetTableId: string };
const reference = (child: string, parent: string): Reference => ({
  sourceTableId: child,
  targetTableId: parent,
});
function nodes(count: number): NodeLayout[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `node-${index}`,
    objectId: `table-${index}`,
    viewId: '__tables__',
    x: -40 + ((index * 97) % 11) * 59,
    y: 25 + ((index * 71) % 7) * 31,
    width: 280 + (index % 5) * 53,
    height: 220 + (index % 7) * 67,
  }));
}
function expectSeparated(result: NodeLayout[]) {
  for (let a = 0; a < result.length; a++) {
    for (let b = a + 1; b < result.length; b++) {
      const left = result[a]!;
      const right = result[b]!;
      expect(
        left.x + left.width + 200 <= right.x ||
          right.x + right.width + 200 <= left.x ||
          left.y + left.height + 200 <= right.y ||
          right.y + right.height + 200 <= left.y,
      ).toBe(true);
    }
  }
}
function expectParentsAbove(result: NodeLayout[], references: Reference[]) {
  const byTable = new Map(result.map((node) => [node.objectId, node]));
  for (const relation of references) {
    const child = byTable.get(relation.sourceTableId)!;
    const parent = byTable.get(relation.targetTableId)!;
    expect(parent.y + parent.height + 200).toBeLessThanOrEqual(child.y);
  }
}
function byId(result: NodeLayout[]) {
  return result.toSorted((a, b) => a.id.localeCompare(b.id));
}

describe('native TABLE auto layout', () => {
  it('preserves input order, IDs, dimensions and minimum-coordinate origin without mutation', () => {
    const input = nodes(20);
    const before = structuredClone(input);
    const references = input.slice(1).map((node) => reference(node.objectId, 'table-0'));
    const beforeReferences = structuredClone(references);
    const result = arrangeNativeTableNodes(input, references);
    expect(input).toEqual(before);
    expect(references).toEqual(beforeReferences);
    expect(result.map(({ x: _x, y: _y, ...node }) => node)).toEqual(
      input.map(({ x: _x, y: _y, ...node }) => node),
    );
    expect(Math.min(...result.map((node) => node.x))).toBe(
      Math.min(...input.map((node) => node.x)),
    );
    expect(Math.min(...result.map((node) => node.y))).toBe(
      Math.min(...input.map((node) => node.y)),
    );
    expectSeparated(result);
    expectParentsAbove(result, references);
    expect(arrangeNativeTableNodes(result, references)).toEqual(result);
  });

  it('wraps a large star into several sibling rows instead of a single wide strip', () => {
    const input = nodes(50).map((node) => ({ ...node, width: 300, height: 240 }));
    const references = input.slice(1).map((node) => reference(node.objectId, 'table-0'));
    const result = arrangeNativeTableNodes(input, references);
    const children = result.slice(1);
    const width =
      Math.max(...result.map((node) => node.x + node.width)) -
      Math.min(...result.map((node) => node.x));
    expect(new Set(children.map((node) => node.y)).size).toBeGreaterThan(1);
    expect(width).toBeLessThan(10000);
    expectSeparated(result);
    expectParentsAbove(result, references);
    expect(arrangeNativeTableNodes(result, references)).toEqual(result);
  });

  it('packs isolates into a compact grid using each actual card size', () => {
    const result = arrangeNativeTableNodes(nodes(50), []);
    expectSeparated(result);
    const width =
      Math.max(...result.map((node) => node.x + node.width)) -
      Math.min(...result.map((node) => node.x));
    const height =
      Math.max(...result.map((node) => node.y + node.height)) -
      Math.min(...result.map((node) => node.y));
    expect(width / height).toBeGreaterThan(0.4);
    expect(width / height).toBeLessThan(2.5);
    expect(arrangeNativeTableNodes(result, [])).toEqual(result);
  });

  it('collapses cycles while preserving parent order outside each strongly connected group', () => {
    const input = nodes(8);
    const cycle = [
      reference('table-0', 'table-1'),
      reference('table-1', 'table-2'),
      reference('table-2', 'table-0'),
    ];
    const boundaries = [
      reference('table-3', 'table-0'),
      reference('table-3', 'table-1'),
      reference('table-3', 'table-2'),
      reference('table-5', 'table-4'),
    ];
    const references = [...cycle, ...boundaries, reference('table-6', 'table-6')];
    const result = arrangeNativeTableNodes(input, references);
    expectSeparated(result);
    expectParentsAbove(result, boundaries);
    expect(arrangeNativeTableNodes(result, references)).toEqual(result);
  });

  it('keeps all parents above children in diamond and uneven multi-component graphs', () => {
    const input = nodes(30);
    const references = [
      reference('table-1', 'table-0'),
      reference('table-2', 'table-0'),
      reference('table-3', 'table-1'),
      reference('table-3', 'table-2'),
    ];
    for (let index = 6; index < 25; index++) {
      references.push(reference(`table-${index}`, `table-${Math.floor((index - 5) / 3) + 4}`));
    }
    const result = arrangeNativeTableNodes(input, references);
    expectSeparated(result);
    expectParentsAbove(result, references);
    expect(arrangeNativeTableNodes(result, references)).toEqual(result);
  });

  it('is deterministic under input and relation permutations, duplicate and missing references', () => {
    const input = nodes(100);
    const references = input
      .slice(1)
      .map((node, index) => reference(node.objectId, `table-${Math.floor(index / 3)}`));
    const expected = arrangeNativeTableNodes(input, references);
    const permuted = arrangeNativeTableNodes(input.toReversed(), references.toReversed());
    expect(byId(permuted)).toEqual(byId(expected));
    expect(
      arrangeNativeTableNodes(input, [
        ...references,
        ...references,
        reference('missing', 'table-0'),
        reference('table-1', 'missing'),
      ]),
    ).toEqual(expected);
    expect(arrangeNativeTableNodes(expected, references)).toEqual(expected);
    expectSeparated(expected);
    expectParentsAbove(expected, references);
  });

  it('retains safe left-to-right ties and their wrapped row order on subsequent runs', () => {
    const input = nodes(20).map((node, index) => ({
      ...node,
      x: 1000 - index * 20,
      y: 0,
      width: 300,
      height: 220,
    }));
    const references = input.slice(1).map((node) => reference(node.objectId, 'table-0'));
    const result = arrangeNativeTableNodes(input, references);
    const orderedChildren = result.slice(1).toSorted((a, b) => a.y - b.y || a.x - b.x);
    expect(orderedChildren.map((node) => node.id)).toEqual(
      input
        .slice(1)
        .toReversed()
        .map((node) => node.id),
    );
    expect(arrangeNativeTableNodes(result, references)).toEqual(result);
  });

  it('does not fold a long chain and avoids recursive graph traversal', () => {
    const input = nodes(2500);
    const references = input
      .slice(1)
      .map((node, index) => reference(node.objectId, `table-${index}`));
    const result = arrangeNativeTableNodes(input, references);
    expect(new Set(result.map((node) => node.y)).size).toBe(input.length);
    expectParentsAbove(result, references);
    expect(arrangeNativeTableNodes(result, references)).toEqual(result);
  });

  it('retains its fixed point on varied graphs with cycles, disconnected groups and unequal cards', () => {
    for (let seed = 1; seed <= 24; seed++) {
      let state = seed;
      const random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 2 ** 32;
      };
      const input = nodes(25 + seed).map((node) => ({
        ...node,
        x: Math.floor(random() * 2000),
        y: Math.floor(random() * 2000),
        width: 280 + Math.floor(random() * 600),
        height: 220 + Math.floor(random() * 1200),
      }));
      const references: Reference[] = [];
      for (let index = 0; index < input.length * 2; index++) {
        references.push(
          reference(
            `table-${Math.floor(random() * input.length)}`,
            `table-${Math.floor(random() * input.length)}`,
          ),
        );
      }
      const result = arrangeNativeTableNodes(input, references);
      expect(arrangeNativeTableNodes(result, references)).toEqual(result);
      expect(byId(arrangeNativeTableNodes(input.toReversed(), references.toReversed()))).toEqual(
        byId(result),
      );
      expectSeparated(result);
    }
  });
  it('handles empty and singleton selections', () => {
    expect(arrangeNativeTableNodes([], [])).toEqual([]);
    const input = nodes(1);
    expect(arrangeNativeTableNodes(input, [reference('table-0', 'table-0')])).toEqual(input);
  });
});
