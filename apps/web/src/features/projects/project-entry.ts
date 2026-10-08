import {
  projectDocumentStateSchema,
  personalStateSnapshotSchema,
  nativeStoredDesignDocumentSchema,
  type ProjectDocumentState,
} from '@ezerd/contracts';
import {
  mergeStoredPersonalState,
  reconcilePersonalState,
  type NativeDesignDocument,
} from '@ezerd/model';
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
  personalUnavailable: boolean;
};

/** A native source always remains outside the v1 editor, including when its preview is unavailable. */
export function projectEntry(snapshotInput: unknown, personalInput: unknown = null): ProjectEntry {
  const snapshot = projectDocumentStateSchema.parse(snapshotInput);
  const personal = personalInput ? personalStateSnapshotSchema.safeParse(personalInput) : null;
  if (snapshot.sourceDocument.schemaVersion === 1)
    throw new Error(translate('v1 프로젝트는 더 이상 열거나 편집할 수 없습니다.'));
  if (snapshot.native.status !== 'available')
    return { kind: 'native', snapshot, document: null, personalUnavailable: false };
  const source = snapshot.native.document;
  if (!personal?.success)
    return { kind: 'native', snapshot, document: source, personalUnavailable: true };
  const merged = nativeStoredDesignDocumentSchema.safeParse(
    mergeStoredPersonalState(source, reconcilePersonalState(source, personal.data.state)),
  );
  return {
    kind: 'native',
    snapshot,
    document: merged.success ? merged.data : source,
    personalUnavailable: !merged.success,
  };
}
export async function loadProjectEntry(
  id: string,
  signal?: AbortSignal,
  api: typeof request = request,
): Promise<ProjectEntry> {
  const [snapshot, personal] = await Promise.all([
    api(`/api/projects/${encodeURIComponent(id)}/document-state`, {
      cache: 'no-store',
      ...(signal && { signal }),
    }),
    api(`/api/projects/${encodeURIComponent(id)}/personal-state`, {
      cache: 'no-store',
      ...(signal && { signal }),
    }).catch(() => null),
  ]);
  return projectEntry(snapshot, personal);
}
