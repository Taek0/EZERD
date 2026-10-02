import {
  createEmptyNativeDocument,
  createNativeColumn,
  createNativeTable,
  defaultDatabaseContext,
  type DatabaseKind,
  type NativeColumnType,
  type NativeDesignDocument,
} from '@ezerd/model';
import type { ProjectDocumentState } from '@ezerd/contracts';
import { vi } from 'vitest';
export function advancedFixture(kind: DatabaseKind = 'postgresql') {
  const database = defaultDatabaseContext(kind),
    table = createNativeTable(database, 't');
  table.physical.name = 'records';
  const numberType: NativeColumnType =
    kind === 'postgresql'
      ? { kind: 'builtin', database: kind, typeId: 'postgresql:integer', parameters: {} }
      : kind === 'mysql'
        ? { kind: 'builtin', database: kind, typeId: 'mysql:int', parameters: {} }
        : { kind: 'builtin', database: kind, typeId: 'sqlite:integer', parameters: {} };
  const stringType: NativeColumnType =
    kind === 'postgresql'
      ? {
          kind: 'builtin',
          database: kind,
          typeId: 'postgresql:varchar',
          parameters: { length: 20 },
        }
      : kind === 'mysql'
        ? { kind: 'builtin', database: kind, typeId: 'mysql:varchar', parameters: { length: 20 } }
        : { kind: 'builtin', database: kind, typeId: 'sqlite:text', parameters: {} };
  const columns = ['a', 'b', 's'].map((id) => {
    const c = createNativeColumn(database, table, id);
    c.physical.name = id;
    c.physical.type = id === 's' ? stringType : structuredClone(numberType);
    c.physical.nullable = false;
    return c;
  });
  const document: NativeDesignDocument = {
    ...createEmptyNativeDocument(database),
    tables: [table],
    columns,
    layout: {
      nodes: [
        { id: 'node', objectId: 't', viewId: '__tables__', x: 20, y: 30, width: 320, height: 220 },
      ],
      viewports: [],
    },
  };
  const snapshot: ProjectDocumentState = {
    protocolVersion: 2,
    project: {
      id: '00000000-0000-4000-8000-000000000002',
      workspaceId: '00000000-0000-4000-8000-000000000003',
      name: 'Advanced',
      databaseKind: kind,
      databaseProfileId: database.profileId,
      databaseRevision: 3,
      status: 'active',
      version: 7,
      createdAt: '2026-10-02T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
    },
    sequence: 10,
    sourceDocument: document,
    native: { status: 'available', document, migrationIssues: [], issues: [] },
  };
  return {
    document,
    table,
    columns,
    snapshot,
    context: {
      userId: '00000000-0000-4000-8000-000000000001',
      snapshot,
      busy: false,
      onSave: vi.fn(async () => true),
    },
  };
}
