import { isVisibleInView } from './index.js';
import { nativeColumnTypeDisplay } from './database/display.js';
import type {
  NativeColumn,
  NativeDesignDocument,
  NativeTable,
} from './database/native-document.js';
export function nativeTableCanvasRows(
  document: NativeDesignDocument,
  table: NativeTable,
  mode: 'physical' | 'logical',
) {
  return nativeTableCanvasMetrics(document, table, mode).rows;
}

// Keep source card typography, displayed bounds, relation ports and PNG in one coordinate system.
export const nativeTableCanvasTypography = {
  title: 20,
  text: 14,
  line: 22,
  columnHeader: 28,
  footer: 32,
} as const;
export const nativeTableCanvasHeaderHeight = 50 + nativeTableCanvasTypography.columnHeader;
export const nativeTableCanvasFooterHeight = nativeTableCanvasTypography.footer;
/** Matches styles/tokens.css --font-sans; SVG images cannot inherit the page token. */
export const nativeCanvasFontFamily =
  "'Segoe UI', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
const textWidth = (value: string) =>
  [...value].reduce(
    (width, character) =>
      width + (character.charCodeAt(0) > 255 ? nativeTableCanvasTypography.text : 8.68),
    0,
  );
export const nativeRelationLabelWidth = (label: string) =>
  Math.max(
    90,
    [...label].reduce((width, character) => width + (character.charCodeAt(0) > 255 ? 14 : 8), 24),
  );
export const nativeTableCanvasTitle = (table: NativeTable, mode: 'physical' | 'logical') =>
  mode === 'physical'
    ? table.physical.name || table.logical.name
    : table.logical.name || table.physical.name;
/** Only PostgreSQL owns a schema badge; other native namespace kinds never imply public. */
export const nativeTableCanvasNamespace = (table: NativeTable, mode: 'physical' | 'logical') =>
  mode === 'physical' && table.physical.namespace.kind === 'postgresSchema'
    ? table.physical.namespace.name || 'public'
    : '';
