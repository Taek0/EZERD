import { projectDocumentStateSchema, type ProjectDocumentState } from '@ezerd/contracts';
import type { NativeDesignDocument } from '@ezerd/model';
import { request } from '../../shared/api/client.js';
import { registerTranslations, translate } from '../../shared/i18n/index.js';

registerTranslations({
  'v1 프로젝트는 더 이상 열거나 편집할 수 없습니다.':
    'V1 projects can no longer be opened or edited.',
});

export type ProjectEntry = {
  kind: 'native';
  snapshot: ProjectDocumentState;
  document: NativeDesignDocument | null;
};

/** A native source always remains outside the v1 editor, including when its preview is unavailable. */
export function projectEntry(snapshotInput: unknown): ProjectEntry {
  const snapshot = projectDocumentStateSchema.parse(snapshotInput);
  if (snapshot.sourceDocument.schemaVersion === 1)
    throw new Error(translate('v1 프로젝트는 더 이상 열거나 편집할 수 없습니다.'));
  if (snapshot.native.status !== 'available') return { kind: 'native', snapshot, document: null };
  return { kind: 'native', snapshot, document: snapshot.native.document };
}
export async function loadProjectEntry(
  id: string,
  signal?: AbortSignal,
  api: typeof request = request,
): Promise<ProjectEntry> {
  const snapshot = await api(`/api/projects/${encodeURIComponent(id)}/document-state`, {
    cache: 'no-store',
    ...(signal && { signal }),
  });
  return projectEntry(snapshot);
}
