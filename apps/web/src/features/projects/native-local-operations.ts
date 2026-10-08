/** Tab-local IDs only: edits from another tab or MCP using the same actor are still remote. */
const sent = new Map<string, number>();
const key = (actor: string, project: string, operation: string) =>
  JSON.stringify([actor, project, operation]);
export function markNativeLocalOperation(
  actor: string,
  project: string,
  operation: string,
  now = Date.now(),
) {
  for (const [id, expires] of sent) if (expires <= now) sent.delete(id);
  const id = key(actor, project, operation);
  sent.delete(id);
  sent.set(id, now + 120_000);
  while (sent.size > 256) sent.delete(sent.keys().next().value!);
}
export function isNativeLocalOperation(
  actor: string,
  project: string,
  operation: string,
  now = Date.now(),
): boolean {
  const id = key(actor, project, operation),
    expires = sent.get(id);
  if (expires === undefined) return false;
  if (expires <= now) {
    sent.delete(id);
    return false;
  }
  return true;
}
