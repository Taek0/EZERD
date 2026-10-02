import {
  normalizeSharedTableCanvas,
  normalizeDocumentPhysicalTypes,
  type DesignDocument,
} from '@ezerd/model';
import { ConflictException } from '@nestjs/common';

/** Prevent a v1 consumer from silently interpreting or re-saving native physical structures. */
export function requireLegacyServerDocument(document: { schemaVersion: number }): void {
  if (document.schemaVersion !== 1)
    throw new ConflictException({
      code: 'document.client-upgrade-required',
      message: '새 설계 형식을 사용하려면 클라이언트를 갱신해 주세요.',
    });
}

/** The same deterministic representation for loads, baselines, and accepted sync writes. */
export function normalizeServerDocument(document: DesignDocument): DesignDocument {
  requireLegacyServerDocument(document);
  return normalizeSharedTableCanvas(normalizeDocumentPhysicalTypes(document));
}
