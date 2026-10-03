import {
  changeProjectDatabaseSchema,
  projectDatabaseChangeResultSchema,
  projectDatabasePreviewSchema,
  projectDocumentStateSchema,
  projectSchema,
  updateProjectSchema,
  userSchema,
  workspaceSchema,
  type DatabaseKind,
  type Project,
  type ProjectDatabaseChangeResult,
  type ProjectDatabasePreview,
  type ProjectDocumentState,
} from '@ezerd/contracts';
import {
  defaultDatabaseContext,
  planNativeDatabaseConversion,
  requestFingerprint,
  type NativeDesignDocument,
} from '@ezerd/model';
import { ApiError, body, request } from '../../shared/api/client.js';
import { captureNativeActorApi } from './native-actor-api.js';
import {
  getNativeDurableQueue,
  nativeDurableId,
  type NativeDurablePending,
} from './native-durable-queue.js';
import { assertNativeExportReady, assertNativeLocalInputsReady } from './project-ddl-export.js';
import {
  assertProjectTransferGraph,
  projectTransferGuard,
  type ProjectTransferApi,
  type ProjectTransferControl,
} from './project-transfer.js';
import { fetchProjectTransferState, sameProjectTransferState } from './project-versioned-export.js';
import { loadProjectEntry, type ProjectEntry } from './project-entry.js';
import {
  galleryConversionArchives,
  retainGalleryConversionArchive,
  type GalleryConversionArchive,
} from './native-gallery-conversion-archive.js';

