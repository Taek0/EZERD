import { projectDocumentStateSchema } from '@ezerd/contracts';
import {
  createEmptyNativeDocument,
  createNativeColumn,
  createNativeTable,
  defaultDatabaseContext,
  TABLES_VIEW_ID,
  type NativeDesignDocument,
} from '@ezerd/model';

export function createNativeRelationFixture() {
  const database = defaultDatabaseContext('postgresql');
  const tables = Array.from({ length: 10 }, (_, index) => {
    const table = createNativeTable(database, `table-${index}`);
    table.logical.name = `Table ${index}`;
    table.physical.name = `table_${index}`;
    return table;
  });
  const columns = tables.flatMap((table) =>
    Array.from({ length: 5 }, (_, index) => {
      const column = createNativeColumn(database, table, `${table.id}-column-${index}`);
      column.logical.name = index === 0 ? 'ID' : `Column ${index}`;
      column.physical.name = index === 0 ? 'id' : `column_${index}`;
      return column;
    }),
  );
  const document: NativeDesignDocument = {
    ...createEmptyNativeDocument(database),
    tables,
    columns,
    keys: tables.map((table) => ({
      id: `${table.id}-pk`,
      tableId: table.id,
      scope: 'both',
      kind: 'primary',
      name: `${table.physical.name}_pk`,
      columnIds: [`${table.id}-column-0`],
    })),
    tableRelations: tables.map((table, index) => ({
      id: `relation-${index}`,
      sourceTableId: table.id,
      targetTableId: tables[(index + 1) % tables.length]!.id,
      scope: 'both',
      logical: { name: `Relation ${index}`, cardinality: 'one-to-many', required: false },
      physical: {
        name: `${table.physical.name}_fk`,
        sourceColumnIds: [`${table.id}-column-1`],
        targetColumnIds: [`${tables[(index + 1) % tables.length]!.id}-column-0`],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
    })),
    layout: {
      nodes: tables.map((table, index) => ({
        id: `node-${table.id}`,
        objectId: table.id,
        viewId: TABLES_VIEW_ID,
        x: (index % 5) * 500,
        y: Math.floor(index / 5) * 400,
        width: 320,
        height: 260,
      })),
      viewports: [],
    },
  };
  const id = '00000000-0000-4000-8000-000000000002';
  const snapshot = projectDocumentStateSchema.parse({
    protocolVersion: 2,
    project: {
      id,
      workspaceId: id,
      name: 'Native relation fixture',
      status: 'active',
      version: 0,
      databaseKind: database.kind,
      databaseProfileId: database.profileId,
      databaseRevision: 0,
      createdAt: '2026-10-15T00:00:00Z',
      updatedAt: '2026-10-15T00:00:00Z',
    },
    sequence: 0,
    sourceDocument: document,
    native: { status: 'available', document, issues: [], migrationIssues: [] },
  });
  return { document, snapshot };
}
