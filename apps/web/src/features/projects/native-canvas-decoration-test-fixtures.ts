import {
  createEmptyNativeDocument,
  defaultDatabaseContext,
  createNativeTable,
  createNativeColumn,
  type DatabaseKind,
  type NativeDesignDocument,
} from '@ezerd/model';
import type { ProjectDocumentState } from '@ezerd/contracts';
export const decorationUserId = '00000000-0000-4000-8000-000000000001',
  decorationProjectId = '00000000-0000-4000-8000-000000000002';
export function decorationFixture(kind: DatabaseKind = 'postgresql'): NativeDesignDocument {
  const database = defaultDatabaseContext(kind),
    table = createNativeTable(database, 't', 'a'),
    column = createNativeColumn(database, table, 'c');
  table.logical.name = 'Records';
  table.physical.name = 'records';
  table.color = '#123456';
  table.physical.namespace = { kind: 'legacyNamespace', source: 'document-v1', original: 'public' };
  column.physical.name = 'opaque';
  column.logical.name = 'Label';
  column.physical.type = {
    kind: 'legacy',
    source: 'document-v1',
    original: { name: ' ORIGINAL_TYPE ', isArray: false },
  };
  column.physical.defaultValue = {
    kind: 'legacyExpression',
    source: 'document-v1',
    original: 'original(9007199254740993)',
  };
  column.physical.comment = '<script>comment</script>';
  return {
    ...createEmptyNativeDocument(database),
    domains: [
      { id: 'a', name: 'Orders', description: '', color: '#654321' },
      { id: 'b', name: 'Audit', description: '' },
    ],
    domainRelations: [
      {
        id: 'r',
        sourceDomainId: 'a',
        targetDomainId: 'b',
        name: 'Tracks',
        direction: 'both',
        description: 'Description',
      },
    ],
    tables: [table],
    columns: [column],
    notes: [{ id: 'n', viewId: '__tables__', text: 'Note', color: '#abcdef' }],
    layout: {
      nodes: [
        { id: 'na', objectId: 'a', viewId: 'overview', x: -400, y: 0, width: 240, height: 210 },
        { id: 'nb', objectId: 'b', viewId: 'overview', x: 100, y: 0, width: 240, height: 210 },
        {
          id: 'nt',
          objectId: 't',
          viewId: '__tables__',
          x: -300,
          y: -200,
          width: 360,
          height: 260,
        },
        { id: 'nn', objectId: 'n', viewId: '__tables__', x: 300, y: 50, width: 240, height: 160 },
      ],
      viewports: [],
    },
  };
}
export function decorationSnapshot(document = decorationFixture()): ProjectDocumentState {
  return {
    protocolVersion: 2,
    project: {
      id: decorationProjectId,
      workspaceId: decorationProjectId,
      name: 'Decorated native',
      databaseKind: document.database.kind,
      databaseProfileId: document.database.profileId,
      databaseRevision: 3,
      version: 7,
      status: 'active',
      createdAt: '2026-10-02T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
    },
    sequence: 10,
    sourceDocument: document,
    native: { status: 'available', document, issues: [], migrationIssues: [] },
  };
}
