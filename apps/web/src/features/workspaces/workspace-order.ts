export function moveWorkspace(ids: string[], id: string, index: number): string[] {
  if (!ids.includes(id)) return ids;
  const next = ids.filter((value) => value !== id);
  next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
  return next;
}

export function workspaceDropIndex(y: number, centres: number[]): number {
  const index = centres.findIndex((centre) => y < centre);
  return index < 0 ? centres.length : index;
}
