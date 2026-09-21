import type { DesignDocument, TableRelation } from '@ezerd/model';
export function tableRelationLabel(document: DesignDocument, relation: TableRelation): string {
  const departure = relation.physical?.targetColumnIds ?? [],
    reference = relation.physical?.sourceColumnIds ?? [];
  const name = (id: string | undefined) =>
    document.columns?.find((column) => column.id === id)?.physical.name || '?';
  return Array.from(
    { length: Math.max(1, departure.length, reference.length) },
    (_, index) => name(departure[index]) + ':' + name(reference[index]),
  ).join(' · ');
}
