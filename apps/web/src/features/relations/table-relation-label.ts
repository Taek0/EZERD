import type { Column, DesignDocument, TableRelation } from '@ezerd/model';
export function tableRelationLabel(
  document: DesignDocument,
  relation: TableRelation,
  columnsById?: ReadonlyMap<string, Column>,
): string {
  const departure = relation.physical?.targetColumnIds ?? [],
    reference = relation.physical?.sourceColumnIds ?? [];
  const name = (id: string | undefined) =>
    (columnsById
      ? id === undefined
        ? undefined
        : columnsById.get(id)
      : document.columns?.find((column) => column.id === id)
    )?.physical.name || '?';
  return Array.from(
    { length: Math.max(1, departure.length, reference.length) },
    (_, index) => name(departure[index]) + ':' + name(reference[index]),
  ).join(' · ');
}
