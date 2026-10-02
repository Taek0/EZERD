import {
  defaultDatabaseContext,
  migrateDesignDocumentV1,
  inspectNativeDatabaseDocument,
} from '@ezerd/model';
import { projectDocumentStateSchema } from '@ezerd/contracts';
import { createPerformanceFixture } from './fixture.js';

export function createNativePerformanceFixture(count = 10, columns = 5) {
  const database = defaultDatabaseContext('postgresql');
  const migrated = migrateDesignDocumentV1(createPerformanceFixture(count, columns), database);
  const issues = inspectNativeDatabaseDocument(migrated.document, database);
  if (migrated.issues.length || issues.length)
    throw new Error('Invalid native performance fixture');
  const id = '00000000-0000-4000-8000-000000000002';
  const snapshot = projectDocumentStateSchema.parse({
    protocolVersion: 2,
    project: {
      id,
      workspaceId: id,
      name: 'Native performance fixture',
      status: 'active',
      version: 0,
      databaseKind: database.kind,
      databaseProfileId: database.profileId,
      databaseRevision: 0,
      createdAt: '2026-10-02T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
    },
    sequence: 0,
    sourceDocument: migrated.document,
    native: { status: 'available', document: migrated.document, issues: [], migrationIssues: [] },
  });
  return { document: migrated.document, snapshot };
}