/** Content snapshot shared by card bounds, rows and ports; recreate after content edits. */
export function createNativeTableCanvasMetrics(
  document: NativeDesignDocument,
  mode: 'physical' | 'logical',
) {
  const columns = new Map<string, NativeColumn[]>();
  const keys = new Map<string, NonNullable<NativeDesignDocument['keys']>>();
  const foreign = new Map<string, Set<string>>();
  for (const column of document.columns ?? []) {
    const group = columns.get(column.tableId) ?? [];
    group.push(column);
    columns.set(column.tableId, group);
  }
  for (const key of document.keys ?? []) {
    const group = keys.get(key.tableId) ?? [];
    group.push(key);
    keys.set(key.tableId, group);
  }
  for (const relation of document.tableRelations ?? []) {
    if (!isVisibleInView(relation.scope, mode)) continue;
    const group = foreign.get(relation.sourceTableId) ?? new Set<string>();
    for (const id of relation.physical?.sourceColumnIds ?? []) group.add(id);
    foreign.set(relation.sourceTableId, group);
  }
  const cache = new Map<NativeTable, ReturnType<typeof nativeTableCanvasMetrics>>();
  return (table: NativeTable) => {
    let metrics = cache.get(table);
    if (!metrics) {
      metrics = nativeTableCanvasMetrics(document, table, mode, {
        columns: columns.get(table.id) ?? [],
        keys: keys.get(table.id) ?? [],
        foreign: foreign.get(table.id) ?? new Set<string>(),
      });
      cache.set(table, metrics);
    }
    return metrics;
  };
}
export function nativeTableCanvasMetrics(
  document: NativeDesignDocument,
  table: NativeTable,
  mode: 'physical' | 'logical',
  indexed?: {
    columns: NativeColumn[];
    keys: NonNullable<NativeDesignDocument['keys']>;
    foreign: Set<string>;
  },
) {
  const foreignColumns =
    indexed?.foreign ??
    new Set(
      (document.tableRelations ?? [])
        .filter(
          (relation) =>
            relation.sourceTableId === table.id && isVisibleInView(relation.scope, mode),
        )
        .flatMap((relation) => relation.physical?.sourceColumnIds ?? []),
    );
  const columnKeys = new Map<string, Set<string>>();
  for (const key of indexed?.keys ?? document.keys ?? []) {
    if (key.tableId !== table.id || !isVisibleInView(key.scope, mode, table.scope)) continue;
    for (const id of key.columnIds) {
      const kinds = columnKeys.get(id) ?? new Set<string>();
      kinds.add(key.kind);
      columnKeys.set(id, kinds);
    }
  }
  const rows = (indexed?.columns ?? document.columns ?? [])
    .filter(
      (column) => column.tableId === table.id && isVisibleInView(column.scope, mode, table.scope),
    )
    .map((column) => ({
      column,
      name:
        mode === 'physical'
          ? column.physical.name || column.logical.name
          : column.logical.name || column.physical.name,
      type:
        mode === 'physical'
          ? nativeColumnTypeDisplay(column.physical.type, document.enums)
          : column.logical.semanticType,
      keys: (() => {
        const keys = columnKeys.get(column.id);
        return [
          keys?.has('primary') ? 'PK' : '',
          foreignColumns.has(column.id) ? 'FK' : '',
          keys?.has('unique') ? 'UQ' : '',
        ]
          .filter(Boolean)
          .join(' ');
      })(),
      nullable:
        table.canvasDisplay?.showNullable === false
          ? ''
          : mode === 'physical'
            ? column.physical.nullable
              ? 'NULL'
              : 'NOT NULL'
            : column.logical.required
              ? '필수'
              : '',
      comment:
        table.canvasDisplay?.showComment === false ? '' : nativeCanvasRowComment(column, mode),
    }));
  const showNullable = table.canvasDisplay?.showNullable !== false;
  const showComment = table.canvasDisplay?.showComment !== false;
  const widths = [
    34,
    Math.max(92, ...rows.map((row) => Math.min(190, textWidth(row.name)))),
    Math.max(88, ...rows.map((row) => Math.min(214, textWidth(row.type) + 12))),
    32,
    Math.max(100, ...rows.map((row) => Math.min(240, textWidth(row.comment)))),
  ];
  const lines = (value: string, width: number) =>
    value
      .split('\n')
      .reduce((count, line) => count + Math.max(1, Math.ceil(textWidth(line) / width)), 0);
  const measuredRows = rows.map((row) => ({
    ...row,
    height:
      Math.max(
        1,
        lines(row.name, widths[1]!),
        lines(row.type, widths[2]!),
        showComment ? lines(row.comment, widths[4]!) : 1,
      ) *
        nativeTableCanvasTypography.line +
      9,
  }));
  const visibleWidths = widths.filter(
    (_, index) =>
      (index !== 3 && index !== 4) || (index === 3 && showNullable) || (index === 4 && showComment),
  );
  const title = nativeTableCanvasTitle(table, mode);
  return {
    width: Math.max(
      280,
      visibleWidths.reduce((sum, width) => sum + width, 0) + 20 + (visibleWidths.length - 1) * 6,
      (textWidth(title) * nativeTableCanvasTypography.title) / nativeTableCanvasTypography.text +
        24,
    ),
    height: Math.max(
      170,
      nativeTableCanvasHeaderHeight +
        Math.max(
          nativeTableCanvasTypography.line + 9,
          measuredRows.reduce((sum, row) => sum + row.height, 0),
        ) +
        nativeTableCanvasFooterHeight,
    ),
    widths: visibleWidths,
    grid: visibleWidths.map((width) => `minmax(${width}px, ${width}fr)`).join(' '),
    rows: measuredRows,
  };
}
export const nativeCanvasRowComment = (column: NativeColumn, mode: 'physical' | 'logical') =>
  mode === 'physical' ? column.physical.comment : column.logical.definition;
