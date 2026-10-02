import {
  projectDocumentStateSchema,
  projectTransferSchema,
  versionedProjectTransferSchema,
  type NativeTransferRead,
  type ProjectDocumentState,
  type ProjectTransfer,
  type VersionedProjectTransfer,
} from '@ezerd/contracts';
import {
  normalizeDocumentPhysicalTypes,
  normalizeSharedTableCanvas,
  requestFingerprint,
} from '@ezerd/model';
import { request } from '../../shared/api/client.js';
import { assertNativeExportReady } from './project-ddl-export.js';
import { captureNativeActorApi } from './native-actor-api.js';
import {
  currentTransferUserId,
  parseProjectTransfer,
  projectTransferFilename,
  projectTransferGuard,
  type ProjectTransferApi,
  type ProjectTransferControl,
} from './project-transfer.js';

export interface ProjectExportOptions {
  api?: ProjectTransferApi;
  control?: ProjectTransferControl;
  assertReady?: (userId: string, projectId: string) => Promise<void>;
  download?: (file: NativeTransferRead, assertCurrent: () => void) => void;
}
export async function fetchProjectTransferState(
  projectId: string,
  api: ProjectTransferApi = request,
): Promise<ProjectDocumentState> {
  const state = projectDocumentStateSchema.parse(
    await api(`/api/projects/${encodeURIComponent(projectId)}/document-state`, {
      cache: 'no-store',
    }),
  );
  if (state.project.id !== projectId) throw new Error('project-transfer.snapshot-changed');
  return state;
}
export function sameProjectTransferState(
  before: ProjectDocumentState,
  current: ProjectDocumentState,
): boolean {
  return (
    before.project.id === current.project.id &&
    before.project.workspaceId === current.project.workspaceId &&
    before.project.version === current.project.version &&
    before.sequence === current.sequence &&
    before.project.databaseRevision === current.project.databaseRevision &&
    before.project.databaseKind === current.project.databaseKind &&
    before.project.databaseProfileId === current.project.databaseProfileId &&
    before.project.name === current.project.name &&
    before.project.status === current.project.status &&
    requestFingerprint(before.sourceDocument) === requestFingerprint(current.sourceDocument)
  );
}
export function assertVersionedTransferSnapshot(
  file: VersionedProjectTransfer,
  state: ProjectDocumentState,
): void {
  if (
    file.source.projectId !== state.project.id ||
    file.source.version !== state.project.version ||
    file.source.sequence !== state.sequence ||
    file.source.databaseRevision !== state.project.databaseRevision ||
    file.project.databaseKind !== state.project.databaseKind ||
    file.project.databaseProfileId !== state.project.databaseProfileId ||
    file.project.name !== state.project.name ||
    requestFingerprint(file.sourceDocument) !== requestFingerprint(state.sourceDocument) ||
    requestFingerprint(file.native) !== requestFingerprint(state.native)
  )
    throw new Error('project-transfer.snapshot-changed');
}
function assertLegacyTransferSnapshot(file: ProjectTransfer, state: ProjectDocumentState): void {
  if (state.sourceDocument.schemaVersion !== 1) throw new Error('document.client-upgrade-required');
  // Mirror the existing server's v1 representation only for comparison, never for v2 conversion.
  const canonical = projectTransferSchema.parse({
    ...file,
    document: normalizeSharedTableCanvas(normalizeDocumentPhysicalTypes(state.sourceDocument)),
  }).document;
  if (
    file.project.name !== state.project.name ||
    (file.project.databaseKind ?? 'postgresql') !== state.project.databaseKind ||
    requestFingerprint(file.document) !== requestFingerprint(canonical)
  )
    throw new Error('project-transfer.snapshot-changed');
}
/** All guards complete before any Blob is created; cleanup also runs if the visible scope changes. */
export function downloadProjectTransfer(
  file: NativeTransferRead,
  assertCurrent: () => void = () => undefined,
): void {
  assertCurrent();
  const json = JSON.stringify(file);
  parseProjectTransfer(json);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  let clicked = false;
  try {
    link.href = url;
    link.download = projectTransferFilename(file.project.name);
    document.body.append(link);
    assertCurrent();
    link.click();
    clicked = true;
  } finally {
    link.remove();
    if (clicked) setTimeout(() => URL.revokeObjectURL(url), 1000);
    else URL.revokeObjectURL(url);
  }
}
function exportControl(
  projectId: string,
  supplied?: ProjectTransferControl,
): ProjectTransferControl {
  if (supplied) {
    if (supplied.scope.projectId !== projectId) throw new Error('project-transfer.scope-changed');
    return supplied;
  }
  const userId = currentTransferUserId();
  if (!userId) throw new Error('project-transfer.identity-required');
  return {
    scope: { userId, projectId },
    currentScope: () => (currentTransferUserId() === userId ? { userId, projectId } : null),
  };
}
async function exportServerProjectFile(
  projectId: string,
  expectedRevision: number | undefined,
  forceVersioned: boolean,
  options: ProjectExportOptions,
): Promise<void> {
  const control = exportControl(projectId, options.control);
  const api = captureNativeActorApi(
    control.scope.userId,
    (options.api ?? request) as typeof request,
  );
  const assertCurrent = projectTransferGuard(control);
  const ready = () =>
    (options.assertReady ?? assertNativeExportReady)(control.scope.userId, projectId);
  assertCurrent();
  await ready();
  assertCurrent();
  const state = await fetchProjectTransferState(projectId, api);
  assertCurrent();
  if (
    (control.scope.workspaceId !== undefined &&
      state.project.workspaceId !== control.scope.workspaceId) ||
    (expectedRevision !== undefined && state.project.databaseRevision !== expectedRevision)
  )
    throw new Error('database.context-changed');
  let file: ProjectTransfer | VersionedProjectTransfer;
  if (forceVersioned || state.sourceDocument.schemaVersion === 2) {
    const raw = await api(`/api/projects/${encodeURIComponent(projectId)}/native-transfer`, {
      cache: 'no-store',
    });
    versionedProjectTransferSchema.parse(raw);
    file = parseProjectTransfer(JSON.stringify(raw)) as VersionedProjectTransfer;
    assertCurrent();
    assertVersionedTransferSnapshot(file, state);
  } else {
    file = projectTransferSchema.parse(
      await api(`/api/projects/${encodeURIComponent(projectId)}/export`, { cache: 'no-store' }),
    );
    assertCurrent();
    assertLegacyTransferSnapshot(file, state);
  }
  parseProjectTransfer(JSON.stringify(file));
  const confirmed = await fetchProjectTransferState(projectId, api);
  assertCurrent();
  if (!sameProjectTransferState(state, confirmed))
    throw new Error('project-transfer.snapshot-changed');
  await ready();
  assertCurrent();
  (options.download ?? downloadProjectTransfer)(file, assertCurrent);
}
/** Gallery callers do not know the source format; choose it from a fresh full server snapshot. */
export function exportCurrentProjectFile(
  projectId: string,
  options: ProjectExportOptions = {},
): Promise<void> {
  return exportServerProjectFile(projectId, undefined, false, options);
}
/** Existing native share callers retain their signature and expected DB revision protection. */
export function exportVersionedProjectFile(
  projectId: string,
  databaseRevision: number,
  options: ProjectExportOptions = {},
): Promise<void> {
  return exportServerProjectFile(projectId, databaseRevision, true, options);
}
