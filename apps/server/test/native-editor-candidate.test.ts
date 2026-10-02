import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import {
  createEmptyNativeDocument,
  createNativeTable,
  createNativeColumn,
  defaultDatabaseContext,
  type NativeDesignDocument,
} from '@ezerd/model';
import {
  nativeEditorCandidate,
  applyNativeProjectChangesMetadataSchema,
} from '../src/mcp/mcp-native-document.service.js';
import {
  nativeDomainEditorCandidate,
  nativeDomainCandidateClaims,
  applyNativeDomainEditorCommand,
} from '../src/mcp/native-editor-candidate.js';

function document(): NativeDesignDocument {
  const database = defaultDatabaseContext('postgresql');
  const table = createNativeTable(database, 'table', 'domain');
  table.scope = 'logical';
  return {
    ...createEmptyNativeDocument(database),
    domains: [{ id: 'domain', name: 'D', description: '' }],
    tables: [table],
    layout: {
      nodes: [
        {
          id: 'node',
          objectId: 'table',
          viewId: '__tables__',
          x: 120,
          y: 130,
          width: 320,
          height: 260,
        },
      ],
      viewports: [],
    },
  };
}
describe('native domain MCP candidate branch', () => {
  it('dispatches domain commands through the actual mixed renderer with shared ID claims', () => {
    const source = document();
    const column = createNativeColumn(source.database, source.tables![0]!, 'column');
    column.physical.type = {
      kind: 'legacy',
      source: 'document-v1',
      original: { name: 'opaque', isArray: false },
    };
    source.columns = [column];
    const candidate = nativeEditorCandidate(source, [
      {
        type: 'add_domain',
        value: { id: 'new', name: 'New', description: '' },
        placement: { x: 20, y: 30 },
        nodeId: 'fresh-domain-node',
      },
      { type: 'move_table_domain', tableId: 'table', targetDomainId: 'new' },
      { type: 'patch_domain', id: 'new', patch: { name: 'Renamed' } },
      { type: 'patch_table', id: 'table', patch: { logical: { name: 'Label' } } },
      { type: 'delete_domain', id: 'domain', policy: { kind: 'rejectNonempty' } },
    ]);
    expect(candidate.domains).toEqual([{ id: 'new', name: 'Renamed', description: '' }]);
    expect(candidate.tables![0]).toMatchObject({ domainId: 'new', logical: { name: 'Label' } });
    expect(candidate.columns).toEqual(source.columns);
    expect(() =>
      nativeEditorCandidate(source, [
        {
          type: 'add_domain',
          value: { id: 'new', name: 'New', description: '' },
          placement: { x: 0, y: 0 },
        },
        { type: 'add_table', value: createNativeTable(source.database, 'new') },
      ]),
    ).toThrow('document.duplicate-identities');
    expect(() =>
      nativeEditorCandidate(source, [
        { type: 'add_column', value: { ...column, id: 'cloned-legacy' } },
      ]),
    ).toThrow('legacy.source-not-trusted');
  });
  it('retains generated canvas node claims when notes are deleted earlier in the same mixed batch', () => {
    const source = document();
    expect(() =>
      nativeEditorCandidate(source, [
        { type: 'upsert_note', value: { id: 'note', viewId: '__tables__', text: 'N' } },
        { type: 'delete_note', id: 'note' },
        {
          type: 'add_domain',
          value: {
            id: 'node:note',
            name: 'Cannot claim a deleted generated node',
            description: '',
          },
          placement: { x: 0, y: 0 },
        },
      ]),
    ).toThrow('document.duplicate-identities');
  });
  it('advertises domain command types without changing their strict handler contract', () => {
    const uuid = '00000000-0000-4000-8000-000000000001',
      source = document();
    const command = {
      type: 'add_domain' as const,
      value: { id: 'new', name: 'D', description: '' },
      nodeId: 'new-node',
      placement: { x: 50, y: 60 },
    };
    const input = {
      projectId: uuid,
      operationId: uuid,
      groupId: uuid,
      clientId: uuid,
      expectedVersion: 5,
      expectedSequence: 9,
      expectedDatabaseRevision: 3,
      includeDocument: true,
      commands: [command],
    };
    expect(applyNativeProjectChangesMetadataSchema.parse(input).commands[0]!.type).toBe(
      'add_domain',
    );
    expect(nativeEditorCandidate(source, [command]).domains).toEqual([
      source.domains[0],
      command.value,
    ]);
  });
  it('creates, patches, moves and removes a domain atomically with strict native storage output', () => {
    const source = document(),
      before = structuredClone(source);
    const result = nativeDomainEditorCandidate(source, [
      {
        type: 'add_domain',
        value: { id: 'new', name: 'New', description: '' },
        nodeId: 'new-node',
        placement: { x: 50, y: 60, width: 500 },
      },
      { type: 'patch_domain', id: 'new', patch: { description: 'Updated', color: '#AABBCC' } },
      { type: 'move_table_domain', tableId: 'table', targetDomainId: 'new' },
      { type: 'delete_domain', id: 'domain', policy: { kind: 'rejectNonempty' } },
    ]);
    expect(result.domains).toEqual([
      { id: 'new', name: 'New', description: 'Updated', color: '#AABBCC' },
    ]);
    expect(result.tables![0]).toEqual({ ...source.tables![0], domainId: 'new' });
    expect(result.layout.nodes.find((node) => node.id === 'new-node')).toMatchObject({
      width: 500,
      x: 50,
      y: 60,
    });
    expect(result.layout.nodes.find((node) => node.id === 'node')).toEqual(source.layout.nodes[0]);
    expect(source).toEqual(before);
  });
  it('keeps baseline IDs claimed after domain/node deletion and rejects known retired IDs', () => {
    const source = document();
    source.tables = [];
    const add = {
      type: 'add_domain' as const,
      value: { id: 'domain', name: 'Replace', description: '' },
      placement: { x: 0, y: 0 },
    };
    expect(() =>
      nativeDomainEditorCandidate(source, [
        { type: 'delete_domain', id: 'domain', policy: { kind: 'rejectNonempty' } },
        add,
      ]),
    ).toThrow('document.duplicate-identities');
    expect(() =>
      nativeDomainEditorCandidate(
        document(),
        [{ ...add, value: { ...add.value, id: 'retired' } }],
        { retiredIds: new Set(['retired']) },
      ),
    ).toThrow('sync.identity-retired');
    expect(() =>
      nativeDomainEditorCandidate(
        document(),
        [{ ...add, value: { ...add.value, id: 'fresh' }, nodeId: 'retired-node' }],
        { retiredIds: new Set(['retired-node']) },
      ),
    ).toThrow('sync.identity-retired');
  });
  it('supports mixed-renderer claims and rejects strict patch injection before candidate mutation', () => {
    const source = document(),
      claims = nativeDomainCandidateClaims(source);
    claims.occupiedIds.add('claimed-by-column-command');
    expect(() =>
      applyNativeDomainEditorCommand(
        source,
        {
          type: 'add_domain',
          value: { id: 'claimed-by-column-command', name: 'Bad', description: '' },
          placement: { x: 0, y: 0 },
        },
        claims,
      ),
    ).toThrow('document.duplicate-identities');
    expect(() =>
      nativeDomainEditorCandidate(source, [
        { type: 'patch_domain', id: 'domain', patch: { tables: [] } } as never,
      ]),
    ).toThrow();
    expect(() =>
      nativeDomainEditorCandidate(source, [
        { type: 'delete_domain', id: 'domain', policy: { kind: 'rejectNonempty' } },
      ]),
    ).toThrow('domain.not-empty');
    expect(source.tables).toHaveLength(1);
  });
});
