import {
  MAX_TABLE_CLIPBOARD_BYTES,
  nativeClipboardByteLength,
  nativeTableClipboardSchema,
  copyNativeTableClipboard,
  nativeClipboardObjectIds,
  nativeClipboardPasteCommandSchema,
  planNativeClipboardCommand,
  type NativeTableClipboard,
  type NativeClipboardPasteCommand,
  type ProjectDocumentState,
} from '@ezerd/contracts';
import {
  sharedDocument,
  normalizeSharedTableCanvas,
  requestFingerprint,
  type NativeDesignDocument,
} from '@ezerd/model';
import { nativeDurableId } from './native-durable-queue.js';

export function nativeClipboardSharedSource(snapshot: ProjectDocumentState): NativeDesignDocument {
  if (snapshot.sourceDocument.schemaVersion !== 2) throw Error('document.native-upgrade-required');
  return sharedDocument(snapshot.sourceDocument);
}
export function nativeClipboardCounts(file: NativeTableClipboard) {
  return Object.fromEntries(
    (['tables', 'columns', 'keys', 'tableRelations', 'indexes', 'checks', 'enums'] as const).map(
      (collection) => [collection, file.document[collection]?.length ?? 0],
    ),
  );
}
export function readNativeClipboard(text: string): NativeTableClipboard {
  if (nativeClipboardByteLength(text) > MAX_TABLE_CLIPBOARD_BYTES)
    throw Error('clipboard.size-limit');
  try {
    return nativeTableClipboardSchema.parse(JSON.parse(text));
  } catch (error) {
    if (error && typeof error === 'object' && 'issues' in error) {
      const issues = (error as { issues: { message: string }[] }).issues;
      const code = issues.find((issue) =>
        /^(clipboard|database|document|type|expression|index|check|foreign-key)\./.test(
          issue.message,
        ),
      )?.message;
      throw Error(code ?? 'clipboard.format-invalid');
    }
    throw Error('clipboard.format-invalid');
  }
}
export function copyNativeClipboard(snapshot: ProjectDocumentState, ids: readonly string[]) {
  const source = nativeClipboardSharedSource(snapshot);
  const prepared = normalizeSharedTableCanvas(source);
  const copied = copyNativeTableClipboard(prepared, ids, [], snapshot.project.id);
  return {
    ...copied,
    file: readNativeClipboard(copied.text),
    omittedRelations: (source.tableRelations ?? [])
      .filter((relation) => copied.omittedRelationIds.includes(relation.id))
      .map((relation) => relation.logical.name || relation.physical?.name || relation.id),
  };
}
export function prepareNativeClipboardPaste(
  snapshot: ProjectDocumentState,
  text: string,
  domainId: string | null,
  point: { x: number; y: number },
  newId: () => string = nativeDurableId,
) {
  const clipboard = readNativeClipboard(text);
  const command = nativeClipboardPasteCommandSchema.parse({
    type: 'paste_native_clipboard',
    clipboard,
    domainId,
    point,
    newIds: nativeClipboardObjectIds(clipboard).map(() => newId()),
  });
  return {
    command,
    plan: planNativeClipboardCommand(nativeClipboardSharedSource(snapshot), command),
  };
}
export function nativeClipboardReviewToken(
  snapshot: ProjectDocumentState,
  domainId: string,
  x: string,
  y: string,
) {
  // Exact text/remap equality is checked separately; no weak digest or secure-context crypto dependency.
  return requestFingerprint({
    actorProject: snapshot.project.id,
    version: snapshot.project.version,
    sequence: snapshot.sequence,
    databaseRevision: snapshot.project.databaseRevision,
    domainId,
    x,
    y,
  });
}
export const NATIVE_CLIPBOARD_CHUNKS = 20;
export function nativeClipboardDraftFields(text: string, prefix: string): Record<string, string> {
  if (text.length > MAX_TABLE_CLIPBOARD_BYTES) throw Error('clipboard.size-limit');
  return Object.fromEntries(
    Array.from({ length: NATIVE_CLIPBOARD_CHUNKS }, (_, index) => [
      `${prefix}${index}JSON`,
      text.slice(index * 100000, (index + 1) * 100000),
    ]),
  );
}
export function nativeClipboardDraftText(values: Record<string, string>, prefix: string) {
  return Array.from(
    { length: NATIVE_CLIPBOARD_CHUNKS },
    (_, index) => values[`${prefix}${index}JSON`] ?? '',
  ).join('');
}
export function reviewedNativeClipboardPaste(
  snapshot: ProjectDocumentState,
  values: Record<string, string>,
) {
  const text = nativeClipboardDraftText(values, 'clipboard'),
    clipboard = readNativeClipboard(text);
  let newIds: string[];
  try {
    newIds = JSON.parse(nativeClipboardDraftText(values, 'remap'));
  } catch {
    throw Error('clipboard.review-required');
  }
  if (
    nativeClipboardDraftText(values, 'reviewClipboard') !== text ||
    nativeClipboardDraftText(values, 'reviewRemap') !== nativeClipboardDraftText(values, 'remap') ||
    values.review !==
      nativeClipboardReviewToken(snapshot, values.domainId ?? '', values.x ?? '', values.y ?? '')
  )
    throw Error('clipboard.review-required');
  const command = nativeClipboardPasteCommandSchema.parse({
    type: 'paste_native_clipboard',
    clipboard,
    domainId: values.domainId || null,
    point: { x: Number(values.x), y: Number(values.y) },
    newIds,
  });
  const plan = planNativeClipboardCommand(nativeClipboardSharedSource(snapshot), command);
  if (!plan.canApply) throw Error('clipboard.policy-blocked');
  return { command, plan };
}
export function reviewedNativeClipboardCommand(
  snapshot: ProjectDocumentState,
  values: Record<string, string>,
): NativeClipboardPasteCommand {
  return reviewedNativeClipboardPaste(snapshot, values).command;
}
