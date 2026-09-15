export function clampCommentsPanelWidth(value: unknown): number {
  if (value === null || value === undefined || value === '') return 340;
  const width = Number(value);
  return Number.isFinite(width) ? Math.min(560, Math.max(280, width)) : 340;
}
