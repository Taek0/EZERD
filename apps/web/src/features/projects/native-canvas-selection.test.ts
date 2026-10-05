import { describe, expect, it } from 'vitest';
import {
  createEmptyNativeDocument,
  createNativeTable,
  createNativeColumn,
  defaultDatabaseContext,
  addTableReference,
  upsertCombinedView,
  type NativeDesignDocument,
} from '@ezerd/model';
import { nativePersonalCanvasCommandSchema } from '@ezerd/contracts';
import {
  nativeCanvasMoveCommand,
  nativeSelectionPlacements,
  nativeAutoLayoutPlacements,
  nativeZoomAt,
  nativeCanvasDraftPlacements,
} from './native-canvas-selection.js';
import { nativeCanvasDeleteCommands } from './native-canvas-delete.js';
import { nativeCanvasPersonalCandidate } from './NativeERDCanvas.js';

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
    expect(placements.every((n) => n.y >= 474)).toBe(true);
    expect(source.layout.nodes.find((n) => n.objectId === 'hidden')!.x).toBe(900);
  });
  it('saves all group placements into one private candidate without changing shared nodes', () => {
    const source = upsertCombinedView(fixture(), { id: 'private', name: 'Mine', domainIds: ['d'] });
    const privateNodes = source.layout.nodes.filter((n) => n.viewId === 'private');
    const commands = nativeSelectionPlacements(privateNodes, 80, 90).map((n) =>
      nativeCanvasMoveCommand(source, n, { x: n.x, y: n.y }),
    );
    const next = commands.reduce<NativeDesignDocument>(
      (doc, c) => nativeCanvasPersonalCandidate(doc, nativePersonalCanvasCommandSchema.parse(c)),
      source,
    );
    expect(next.layout.nodes.filter((n) => n.viewId === '__tables__')).toEqual(
      source.layout.nodes.filter((n) => n.viewId === '__tables__'),
    );
    expect(next.layout.nodes.filter((n) => n.viewId === 'private').map((n) => n.x)).toEqual(
      privateNodes.map((n) => n.x + 80),
    );
    expect(next.columns).toBe(source.columns);
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
  it('collapses domain/table cascade overlap and never deletes shared data in private views', () => {
    const doc = fixture(),
      original = structuredClone(doc);
    const commands = nativeCanvasDeleteCommands(doc, ['d', 'a', 'b'], 'overview');
    expect(commands).toEqual([
      { type: 'delete_domain', id: 'd', policy: { kind: 'deleteTables' } },
    ]);
    const personal = upsertCombinedView(doc, { id: 'private', name: 'Mine', domainIds: ['d'] });
    const privateCommands = nativeCanvasDeleteCommands(personal, ['a', 'b'], 'private', true);
    expect(privateCommands.every((c) => c.type === 'remove_table_reference')).toBe(true);
    expect(doc).toEqual(original);
    expect(() => nativeCanvasDeleteCommands(personal, ['a'], '__tables__', true)).toThrow(
      'canvas.personal-view-required',
    );
  });
});
