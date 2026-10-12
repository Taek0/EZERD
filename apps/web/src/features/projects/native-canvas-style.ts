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
  // Source palettes tint headers/top accents; neutral side borders remain legible.
  return document.notes.some((item) => item.id === objectId) ? '#ded9bf' : '#c8d0de';
}

export function nativeTableHeaderColor(document: NativeDesignDocument, table: NativeTable) {
  return (
    table.color ??
    document.domains.find((domain) => domain.id === table.domainId)?.color ??
    '#edf2f8'
  );
}

/** Choose readable text without replacing a user-defined table/domain color. */
export function nativeTableHeaderTextColor(document: NativeDesignDocument, table: NativeTable) {
  const background = nativeTableHeaderColor(document, table);
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => {
      const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  const bg = luminance(background),
    ink = luminance('#243248');
  const darkContrast = (Math.max(bg, ink) + 0.05) / (Math.min(bg, ink) + 0.05);
  const lightContrast = 1.05 / (bg + 0.05);
  return darkContrast >= lightContrast ? '#243248' : '#ffffff';
}
