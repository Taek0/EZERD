import { nativeCanvasStyleCommandSchema, type NativeCanvasStyleCommand } from '@ezerd/contracts';
import { type NativeDesignDocument, type NativeTable } from '@ezerd/model';
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
export {
  nativeTableCanvasRows,
  nativeTableCanvasHeaderHeight,
  nativeTableCanvasFooterHeight,
  nativeCanvasFontFamily,
  nativeRelationLabelWidth,
  nativeTableCanvasTitle,
  nativeTableCanvasNamespace,
  nativeTableCanvasMetrics,
  nativeCanvasRowComment,
} from '@ezerd/model';
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
