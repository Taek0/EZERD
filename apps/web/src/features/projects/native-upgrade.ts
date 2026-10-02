import {
  upgradeProjectDocumentSchema,
  nativeSyncOperationResultSchema,
  projectDocumentStateSchema,
  type NativeSyncOperationResult,
  type ProjectDocumentState,
} from '@ezerd/contracts';
import { requestFingerprint } from '@ezerd/model';
import { body, request } from '../../shared/api/client.js';
import { assertNativeExportReady, assertNativeLocalInputsReady } from './project-ddl-export.js';
import { fetchProjectTransferState, sameProjectTransferState } from './project-versioned-export.js';
import {
  assertProjectTransferGraph,
  projectTransferGuard,
  type ProjectTransferApi,
  type ProjectTransferControl,
} from './project-transfer.js';
import { captureNativeActorApi } from './native-actor-api.js';
import {
  getNativeDurableQueue,
  nativeDurableId,
  type NativeDurablePending,
} from './native-durable-queue.js';

type UpgradeInput = ReturnType<typeof upgradeProjectDocumentSchema.parse>;
type LocalStorage = Pick<Storage, 'getItem' | 'key' | 'length'>;
interface NativeUpgradePayload {
  readonly userId: string;
  readonly projectId: string;
  readonly snapshot: ProjectDocumentState;
  readonly input: Readonly<UpgradeInput>;
}
export interface NativeUpgradePlan extends NativeUpgradePayload {
  readonly assertCurrent: () => void;
}
export interface NativeUpgradeOptions {
  control: ProjectTransferControl;
  canUpgrade: boolean;
  prepare: () => Promise<boolean>;
  api?: ProjectTransferApi;
  assertReady?: (userId: string, projectId: string) => Promise<void>;
  storage?: LocalStorage;
  clientId?: string;
}
export class NativeUpgradeAttemptError extends Error {
  constructor(
    message: string,
    readonly requestMayHaveApplied: boolean,
  ) {
    super(message);
  }
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function authority(options: NativeUpgradeOptions) {
  const { userId, projectId } = options.control.scope;
  if (!userId || !projectId) throw Error('native.upgrade-scope-invalid');
  const assertCurrent = projectTransferGuard(options.control);
  assertCurrent();
  const api = captureNativeActorApi(userId, (options.api ?? request) as typeof request);
  return { userId, projectId, assertCurrent, api };
}
function verifyPayload(raw: unknown, entry: NativeDurablePending): NativeUpgradePayload {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Object.keys(raw).sort().join(',') !== 'input,projectId,snapshot,userId'
  )
    throw Error('native.upgrade-pending-invalid');
  const payload = raw as NativeUpgradePayload;
  const snapshot = projectDocumentStateSchema.parse(payload.snapshot);
  const input = upgradeProjectDocumentSchema.parse(payload.input);
  if (
    entry.kind !== 'upgrade' ||
    payload.userId !== entry.userId ||
    payload.projectId !== entry.projectId ||
    input.operationId !== entry.operationId ||
    snapshot.project.id !== payload.projectId ||
    snapshot.sourceDocument.schemaVersion !== 1 ||
    snapshot.native.status !== 'available' ||
    snapshot.project.status !== 'active' ||
    input.expectedVersion !== snapshot.project.version ||
    input.expectedSequence !== snapshot.sequence ||
    input.expectedDatabaseRevision !== snapshot.project.databaseRevision
  )
    throw Error('native.upgrade-pending-invalid');
  assertProjectTransferGraph(snapshot.sourceDocument);
  assertProjectTransferGraph(snapshot.native.document);
  // Validate without normalizing source evidence or replacing the exact persisted POST body.
  return freeze(structuredClone(payload));
}
export function nativeUpgradeEntry(plan: NativeUpgradePlan): NativeDurablePending {
  return {
    userId: plan.userId,
    projectId: plan.projectId,
    operationId: plan.input.operationId,
    kind: 'upgrade',
    payload: {
      userId: plan.userId,
      projectId: plan.projectId,
      snapshot: plan.snapshot,
      input: plan.input,
    },
  };
}
export async function loadNativeUpgrade(
  options: NativeUpgradeOptions,
): Promise<NativeUpgradePlan | null> {
  const { userId, projectId, assertCurrent } = authority(options);
  const entry = await getNativeDurableQueue().read(userId, projectId);
  assertCurrent();
  if (!entry || entry.kind !== 'upgrade') return null;
  const payload = verifyPayload(entry.payload, entry);
  if (
    options.control.scope.workspaceId !== undefined &&
    payload.snapshot.project.workspaceId !== options.control.scope.workspaceId
  )
    throw Error('native.upgrade-scope-invalid');
  return Object.freeze({ ...payload, assertCurrent });
}
/** Reviewing does not claim a write; explicit apply stages the immutable request. */
export async function prepareNativeUpgrade(
  options: NativeUpgradeOptions,
): Promise<NativeUpgradePlan> {
  if (!options.canUpgrade) throw Error('native.upgrade-design-required');
  const { userId, projectId, assertCurrent, api } = authority(options);
  if (!(await options.prepare())) throw Error('native.upgrade-unsaved-source');
  assertCurrent();
  await (options.assertReady ?? assertNativeExportReady)(userId, projectId);
  assertCurrent();
  const snapshot = await fetchProjectTransferState(projectId, api);
  assertCurrent();
  if (
    options.control.scope.workspaceId !== undefined &&
    snapshot.project.workspaceId !== options.control.scope.workspaceId
  )
    throw Error('native.upgrade-scope-invalid');
  if (snapshot.sourceDocument.schemaVersion !== 1) throw Error('document.already-native');
  if (snapshot.project.status !== 'active') throw Error('project.archived');
  if (snapshot.native.status !== 'available') throw Error(snapshot.native.code);
  assertProjectTransferGraph(snapshot.sourceDocument);
  assertProjectTransferGraph(snapshot.native.document);
  const input = upgradeProjectDocumentSchema.parse({
    operationId: nativeDurableId(),
    clientId: options.clientId ?? nativeDurableId(),
    expectedVersion: snapshot.project.version,
    expectedSequence: snapshot.sequence,
    expectedDatabaseRevision: snapshot.project.databaseRevision,
  });
  return Object.freeze({
    snapshot: freeze(structuredClone(snapshot)),
    input: freeze(input),
    assertCurrent,
    userId,
    projectId,
  });
}
export async function stageNativeUpgrade(
  plan: NativeUpgradePlan,
  options: NativeUpgradeOptions,
): Promise<void> {
  const { userId, projectId, assertCurrent, api } = authority(options);
  plan.assertCurrent();
  if (userId !== plan.userId || projectId !== plan.projectId)
    throw Error('native.upgrade-scope-invalid');
  if (!options.canUpgrade) throw Error('native.upgrade-design-required');
  if (!(await options.prepare())) throw Error('native.upgrade-unsaved-source');
  assertCurrent();
  await (options.assertReady ?? assertNativeExportReady)(userId, projectId);
  assertCurrent();
  const current = await fetchProjectTransferState(projectId, api);
  assertCurrent();
  if (!sameProjectTransferState(plan.snapshot, current))
    throw Error('native.upgrade-preview-changed');
  const entry = nativeUpgradeEntry(plan);
  verifyPayload(entry.payload, entry);
  await getNativeDurableQueue().claim(entry, () => {
    plan.assertCurrent();
    assertCurrent();
    assertNativeLocalInputsReady(userId, projectId, options.storage ?? localStorage);
  });
}
export function validateNativeUpgradeAck(
  plan: NativeUpgradePlan,
  raw: unknown,
): NativeSyncOperationResult {
  const result = nativeSyncOperationResultSchema.parse(raw);
  if (
    result.status !== 'accepted' ||
    result.reasonCode !== 'document.upgraded' ||
    !result.document ||
    result.actor.id !== plan.userId ||
    result.operationId !== plan.input.operationId ||
    result.groupId !== plan.input.operationId ||
    result.sequence !== plan.input.expectedSequence + 1 ||
    result.databaseRevision !== plan.input.expectedDatabaseRevision + 1 ||
    result.database.kind !== plan.snapshot.project.databaseKind ||
    result.database.profileId !== plan.snapshot.project.databaseProfileId ||
    result.nextBaseline.baseSequence !== result.sequence
  )
    throw Error('native.upgrade-ack-invalid');
  assertProjectTransferGraph(result.document);
  return result;
}
/** Replay needs read authority; role/archive/head changes never rewrite the persisted request. */
export async function sendNativeUpgrade(
  plan: NativeUpgradePlan,
  options: NativeUpgradeOptions,
): Promise<NativeSyncOperationResult> {
  const { assertCurrent, api, userId, projectId } = authority(options);
  if (userId !== plan.userId || projectId !== plan.projectId)
    throw Error('native.upgrade-scope-invalid');
  const stored = await loadNativeUpgrade(options);
  assertCurrent();
  if (
    !stored ||
    requestFingerprint(nativeUpgradeEntry(stored)) !== requestFingerprint(nativeUpgradeEntry(plan))
  )
    throw Error('native.upgrade-pending-changed');
  const queue = getNativeDurableQueue(),
    entry = nativeUpgradeEntry(stored);
  const token = await queue.beginTransmission(entry);
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    void queue
      .renewTransmission(entry, token)
      .then((renewed) => {
        if (!renewed) leaseLost = true;
      })
      .catch(() => {
        leaseLost = true;
      });
  }, 5000);
  try {
    assertCurrent();
    const result = validateNativeUpgradeAck(
      stored,
      await api(
        `/api/projects/${encodeURIComponent(projectId)}/document/upgrade`,
        body('POST', stored.input),
      ),
    );
    assertCurrent();
    if (leaseLost || !(await queue.renewTransmission(entry, token)))
      throw Error('native.upgrade-lease-lost');
    assertCurrent();
    if (!(await queue.acknowledge(entry))) throw Error('native.upgrade-pending-changed');
    return result;
  } catch (error) {
    throw new NativeUpgradeAttemptError(
      error instanceof Error ? error.message : 'native.upgrade-result-unknown',
      true,
    );
  } finally {
    clearInterval(heartbeat);
    // A cleanup failure must not turn a consumed, verified ACK into an unknown write.
    await queue.endTransmission(entry, token).catch(() => {});
  }
}
export async function reloadNativeUpgrade(
  plan: NativeUpgradePlan,
  result: NativeSyncOperationResult,
  options: NativeUpgradeOptions,
): Promise<ProjectDocumentState> {
  const { assertCurrent, api, userId, projectId } = authority(options);
  if (userId !== plan.userId || projectId !== plan.projectId)
    throw Error('native.upgrade-scope-invalid');
  validateNativeUpgradeAck(plan, result);
  const snapshot = await fetchProjectTransferState(projectId, api);
  assertCurrent();
  if (
    snapshot.sourceDocument.schemaVersion !== 2 ||
    snapshot.project.workspaceId !== plan.snapshot.project.workspaceId ||
    snapshot.project.databaseKind !== result.database.kind ||
    snapshot.project.databaseProfileId !== result.database.profileId ||
    snapshot.project.databaseRevision !== result.databaseRevision ||
    snapshot.sequence < result.sequence ||
    snapshot.project.version < plan.input.expectedVersion + 1 ||
    (snapshot.sequence === result.sequence &&
      requestFingerprint(snapshot.sourceDocument) !== requestFingerprint(result.document))
  )
    throw Error('native.upgrade-reload-invalid');
  assertProjectTransferGraph(snapshot.sourceDocument);
  return snapshot;
}
export async function applyNativeUpgrade(
  plan: NativeUpgradePlan,
  options: NativeUpgradeOptions,
  retry = false,
) {
  if (!retry) await stageNativeUpgrade(plan, options);
  const result = await sendNativeUpgrade(plan, options);
  try {
    return { result, snapshot: await reloadNativeUpgrade(plan, result, options), reloadError: '' };
  } catch (error) {
    return {
      result,
      snapshot: null,
      reloadError: error instanceof Error ? error.message : 'native.upgrade-reload-invalid',
    };
  }
}
