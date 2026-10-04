import {
  projectDDLExportSchema,
  projectDocumentStateSchema,
  type ProjectDDLExport,
} from '@ezerd/contracts';
import { request } from '../../shared/api/client.js';
import { loadNativePending } from './native-save.js';
import { assertNativeDurableReady, nativeEditorExportBlocked } from './native-export-state.js';
import { nativeDraftMemoryState } from './native-durable-drafts.js';
import { nativeDraftArchive, nativePropertyArchiveKey } from './native-draft-archive.js';
type Storage = Pick<globalThis.Storage, 'getItem' | 'key' | 'length'>;

/** Own project inputs only. A damaged own draft is preserved and blocks an outdated export. */
export async function assertNativeExportReady(
  userId: string,
  projectId: string,
  storage: Storage = localStorage,
): Promise<void> {
  if (await loadNativePending(userId, projectId, storage as globalThis.Storage))
    throw Error('project-export.pending');
  await assertNativeDurableReady(userId, projectId);
  assertNativeLocalInputsReady(userId, projectId, storage);
}
/** Synchronous draft/legacy guard, also rechecked inside an IndexedDB claim. */
export function assertNativeLocalInputsReady(
  userId: string,
  projectId: string,
  storage: Storage = localStorage,
): void {
  if (nativeEditorExportBlocked(userId, projectId)) throw Error('project-export.unsaved-draft');
  const memory = nativeDraftMemoryState(userId, projectId, storage as globalThis.Storage);
  if (memory.dirty || memory.storageFailure) throw Error('project-export.unsaved-draft');
  if (storage.getItem(`ezerd.native.pending:${userId}:${projectId}`) !== null)
    throw Error('project-export.pending');
  if (storage.getItem(`ezerd.native.history:${JSON.stringify([userId, projectId])}`) !== null)
    throw Error('project-export.pending');
  if (
    storage.getItem(`ezerd.native.canvas.personal:${JSON.stringify([userId, projectId])}`) !== null
  )
    throw Error('project-export.pending');
  const identity = JSON.stringify([userId, projectId]).slice(0, -1) + ',';
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key) continue;
    const editor = key.startsWith('ezerd.native.editor:' + identity),
      property = key.startsWith('ezerd.native.draft:' + identity);
    if (!editor && !property) continue;
    const parts: unknown = JSON.parse(
      key.slice((editor ? 'ezerd.native.editor:' : 'ezerd.native.draft:').length),
    );
    if (
      !Array.isArray(parts) ||
      parts.length !== (editor ? 3 : 4) ||
      parts.some((value) => typeof value !== 'string')
    )
      throw Error('native.draft-invalid');
    const parsed = nativeDraftArchive(storage as globalThis.Storage).legacy(
      userId,
      projectId,
      editor ? 'editor' : 'property',
      editor ? parts[2] : nativePropertyArchiveKey(parts[2], parts[3]),
    );
    if (!parsed) continue;
    const fields = new Set([...Object.keys(parsed.values), ...Object.keys(parsed.before)]);
    if (
      [...fields].some(
        (field) =>
          (parsed.values as Record<string, string>)[field] !==
          (parsed.before as Record<string, string>)[field],
      )
    )
      throw Error('project-export.unsaved-draft');
  }
}
export async function fetchProjectDDL(
  projectId: string,
  databaseRevision: number,
  api: typeof request = request,
): Promise<ProjectDDLExport> {
  const result = projectDDLExportSchema.parse(
    await api(`/api/projects/${encodeURIComponent(projectId)}/ddl`, { cache: 'no-store' }),
  );
  if (result.projectId !== projectId || result.database.revision !== databaseRevision)
    throw Error('database.context-changed');
  return result;
}
export async function confirmProjectDDLSnapshot(
  result: ProjectDDLExport,
  api: typeof request = request,
): Promise<void> {
  if (!result.canExport || !result.sql || result.issues.some((issue) => issue.severity === 'error'))
    throw Error('ddl.export-blocked');
  const state = projectDocumentStateSchema.parse(
    await api(`/api/projects/${encodeURIComponent(result.projectId)}/document-state`, {
      cache: 'no-store',
    }),
  );
  if (
    state.project.id !== result.projectId ||
    state.project.version !== result.version ||
    state.sequence !== result.sequence ||
    state.project.databaseRevision !== result.database.revision ||
    state.project.databaseProfileId !== result.database.profileId ||
    state.project.databaseKind !== result.database.kind
  )
    throw Error('ddl.snapshot-changed');
}
export function downloadProjectDDL(result: ProjectDDLExport): void {
  if (!result.canExport || !result.sql || result.issues.some((issue) => issue.severity === 'error'))
    throw Error('ddl.export-blocked');
  const url = URL.createObjectURL(
    new Blob([result.sql], { type: 'application/sql;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = result.filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
