import type { DesignDocument, Table } from '@ezerd/model';

export const UNASSIGNED_DOMAIN_VALUE = '__unassigned__';
// Encode assigned IDs so a domain named like the sentinel still remains selectable.
export const tableDomainValue = (domainId: string | null) =>
  domainId === null ? UNASSIGNED_DOMAIN_VALUE : `domain:${domainId}`;
export const tableDomainFromValue = (value: string): string | null =>
  value === UNASSIGNED_DOMAIN_VALUE ? null : value.slice('domain:'.length);

export function tableColor(doc: DesignDocument, table: Table): string {
  return (
    table.color ?? doc.domains.find((domain) => domain.id === table.domainId)?.color ?? '#8993a3'
  );
}

/** Table titles use a consistent white foreground in every canvas. */
export function tableHeaderStyle(doc: DesignDocument, table: Table) {
  return {
    background: tableColor(doc, table),
    color: '#ffffff',
  };
}
