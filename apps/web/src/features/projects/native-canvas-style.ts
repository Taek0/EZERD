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
  return (document.columns ?? [])
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
      keys: (document.keys ?? [])
        .filter(
          (key) =>
            key.tableId === table.id &&
            key.columnIds.includes(column.id) &&
            isVisibleInView(key.scope, mode, table.scope),
        )
        .map((key) => (key.kind === 'primary' ? 'PK' : 'UQ'))
        .join(' '),
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
      height:
        34 +
        ((table.canvasDisplay?.showComment !== false && nativeCanvasRowComment(column, mode)) ||
        (table.canvasDisplay?.showNullable !== false &&
          (mode === 'physical' || column.logical.required))
          ? 18
          : 0),
    }));
}
export const nativeCanvasRowComment = (column: NativeColumn, mode: 'physical' | 'logical') =>
  mode === 'physical' ? column.physical.comment : column.logical.definition;
export function nativeCardColor(document: NativeDesignDocument, objectId: string) {
  return (
    document.tables?.find((item) => item.id === objectId)?.color ??
    document.domains.find((item) => item.id === objectId)?.color ??
    document.notes.find((item) => item.id === objectId)?.color ??
    '#c9d0dd'
  );
}
