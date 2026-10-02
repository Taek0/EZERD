import { describe, expect, it } from 'vitest';
import { createNativeColumn, createNativeTable, defaultDatabaseContext } from '@ezerd/model';
import { nativeEditorCommandSchema, nativePendingSaveSchema } from './native-edit.js';
import {
  nativeSharedCanvasCommandSchema,
  nativePersonalCanvasCommandSchema,
} from './native-editor-command.js';

describe('native structured editor commands', () => {
  it('bounds native canvas IDs/layouts and separates personal camera/view commands', () => {
    const command = {
      type: 'update_node_layout',
      nodeId: 'n'.repeat(160),
      patch: { x: -1e7, y: 1e7, width: 10000 },
    };
    expect(nativeEditorCommandSchema.parse(command)).toEqual(command);
    for (const input of [
      { ...command, nodeId: 'n'.repeat(161) },
      { ...command, patch: {} },
      { ...command, patch: { x: 1e7 + 1 } },
      { ...command, patch: { height: 0 } },
      { ...command, patch: { objectId: 'hijack' } },
    ])
      expect(nativeEditorCommandSchema.safeParse(input).success).toBe(false);
    const camera = { type: 'set_viewport', value: { viewId: '__tables__', x: 0, y: 0, zoom: 4 } };
    expect(nativeSharedCanvasCommandSchema.safeParse(camera).success).toBe(false);
    expect(nativePersonalCanvasCommandSchema.parse(camera)).toEqual(camera);
    expect(
      nativePersonalCanvasCommandSchema.safeParse({
        ...camera,
        value: { ...camera.value, zoom: 4.1 },
      }).success,
    ).toBe(false);
    expect(
      nativeEditorCommandSchema.safeParse({
        type: 'add_table_reference',
        tableId: 't',
        viewId: ' private ',
        placement: { x: 0, y: 0 },
      }).success,
    ).toBe(false);
  });
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'accepts native %s factories without turning them into legacy objects',
    (kind) => {
      const database = defaultDatabaseContext(kind),
        table = createNativeTable(database, 't');
      expect(nativeEditorCommandSchema.parse({ type: 'add_table', value: table })).toEqual({
        type: 'add_table',
        value: table,
      });
      const column = createNativeColumn(database, table, 'c');
      expect(nativeEditorCommandSchema.parse({ type: 'add_column', value: column })).toEqual({
        type: 'add_column',
        value: column,
      });
    },
  );
  it('shares key/index/check/enum/FK strict partial patches and preserves AST numeric tokens', () => {
    const expression = {
      kind: 'binary',
      operator: '>',
      left: { kind: 'column', columnId: 'c' },
      right: { kind: 'literal', literalType: 'number', value: '9007199254740993' },
    };
    for (const command of [
      { type: 'patch_key', id: 'k', patch: { name: 'renamed' } },
      { type: 'patch_index', id: 'i', patch: { parts: [{ direction: 'desc', expression }] } },
      { type: 'patch_check', id: 'q', patch: { expression } },
      { type: 'patch_enum', id: 'e', patch: { values: ['a', 'b'] } },
      {
        type: 'patch_foreign_key',
        id: 'r',
        patch: { physical: { name: 'renamed' }, logical: { name: 'logical' } },
      },
    ])
      expect(nativeEditorCommandSchema.parse(command)).toEqual(command);
    for (const type of [
      'patch_key',
      'patch_index',
      'patch_check',
      'patch_enum',
      'patch_foreign_key',
    ])
      for (const patch of [
        { id: 'other' },
        { tableId: 'other' },
        { sourceTableId: 'other' },
        { database: 'mysql' },
      ])
        expect(nativeEditorCommandSchema.safeParse({ type, id: 'object', patch }).success).toBe(
          false,
        );
    expect(
      nativeEditorCommandSchema.safeParse({
        type: 'patch_foreign_key',
        id: 'r',
        patch: { physical: { injected: true } },
      }).success,
    ).toBe(false);
    expect(
      nativeEditorCommandSchema.safeParse({
        type: 'patch_index',
        id: 'i',
        patch: { options: { database: 'sqlite', rawSql: 'DROP TABLE t' } },
      }).success,
    ).toBe(false);
  });
  it('uses the same new command union in durable pending requests', () => {
    const uuid = '00000000-0000-4000-8000-000000000001';
    const pending = nativePendingSaveSchema.parse({
      userId: uuid,
      projectId: uuid,
      editorDraft: { key: 'create:table:project', revision: uuid },
      request: {
        operationId: uuid,
        groupId: uuid,
        clientId: uuid,
        expectedVersion: 0,
        expectedSequence: 0,
        expectedDatabaseRevision: 0,
        includeDocument: true,
        commands: [{ type: 'delete_objects', targets: [{ collection: 'checks', id: 'q' }] }],
      },
    });
    expect(pending.editorDraft?.revision).toBe(uuid);
    expect(pending.request.commands[0]?.type).toBe('delete_objects');
  });
});
