export function inspectorBounds(workspaceWidth: number) {
  const max = Math.max(280, Math.min(520, workspaceWidth - 320));
  return { min: 280, max };
}
export function clampInspectorWidth(width: number, workspaceWidth: number) {
  const { min, max } = inspectorBounds(workspaceWidth);
  return Math.min(max, Math.max(min, width));
}
export function readInspectorWidth(value: string | null) {
  const width = Number(value);
  return Number.isFinite(width) && width >= 280 && width <= 520 ? width : 320;
}
