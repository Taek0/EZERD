import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  createEmptyNativeDocument,
  defaultDatabaseContext,
} from '@ezerd/model';
import { projectDocumentStateSchema } from './project-document-state.js';
const context = defaultDatabaseContext('postgresql');
function fixture() {
  return {
    protocolVersion: 2,
    project: {
      id: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      name: 'test',
      databaseKind: context.kind,
      databaseProfileId: context.profileId,
      databaseRevision: 3,
      status: 'active',
      version: 9,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    },
    sequence: 10,
    sourceDocument: createEmptyDocument(),
    native: {
      status: 'available',
      document: createEmptyNativeDocument(context),
      migrationIssues: [],
      issues: [],
    },
  };
}
describe('versioned project snapshot contract', () => {
  it('keeps raw v1 aliases and identifiers unchanged while parsing the native preview separately', () => {
    const input = fixture();
    input.sourceDocument.columns = [
      {
        id: ' old-id ',
        tableId: ' t ',
        scope: 'both',
        logical: { name: '', definition: '', semanticType: '', required: false },
        physical: {
          name: '',
          type: { name: ' FLOAT4 ', isArray: false },
          nullable: true,
          defaultExpression: ' raw() ',
          comment: '',
        },
        customProperties: { common: {}, logical: {}, physical: {} },
      },
    ];
    const parsed = projectDocumentStateSchema.parse(input);
    expect(parsed.sourceDocument).toEqual(input.sourceDocument);
    expect(parsed.sequence).toBe(10);
    expect(parsed.project.databaseRevision).toBe(3);
    expect(parsed.native.status).toBe('available');
  });
  it('requires matching project context and preview and preserves a mismatched native source only as unavailable', () => {
    const input = fixture();
    expect(
      projectDocumentStateSchema.safeParse({
        ...input,
        project: { ...input.project, databaseProfileId: 'mysql-8.4-innodb-v1' },
      }).success,
    ).toBe(false);
    expect(
      projectDocumentStateSchema.safeParse({
        ...input,
        native: {
          ...input.native,
          document: createEmptyNativeDocument(defaultDatabaseContext('mysql')),
        },
      }).success,
    ).toBe(false);
    const mismatched = {
      ...input,
      sourceDocument: createEmptyNativeDocument(defaultDatabaseContext('mysql')),
    };
    expect(projectDocumentStateSchema.safeParse(mismatched).success).toBe(false);
    expect(
      projectDocumentStateSchema.safeParse({
        ...mismatched,
        native: { status: 'unavailable', code: 'database.context-changed' },
      }).success,
    ).toBe(true);
    expect(
      projectDocumentStateSchema.safeParse({
        ...mismatched,
        native: { status: 'unavailable', code: 'document.native-preview-invalid' },
      }).success,
    ).toBe(false);
  });
  it('does not accept missing revision, malformed sources or private cause fingerprints', () => {
    const input = fixture();
    const { databaseRevision: _, ...project } = input.project;
    expect(projectDocumentStateSchema.safeParse({ ...input, project }).success).toBe(false);
    expect(
      projectDocumentStateSchema.safeParse({ ...input, sourceDocument: { schemaVersion: 9 } })
        .success,
    ).toBe(false);
    expect(
      projectDocumentStateSchema.safeParse({
        ...input,
        native: {
          ...input.native,
          issues: [
            {
              code: 'test',
              category: 'invalid',
              severity: 'error',
              objectId: null,
              path: '',
              params: {},
              cause: 'private',
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
});
