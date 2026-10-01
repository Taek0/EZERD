import {
  nativeStoredDesignDocumentSchema,
  designDocumentReadSchema,
  nativeSyncOperationInputSchema,
  type NativeSyncOperationInput,
} from '@ezerd/contracts';
import {
  applyChanges,
  claimedChangesMatch,
  deriveOperationChanges,
  deriveStructuralDependencyPaths,
  findFieldVersionConflicts,
  requestFingerprint,
  resolveProjectDatabaseState,
  sharedDocument,
  validateDatabaseDocument,
  type DatabaseIssue,
  type DocumentChange,
  type FieldVersions,
  type NativeDesignDocument,
  type ProjectDatabaseState,
} from '@ezerd/model';
import { BadRequestException } from '@nestjs/common';

const BASELINE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export interface LockedNativeProject {
  id: string;
  status: 'active' | 'archived';
  syncSequence: number;
  database: ProjectDatabaseState;
  document: unknown;
}
export interface TrustedNativeBaseline {
  projectId: string;
  userId: string;
  clientId: string;
  baselineId: string;
  lastSequence: number;
  databaseRevision: number;
  lastSuccessfulSyncAt: Date;
  document: unknown;
}
export type NativeSyncCandidatePreparation =
  | {
      status: 'prepared';
      document: NativeDesignDocument;
      changes: DocumentChange[];
      dependencyPaths: string[];
    }
  | { status: 'rejected'; code: string; issues?: DatabaseIssue[]; conflictingPaths?: string[] };

/** Run after authorization, replay handling and the project row lock; this never writes or ACKs. */
export function prepareNativeSyncCandidate(
  raw: unknown,
  project: LockedNativeProject,
  baseline: TrustedNativeBaseline | undefined,
  actorId: string,
  versions: FieldVersions,
  now = Date.now(),
): NativeSyncCandidatePreparation {
  const parsed = nativeSyncOperationInputSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException({ code: 'sync.input-invalid' });
  const input = parsed.data;
  // The protocol parser may trim identifiers. Such a transformation must never hide raw claims.
  const original = raw as NativeSyncOperationInput;
  for (const field of ['baselineDocument', 'document', 'changes'] as const)
    if (requestFingerprint(input[field]) !== requestFingerprint(original[field]))
      throw new BadRequestException({ code: 'sync.raw-input-changed' });
  let derived: DocumentChange[];
  try {
    derived = deriveOperationChanges(original.baselineDocument, original.document);
  } catch {
    throw new BadRequestException({ code: 'sync.claims-invalid' });
  }
  const claimed: DocumentChange[] = input.changes.map((change) => ({
    path: change.path,
    before: change.before,
    after: change.after,
    ...(change.beforeExists !== undefined ? { beforeExists: change.beforeExists } : {}),
    ...(change.afterExists !== undefined ? { afterExists: change.afterExists } : {}),
  }));
  if (!claimedChangesMatch(derived, claimed))
    throw new BadRequestException({ code: 'sync.claims-invalid' });
  const reject = (code: string): NativeSyncCandidatePreparation => ({ status: 'rejected', code });
  if (project.status !== 'active') return reject('project.archived');
  if (project.syncSequence >= Number.MAX_SAFE_INTEGER) return reject('sync.sequence-limit');
  const database = resolveProjectDatabaseState({
    databaseKind: project.database.kind,
    databaseProfileId: project.database.profileId,
    databaseRevision: project.database.revision,
  });
  if (
    input.databaseRevision !== database.revision ||
    input.database.kind !== database.kind ||
    input.database.profileId !== database.profileId ||
    (baseline && baseline.databaseRevision !== database.revision)
  )
    return reject('database.context-changed');
  const current = nativeStoredDesignDocumentSchema.safeParse(project.document);
  if (!current.success) {
    const stored = designDocumentReadSchema.safeParse(project.document);
    return reject(
      stored.success && stored.data.schemaVersion === 1
        ? 'document.native-upgrade-required'
        : 'sync.stored-document-invalid',
    );
  }
  if (
    current.data.database.kind !== database.kind ||
    current.data.database.profileId !== database.profileId
  )
    return reject('database.context-changed');
  if (
    !baseline ||
    baseline.projectId !== project.id ||
    baseline.userId !== actorId ||
    baseline.clientId !== input.clientId ||
    baseline.baselineId !== input.baselineId ||
    baseline.lastSequence !== input.baseSequence ||
    input.baseSequence > project.syncSequence ||
    baseline.lastSuccessfulSyncAt.getTime() !== new Date(input.baselineIssuedAt).getTime() ||
    !Number.isFinite(now) ||
    now < baseline.lastSuccessfulSyncAt.getTime() ||
    now - baseline.lastSuccessfulSyncAt.getTime() > BASELINE_MAX_AGE_MS
  )
    return reject('sync.baseline-invalid');
  const trusted = nativeStoredDesignDocumentSchema.safeParse(baseline.document);
  if (
    !trusted.success ||
    requestFingerprint(sharedDocument(trusted.data)) !== requestFingerprint(input.baselineDocument)
  )
    return reject('sync.baseline-invalid');
  const dependencyPaths = [
    ...new Set([
      ...deriveStructuralDependencyPaths(input.document, derived),
      ...input.dependencyPaths,
    ]),
  ];
  const conflictingPaths = findFieldVersionConflicts(
    { kind: input.kind, baseSequence: input.baseSequence, changes: derived, dependencyPaths },
    versions,
  );
  if (conflictingPaths.length)
    return {
      status: 'rejected',
      code: 'sync.field-conflict',
      conflictingPaths: [...new Set(conflictingPaths)],
    };
  // A later trusted restore path must prove deletion provenance instead of relaxing this rule.
  for (const change of derived) {
    const entity =
      /^\/(?:domains|domainRelations|tables|columns|keys|tableRelations|notes|enums|views|indexes|checks)\/[^/]+$/.test(
        change.path,
      ) || /^\/layout\/(?:nodes|relations)\/[^/]+$/.test(change.path);
    const versionKnown =
      'get' in versions && typeof versions.get === 'function'
        ? versions.get(change.path) !== undefined
        : Object.hasOwn(versions, change.path);
    if (entity && change.before === null && change.beforeExists !== true && versionKnown)
      return reject('sync.identity-retired');
  }
  let candidate: NativeDesignDocument;
  try {
    candidate = applyChanges(current.data, derived);
  } catch {
    return reject('sync.target-missing');
  }
  const valid = nativeStoredDesignDocumentSchema.safeParse(candidate);
  if (!valid.success) return reject('sync.candidate-invalid');
  const issues = validateDatabaseDocument(valid.data, database, {
    mode: 'write',
    previous: current.data,
  });
  if (issues.some((issue) => issue.severity === 'error'))
    return { status: 'rejected', code: 'database.candidate-invalid', issues };
  const changes = deriveOperationChanges(current.data, valid.data);
  if (changes.length > 1000) return reject('sync.change-limit');
  return { status: 'prepared', document: valid.data, changes, dependencyPaths };
}
