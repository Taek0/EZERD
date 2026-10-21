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
  nativeTableCanvasTypography,
  nativeTableCanvasFooterHeight,
  nativeCanvasFontFamily,
  nativeRelationLabelWidth,
  nativeTableCanvasTitle,
  nativeTableCanvasNamespace,
  nativeTableCanvasMetrics,
  nativeCanvasRowComment,
} from '@ezerd/model';
export function nativeCardColor(document: NativeDesignDocument, objectId: string) {
  // Notes use one solid color; table and domain side borders stay neutral.
  const note = document.notes.find((item) => item.id === objectId);
  return note ? (note.color ?? '#fff3c4') : '#c8d0de';
}

/** Pick the higher-contrast ink for the note's opaque six-digit sRGB background. */
export function nativeNoteTextColor(color = '#fff3c4') {
  const channels = [1, 3, 5].map((offset) => {
    const channel = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}

export function nativeTableHeaderColor(document: NativeDesignDocument, table: NativeTable) {
  return (
    table.color ??
    document.domains.find((domain) => domain.id === table.domainId)?.color ??
    '#435975'
  );
}

/** Table titles use the same fixed white ink on screen and in PNG exports. */
export function nativeTableHeaderTextColor(_document: NativeDesignDocument, _table: NativeTable) {
  return '#ffffff';
}
