import { columnTypeDisplay } from './column-type-display.js';
import { type DesignDocument, isVisibleInView } from '@ezerd/model';
const textWidth = (value: string) =>
  [...value].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 17 : 10.5), 0);
export function tableCardMetrics(doc: DesignDocument, tableId: string) {
  const table = doc.tables?.find((t) => t.id === tableId);
  const columns = (doc.columns ?? []).filter(
    (c) => c.tableId === tableId && isVisibleInView(c.scope, 'physical', table?.scope),
  );
  const showNullable = table?.canvasDisplay?.showNullable !== false,
    showComment = table?.canvasDisplay?.showComment !== false;
  const typeDisplays = columns.map((c) => columnTypeDisplay(c.physical.type, doc.enums));
  const widths = [
    58,
    Math.max(110, ...columns.map((c) => Math.min(240, textWidth(c.physical.name)))),
    Math.max(100, ...typeDisplays.map((typeDisplay) => Math.min(220, textWidth(typeDisplay)))),
    44,
    Math.max(110, ...columns.map((c) => Math.min(320, textWidth(c.physical.comment)))),
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
        25 +
      17,
  );
  const visibleWidths = widths.filter(
    (_, i) => (i !== 3 && i !== 4) || (i === 3 && showNullable) || (i === 4 && showComment),
  );
  const width = Math.max(
    480,
    visibleWidths.reduce((a, b) => a + b, 0) + 24 + (visibleWidths.length - 1) * 8,
    textWidth(table?.physical.name ?? '') * 1.2 + 32,
  );
  return {
    width,
    height: Math.max(
      240,
      52 +
        36 +
        Math.max(
          42,
          rows.reduce((a, b) => a + b, 0),
        ) +
        56,
    ),
    grid: visibleWidths.map((n) => `minmax(${n}px, ${n}fr)`).join(' '),
    rows,
  };
}
/** Identical content bounds for render, resize, routing, fit and export. */
export function tableCardSize(doc: DesignDocument, tableId: string, width = 480, height = 280) {
  const minimum = tableCardMetrics(doc, tableId);
  return { width: Math.max(width, minimum.width), height: Math.max(height, minimum.height) };
}
