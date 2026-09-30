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

/** Choose the higher contrast foreground for custom light and dark header colors. */
export function tableHeaderStyle(doc: DesignDocument, table: Table) {
  const background = tableColor(doc, table);
  const luminance = (color: string) => {
    const channels = [1, 3, 5].map((offset) => {
      const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  const light = '#ffffff',
    dark = '#000000';
  const brightness = luminance(background);
  return {
    background,
    color:
      (brightness + 0.05) / (luminance(dark) + 0.05) >= 1.05 / (brightness + 0.05) ? dark : light,
  };
}
