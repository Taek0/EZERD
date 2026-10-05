import { describe, expect, it } from 'vitest';
import { createEmptyNativeDocument, defaultDatabaseContext, addNote } from '@ezerd/model';
import { nativeSelectedObjectCommands } from './NativeSelectedObjectInspector.js';
describe('restored selected note inspector preserves unaffected layout and palette', () => {
  const doc = addNote(
      createEmptyNativeDocument(defaultDatabaseContext('sqlite')),
      { id: 'memo', viewId: '__tables__', text: 'before' },
      { x: 20, y: 40 },
    ),
    node = doc.layout.nodes[0]!;
  const initial = {
    x: String(node.x),
    y: String(node.y),
    width: String(node.width),
    height: String(node.height),
    text: 'before',
    color: '#fff3c4',
    personalVersion: '2',
  };
  it('changes only note text without converting the inherited palette to an explicit color', () => {
    expect(nativeSelectedObjectCommands(doc, node, { ...initial, text: 'after' }, 2)).toEqual([
      { type: 'patch_note', id: 'memo', patch: { text: 'after' } },
    ]);
    expect(doc.notes[0]).not.toHaveProperty('color');
  });
  it('keeps position-only changes free of unrelated size updates', () => {
    expect(nativeSelectedObjectCommands(doc, node, { ...initial, x: '75' }, 2)).toEqual([
      { type: 'update_node_layout', nodeId: node.id, patch: { x: 75, y: 40 } },
    ]);
  });
  it('rejects stale private input and invalid dimensions', () => {
    expect(() => nativeSelectedObjectCommands(doc, node, initial, 3)).toThrow(
      'native.personal-conflict',
    );
    expect(() =>
      nativeSelectedObjectCommands(doc, node, { ...initial, width: 'NaN' }, 2),
    ).toThrow();
    expect(() =>
      nativeSelectedObjectCommands(doc, node, { ...initial, height: '-1' }, 2),
    ).toThrow();
  });
  it('does not submit unchanged values', () =>
    expect(nativeSelectedObjectCommands(doc, node, initial, 2)).toEqual([]));
});
