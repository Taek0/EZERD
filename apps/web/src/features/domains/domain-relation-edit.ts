import { type DesignDocument, upsertDomainRelation } from '@ezerd/model';

type DomainRelation = DesignDocument['domainRelations'][number];
export type DomainRelationPatch = Partial<Omit<DomainRelation, 'id'>>;

/** Apply only the field being edited; never recreate a deleted relation. */
export function applyDomainRelationPatch(
  document: DesignDocument,
  relationId: string,
  patch: DomainRelationPatch,
): DesignDocument {
  const current = document.domainRelations.find((relation) => relation.id === relationId);
  if (!current) return document;
  const next = { ...current, ...patch };
  if (
    !next.name.trim() ||
    next.sourceDomainId === next.targetDomainId ||
    ![next.sourceDomainId, next.targetDomainId].every((id) =>
      document.domains.some((domain) => domain.id === id),
    )
  )
    return document;
  if (patch.name !== undefined) next.name = patch.name.trim();
  return upsertDomainRelation(document, next);
}
