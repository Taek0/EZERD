const maxInspectorWidth = 520;
const minCanvasWidth = 420;

/** Larger widths produce the same bounds and stacking decision. */
export function inspectorLayoutWidth(workspaceWidth: number) {
  return Math.min(workspaceWidth, maxInspectorWidth + minCanvasWidth);
}

export function inspectorBounds(workspaceWidth: number) {
  const max = Math.max(280, Math.min(maxInspectorWidth, workspaceWidth - minCanvasWidth));
  return { min: 280, max };
}
export function shouldStackInspector(workspaceWidth: number) {
  return workspaceWidth < 700;
}
export function clampInspectorWidth(width: number, workspaceWidth: number) {
  const { min, max } = inspectorBounds(workspaceWidth);
  return Math.min(max, Math.max(min, width));
}
export function readInspectorWidth(value: string | null) {
  const width = Number(value);
  return Number.isFinite(width) && width >= 280 && width <= 520 ? width : 320;
}
