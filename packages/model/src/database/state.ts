import type { DesignDocument } from '../document.js';
import type { DatabaseContext, DatabaseKind, DatabaseProfileId } from './definitions.js';
import type { NativeDesignDocument } from './native-document.js';
import { defaultDatabaseContext, getDatabaseProfile } from './profiles.js';

export const MAX_DATABASE_REVISION = 2147483647;
export interface ProjectDatabaseState extends DatabaseContext {
  revision: number;
}
export function resolveProjectDatabaseState(input: {
  databaseKind: DatabaseKind;
  databaseProfileId?: DatabaseProfileId | null | undefined;
  databaseRevision?: number | undefined;
}): ProjectDatabaseState {
  const context = input.databaseProfileId
    ? { kind: input.databaseKind, profileId: input.databaseProfileId }
    : defaultDatabaseContext(input.databaseKind);
  getDatabaseProfile(context);
  const revision = input.databaseRevision ?? 0;
  if (!Number.isInteger(revision) || revision < 0 || revision > MAX_DATABASE_REVISION)
    throw new Error('database.revision-invalid');
  return { ...context, revision };
}
/** Orphan physical objects still prevent a metadata-only database change. */
export function hasPhysicalDatabaseDesign(
  document: DesignDocument | NativeDesignDocument,
): boolean {
  return !!(
    (document.tables ?? []).some((item) => item.scope !== 'logical') ||
    (document.columns ?? []).some((item) => item.scope !== 'logical') ||
    (document.keys ?? []).some((item) => item.scope !== 'logical') ||
    (document.tableRelations ?? []).some(
      (item) => item.scope !== 'logical' && item.physical !== null,
    ) ||
    document.enums?.length ||
    ('indexes' in document && document.indexes?.some((item) => item.scope !== 'logical')) ||
    ('checks' in document && document.checks?.some((item) => item.scope !== 'logical'))
  );
}
export function nextDatabaseRevision(state: ProjectDatabaseState): number {
  if (state.revision >= MAX_DATABASE_REVISION) throw new Error('database.revision-limit');
  return state.revision + 1;
}
