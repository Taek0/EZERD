import type { Column, DesignDocument, ModelScope, NodeLayout } from './document.js';

export function columnTypeDisplay(
  type: Column['physical']['type'],
  enums: DesignDocument['enums'] = [],
) {
  let label = type.enumId
    ? (enums?.find((item) => item.id === type.enumId)?.name ?? 'ENUM')
    : type.name;
  if (!type.enumId) {
    if (type.length !== undefined) label += '(' + type.length + ')';
    else if (type.precision !== undefined)
      label += '(' + type.precision + (type.scale === undefined ? '' : ',' + type.scale) + ')';
  }
  return label.toUpperCase() + (type.isArray ? '[]' : '');
}

const textWidth = (value: string) =>
  [...value].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 20 : 12.4), 0);
const physical = (scope: ModelScope | undefined) => scope !== 'logical';

export function tableCardMetrics(doc: DesignDocument, tableId: string) {
  const table = doc.tables?.find((t) => t.id === tableId);
  const columns = (doc.columns ?? []).filter(
    (c) => c.tableId === tableId && physical(c.scope) && physical(table?.scope),
  );
  const showNullable = table?.canvasDisplay?.showNullable !== false,
    showComment = table?.canvasDisplay?.showComment !== false;
  const typeDisplays = columns.map((c) => columnTypeDisplay(c.physical.type, doc.enums));
  const widths = [
    54,
    Math.max(100, ...columns.map((c) => Math.min(216, textWidth(c.physical.name)))),
    Math.max(108, ...typeDisplays.map((typeDisplay) => Math.min(234, textWidth(typeDisplay) + 16))),
    40,
    Math.max(96, ...columns.map((c) => Math.min(288, textWidth(c.physical.comment)))),
  ];
  const lines = (value: string, width: number) =>
    value.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(textWidth(line) / width)), 0);
  const rows = columns.map(
    (c, index) =>
      Math.max(
        1,
        lines(c.physical.name, widths[1]!),
        lines(typeDisplays[index]!, widths[2]!),
        showComment ? lines(c.physical.comment, widths[4]!) : 1,
      ) *
        28 +
      9,
  );
  const visibleWidths = widths.filter(
    (_, i) => (i !== 3 && i !== 4) || (i === 3 && showNullable) || (i === 4 && showComment),
  );
  const width = Math.max(
    280,
    visibleWidths.reduce((a, b) => a + b, 0) + 20 + (visibleWidths.length - 1) * 6,
    (textWidth(table?.physical.name ?? '') * 26) / 20 + 24,
  );
  return {
    width,
    height: Math.max(
      180,
      50 +
        34 +
        Math.max(
          37,
          rows.reduce((a, b) => a + b, 0),
        ) +
        40,
    ),
    grid: visibleWidths.map((n) => `minmax(${n}px, ${n}fr)`).join(' '),
    rows,
  };
}

export function tableCardSize(doc: DesignDocument, tableId: string, width = 480, height = 280) {
  const minimum = tableCardMetrics(doc, tableId);
  return { width: Math.max(width, minimum.width), height: Math.max(height, minimum.height) };
}

export function basicCardSize(kind: 'domain' | 'table' | 'note', width: number, height: number) {
  const min = kind === 'domain' ? [240, 210] : kind === 'table' ? [280, 220] : [160, 110];
  return { width: Math.max(min[0]!, width), height: Math.max(min[1]!, height) };
}

export function effectiveCardSize(doc: DesignDocument, node: NodeLayout) {
  if (doc.tables?.some((table) => table.id === node.objectId))
    return tableCardSize(doc, node.objectId, node.width, node.height);
  return basicCardSize(
    doc.domains.some((domain) => domain.id === node.objectId) ? 'domain' : 'note',
    node.width,
    node.height,
  );
}
