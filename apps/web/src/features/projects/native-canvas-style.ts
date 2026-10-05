import { nativeCanvasStyleCommandSchema, type NativeCanvasStyleCommand } from '@ezerd/contracts';
import {
  isVisibleInView,
  nativeColumnTypeDisplay,
  type NativeDesignDocument,
  type NativeTable,
  type NativeColumn,
} from '@ezerd/model';
export function nativeCanvasStyleCommands(
  target: NativeCanvasStyleCommand['target'],
  values: Record<string, string>,
  before: Record<string, string>,
): NativeCanvasStyleCommand[] {
  const changedDisplay =
    target.kind === 'table'
      ? {
          ...(values.showNullable !== before.showNullable
            ? { showNullable: values.showNullable === 'true' }
            : {}),
          ...(values.showComment !== before.showComment
            ? { showComment: values.showComment === 'true' }
            : {}),
        }
      : {};
  const patch = {
    ...(values.color !== before.color ? { color: values.color || null } : {}),
    ...(Object.keys(changedDisplay).length ? { canvasDisplay: changedDisplay } : {}),
  };
  return Object.keys(patch).length
    ? [nativeCanvasStyleCommandSchema.parse({ type: 'patch_canvas_style', target, patch })]
    : [];
}
export function nativeTableCanvasRows(
  document: NativeDesignDocument,
  table: NativeTable,
  mode: 'physical' | 'logical',
) {
  return nativeTableCanvasMetrics(document, table, mode).rows;
}

// Keep source card typography, displayed bounds, relation ports and PNG in one coordinate system.
export const nativeTableCanvasHeaderHeight = 50 + 34;
export const nativeTableCanvasFooterHeight = 40;
const textWidth = (value: string) =>
  [...value].reduce((width, character) => width + (character.charCodeAt(0) > 255 ? 20 : 12.4), 0);
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
export function nativeTableCanvasMetrics(
  document: NativeDesignDocument,
  table: NativeTable,
  mode: 'physical' | 'logical',
) {
  const foreignColumns = new Set(
    (document.tableRelations ?? [])
      .filter(
        (relation) => relation.sourceTableId === table.id && isVisibleInView(relation.scope, mode),
      )
      .flatMap((relation) => relation.physical?.sourceColumnIds ?? []),
  );
  const rows = (document.columns ?? [])
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
        const keys = (document.keys ?? []).filter(
          (key) =>
            key.tableId === table.id &&
            key.columnIds.includes(column.id) &&
            isVisibleInView(key.scope, mode, table.scope),
        );
        return [
          keys.some((key) => key.kind === 'primary') ? 'PK' : '',
          foreignColumns.has(column.id) ? 'FK' : '',
          keys.some((key) => key.kind === 'unique') ? 'UQ' : '',
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
    54,
    Math.max(100, ...rows.map((row) => Math.min(216, textWidth(row.name)))),
    Math.max(108, ...rows.map((row) => Math.min(234, textWidth(row.type) + 16))),
    40,
    Math.max(96, ...rows.map((row) => Math.min(288, textWidth(row.comment)))),
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
        28 +
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
      (textWidth(title) * 26) / 20 + 24,
    ),
    height: Math.max(
      180,
      nativeTableCanvasHeaderHeight +
        Math.max(
          37,
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
export function nativeCardColor(document: NativeDesignDocument, objectId: string) {
  // Source palettes tint headers/top accents; neutral side borders remain legible.
  return document.notes.some((item) => item.id === objectId) ? '#ded9bf' : '#c8d0de';
}

export function nativeTableHeaderColor(document: NativeDesignDocument, table: NativeTable) {
  return (
    table.color ??
    document.domains.find((domain) => domain.id === table.domainId)?.color ??
    '#8993a3'
  );
}