export interface NativeGalleryConversionPlan {
  format: 'native-database-change';
  userId: string;
  projectId: string;
  workspaceId: string;
  snapshot: ProjectDocumentState;
  preview: ProjectDatabasePreview;
  input: ReturnType<typeof changeProjectDatabaseSchema.parse>;
  requestedName: string | null;
}
export interface NativeGalleryConversionOptions {
  control: ProjectTransferControl;
  canEdit: () => boolean;
  api?: ProjectTransferApi;
  storage?: Storage;
}
function authority(options: NativeGalleryConversionOptions, requireEdit = true) {
  const { userId, projectId, workspaceId } = options.control.scope;
  if (!userId || !projectId || !workspaceId) throw Error('database.change-scope-invalid');
  const current = projectTransferGuard(options.control);
  const assertCurrent = () => {
    current();
    if (requireEdit && !options.canEdit()) throw Error('database.change-edit-required');
  };
  assertCurrent();
  const api = captureNativeActorApi(userId, (options.api ?? request) as typeof request);
  const storage = () => options.storage ?? localStorage;
  const inputsReady = () => {
    assertCurrent();
    assertNativeLocalInputsReady(userId, projectId, storage());
  };
  return {
    userId,
    projectId,
    workspaceId,
    assertCurrent,
    api,
    get storage() {
      return storage();
    },
    inputsReady,
  };
}
async function livePermission(options: NativeGalleryConversionOptions, requireEdit = true) {
  const auth = authority(options, requireEdit);
  const workspace = workspaceSchema.parse(
    await auth.api(`/api/workspaces/${encodeURIComponent(auth.workspaceId)}`, {
      cache: 'no-store',
    }),
  );
  auth.assertCurrent();
  if (
    workspace.id !== auth.workspaceId ||
    (requireEdit && (workspace.status !== 'active' || workspace.role === 'viewer'))
  )
    throw Error('database.change-edit-required');
  return Object.assign(auth, { workspace });
}
/** Raw source determines routing. A migrated v1 preview never authorizes a v2 write. */
export async function fetchGalleryDatabaseSnapshot(
  options: NativeGalleryConversionOptions,
  requireEdit = true,
) {
  const auth = await livePermission(options, requireEdit);
  const state = await fetchProjectTransferState(auth.projectId, auth.api);
  auth.assertCurrent();
  if (state.project.workspaceId !== auth.workspaceId) throw Error('database.change-scope-invalid');
  return state;
}
function nativeSource(state: ProjectDocumentState, requireActive = true): NativeDesignDocument {
  projectDocumentStateSchema.parse(state);
  if (
    state.sourceDocument.schemaVersion !== 2 ||
    state.native.status !== 'available' ||
    (requireActive && state.project.status !== 'active') ||
    state.sourceDocument.database.kind !== state.project.databaseKind ||
    state.sourceDocument.database.profileId !== state.project.databaseProfileId
  )
    throw Error('database.change-context-invalid');
  assertProjectTransferGraph(state.sourceDocument);
  return state.sourceDocument;
}
export function galleryConversionDetails(plan: NativeGalleryConversionPlan) {
  return planNativeDatabaseConversion(
    nativeSource(plan.snapshot),
    plan.preview.current,
    plan.preview.target,
  );
}
function validatedPlan(raw: unknown, options: NativeGalleryConversionOptions) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).sort().join(',') !==
      'format,input,preview,projectId,requestedName,snapshot,userId,workspaceId'
  )
    throw Error('database.change-pending-invalid');
  // Preserve source aliases, names and input rather than returning parser-normalized values.
  const plan = structuredClone(raw) as NativeGalleryConversionPlan;
  if (
    plan.format !== 'native-database-change' ||
    (plan.requestedName !== null &&
      !updateProjectSchema.safeParse({ expectedVersion: 0, name: plan.requestedName }).success)
  )
    throw Error('database.change-pending-invalid');
  userSchema.shape.id.parse(plan.userId);
  projectDocumentStateSchema.parse(plan.snapshot);
  projectDatabasePreviewSchema.parse(plan.preview);
  changeProjectDatabaseSchema.parse(plan.input);
  const auth = authority(options, false),
    state = plan.snapshot,
    p = plan.preview,
    i = plan.input;
  nativeSource(state);
  if (
    plan.userId !== auth.userId ||
    plan.projectId !== auth.projectId ||
    plan.workspaceId !== auth.workspaceId ||
    state.project.id !== plan.projectId ||
    state.project.workspaceId !== plan.workspaceId ||
    p.projectId !== plan.projectId ||
    p.version !== state.project.version ||
    p.sequence !== state.sequence ||
    p.current.kind !== state.project.databaseKind ||
    p.current.profileId !== state.project.databaseProfileId ||
    p.current.revision !== state.project.databaseRevision ||
    i.expectedVersion !== p.version ||
    i.expectedSequence !== p.sequence ||
    i.expectedDatabaseRevision !== p.current.revision ||
    i.targetKind !== p.target.kind ||
    i.targetProfileId !== p.target.profileId ||
    (p.target.kind === p.current.kind && p.target.profileId === p.current.profileId)
  )
    throw Error('database.change-preview-invalid');
  return plan;
}
export async function prepareGalleryDatabaseConversion(
  state: ProjectDocumentState,
  targetKind: DatabaseKind,
  requestedName: string | undefined,
  options: NativeGalleryConversionOptions,
): Promise<NativeGalleryConversionPlan> {
  const auth = await livePermission(options);
  nativeSource(state);
  await assertNativeExportReady(auth.userId, auth.projectId, auth.storage);
  auth.assertCurrent();
  const target = defaultDatabaseContext(targetKind);
  const preview = projectDatabasePreviewSchema.parse(
    await auth.api(
      `/api/projects/${encodeURIComponent(auth.projectId)}/database/preview`,
      body('POST', {
        expectedVersion: state.project.version,
        expectedSequence: state.sequence,
        targetKind,
        targetProfileId: target.profileId,
      }),
    ),
  );
  auth.assertCurrent();
  return validatedPlan(
    {
      format: 'native-database-change',
      userId: auth.userId,
      projectId: auth.projectId,
      workspaceId: auth.workspaceId,
      snapshot: state,
      preview,
      input: {
        operationId: nativeDurableId(),
        expectedVersion: state.project.version,
        expectedSequence: state.sequence,
        expectedDatabaseRevision: state.project.databaseRevision,
        targetKind,
        targetProfileId: target.profileId,
      },
      requestedName: requestedName ?? null,
    },
    options,
  );
}
export function galleryConversionEntry(plan: NativeGalleryConversionPlan): NativeDurablePending {
  return {
    userId: plan.userId,
    projectId: plan.projectId,
    operationId: plan.input.operationId,
    kind: 'databaseChange',
    payload: plan,
  };
}
export async function loadGalleryDatabaseConversion(options: NativeGalleryConversionOptions) {
  const auth = authority(options, false);
  const entry = await getNativeDurableQueue().read(auth.userId, auth.projectId);
  auth.assertCurrent();
  if (!entry || entry.kind !== 'databaseChange') return null;
  const plan = validatedPlan(entry.payload, options);
  if (entry.operationId !== plan.input.operationId) throw Error('database.change-pending-invalid');
  return plan;
}
/** Completing an older durable request must not clear newer gallery form values. */
export function galleryConversionMatchesInput(
  plan: NativeGalleryConversionPlan,
  patch: { name?: string; databaseKind?: DatabaseKind },
): boolean {
  return (
    patch.databaseKind === plan.input.targetKind &&
    (patch.name ?? plan.snapshot.project.name).trim() ===
      (plan.requestedName ?? plan.snapshot.project.name).trim()
  );
}
/** Read-only project opening stays available to viewers; DB-change pending uses its own recovery UI. */
export async function loadGalleryProjectForOpen(
  projectId: string,
  options: NativeGalleryConversionOptions,
  load: (id: string) => Promise<ProjectEntry> = loadProjectEntry,
): Promise<
  { kind: 'open'; entry: ProjectEntry } | { kind: 'recover'; plan: NativeGalleryConversionPlan }
