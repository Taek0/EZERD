import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyNativeDocument,
  createNativeTable,
  createNativeColumn,
  defaultDatabaseContext,
  type NativeDesignDocument,
  upsertCombinedView,
  addTableReference,
} from '@ezerd/model';
import {
  McpNativeDocumentService,
  nativeEditorCandidate,
} from '../src/mcp/mcp-native-document.service.js';
import type { NativeSyncService } from '../src/sync/native-sync.service.js';
import type { AuthenticatedUser } from '../src/identity/session.js';

function fixture(): NativeDesignDocument {
  const database = defaultDatabaseContext('postgresql');
  const table = createNativeTable(database, 't');
  table.physical.name = 'records';
  const column = createNativeColumn(database, table, 'c');
  column.physical.name = 'id';
  const doc = { ...createEmptyNativeDocument(database), tables: [table], columns: [column] };
  return doc;
}
describe('native editor candidate and MCP ordering', () => {
  it('uses generic native canvas layout/note/reference helpers and preserves raw physical data', () => {
    const source = fixture(),
      before = structuredClone(source);
    source.domains = [{ id: 'd', name: 'Shared', description: '' }];
    let candidate = nativeEditorCandidate(source, [
      {
        type: 'add_table_reference',
        tableId: 't',
        viewId: '__tables__',
        placement: { x: 100, y: 120, width: 600 },
      },
      {
        type: 'upsert_note',
        value: { id: 'note', viewId: '__tables__', text: 'Shared note' },
        placement: { x: 30, y: 40 },
      },
      { type: 'add_table_reference', tableId: 't', viewId: 'd', placement: { x: 10, y: 20 } },
    ]);
    const node = candidate.layout.nodes.find(
      (node) => node.objectId === 't' && node.viewId === '__tables__',
    )!;
    const reference = candidate.layout.nodes.find(
      (node) => node.objectId === 't' && node.viewId === 'd',
    )!;
    candidate = nativeEditorCandidate(candidate, [
      { type: 'update_node_layout', nodeId: node.id, patch: { x: -900, y: 150, height: 700 } },
      { type: 'patch_note', id: 'note', patch: { text: 'edited' } },
      { type: 'remove_table_reference', nodeId: reference.id },
    ]);
    expect(candidate.layout.nodes.find((item) => item.id === node.id)).toMatchObject({
      x: -900,
      y: 150,
      width: 600,
      height: 700,
    });
    expect(candidate.notes[0]!.text).toBe('edited');
    expect(candidate.tables).toEqual(before.tables);
    expect(candidate.columns).toEqual(before.columns);
    candidate = nativeEditorCandidate(candidate, [
      {
        type: 'add_table_reference',
        tableId: 't',
        viewId: 'd',
        nodeId: 'fresh-reference',
        placement: { x: 30, y: 40 },
      },
    ]);
    expect(candidate.layout.nodes.find((node) => node.viewId === 'd')!.id).toBe('fresh-reference');
    candidate = nativeEditorCandidate(candidate, [{ type: 'delete_note', id: 'note' }]);
    expect(candidate.notes).toEqual([]);
    expect(() =>
      nativeEditorCandidate(candidate, [{ type: 'remove_table_reference', nodeId: node.id }]),
    ).toThrow('소유 화면');
  });
  it('rejects private view nodes/notes/cameras through the shared command route', () => {
    const doc = fixture();
    doc.domains = [{ id: 'd', name: 'D', description: '' }];
    doc.tables![0]!.domainId = 'd';
    const personal = upsertCombinedView(addTableReference(doc, 't', '__tables__', { x: 0, y: 0 }), {
      id: 'v',
      name: 'Private',
      domainIds: ['d'],
    });
    const node = personal.layout.nodes.find((node) => node.viewId === 'v')!;
    expect(() =>
      nativeEditorCandidate(personal, [
        { type: 'update_node_layout', nodeId: node.id, patch: { x: 0 } },
      ]),
    ).toThrow('canvas.shared-view-required');
    expect(() =>
      nativeEditorCandidate(personal, [
        { type: 'upsert_note', value: { id: 'note', viewId: 'v', text: 'private' } },
      ]),
    ).toThrow('canvas.shared-view-required');
    expect(() =>
      nativeEditorCandidate(doc, [
        { type: 'set_viewport', value: { viewId: '__tables__', x: 0, y: 0, zoom: 1 } } as never,
      ]),
    ).toThrow();
  });
  it('adds native tables, columns and constraints atomically, then patches only supplied fields', () => {
    const doc = fixture(),
      database = doc.database;
    const table = createNativeTable(database, 't2');
    const column = createNativeColumn(database, table, 'c2');
    const candidate = nativeEditorCandidate(doc, [
      { type: 'add_table', value: table },
      { type: 'add_column', value: column },
      {
        type: 'add_key',
        value: {
          id: 'k',
          tableId: 't',
          scope: 'physical',
          kind: 'primary',
          name: 'pk',
          columnIds: ['c'],
        },
      },
      {
        type: 'add_index',
        value: {
          id: 'i',
          tableId: 't',
          scope: 'physical',
          name: 'idx',
          unique: false,
          parts: [{ direction: 'asc', expression: { kind: 'column', columnId: 'c' } }],
          options: { database: 'postgresql', method: 'btree', includeColumnIds: ['c'] },
        },
      },
      {
        type: 'add_check',
        value: {
          id: 'q',
          tableId: 't',
          scope: 'physical',
          name: 'ck',
          expression: {
            kind: 'binary',
            operator: '>',
            left: { kind: 'column', columnId: 'c' },
            right: { kind: 'literal', literalType: 'number', value: '9007199254740993' },
          },
        },
      },
      { type: 'add_enum', value: { id: 'e', name: 'state', schema: 'public', values: ['a', 'b'] } },
      {
        type: 'add_foreign_key',
        value: {
          id: 'r',
          sourceTableId: 't2',
          targetTableId: 't',
          scope: 'physical',
          logical: { name: '', cardinality: 'one-to-many', required: false },
          physical: {
            name: 'fk',
            sourceColumnIds: ['c2'],
            targetColumnIds: ['c'],
            onDelete: 'NO ACTION',
            onUpdate: 'NO ACTION',
          },
        },
      },
    ]);
    const patched = nativeEditorCandidate(candidate, [
      { type: 'patch_index', id: 'i', patch: { name: 'renamed' } },
      { type: 'patch_check', id: 'q', patch: { name: 'renamed' } },
      { type: 'patch_key', id: 'k', patch: { name: 'renamed' } },
      { type: 'patch_enum', id: 'e', patch: { name: 'renamed' } },
      {
        type: 'patch_foreign_key',
        id: 'r',
        patch: { physical: { name: 'renamed' }, logical: { name: 'label' } },
      },
    ]);
    expect(patched.indexes![0]).toEqual({ ...candidate.indexes![0], name: 'renamed' });
    expect(patched.checks![0]).toEqual({ ...candidate.checks![0], name: 'renamed' });
    expect(patched.tableRelations![0]!.physical).toEqual({
      ...candidate.tableRelations![0]!.physical,
      name: 'renamed',
    });
    expect(patched.tableRelations![0]!.logical.cardinality).toBe('one-to-many');
    expect(doc.tables).toHaveLength(1);
    const deleted = nativeEditorCandidate(patched, [
      {
        type: 'delete_objects',
        targets: [
          { collection: 'checks', id: 'q' },
          { collection: 'tableRelations', id: 'r' },
        ],
      },
    ]);
    expect(deleted.checks).toEqual([]);
    expect(deleted.tableRelations).toEqual([]);
    expect(deleted.columns).toHaveLength(2);
  });
  it('rejects new legacy data, identity collisions, missing targets and raw patch injection', () => {
    const doc = fixture(),
      column = structuredClone(doc.columns![0]!);
    column.id = 'legacy';
    column.physical.type = {
      kind: 'legacy',
      source: 'document-v1',
      original: { name: 'unknown', isArray: false },
    };
    expect(() => nativeEditorCandidate(doc, [{ type: 'add_column', value: column }])).toThrow(
      'legacy',
    );
    expect(() =>
      nativeEditorCandidate(doc, [{ type: 'add_table', value: doc.tables![0]! }]),
    ).toThrow('document.duplicate-identities');
    expect(() =>
      nativeEditorCandidate(doc, [
        { type: 'delete_objects', targets: [{ collection: 'columns', id: 'c' }] },
        { type: 'add_column', value: doc.columns![0]! },
      ]),
    ).toThrow('document.duplicate-identities');
    expect(() =>
      nativeEditorCandidate(doc, [{ type: 'patch_key', id: 'missing', patch: { name: 'bad' } }]),
    ).toThrow('document.object-not-found');
    expect(() =>
      nativeEditorCandidate(doc, [
        { type: 'patch_column', id: 'c', patch: { physical: { injected: true } } } as never,
      ]),
    ).toThrow();
  });
  it('returns a matching replay before command validation or baseline issuance', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const result = { status: 'accepted', document: fixture() };
    const sync = {
      baseline: vi.fn(),
      apply: vi.fn().mockResolvedValue(result),
    };
    const service = new McpNativeDocumentService(sync as unknown as NativeSyncService);
    expect(
      await service.apply(
        {
          projectId: id,
          operationId: id,
          commands: [{ type: 'future_old_replay' }],
          includeDocument: true,
        },
        { id } as AuthenticatedUser,
      ),
    ).toEqual(result);
    expect(sync.baseline).not.toHaveBeenCalled();
    expect(sync.apply).toHaveBeenCalledWith(
      id,
      { operationId: id },
      { id },
      expect.any(String),
      expect.any(Function),
    );
  });
  it('passes all optimistic expectations and the complete candidate to locked sync', async () => {
    const doc = fixture(),
      id = '00000000-0000-4000-8000-000000000001';
    const baseline = {
      document: doc,
      database: doc.database,
      databaseRevision: 4,
      baselineId: id,
      sequence: 11,
      baselineIssuedAt: '2026-10-02T00:00:00Z',
    };
    const issueBaseline = vi.fn().mockResolvedValue(baseline);
    type Preparation = NonNullable<Parameters<NativeSyncService['apply']>[4]>;
    let prepared: Awaited<ReturnType<Preparation>> | undefined;
    const sync = {
      apply: vi
        .fn()
        .mockImplementation(
          async (
            _project: string,
            _raw: unknown,
            _user: AuthenticatedUser,
            _hash: string,
            prepare: Preparation,
          ) => {
            prepared = await prepare(issueBaseline);
            return { status: 'accepted' };
          },
        ),
    };
    const service = new McpNativeDocumentService(sync as unknown as NativeSyncService);
    const user = { id } as AuthenticatedUser;
    await service.apply(
      {
        projectId: id,
        operationId: id,
        groupId: id,
        clientId: id,
        expectedVersion: 7,
        expectedSequence: 11,
        expectedDatabaseRevision: 4,
        commands: [{ type: 'patch_column', id: 'c', patch: { physical: { comment: 'saved' } } }],
      },
      user,
    );
    expect(issueBaseline).toHaveBeenCalledWith(id, {
      version: 7,
      sequence: 11,
      databaseRevision: 4,
    });
    expect(prepared).toEqual(
      expect.objectContaining({
        baselineDocument: doc,
        document: expect.objectContaining({
          columns: [
            expect.objectContaining({
              physical: expect.objectContaining({
                comment: 'saved',
                type: doc.columns![0]!.physical.type,
              }),
            }),
          ],
        }),
        databaseRevision: 4,
      }),
    );
    expect(sync.apply).toHaveBeenCalledWith(
      id,
      { operationId: id },
      user,
      expect.any(String),
      expect.any(Function),
    );
  });
});

describe('native column order command', () => {
  it('reorders the entire table including hidden scope columns while preserving other tables and opaque values', () => {
    const source = fixture();
    const first = source.columns![0]!;
    source.columns = [
      first,
      { ...structuredClone(first), id: 'foreign', tableId: 'other' },
      { ...structuredClone(first), id: 'second', scope: 'logical' },
    ];
    const before = structuredClone(source);
    const next = nativeEditorCandidate(source, [
      { type: 'reorder_columns', tableId: 't', columnIds: ['second', 'c'] },
    ]);
    expect(next.columns?.map((column) => column.id)).toEqual(['second', 'foreign', 'c']);
    expect(next.columns![0]).toEqual(before.columns![2]);
    expect(next.columns![1]).toEqual(before.columns![1]);
    expect(source).toEqual(before);
  });
  it.each([['c'], ['c', 'c'], ['c', 'foreign']])(
    'rejects partial, duplicate or foreign orders: %j',
    (...columnIds) => {
      const source = fixture();
      source.columns!.push({ ...structuredClone(source.columns![0]!), id: 'second' });
      expect(() =>
        nativeEditorCandidate(source, [{ type: 'reorder_columns', tableId: 't', columnIds }]),
      ).toThrow();
    },
  );
});
