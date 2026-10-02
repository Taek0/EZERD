import { describe, expect, it } from 'vitest';
import { createEmptyDocument, defaultDatabaseContext, migrateDesignDocumentV1 } from '@ezerd/model';
import {
  importNativeProjectSchema,
  nativeTransferReadSchema,
  versionedProjectTransferSchema,
} from './native-transfer.js';

const source = createEmptyDocument();
function envelope() {
  return {
    format: 'ezerd-project',
    formatVersion: 2,
    exportedAt: '2026-10-02T00:00:00.000Z',
    project: {
      name: 'Transfer',
      databaseKind: 'postgresql',
      databaseProfileId: 'postgresql-18-v1',
    },
    source: {
      projectId: '00000000-0000-4000-8000-000000000001',
      version: 7,
      sequence: 11,
      databaseRevision: 3,
    },
    sourceDocument: structuredClone(source),
    native: {
      status: 'available',
      document: migrateDesignDocumentV1(source, defaultDatabaseContext('postgresql')).document,
      migrationIssues: [],
      issues: [],
    },
  };
}

describe('versioned project transfer contracts', () => {
  it('preserves exact raw source independently of the native preview and counters', () => {
    const input = envelope();
    input.sourceDocument.domains = [{ id: ' raw-id ', name: 'raw', description: '' }];
    const parsed = versionedProjectTransferSchema.parse(input);
    expect(parsed.sourceDocument).toEqual(input.sourceDocument);
    expect(parsed.source).toEqual(input.source);
    expect(parsed.native).toEqual(input.native);
  });
  it('reads structural v1 and compact native v2 without transforming source IDs', () => {
    const document = createEmptyDocument();
    document.domains = [{ id: ' raw-id ', name: 'raw', description: '' }];
    const v1 = {
      format: 'ezerd-project',
      formatVersion: 1,
      exportedAt: envelope().exportedAt,
      project: { name: 'legacy', databaseKind: 'mysql' },
      document,
    };
    expect(nativeTransferReadSchema.parse(v1)).toEqual(v1);
    const v2 = {
      ...v1,
      formatVersion: 2,
      project: envelope().project,
      document: envelope().native.document,
    };
    expect(nativeTransferReadSchema.parse(v2)).toEqual(v2);
  });
  it('rejects unknown versions, private data and invalid coordinates', () => {
    for (const invalid of [
      { ...envelope(), formatVersion: 3 },
      { ...envelope(), personalState: {} },
      { ...envelope(), source: { ...envelope().source, version: -1 } },
      { ...envelope(), source: { ...envelope().source, sequence: 2147483648 } },
    ])
      expect(nativeTransferReadSchema.safeParse(invalid).success).toBe(false);
    expect(
      importNativeProjectSchema.safeParse({
        workspaceId: envelope().source.projectId,
        transfer: envelope(),
        status: 'archived',
      }).success,
    ).toBe(false);
  });
  it('validates profile/context while permitting explicit unavailable raw source exports', () => {
    const bad = envelope();
    bad.project.databaseKind = 'mysql';
    expect(nativeTransferReadSchema.safeParse(bad).success).toBe(false);
    const sourceDocument = migrateDesignDocumentV1(
      source,
      defaultDatabaseContext('mysql'),
    ).document;
    const mismatch = {
      ...envelope(),
      sourceDocument,
      native: { status: 'unavailable', code: 'database.context-changed' },
    };
    expect(versionedProjectTransferSchema.safeParse(mismatch).success).toBe(true);
    expect(
      versionedProjectTransferSchema.safeParse({ ...mismatch, native: envelope().native }).success,
    ).toBe(false);
  });
  it('checks both document and total transport UTF-8 budgets before parsing', () => {
    const large = createEmptyDocument();
    large.notes = Array.from({ length: 76 }, (_, i) => ({
      id: `n${i}`,
      viewId: 'overview',
      text: 'x'.repeat(20000),
    }));
    const oversizedDocument = {
      format: 'ezerd-project',
      formatVersion: 1,
      exportedAt: envelope().exportedAt,
      project: { name: 'size' },
      document: large,
    };
    expect(nativeTransferReadSchema.safeParse(oversizedDocument).success).toBe(false);
    large.notes = large.notes.slice(0, 55);
    const doubled = {
      ...envelope(),
      sourceDocument: large,
      native: {
        ...envelope().native,
        document: migrateDesignDocumentV1(large, defaultDatabaseContext('postgresql')).document,
      },
    };
    const failure = versionedProjectTransferSchema.safeParse(doubled);
    expect(failure.success).toBe(false);
    if (!failure.success)
      expect(failure.error.issues.map((issue) => issue.message)).toContain(
        'project-transfer.size-limit',
      );
    const utf8 = structuredClone(oversizedDocument);
    utf8.document.notes = Array.from({ length: 30 }, (_, i) => ({
      id: `n${i}`,
      viewId: 'overview',
      text: '한'.repeat(20000),
    }));
    expect(nativeTransferReadSchema.safeParse(utf8).success).toBe(false);
  });
});
