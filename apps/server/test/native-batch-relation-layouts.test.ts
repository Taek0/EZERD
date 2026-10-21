import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import {
  addTableReference,
  applyChanges,
  deriveOperationChanges,
  inverseChanges,
  type NativeDesignDocument,
} from '@ezerd/model';
import { nativeEditorCandidate } from '../src/mcp/mcp-native-document.service.js';
import { deferrableFixture } from './native-deferrable-fixture.js';
import { normalizeNativeServerDocument } from '../src/shared/native-document-reader.js';

function fixture(count: number): NativeDesignDocument {
  let document = deferrableFixture();
  document = addTableReference(document, 'parent', '__tables__', { x: 0, y: 0 });
  document = addTableReference(document, 'child', '__tables__', { x: 700, y: 200 });
  const template = document.tableRelations![0]!;
  document.tableRelations = Array.from({ length: count }, (_, index) => ({
    ...structuredClone(template),
    id: `fk-${index}`,
    physical: { ...template.physical!, name: `fk_parent_${index}` },
  }));
  return document;
}

const command = (count: number) => ({
  type: 'batch_upsert_relation_layouts' as const,
  viewId: '__tables__',
  routes: Array.from({ length: count }, (_, index) => ({
    relationId: `fk-${index}`,
    offset: 0,
    sourceAnchor: { side: 'right' as const, ratio: (index + 1) / (count + 1) },
    targetAnchor: { side: 'left' as const, ratio: (index + 1) / (count + 1) },
    waypoints: [{ x: 500, y: index * 5 }],
  })),
});

describe('native batch relation layout candidate', () => {
  it('materializes missing shared placements using the same geometry as the preview', () => {
    const before = fixture(2);
    before.layout.nodes = before.layout.nodes.filter((node) => node.objectId !== 'child');
    const original = structuredClone(before);
    const preview = normalizeNativeServerDocument(before);
    const after = nativeEditorCandidate(before, [command(2)]);
    expect(after.layout.nodes).toEqual(preview.layout.nodes);
    expect(after.layout.relations).toHaveLength(2);
    expect(after.tables).toEqual(before.tables);
    expect(before).toEqual(original);
    const single = nativeEditorCandidate(before, [
      { type: 'upsert_relation_layout', value: { ...command(1).routes[0]!, viewId: '__tables__' } },
    ]);
    expect(single.layout.nodes).toEqual(preview.layout.nodes);
    const changes = deriveOperationChanges(before, after);
    expect(applyChanges(after, inverseChanges(changes))).toEqual({
      ...before,
      layout: { ...before.layout, relations: before.layout.relations ?? [] },
    });
  });
  it('applies 150 routes atomically and leaves relation meaning and card placement untouched', () => {
    const before = fixture(150);
    const after = nativeEditorCandidate(before, [command(150)]);
    const changes = deriveOperationChanges(before, after);
    expect(changes).toHaveLength(150);
    expect(changes.every((change) => change.path.startsWith('/layout/relations/'))).toBe(true);
    expect(after.layout.relations).toHaveLength(150);
    expect(after.tableRelations).toEqual(before.tableRelations);
    expect(after.layout.nodes).toEqual(before.layout.nodes);
    expect(before.layout.relations ?? []).toHaveLength(0);

    // Native history uses these same inverse route paths. A later table movement survives undo.
    const moved = structuredClone(after);
    moved.layout.nodes[0]!.x += 100;
    const undone = applyChanges(moved, inverseChanges(changes));
    expect(undone.layout.relations).toEqual([]);
    expect(undone.layout.nodes[0]!.x).toBe(moved.layout.nodes[0]!.x);
  });

  it('rejects a missing relation or endpoint without mutating any earlier route', () => {
    const before = fixture(2);
    const snapshot = structuredClone(before);
    expect(() =>
      nativeEditorCandidate(before, [
        {
          ...command(2),
          routes: [command(2).routes[0]!, { ...command(2).routes[1]!, relationId: 'missing' }],
        },
      ]),
    ).toThrow();
    const withoutEndpoint = structuredClone(before);
    withoutEndpoint.layout.nodes = withoutEndpoint.layout.nodes.filter(
      (node) => node.objectId !== 'child',
    );
    withoutEndpoint.tables = withoutEndpoint.tables!.filter((table) => table.id !== 'child');
    expect(() => nativeEditorCandidate(withoutEndpoint, [command(2)])).toThrow();
    expect(before).toEqual(snapshot);
  });

  it('keeps a relation layout batch exclusive to preserve route-only undo', () => {
    expect(() =>
      nativeEditorCandidate(fixture(1), [
        command(1),
        { type: 'patch_table', id: 'parent', patch: { logical: { name: 'changed' } } },
      ]),
    ).toThrow('relation-layout.batch-exclusive');
  });
});
