import { describe, expect, it } from 'vitest';
import {
  createEmptyNativeDocument,
  createNativeTable,
  createNativeColumn,
  defaultDatabaseContext,
  updateNativeTable,
  updateNativeColumn,
  updateNodeLayout,
  type NativeDesignDocument,
} from '@ezerd/model';
import type { NativeWebCommand } from './native-save.js';
import { coalesceNativeSaveCommands } from './native-save-coalescing.js';

const comment = (value: string): NativeWebCommand => ({
  type: 'patch_column',
  id: 'c',
  patch: { physical: { comment: value } },
});
function apply(document: NativeDesignDocument, commands: NativeWebCommand[]) {
  return commands.reduce((current, command) => {
    switch (command.type) {
      case 'patch_table':
        return updateNativeTable(current, command.id, command.patch);
      case 'patch_column':
        return updateNativeColumn(current, command.id, command.patch);
      case 'update_node_layout':
        return updateNodeLayout(current, command.nodeId, command.patch);
      default:
        throw Error('unsupported fixture command');
    }
  }, document);
}

describe('native save command coalescing before operation identity', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'preserves the applied %s document while reducing text and movement payloads',
    (kind) => {
      const database = defaultDatabaseContext(kind),
        table = createNativeTable(database, 't'),
        column = createNativeColumn(database, table, 'c'),
        document = {
          ...createEmptyNativeDocument(database),
          tables: [table],
          columns: [column],
          layout: {
            nodes: [
              { id: 'n', objectId: 't', viewId: 'overview', x: 0, y: 0, width: 320, height: 260 },
            ],
            viewports: [],
          },
        },
        commands: NativeWebCommand[] = [
          { type: 'patch_table', id: 't', patch: { logical: { name: 'A' } } },
          { type: 'patch_table', id: 't', patch: { logical: { definition: 'kept' } } },
          { type: 'patch_table', id: 't', patch: { logical: { name: 'B' } } },
          comment('A'),
          {
            type: 'patch_column',
            id: 'c',
            patch: { logical: { name: 'column', definition: 'kept' } },
          },
          comment('B'),
          comment('A'),
          { type: 'update_node_layout', nodeId: 'n', patch: { x: 10, width: 400 } },
          { type: 'update_node_layout', nodeId: 'n', patch: { y: 20 } },
          { type: 'update_node_layout', nodeId: 'n', patch: { x: 30 } },
        ],
        original = structuredClone(commands),
        folded = coalesceNativeSaveCommands(commands);
      expect(folded).toHaveLength(3);
      expect(apply(document, folded)).toEqual(apply(document, commands));
      expect(apply(document, folded).columns![0]!.physical.comment).toBe('A');
      expect(commands).toEqual(original);
      folded[0]!.type = 'patch_column';
      expect(commands).toEqual(original);
    },
  );

  const boundaries: NativeWebCommand[] = [
    { type: 'delete_objects', targets: [{ collection: 'columns', id: 'other' }] },
    { type: 'reorder_columns', tableId: 't', columnIds: ['c'] },
    { type: 'move_table_domain', tableId: 't', targetDomainId: null },
    { type: 'patch_column', id: 'c', patch: { physical: { name: 'new_name' } } },
    { type: 'patch_column', id: 'c', patch: { scope: 'logical' } },
    { type: 'patch_column', id: 'c', patch: { physical: { nullable: true } } },
    { type: 'patch_column', id: 'c', patch: { logical: { required: true } } },
  ];
  it.each(boundaries)('keeps $type as an ordered coalescing boundary', (boundary) => {
    const commands = [comment('before'), boundary, comment('after')];
    expect(coalesceNativeSaveCommands(commands)).toEqual(commands);
  });

  it('never collapses across a different object, command type or intervening layout', () => {
    const commands: NativeWebCommand[] = [
      comment('first'),
      { type: 'patch_column', id: 'other', patch: { physical: { comment: 'other' } } },
      comment('last'),
      { type: 'patch_table', id: 'c', patch: { physical: { comment: 'table' } } },
      comment('final'),
    ];
    expect(coalesceNativeSaveCommands(commands)).toEqual(commands);
  });

  it('keeps explicit undefined as a boundary so JSON omission preserves earlier text assignments', () => {
    const commands: NativeWebCommand[] = [
        comment('keep comment'),
        {
          type: 'patch_column',
          id: 'c',
          patch: { physical: { comment: undefined }, logical: { name: 'new logical name' } },
        } as unknown as NativeWebCommand,
        { type: 'patch_column', id: 'c', patch: { logical: { definition: 'new definition' } } },
      ],
      folded = coalesceNativeSaveCommands(commands),
      wire = JSON.parse(JSON.stringify(folded)) as NativeWebCommand[];
    expect(folded).toEqual(commands);
    expect(wire[0]).toEqual(comment('keep comment'));
    expect(wire[1]).toEqual({
      type: 'patch_column',
      id: 'c',
      patch: { physical: {}, logical: { name: 'new logical name' } },
    });
  });

  it('keeps undefined dimensions separate instead of losing an earlier resize on the wire', () => {
    const commands = [
        { type: 'update_node_layout', nodeId: 'n', patch: { width: 400 } },
        { type: 'update_node_layout', nodeId: 'n', patch: { x: 20, width: undefined } },
        { type: 'update_node_layout', nodeId: 'n', patch: { y: 30 } },
      ] as unknown as NativeWebCommand[],
      folded = coalesceNativeSaveCommands(commands);
    expect(folded).toEqual(commands);
    expect(JSON.parse(JSON.stringify(folded))).toEqual([
      { type: 'update_node_layout', nodeId: 'n', patch: { width: 400 } },
      { type: 'update_node_layout', nodeId: 'n', patch: { x: 20 } },
      { type: 'update_node_layout', nodeId: 'n', patch: { y: 30 } },
    ]);
  });

  it('rejects an invalid intermediate command instead of hiding it behind a valid final patch', () => {
    expect(() =>
      coalesceNativeSaveCommands([comment('x'.repeat(10001)), comment('valid')]),
    ).toThrow();
    expect(() =>
      coalesceNativeSaveCommands([
        { type: 'update_node_layout', nodeId: 'n', patch: { width: -1 } },
        { type: 'update_node_layout', nodeId: 'n', patch: { width: 320 } },
      ]),
    ).toThrow();
    expect(() =>
      coalesceNativeSaveCommands(Array.from({ length: 101 }, () => comment('A'))),
    ).toThrow();
  });
});
