import {
  ensureTableCanvasLayout,
  normalizeDocumentPhysicalTypes,
  type DesignDocument,
} from '@ezerd/model';

/** The same deterministic representation for loads, baselines, and accepted sync writes. */
export function normalizeServerDocument(document: DesignDocument): DesignDocument {
  return ensureTableCanvasLayout(normalizeDocumentPhysicalTypes(document));
}
