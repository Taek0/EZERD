import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyNativeDocument,
  createNativeTable,
  createNativeColumn,
  defaultDatabaseContext,
  type NativeDesignDocument,
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
      findReplay: vi.fn().mockResolvedValue(result),
      baseline: vi.fn(),
      apply: vi.fn(),
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
    expect(sync.apply).not.toHaveBeenCalled();
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
    const sync = {
      findReplay: vi.fn(),
      baseline: vi.fn().mockResolvedValue(baseline),
      apply: vi.fn().mockResolvedValue({ status: 'accepted' }),
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
    expect(sync.baseline).toHaveBeenCalledWith(id, id, user, {
      version: 7,
      sequence: 11,
      databaseRevision: 4,
    });
    expect(sync.apply).toHaveBeenCalledWith(
      id,
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
      user,
      expect.any(String),
    );
  });
});
