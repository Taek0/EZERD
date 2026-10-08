import { describe, expect, it } from 'vitest';
import { createNativeTable } from '@ezerd/model';
import { decorationFixture } from './native-canvas-decoration-test-fixtures.js';
import {
  nativeTableCreationPreview,
  nativeTableCreationReflected,
  withNativeTableCreationPreviews,
} from './native-table-creation-preview.js';
import type { NativeWebCommand } from './native-save.js';

function fixture() {
  const document = decorationFixture();
  const table = createNativeTable(document.database, 'new', null, 'physical');
  const commands: NativeWebCommand[] = [
    { type: 'add_table', value: table },
    {
      type: 'add_table_reference',
      tableId: table.id,
      viewId: '__tables__',
      nodeId: 'new-node',
      placement: { x: 80, y: 160 },
    },
  ];
  return { document, commands };
}
describe('limited blank table preview', () => {
  it('adds only the new table and placement without changing the snapshot or commands', () => {
    const { document, commands } = fixture();
    const before = JSON.stringify({ document, commands });
    const preview = nativeTableCreationPreview(document, commands, 'op')!;
    const next = withNativeTableCreationPreviews(document, [preview]);
    expect(next.tables!.at(-1)!.physical.name).toBe('');
    expect(next.layout.nodes.at(-1)).toMatchObject({
      objectId: 'new',
      x: 80,
      y: 160,
      width: 320,
      height: 260,
    });
    expect(next.columns).toBe(document.columns);
    expect(JSON.stringify({ document, commands })).toBe(before);
    expect(nativeTableCreationReflected(document, preview)).toBe(false);
    expect(nativeTableCreationReflected(next, preview)).toBe(true);
    expect(withNativeTableCreationPreviews(next, [preview])).toBe(next);
  });
  it('never overwrites a confirmed name when the document arrives before preview cleanup', () => {
    const { document, commands } = fixture();
    const preview = nativeTableCreationPreview(document, commands, 'op')!;
    const saved = structuredClone(withNativeTableCreationPreviews(document, [preview]));
    saved.tables!.at(-1)!.physical.name = 'confirmed';
    expect(withNativeTableCreationPreviews(saved, [preview]).tables!.at(-1)!.physical.name).toBe(
      'confirmed',
    );
  });
  it('rejects patches, mixed command batches, private placement and duplicate identities', () => {
    const { document, commands } = fixture();
    const patch: NativeWebCommand = {
      type: 'patch_table',
      id: 't',
      patch: { physical: { name: 'changed' } },
    };
    expect(nativeTableCreationPreview(document, [patch], 'op')).toBeNull();
    expect(nativeTableCreationPreview(document, [...commands, patch], 'op')).toBeNull();
    const reference = commands[1]!;
    if (reference.type !== 'add_table_reference') throw Error('fixture');
    expect(
      nativeTableCreationPreview(
        document,
        [commands[0]!, { ...reference, viewId: 'private' }],
        'op',
      ),
    ).toBeNull();
    const next = withNativeTableCreationPreviews(document, [
      nativeTableCreationPreview(document, commands, 'op')!,
    ]);
    expect(nativeTableCreationPreview(next, commands, 'other')).toBeNull();
  });
});
