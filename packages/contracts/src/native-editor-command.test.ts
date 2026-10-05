import { describe, expect, it } from 'vitest';
import { createNativeColumn, createNativeTable, defaultDatabaseContext } from '@ezerd/model';
import { nativeEditorCommandSchema, nativePendingSaveSchema } from './native-edit.js';
import {
  nativeSharedCanvasCommandSchema,
  nativePersonalCanvasCommandSchema,
  nativeDomainCommandSchema,
  nativeKeyPatchSchema,
  nativeForeignKeyPatchSchema,
} from './native-editor-command.js';
import {
  clipboardCommand,
  clipboardFixture,
} from '../../../apps/web/src/features/projects/native-clipboard-test-fixtures.js';
import { nativeTableClipboardSchema } from './native-clipboard.js';
import {
  nativeClipboardPasteCommandSchema,
  planNativeClipboardCommand,
} from './native-editor-command.js';
import { createEmptyNativeDocument } from '@ezerd/model';

describe('native structured editor commands', () => {
  it('distinguishes omitted FK definitions from explicit removal and allows endpoint patches', () => {
    expect(
      nativeForeignKeyPatchSchema.parse({
        sourceTableId: 'child',
        targetTableId: 'parent',
        physical: null,
      }),
    ).toEqual({ sourceTableId: 'child', targetTableId: 'parent', physical: null });
    expect(
      Object.hasOwn(nativeForeignKeyPatchSchema.parse({ logical: { name: 'new' } }), 'physical'),
    ).toBe(false);
    expect(nativeForeignKeyPatchSchema.safeParse({ physical: undefined }).success).toBe(false);
    expect(
      nativeForeignKeyPatchSchema.safeParse({ physical: { name: 'partial' }, id: 'replacement' })
        .success,
    ).toBe(false);
    expect(nativeForeignKeyPatchSchema.safeParse({ sourceTableId: '' }).success).toBe(false);
  });
  it.each(['patch_key', 'patch_foreign_key'] as const)(
    '%s preserves omission and accepts root null only as an explicit removal token',
    (type) => {
      const schema = type === 'patch_key' ? nativeKeyPatchSchema : nativeForeignKeyPatchSchema;
      const omitted = schema.parse({});
      expect(Object.hasOwn(omitted, 'deferrable')).toBe(false);
      for (const deferrable of [null, { initially: 'immediate' }, { initially: 'deferred' }]) {
        const command = { type, id: 'constraint', patch: { deferrable } };
        expect(nativeEditorCommandSchema.parse(command)).toEqual(command);
        expect(schema.parse(command.patch)).toEqual(command.patch);
      }
      for (const deferrable of [
        undefined,
        false,
        true,
        '',
        {},
        { initially: 'later' },
        { initially: undefined },
        { initially: 'deferred', extra: true },
      ])
        expect(schema.safeParse({ deferrable }).success).toBe(false);
      expect(schema.safeParse({ id: 'replacement', deferrable: null }).success).toBe(false);
      expect(
        nativeForeignKeyPatchSchema.safeParse({ physical: { deferrable: null } }).success,
      ).toBe(false);
      expect(nativeForeignKeyPatchSchema.safeParse({ logical: { deferrable: null } }).success).toBe(
        false,
      );
    },
  );
  it('keeps null removal out of add/stored constraint contracts and retains valid operation tokens through pending JSON', () => {
    const key = {
      id: 'k',
      tableId: 't',
      scope: 'physical',
      kind: 'primary',
      name: 'pk',
      columnIds: ['c'],
      deferrable: null,
    };
    expect(nativeEditorCommandSchema.safeParse({ type: 'add_key', value: key }).success).toBe(
      false,
    );
    const relation = {
      id: 'r',
      sourceTableId: 's',
      targetTableId: 't',
      scope: 'logical',
      logical: { name: 'FK', cardinality: 'one-to-many', required: false },
      physical: null,
      deferrable: null,
    };
    expect(
      nativeEditorCommandSchema.safeParse({ type: 'add_foreign_key', value: relation }).success,
    ).toBe(false);
    const uuid = '00000000-0000-4000-8000-000000000001';
    const pending = {
      userId: uuid,
      projectId: uuid,
      request: {
        operationId: uuid,
        groupId: uuid,
        clientId: uuid,
        expectedVersion: 7,
        expectedSequence: 11,
        expectedDatabaseRevision: 3,
        includeDocument: true as const,
        commands: [
          { type: 'patch_key', id: 'k', patch: { deferrable: null } },
          { type: 'patch_foreign_key', id: 'r', patch: { deferrable: null } },
        ],
      },
    };
    expect(nativePendingSaveSchema.parse(JSON.parse(JSON.stringify(pending)))).toEqual(pending);
  });
  it('accepts only strict self-contained format2 clipboard commands with complete fresh UUID remaps', () => {
    const command = clipboardCommand();
    expect(nativeEditorCommandSchema.parse(command)).toEqual(command);
    expect(nativePersonalCanvasCommandSchema.safeParse(command).success).toBe(false);
    for (const input of [
      { ...command, privilegedBefore: command.clipboard.document },
      { ...command, bindExisting: { a: 'short-existing' } },
      { ...command, newIds: command.newIds.slice(1) },
      { ...command, newIds: command.newIds.map(() => command.newIds[0]) },
      { ...command, clipboard: { ...command.clipboard, formatVersion: 1 } },
      { ...command, clipboard: { ...command.clipboard, sourceProjectId: 'foreign-short' } },
      { ...command, point: { x: 10000001, y: 0 } },
    ])
      expect(nativeClipboardPasteCommandSchema.safeParse(input).success).toBe(false);
    const old = structuredClone(command.clipboard);
    delete old.sourceProjectId;
    expect(nativeTableClipboardSchema.safeParse(old).success).toBe(true);
    const borrowed = structuredClone(command);
    borrowed.clipboard.document.tableRelations![0]!.targetTableId = 'existing';
    expect(nativeClipboardPasteCommandSchema.safeParse(borrowed).success).toBe(false);
  });
  it('clones all ENUM dependencies rather than auto-binding same-named target or source project IDs', () => {
    const source = clipboardFixture();
    source.enums = [{ id: 'enum', name: 'state', schema: 'public', values: ['ready'] }];
    source.columns![0]!.physical.type = {
      kind: 'projectEnum',
      database: 'postgresql',
      enumId: 'enum',
    };
    const command = clipboardCommand(source),
      target = createEmptyNativeDocument(source.database);
    target.enums = [{ ...source.enums[0]!, id: 'existing' }];
    const plan = planNativeClipboardCommand(target, command);
    expect(plan.document.enums).toHaveLength(2);
    expect(plan.document.enums![1]!.id).not.toBe('existing');
    expect(plan.document.enums![1]!.name).toBe('state_copy');
    expect(plan.document.columns![0]!.physical.type).toMatchObject({
      enumId: plan.document.enums![1]!.id,
    });
    const originalId = structuredClone(command);
    originalId.clipboard.document.tables![0]!.id = command.newIds[0]!;
    originalId.clipboard.document.columns![0]!.tableId = command.newIds[0]!;
    expect(nativeClipboardPasteCommandSchema.safeParse(originalId).success).toBe(false);
  });
  it('preflights the ordinary 1000-change budget without truncating a large logical fragment', () => {
    const source = clipboardFixture();
    const template = source.columns![0]!;
    source.columns!.push(
      ...Array.from({ length: 1000 }, (_, index) => ({
        ...structuredClone(template),
        id: `extra-${index}`,
        logical: { ...template.logical, name: `Extra ${index}` },
        physical: { ...template.physical, name: `extra_${index}` },
      })),
    );
    const before = structuredClone(source),
      command = clipboardCommand(source);
    const plan = planNativeClipboardCommand(createEmptyNativeDocument(source.database), command);
    expect(plan.canApply).toBe(false);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: 'sync.change-limit' }));
    expect(plan.document.columns).toHaveLength(1002);
    expect(source).toEqual(before);
  });
  it('requires explicit domain removal policies and strict metadata/grouping-only patches', () => {
    for (const command of [
      {
        type: 'add_domain',
        value: { id: 'd', name: 'Domain', description: '' },
        placement: { x: 0, y: 20 },
        nodeId: 'node-d',
      },
      { type: 'patch_domain', id: 'd', patch: { color: null } },
      { type: 'move_table_domain', tableId: 't', targetDomainId: null },
      { type: 'delete_domain', id: 'd', policy: { kind: 'moveTables', targetDomainId: 'other' } },
      {
        type: 'delete_domain',
        id: 'd',
        policy: { kind: 'deleteTables', cascadeGeneratedColumns: true },
      },
    ]) {
      expect(nativeDomainCommandSchema.parse(command)).toEqual(command);
      expect(nativeEditorCommandSchema.parse(command)).toEqual(command);
      expect(nativePersonalCanvasCommandSchema.safeParse(command).success).toBe(false);
    }
    for (const command of [
      { type: 'delete_domain', id: 'd' },
      { type: 'delete_domain', id: 'd', policy: { kind: 'moveTables' } },
      {
        type: 'delete_domain',
        id: 'd',
        policy: { kind: 'rejectNonempty', cascadeGeneratedColumns: true },
      },
      { type: 'patch_domain', id: 'd', patch: { id: 'new' } },
      { type: 'patch_domain', id: 'd', patch: { physical: { namespace: 'public' } } },
      { type: 'patch_domain', id: 'd', patch: {} },
      { type: 'move_table_domain', tableId: 't', targetDomainId: ' padded ' },
      {
        type: 'add_domain',
        value: { id: 'd', name: 'D', description: '', columns: [] },
        placement: { x: 0, y: 0 },
      },
    ])
      expect(nativeDomainCommandSchema.safeParse(command).success).toBe(false);
  });
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
        ...(type === 'patch_foreign_key' ? [] : [{ sourceTableId: 'other' }]),
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
