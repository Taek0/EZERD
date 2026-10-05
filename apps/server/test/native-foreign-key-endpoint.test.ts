import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { nativeEditorCandidate } from '../src/mcp/mcp-native-document.service.js';
import { deferrableFixture } from './native-deferrable-fixture.js';
describe('restored FK endpoint and definition patch candidate', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'retains %s identity, logical meaning and raw data when removing/restoring a definition',
    (kind) => {
      const source = deferrableFixture(kind),
        before = structuredClone(source),
        relation = source.tableRelations![0]!;
      const removed = nativeEditorCandidate(source, [
        { type: 'patch_foreign_key', id: relation.id, patch: { physical: null } },
      ]);
      expect(removed.tableRelations![0]).toEqual({ ...relation, physical: null });
      expect(source).toEqual(before);
      expect(removed.columns).toEqual(source.columns);
      const restored = nativeEditorCandidate(removed, [
        { type: 'patch_foreign_key', id: relation.id, patch: { physical: relation.physical! } },
      ]);
      expect(restored).toEqual(source);
      expect(() =>
        nativeEditorCandidate(removed, [
          {
            type: 'patch_foreign_key',
            id: relation.id,
            patch: { physical: { name: 'incomplete' } },
          },
        ]),
      ).toThrow();
    },
  );
  it('merges only endpoint and supplied physical columns, preserving labels/actions/metadata', () => {
    const source = deferrableFixture(),
      relation = source.tableRelations![0]!;
    const next = nativeEditorCandidate(source, [
      {
        type: 'patch_foreign_key',
        id: relation.id,
        patch: { targetTableId: 'new-parent', physical: { targetColumnIds: ['new-id'] } },
      },
    ]);
    expect(next.tableRelations![0]).toEqual({
      ...relation,
      targetTableId: 'new-parent',
      physical: { ...relation.physical!, targetColumnIds: ['new-id'] },
    });
    // This is shape-only preparation: the locked write validator must reject unresolved owners.
    expect(next.columns).toEqual(source.columns);
  });
});
