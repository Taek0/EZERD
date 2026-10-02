import {
  createNativeTable,
  createNativeColumn,
  createEmptyNativeDocument,
  defaultDatabaseContext,
  type NativeDesignDocument,
  type DatabaseKind,
} from '@ezerd/model';
import {
  copyNativeTableClipboard,
  nativeTableClipboardSchema,
  nativeClipboardObjectIds,
  nativeClipboardPasteCommandSchema,
  type ProjectDocumentState,
} from '@ezerd/contracts';
export const clipboardActor = '00000000-0000-4000-8000-000000000001';
export const clipboardProject = '00000000-0000-4000-8000-000000000002';
export function clipboardFixture(kind: DatabaseKind = 'postgresql'): NativeDesignDocument {
  const database = defaultDatabaseContext(kind),
    a = createNativeTable(database, 'a', 'd', 'logical'),
    b = createNativeTable(database, 'b', 'd', 'logical');
  a.logical.name = 'Orders';
  b.logical.name = 'Audit';
  a.physical.name = 'orders';
  b.physical.name = 'audit';
  const ca = createNativeColumn(database, a, 'ca'),
    cb = createNativeColumn(database, b, 'cb');
  ca.logical.name = 'Amount';
  cb.logical.name = 'Copied amount';
  ca.physical.name = 'amount';
  cb.physical.name = 'copy';
  ca.physical.defaultValue = { kind: 'literal', literalType: 'number', value: '9007199254740993' };
  return {
    ...createEmptyNativeDocument(database),
    domains: [{ id: 'd', name: 'Domain', description: '' }],
    tables: [a, b],
    columns: [ca, cb],
    keys: [
      { id: 'k', tableId: 'a', kind: 'primary', name: 'Key', scope: 'logical', columnIds: ['ca'] },
    ],
    tableRelations: [
      {
        id: 'fk',
        sourceTableId: 'b',
        targetTableId: 'a',
        scope: 'logical',
        logical: { name: 'Audits', cardinality: 'one-to-many', required: false },
        physical: null,
      },
    ],
    indexes: [
      {
        id: 'ix',
        tableId: 'a',
        name: 'Index',
        scope: 'logical',
        unique: false,
        parts: [{ direction: 'asc', expression: { kind: 'column', columnId: 'ca' } }],
        options:
          kind === 'postgresql'
            ? { database: kind, method: 'btree', includeColumnIds: ['ca'] }
            : kind === 'mysql'
              ? { database: kind, kind: 'btree' }
              : {
                  database: kind,
                  predicate: {
                    kind: 'isNull',
                    operand: { kind: 'column', columnId: 'ca' },
                    negate: true,
                  },
                },
      },
    ],
    checks: [
      {
        id: 'q',
        tableId: 'a',
        name: 'Check',
        scope: 'logical',
        expression: {
          kind: 'binary',
          operator: '>',
          left: { kind: 'column', columnId: 'ca' },
          right: { kind: 'literal', literalType: 'number', value: '9007199254740993' },
        },
      },
    ],
    layout: {
      nodes: [
        { id: 'na', objectId: 'a', viewId: '__tables__', x: 20, y: 30, width: 320, height: 260 },
        { id: 'nb', objectId: 'b', viewId: '__tables__', x: 450, y: 30, width: 320, height: 260 },
      ],
      viewports: [],
      relations: [
        { relationId: 'fk', viewId: '__tables__', offset: 12, waypoints: [{ x: 200, y: 10 }] },
      ],
    },
  };
}
export function clipboardSnapshot(document = clipboardFixture()): ProjectDocumentState {
  return {
    protocolVersion: 2,
    project: {
      id: clipboardProject,
      workspaceId: clipboardProject,
      name: 'Native',
      status: 'active',
      version: 7,
      databaseKind: document.database.kind,
      databaseProfileId: document.database.profileId,
      databaseRevision: 3,
      createdAt: '2026-10-02T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
    },
    sequence: 10,
    sourceDocument: document,
    native: { status: 'available', document, issues: [], migrationIssues: [] },
  };
}
export function clipboardCommand(source = clipboardFixture(), prefix = '10000000') {
  const clipboard = nativeTableClipboardSchema.parse(
    JSON.parse(copyNativeTableClipboard(source, ['a', 'b'], [], clipboardProject).text),
  );
  return nativeClipboardPasteCommandSchema.parse({
    type: 'paste_native_clipboard',
    clipboard,
    domainId: null,
    point: { x: 100, y: 200 },
    newIds: nativeClipboardObjectIds(clipboard).map(
      (_, i) => `${prefix}-0000-4000-8000-${(i + 1).toString().padStart(12, '0')}`,
    ),
  });
}