> {
  const auth = authority(options, false);
  if (projectId !== auth.projectId) throw Error('database.change-scope-invalid');
  const entry = await load(projectId);
  auth.assertCurrent();
  const project = entry.kind === 'native' ? entry.snapshot.project : entry.value.project;
  if (project.id !== auth.projectId || project.workspaceId !== auth.workspaceId)
    throw Error('database.change-scope-invalid');
  if (entry.kind === 'native') {
    try {
      const plan = await loadGalleryDatabaseConversion(options);
      if (plan) return { kind: 'recover', plan };
    } catch {
      // Read access was established by load. Keep queue unknown/pending; NativeView blocks writes.
      // Account/workspace/session changes still reject the response rather than entering another scope.
      auth.assertCurrent();
    }
  }
  return { kind: 'open', entry };
}
export async function stageGalleryDatabaseConversion(
  plan: NativeGalleryConversionPlan,
  options: NativeGalleryConversionOptions,
) {
  const immutable = validatedPlan(plan, options),
    auth = await livePermission(options);
  const local = galleryConversionDetails(immutable);
  if (
    !immutable.preview.canChange ||
    immutable.preview.issues?.some((i) => i.severity === 'error') ||
    !local.canApply ||
    !local.engineVerified
  )
    throw Error('database.conversion-required');
  await assertNativeExportReady(auth.userId, auth.projectId, auth.storage);
  const latest = await fetchGalleryDatabaseSnapshot(options);
  if (!sameProjectTransferState(immutable.snapshot, latest))
    throw Error('database.change-preview-changed');
  auth.inputsReady();
  await getNativeDurableQueue().claim(galleryConversionEntry(immutable), auth.inputsReady);
  auth.assertCurrent();
}
/** A native rename in the same DB context never sends databaseKind through metadata PATCH. */
export async function saveNativeGalleryName(
  state: ProjectDocumentState,
  name: string | undefined,
  options: NativeGalleryConversionOptions,
): Promise<Project> {
  const auth = await livePermission(options);
  nativeSource(state, false);
  await assertNativeExportReady(auth.userId, auth.projectId, auth.storage);
  const latest = await fetchGalleryDatabaseSnapshot(options);
  if (!sameProjectTransferState(state, latest)) throw Error('database.change-preview-changed');
  if (name === undefined || name.trim() === latest.project.name) return latest.project;
  auth.inputsReady();
  const project = projectSchema.parse(
    await auth.api(
      `/api/projects/${encodeURIComponent(auth.projectId)}`,
      body('PATCH', { expectedVersion: latest.project.version, name }),
    ),
  );
  auth.assertCurrent();
  if (
    project.id !== auth.projectId ||
    project.workspaceId !== auth.workspaceId ||
    project.version !== latest.project.version + 1 ||
    project.name !== name.trim() ||
    project.databaseKind !== latest.project.databaseKind ||
    project.databaseProfileId !== latest.project.databaseProfileId ||
    project.databaseRevision !== latest.project.databaseRevision
  )
    throw Error('database.change-name-ack-invalid');
  return project;
}
export function validateGalleryDatabaseAck(plan: NativeGalleryConversionPlan, raw: unknown) {
  const result = projectDatabaseChangeResultSchema.parse(raw),
    i = plan.input;
  if (
    result.projectId !== plan.projectId ||
    result.operationId !== i.operationId ||
    !result.changed ||
    result.version !== i.expectedVersion + 1 ||
    result.sequence !== i.expectedSequence! + 1 ||
    result.database.kind !== i.targetKind ||
    result.database.profileId !== i.targetProfileId ||
    result.database.revision !== i.expectedDatabaseRevision + 1
  )
    throw Error('database.change-ack-invalid');
  return result;
}
function afterConversion(
  plan: NativeGalleryConversionPlan,
  ack: ProjectDatabaseChangeResult,
  state: ProjectDocumentState,
) {
  nativeSource(state, false);
  if (
    state.project.id !== plan.projectId ||
    state.project.workspaceId !== plan.workspaceId ||
    state.project.version < ack.version ||
    state.sequence < ack.sequence ||
    state.project.databaseRevision < ack.database.revision
  )
    throw Error('database.change-reload-invalid');
}
/** Keep the original request until the DB ACK and the separate name save are both verified. */
export async function sendGalleryDatabaseConversion(
  plan: NativeGalleryConversionPlan,
  options: NativeGalleryConversionOptions,
): Promise<{ project: Project; completed: boolean; archive: GalleryConversionArchive | null }> {
  const immutable = validatedPlan(plan, options),
    auth = await livePermission(options, false);
  const queue = getNativeDurableQueue(),
    entry = galleryConversionEntry(immutable);
  const stored = await loadGalleryDatabaseConversion(options);
  if (!stored || requestFingerprint(stored) !== requestFingerprint(immutable))
    throw Error('database.change-pending-changed');
  auth.inputsReady();
  const token = await queue.beginTransmission(entry);
  let lostLease = false;
  const heartbeat = setInterval(() => {
    void queue
      .renewTransmission(entry, token)
      .then((ok) => {
        if (!ok) lostLease = true;
      })
      .catch(() => {
        lostLease = true;
      });
  }, 5000);
  const guarded = async () => {
    auth.inputsReady();
    if (lostLease || !(await queue.renewTransmission(entry, token)))
      throw Error('database.change-lease-lost');
    auth.inputsReady();
  };
  try {
    await guarded();
    const ack = validateGalleryDatabaseAck(
      immutable,
      await auth.api(
        `/api/projects/${encodeURIComponent(auth.projectId)}/database/change`,
        body('POST', immutable.input),
      ),
    );
    await guarded();
    const latest = await fetchGalleryDatabaseSnapshot(options, false);
    afterConversion(immutable, ack, latest);
    let project: Project = latest.project;
    const name = immutable.requestedName?.trim();
    const sameDatabase =
      project.databaseKind === ack.database.kind &&
      project.databaseProfileId === ack.database.profileId &&
      project.databaseRevision === ack.database.revision;
    const namePending = name !== undefined && name !== project.name;
    if (
      !sameDatabase ||
      (namePending &&
        (project.name !== immutable.snapshot.project.name ||
          project.status !== 'active' ||
          !options.canEdit() ||
          auth.workspace.status !== 'active' ||
          auth.workspace.role === 'viewer'))
    ) {
      await guarded();
      let archive: GalleryConversionArchive | null = null;
      if (
        !(await queue.acknowledge(entry, () => {
          auth.inputsReady();
          archive = retainGalleryConversionArchive(
            {
              formatVersion: 1,
              outcome: 'accepted',
              savedAt: new Date().toISOString(),
              plan: immutable,
              ack,
              fresh: latest,
            },
            auth.storage,
          );
        }))
      )
        throw Error('database.change-pending-changed');
      return { project, completed: false, archive };
    }
    if (name !== undefined && name !== project.name) {
      // Do not overwrite another writer's subsequent rename while recovering a lost ACK.
      if (project.name !== immutable.snapshot.project.name)
        throw Error('database.change-name-changed');
      if (project.status !== 'active') throw Error('database.change-edit-required');
      const writeAuth = await livePermission(options);
      await guarded();
      writeAuth.inputsReady();
      project = projectSchema.parse(
        await auth.api(
          `/api/projects/${encodeURIComponent(auth.projectId)}`,
          body('PATCH', { expectedVersion: latest.project.version, name }),
        ),
      );
      auth.assertCurrent();
      if (
        project.id !== immutable.projectId ||
        project.workspaceId !== immutable.workspaceId ||
        project.version !== latest.project.version + 1 ||
        project.name !== name ||
        project.status !== 'active' ||
        project.databaseKind !== ack.database.kind ||
        project.databaseProfileId !== ack.database.profileId ||
        project.databaseRevision !== ack.database.revision
      )
        throw Error('database.change-name-ack-invalid');
    }
    await guarded();
    if (!(await queue.acknowledge(entry, auth.inputsReady)))
      throw Error('database.change-pending-changed');
    return { project, completed: true, archive: null };
  } finally {
    clearInterval(heartbeat);
    await queue.endTransmission(entry, token).catch(() => {});
  }
}
export interface GalleryDatabaseReleaseProof {
  plan: NativeGalleryConversionPlan;
  fresh: ProjectDocumentState;
  ack: ProjectDatabaseChangeResult | null;
}
function consumedPrecondition(
  plan: NativeGalleryConversionPlan,
  fresh: ProjectDocumentState,
): void {
  nativeSource(fresh, false);
  if (
    fresh.project.id !== plan.projectId ||
    fresh.project.workspaceId !== plan.workspaceId ||
    fresh.project.version < plan.input.expectedVersion ||
    fresh.sequence < plan.input.expectedSequence! ||
    fresh.project.databaseRevision < plan.input.expectedDatabaseRevision ||
    !(
      fresh.project.version > plan.input.expectedVersion ||
      fresh.project.databaseRevision > plan.input.expectedDatabaseRevision
    )
  )
    throw Error('database.change-precondition-not-consumed');
}
export function readGalleryDatabaseArchives(options: NativeGalleryConversionOptions) {
  const auth = authority(options, false);
  return galleryConversionArchives(auth.userId, auth.projectId, auth.storage).map((record) => {
    validatedPlan(record.plan, options);
    if (record.outcome === 'accepted')
      afterConversion(
        record.plan,
        validateGalleryDatabaseAck(record.plan, record.ack),
        record.fresh,
      );
    else consumedPrecondition(record.plan, record.fresh);
    return record;
  });
}
/** Fresh monotonic counters fence out a new mutation; an exact replay distinguishes a known ACK. */
function monitorGalleryLease(
  queue: ReturnType<typeof getNativeDurableQueue>,
  entry: NativeDurablePending,
  token: string,
) {
  let lost = false;
  const renew = async () => {
    if (lost) return false;
    const ok = await queue.renewTransmission(entry, token);
    if (!ok) lost = true;
    return ok;
  };
  const timer = setInterval(() => {
    void renew().catch(() => {
      lost = true;
    });
  }, 5000);
  return { renew, close: () => clearInterval(timer) };
}
export async function prepareGalleryDatabaseRelease(
  plan: NativeGalleryConversionPlan,
  options: NativeGalleryConversionOptions,
): Promise<GalleryDatabaseReleaseProof> {
  const immutable = validatedPlan(plan, options),
    auth = await livePermission(options, false);
  const queue = getNativeDurableQueue(),
    entry = galleryConversionEntry(immutable);
  const stored = await loadGalleryDatabaseConversion(options);
  if (!stored || requestFingerprint(stored) !== requestFingerprint(immutable))
    throw Error('database.change-pending-changed');
  const token = await queue.beginTransmission(entry);
  const lease = monitorGalleryLease(queue, entry, token);
  try {
    const fresh = await fetchGalleryDatabaseSnapshot(options, false);
    consumedPrecondition(immutable, fresh);
    auth.inputsReady();
    if (!(await lease.renew())) throw Error('database.change-lease-lost');
    auth.inputsReady();
    let ack: ProjectDatabaseChangeResult | null = null;
    try {
      ack = validateGalleryDatabaseAck(
        immutable,
        await auth.api(
          `/api/projects/${encodeURIComponent(auth.projectId)}/database/change`,
          body('POST', immutable.input),
        ),
      );
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 409)) throw cause;
    }
    auth.assertCurrent();
    if (!(await lease.renew())) throw Error('database.change-lease-lost');
    auth.assertCurrent();
    return { plan: immutable, fresh, ack };
  } finally {
    lease.close();
    await queue.endTransmission(entry, token).catch(() => {});
  }
}
/** User explicitly archives before release. This proves no new mutation, never that none was applied. */
export async function releaseGalleryDatabaseConversion(
  proof: GalleryDatabaseReleaseProof,
  options: NativeGalleryConversionOptions,
): Promise<{ project: Project; archive: GalleryConversionArchive }> {
  const plan = validatedPlan(proof.plan, options),
    auth = await livePermission(options, false);
  consumedPrecondition(plan, proof.fresh);
  if (proof.ack !== null) validateGalleryDatabaseAck(plan, proof.ack);
  const queue = getNativeDurableQueue(),
    entry = galleryConversionEntry(plan);
  const token = await queue.beginTransmission(entry);
  const lease = monitorGalleryLease(queue, entry, token);
  let archive: GalleryConversionArchive | undefined;
  let accepted = proof.ack;
  const archiveGuard = () => {
    auth.inputsReady();
    archive = retainGalleryConversionArchive(
      {
        formatVersion: 1,
        outcome: accepted ? 'accepted' : 'unconfirmed',
        savedAt: new Date().toISOString(),
        plan,
        ack: accepted,
        fresh: proof.fresh,
      },
      auth.storage,
    );
  };
  try {
    const fresh = await fetchGalleryDatabaseSnapshot(options, false);
    consumedPrecondition(plan, fresh);
    if (!sameProjectTransferState(proof.fresh, fresh))
      throw Error('database.change-preview-changed');
    auth.inputsReady();
    if (!(await lease.renew())) throw Error('database.change-lease-lost');
    auth.inputsReady();
    // Re-establish endpoint evidence under this lease; never trust a caller-supplied ACK/proof.
    try {
      const ack = validateGalleryDatabaseAck(
        plan,
        await auth.api(
          `/api/projects/${encodeURIComponent(auth.projectId)}/database/change`,
          body('POST', plan.input),
        ),
      );
      if (accepted && requestFingerprint(accepted) !== requestFingerprint(ack))
        throw Error('database.change-ack-invalid');
      accepted = ack;
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 409) || accepted !== null) throw cause;
    }
    auth.inputsReady();
    if (!(await lease.renew())) throw Error('database.change-lease-lost');
    auth.inputsReady();
    if (accepted) {
      if (!(await queue.acknowledge(entry, archiveGuard)))
        throw Error('database.change-pending-changed');
    } else {
      if (!(await queue.confirmDatabaseChangePreconditionConsumed(entry, token, archiveGuard)))
        throw Error('database.change-lease-lost');
      await queue.endTransmission(entry, token);
      auth.assertCurrent();
      if (!(await queue.discard(entry))) throw Error('database.change-pending-changed');
    }
    auth.assertCurrent();
    if (!archive) throw Error('database.change-archive-unavailable');
    return { project: fresh.project, archive };
  } finally {
    lease.close();
    await queue.endTransmission(entry, token).catch(() => {});
  }
}
