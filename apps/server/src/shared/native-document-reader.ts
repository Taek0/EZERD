import { designDocumentReadSchema, nativeStoredDesignDocumentSchema } from '@ezerd/contracts';
import {
  migrateDesignDocumentV1,
  normalizeSharedTableCanvas,
  resolveProjectDatabaseState,
  validateDatabaseDocument,
  TABLES_VIEW_ID,
  type DatabaseIssue,
  type DesignDocument,
  type NativeDesignDocument,
  type NativeMigrationIssue,
  type ProjectDatabaseState,
} from '@ezerd/model';
import { BadRequestException } from '@nestjs/common';

interface NativeDocumentReadBase {
  /** Exact source snapshot, including legacy aliases; it is never replaced by the preview. */
  rawSource: unknown;
  stored: DesignDocument | NativeDesignDocument;
  database: ProjectDatabaseState;
}
export type NativeDocumentReadPreview = NativeDocumentReadBase &
  (
    | {
        status: 'available';
        preview: NativeDesignDocument;
        migrationIssues: NativeMigrationIssue[];
        issues: DatabaseIssue[];
      }
    | {
        status: 'unavailable';
        code: 'database.context-changed' | 'document.native-preview-invalid';
      }
  );

/** Read-only canonicalization. All native physical fields survive; v1 output is unaffected. */
export function normalizeNativeServerDocument(
  document: NativeDesignDocument,
): NativeDesignDocument {
  return normalizeSharedTableCanvas(document, {
    // The canonical v1 ID can exceed the 160-char contract limit for long imported table IDs.
    // Sorted placement + the existing collision suffix preserves deterministic uniqueness.
    nodeId: (tableId) => `node:${tableId.slice(0, 128)}:${TABLES_VIEW_ID}`,
  });
}

/** Reader only; upgrade/import/history callers decide whether a trusted preview can be persisted. */
export function readNativeProjectDocument(
  raw: unknown,
  state: ProjectDatabaseState,
): NativeDocumentReadPreview {
  const parsed = designDocumentReadSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException({ code: 'document.source-invalid' });
  const database = resolveProjectDatabaseState({
    databaseKind: state.kind,
    databaseProfileId: state.profileId,
    databaseRevision: state.revision,
  });
  const base = { rawSource: structuredClone(raw), stored: parsed.data, database };
  if (
    parsed.data.schemaVersion === 2 &&
    (parsed.data.database.kind !== database.kind ||
      parsed.data.database.profileId !== database.profileId)
  )
    return { ...base, status: 'unavailable', code: 'database.context-changed' };
  const context = { kind: database.kind, profileId: database.profileId };
  const migration =
    parsed.data.schemaVersion === 1
      ? migrateDesignDocumentV1(parsed.data, context)
      : { document: structuredClone(parsed.data), issues: [] };
  let preview: NativeDesignDocument;
  try {
    preview = nativeStoredDesignDocumentSchema.parse(
      normalizeNativeServerDocument(migration.document),
    );
  } catch {
    return { ...base, status: 'unavailable', code: 'document.native-preview-invalid' };
  }
  return {
    ...base,
    status: 'available',
    preview,
    migrationIssues: migration.issues,
    issues: validateDatabaseDocument(preview, database, { mode: 'read' }),
  };
}
