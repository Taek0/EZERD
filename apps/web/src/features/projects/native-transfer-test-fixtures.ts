import {
  createEmptyDocument,
  defaultDatabaseContext,
  migrateDesignDocumentV1,
  type DatabaseKind,
  type DesignDocument,
} from '@ezerd/model';
import type { ProjectDocumentState, VersionedProjectTransfer } from '@ezerd/contracts';

export const transferActor = '00000000-0000-4000-8000-000000000001';
export const transferProject = '00000000-0000-4000-8000-000000000002';
export const transferWorkspace = '00000000-0000-4000-8000-000000000003';
export const transferTime = '2026-10-02T00:00:00.000Z';
export function transferState(
  kind: DatabaseKind = 'postgresql',
  schemaVersion: 1 | 2 = 2,
): ProjectDocumentState {
  const properties = { common: {}, logical: {}, physical: {} };
  const source: DesignDocument = {
    ...createEmptyDocument(),
    layout: {
      nodes: [
        {
          id: 'table-layout',
          objectId: 't',
          viewId: '__tables__',
          x: 20,
          y: 30,
          width: 320,
          height: 260,
        },
      ],
      viewports: [
        { viewId: 'overview', x: 0, y: 0, zoom: 1 },
        { viewId: '__tables__', x: 0, y: 0, zoom: 1 },
      ],
    },
    tables: [
      {
        id: 't',
        domainId: null,
        scope: 'both',
        logical: { name: '원문', definition: '' },
        physical: { name: 'records', schema: 'public', comment: '' },
        customProperties: properties,
      },
    ],
    columns: [
      {
        id: 'c',
        tableId: 't',
        scope: 'both',
        logical: { name: 'ID', definition: '', semanticType: '', required: true },
        physical: {
          name: 'id',
          type: { name: 'int4', isArray: false },
          nullable: false,
          defaultExpression: null,
          comment: '',
        },
        customProperties: properties,
      },
    ],
  };
  const migrated = migrateDesignDocumentV1(source, defaultDatabaseContext(kind));
  const native = migrated.document;
  if (schemaVersion === 2) {
    native.indexes = [
      {
        id: 'i',
        tableId: 't',
        name: 'records_idx',
        scope: 'physical',
        unique: false,
        options:
          kind === 'postgresql'
            ? { database: kind, method: 'btree' }
            : kind === 'mysql'
              ? { database: kind, kind: 'btree' }
              : { database: kind },
        parts: [{ expression: { kind: 'column', columnId: 'c' }, direction: 'asc' }],
      },
    ];
    native.checks = [
      {
        id: 'check',
        tableId: 't',
        name: 'records_positive',
        scope: 'physical',
        expression: {
          kind: 'binary',
          operator: '>',
          left: { kind: 'column', columnId: 'c' },
          right: { kind: 'literal', literalType: 'number', value: '0' },
        },
      },
    ];
  }
  return {
    protocolVersion: 2,
    project: {
      id: transferProject,
      workspaceId: transferWorkspace,
      name: 'Transfer',
      databaseKind: kind,
      databaseProfileId: native.database.profileId,
      databaseRevision: 4,
      version: 9,
      status: 'active',
      createdAt: transferTime,
      updatedAt: transferTime,
    },
    sequence: 12,
    sourceDocument: schemaVersion === 1 ? source : native,
    native: { status: 'available', document: native, migrationIssues: migrated.issues, issues: [] },
  };
}
export function transferEnvelope(state = transferState()): VersionedProjectTransfer {
  return {
    format: 'ezerd-project',
    formatVersion: 2,
    exportedAt: transferTime,
    project: {
      name: state.project.name,
      databaseKind: state.project.databaseKind,
      databaseProfileId: state.project.databaseProfileId,
    },
    source: {
      projectId: state.project.id,
      version: state.project.version,
      sequence: state.sequence,
      databaseRevision: state.project.databaseRevision,
    },
    sourceDocument: state.sourceDocument,
    native: state.native,
  };
}
export function transferControl() {
  const scope = {
    userId: transferActor,
    projectId: transferProject,
    workspaceId: transferWorkspace,
  };
  return { scope, currentScope: () => scope };
}
export function transferStorage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
    key: (i: number) => [...entries.keys()][i] ?? null,
    get length() {
      return entries.size;
    },
  };
}
