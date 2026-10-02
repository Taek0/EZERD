import {
  projectDocumentSchema,
  projectDocumentStateSchema,
  personalStateSnapshotSchema,
  nativeStoredDesignDocumentSchema,
  type ProjectDocument,
  type ProjectDocumentState,
} from '@ezerd/contracts';
import {
  normalizeSharedTableCanvas,
  normalizeDocumentPhysicalTypes,
  mergeStoredPersonalState,
  reconcilePersonalState,
  type NativeDesignDocument,
} from '@ezerd/model';
import { request } from '../../shared/api/client.js';

export type ProjectEntry =
  | { kind: 'legacy'; value: ProjectDocument }
  | {
      kind: 'native';
      snapshot: ProjectDocumentState;
      document: NativeDesignDocument | null;
      personalUnavailable: boolean;
    };

/** A native source always remains outside the v1 editor, including when its preview is unavailable. */
export function projectEntry(snapshotInput: unknown, personalInput: unknown = null): ProjectEntry {
  const snapshot = projectDocumentStateSchema.parse(snapshotInput);
  const personal = personalInput ? personalStateSnapshotSchema.safeParse(personalInput) : null;
  if (snapshot.sourceDocument.schemaVersion === 1) {
    const legacy = projectDocumentSchema.parse({
      project: snapshot.project,
      document: normalizeSharedTableCanvas(normalizeDocumentPhysicalTypes(snapshot.sourceDocument)),
    });
    return {
      kind: 'legacy',
      value: {
        ...legacy,
        document: personal?.success
          ? mergeStoredPersonalState(
              legacy.document,
              reconcilePersonalState(legacy.document, personal.data.state),
            )
          : legacy.document,
      },
    };
  }
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
export async function loadProjectEntry(id: string, signal?: AbortSignal): Promise<ProjectEntry> {
  const [snapshot, personal] = await Promise.all([
    request(`/api/projects/${encodeURIComponent(id)}/document-state`, {
      cache: 'no-store',
      ...(signal && { signal }),
    }),
    request(`/api/projects/${encodeURIComponent(id)}/personal-state`, {
      cache: 'no-store',
      ...(signal && { signal }),
    }).catch(() => null),
  ]);
  return projectEntry(snapshot, personal);
}
