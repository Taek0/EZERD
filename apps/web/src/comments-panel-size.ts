export function clampCommentsPanelWidth(value: unknown): number {
  if (value === null || value === undefined || value === '') return 340;
  const width = Number(value);
  return Number.isFinite(width) ? Math.min(560, Math.max(280, width)) : 340;
}

/** Docked comments leave room for the inspector and a useful canvas. */
export function commentsPanelBounds(workspaceWidth: number) {
  return { min: 280, max: Math.max(280, Math.min(560, workspaceWidth - 840)) };
}
