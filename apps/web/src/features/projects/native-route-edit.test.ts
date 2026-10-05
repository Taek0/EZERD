import { describe, expect, it } from 'vitest';
import { clipboardFixture } from './native-clipboard-test-fixtures.js';
import { upsertRelationLayout } from '@ezerd/model';
import { nativeCanvasScene, nativeCanvasPersonalCandidate } from './NativeERDCanvas.js';
import {
  nativeRouteCommand,
  nativeRouteDrag,
  nativeRouteGeometry,
  nativeRouteKey,
} from './native-route-edit.js';
import { nativeDraftRecoveryTarget } from './native-draft-recovery-target.js';
import type { NativeDraftArchiveEntry } from './native-draft-archive.js';
describe('native relation path editing', () => {
  it('moves an anchor without changing FK columns or source data', () => {
    const document = clipboardFixture(),
      before = structuredClone(document);
    const scene = nativeCanvasScene(document, '__tables__', 'logical'),
      item = scene.relations[0]!,
      source = scene.nodes.find((n) => n.objectId === item.relation.sourceTableId)!;
    const route = { viewId: '__tables__', relationId: item.relation.id, offset: 0 };
    const moved = nativeRouteDrag(
      scene,
      item.relation.id,
      route,
      item.geometry.points,
      'source',
      { x: source.x + source.width / 2, y: source.y },
      item.geometry.points[0]!,
    );
    expect(moved.sourceAnchor).toEqual({ side: 'top', ratio: 0.5 });
    const command = nativeRouteCommand(
      document,
      '__tables__',
      item.relation.id,
      JSON.stringify(moved),
    );
    expect(() => nativeCanvasPersonalCandidate(document, command)).toThrow(
      'canvas.personal-view-required',
    );
    const candidate = upsertRelationLayout(document, moved);
    expect(candidate.layout.relations).toContainEqual(moved);
    expect(candidate.tableRelations).toEqual(document.tableRelations);
    expect(document).toEqual(before);
    expect(nativeRouteGeometry(scene, item.relation.id, moved).path).not.toEqual(
      item.geometry.path,
    );
  });
  it('rejects mismatched scope, invalid ratio and non-finite points', () => {
    const document = clipboardFixture();
    expect(() =>
      nativeRouteCommand(
        document,
        '__tables__',
        'fk',
        JSON.stringify({ viewId: 'private', relationId: 'fk', offset: 0 }),
      ),
    ).toThrow();
    expect(() =>
      nativeRouteCommand(
        document,
        '__tables__',
        'fk',
        JSON.stringify({
          viewId: '__tables__',
          relationId: 'fk',
          offset: 0,
          sourceAnchor: { side: 'left', ratio: 2 },
        }),
      ),
    ).toThrow();
    expect(nativeRouteCommand(document, '__tables__', 'fk', '', true)).toEqual({
      type: 'delete_relation_layout',
      relationId: 'fk',
      viewId: '__tables__',
    });
  });
  it('recovers saved route drafts into the correct shared canvas', () => {
    const document = clipboardFixture(),
      key = nativeRouteKey('__tables__', 'fk');
    expect(
      nativeDraftRecoveryTarget(document, {
        category: 'editor',
        logicalKey: key,
        draft: { key },
      } as NativeDraftArchiveEntry),
    ).toEqual({
      kind: 'canvas',
      selection: { viewId: '__tables__', routeId: 'fk' },
      personal: false,
    });
  });
});
