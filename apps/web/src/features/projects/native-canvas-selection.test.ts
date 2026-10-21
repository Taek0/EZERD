import { describe, expect, it } from 'vitest';
import {
  createEmptyNativeDocument,
  createNativeTable,
  createNativeColumn,
  defaultDatabaseContext,
  addTableReference,
  updateNodeLayout,
  type NativeDesignDocument,
} from '@ezerd/model';
import {
  nativeCanvasMoveCommand,
  nativeSelectionPlacements,
  nativeAutoLayoutPlacements,
  nativeTableLayoutInput,
  nativeZoomAt,
  nativeCanvasDraftPlacements,
} from './native-canvas-selection.js';
import { nativeCanvasDeleteCommands } from './native-canvas-delete.js';

function fixture(): NativeDesignDocument {
  const database = defaultDatabaseContext('postgresql');
  const a = createNativeTable(database, 'a', 'd'),
    b = createNativeTable(database, 'b', 'd'),
    hidden = createNativeTable(database, 'hidden', 'd');
  const ca = createNativeColumn(database, a, 'ca'),
    cb = createNativeColumn(database, b, 'cb');
  let doc = {
    ...createEmptyNativeDocument(database),
    domains: [{ id: 'd', name: 'D', description: '' }],
    tables: [a, b, hidden],
    columns: [ca, cb],
  };
  for (const [id, x] of [
    ['a', 0],
    ['b', 450],
    ['hidden', 900],
  ] as const)
    doc = addTableReference(doc, id, '__tables__', { x, y: 10 });
  return doc;
}
describe('restored native canvas interactions', () => {
  it('resizes an existing node without replacing a concurrent move', () => {
    const source = fixture();
    const displayed = source.layout.nodes.find((node) => node.viewId === '__tables__')!;
    const moved = {
      ...source,
      layout: {
        ...source.layout,
        nodes: source.layout.nodes.map((node) =>
          node.id === displayed.id ? { ...node, x: 300, y: 400 } : node,
        ),
      },
    };
    const command = nativeCanvasMoveCommand(source, displayed, { width: 500, height: 300 });
    if (command.type !== 'update_node_layout') throw Error('Expected update');
    const next = updateNodeLayout(moved, command.nodeId, command.patch);
    expect(next.layout.nodes.find((node) => node.id === displayed.id)).toMatchObject({
      x: 300,
      y: 400,
      width: 500,
      height: 300,
    });
    expect(command).toMatchObject({ patch: { width: 500, height: 300 } });
    expect('patch' in command && command.patch).not.toHaveProperty('x');
    expect('patch' in command && command.patch).not.toHaveProperty('y');
  });
  it('materializes a size-only edit with the generated node position', () => {
    const source = fixture();
    const displayed = source.layout.nodes[0]!;
    const without = { ...source, layout: { ...source.layout, nodes: [] } };
    expect(nativeCanvasMoveCommand(without, displayed, { width: 500, height: 300 })).toMatchObject({
      type: 'add_table_reference',
      placement: { x: displayed.x, y: displayed.y, width: 500, height: 300 },
    });
  });
  it('moves a selected group with a shared boundary clamp and retains raw dimensions', () => {
    const nodes = fixture()
      .layout.nodes.slice(0, 2)
      .map((n, i) => ({ ...n, x: 1e7 - 450 + i * 450 }));
    const moved = nativeSelectionPlacements(nodes, 1000, -100);
    expect(moved[1]!.x).toBe(1e7);
    expect(moved[1]!.x - moved[0]!.x).toBe(450);
    expect(moved[0]!.width).toBe(nodes[0]!.width);
    expect(nodes[0]!.y).toBe(10);
    const inside = nativeSelectionPlacements(nodes, -200, 80);
    expect(inside[0]!.x).toBe(nodes[0]!.x - 200);
    expect(inside[0]!.y).toBe(90);
  });
  it('keeps hidden tables out of the original flow layout, with notes stationary', () => {
    const source = fixture();
    source.notes = [{ id: 'note', viewId: '__tables__', text: 'memo' }];
    source.layout.nodes.push({
      id: 'note-node',
      objectId: 'note',
      viewId: '__tables__',
      x: 0,
      y: 300,
      width: 240,
      height: 110,
    });
    const visible = source.layout.nodes.filter((n) => n.objectId !== 'hidden');
    const placements = nativeAutoLayoutPlacements(source, visible, '__tables__');
    expect(placements.map((n) => n.objectId)).toEqual(['a', 'b']);
    expect(placements.every((n) => n.y >= 610)).toBe(true);
    expect(source.layout.nodes.find((n) => n.objectId === 'hidden')!.x).toBe(900);
  });
  it('materializes generated table positions but rejects generated domain positions', () => {
    const source = fixture(),
      node = source.layout.nodes[0]!;
    const without = { ...source, layout: { ...source.layout, nodes: [] } };
    expect(nativeCanvasMoveCommand(without, node, { x: 5, y: 8 })).toMatchObject({
      type: 'add_table_reference',
      tableId: 'a',
      placement: { x: 5, y: 8 },
    });
    expect(() =>
      nativeCanvasMoveCommand(
        without,
        { ...node, objectId: 'd', viewId: 'overview' },
        { x: 5, y: 8 },
      ),
    ).toThrow('canvas.node-not-found');
  });
  it('keeps the cursor anchor fixed for zoom buttons just as wheel zoom does', () => {
    const camera = { viewId: '__tables__', x: -170, y: 320, zoom: 0.7 },
      point = { x: 420, y: 260 };
    const next = nativeZoomAt(camera, 1.2, point);
    expect((point.x - next.x) / next.zoom).toBeCloseTo((point.x - camera.x) / camera.zoom);
    expect((point.y - next.y) / next.zoom).toBeCloseTo((point.y - camera.y) / camera.zoom);
  });
  it('rejects corrupt or oversized recovered group drafts', () => {
    const nodes = fixture().layout.nodes;
    expect(nativeCanvasDraftPlacements({ nodesJSON: JSON.stringify(nodes) })).toEqual(nodes);
    expect(() =>
      nativeCanvasDraftPlacements({ nodesJSON: JSON.stringify([{ ...nodes[0], x: null }]) }),
    ).toThrow('canvas.placement-invalid');
    expect(() =>
      nativeCanvasDraftPlacements({ nodesJSON: JSON.stringify(Array(101).fill(nodes[0])) }),
    ).toThrow('canvas.placement-invalid');
  });
  it('collapses domain/table cascade overlap', () => {
    const doc = fixture(),
      original = structuredClone(doc);
    const commands = nativeCanvasDeleteCommands(doc, ['d', 'a', 'b']);
    expect(commands).toEqual([
      { type: 'delete_domain', id: 'd', policy: { kind: 'deleteTables' } },
    ]);
    expect(doc).toEqual(original);
  });
});

it('matches physical/logical scene relation filtering and retains measured card sizes', () => {
  const source = fixture();
  source.tableRelations = [
    {
      id: 'edge',
      sourceTableId: 'b',
      targetTableId: 'a',
      scope: 'both',
      physical: null,
      logical: { name: '', cardinality: 'one-to-many', required: false },
    },
  ];
  const nodes = source.layout.nodes
    .filter((node) => node.objectId !== 'hidden')
    .map((node) => ({ ...node, width: 451, height: 679 }));
  expect(nativeTableLayoutInput(source, nodes).relations).toEqual([]);
  const logical = nativeTableLayoutInput(source, nodes, 'logical');
  expect(logical.relations).toEqual([{ sourceTableId: 'b', targetTableId: 'a' }]);
  expect(logical.nodes.every((node) => node.width === 451 && node.height === 679)).toBe(true);
});
