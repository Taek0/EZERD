import { TABLES_VIEW_ID, type DesignDocument, type Table } from '@ezerd/model';

/** Null includes every domain, including tables created or reassigned later. */
export type DomainFilter = { domainIds: string[]; unassigned: boolean } | null;

export function matchesDomainFilter(table: Table, filter: DomainFilter): boolean {
  return (
    filter === null ||
    (table.domainId === null ? filter.unassigned : filter.domainIds.includes(table.domainId))
  );
}

export function domainFilterOwner(doc: DesignDocument, filter: DomainFilter): string | null {
  if (!filter || filter.unassigned) return null;
  const ids = [...new Set(filter.domainIds)].filter((id) => doc.domains.some((d) => d.id === id));
  return ids.length === 1 ? ids[0]! : null;
}

/** Legacy links select a local filter, never create or edit a saved view. */
export function domainCanvasTarget(
  doc: DesignDocument,
  id: string,
): {
  viewId: string;
  filter: DomainFilter;
} {
  if (id === 'overview') return { viewId: 'overview', filter: null };
  if (doc.domains.some((d) => d.id === id))
    return { viewId: TABLES_VIEW_ID, filter: { domainIds: [id], unassigned: false } };
  const combined = doc.views?.find((v) => v.id === id);
  return {
    viewId: TABLES_VIEW_ID,
    filter: combined
      ? {
          domainIds: combined.domainIds.filter((domainId) =>
            doc.domains.some((d) => d.id === domainId),
          ),
          unassigned: false,
        }
      : null,
  };
}

export function domainFilterNames(doc: DesignDocument, filter: DomainFilter): string[] {
  return filter
    ? doc.domains.filter((d) => filter.domainIds.includes(d.id)).map((d) => d.name)
    : [];
}
