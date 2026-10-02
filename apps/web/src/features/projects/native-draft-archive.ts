import { nativeEditorDraftSchema, nativePropertyDraftSchema } from '@ezerd/contracts';
import { requestFingerprint } from '@ezerd/model';
import { nativeDurableId } from './native-durable-queue.js';
import {
  nativeDraftStorage,
  getNativeMemoryDraft,
  forgetNativeMemoryDraft,
  retainNativeMemoryDraft,
  type NativeDraftStorage,
} from './native-durable-drafts.js';

export type NativeDraftCategory = 'editor' | 'property';
type Draft =
  | ReturnType<typeof nativeEditorDraftSchema.parse>
  | ReturnType<typeof nativePropertyDraftSchema.parse>;
export interface NativeDraftArchiveEntry {
  formatVersion: 1;
  entryId: string;
  writerId: string;
  userId: string;
  projectId: string;
  category: NativeDraftCategory;
  logicalKey: string;
  revision: string;
  savedAt: string;
  draft: Draft;
  recoveredFrom?: string;
}
const prefix = 'ezerd.native.archive:',
  headPrefix = 'ezerd.native.archive-head:';
const ackPrefix = 'ezerd.native.archive-ack:';
const dismissedPrefix = 'ezerd.native.archive-dismissed:';
let runtimeWriter: string | undefined;
export const nativeDraftWriterId = () => (runtimeWriter ??= nativeDurableId());
const registries = new WeakMap<object, Set<string>>();
const registry = (storage: object) => {
  let known = registries.get(storage);
  if (!known) {
    known = new Set();
    registries.set(storage, known);
  }
  return known;
};
function keys(storage: NativeDraftStorage): string[] {
  const enumerable = storage as NativeDraftStorage & Partial<Pick<Storage, 'length' | 'key'>>;
  const found = new Set(registry(storage));
  if (typeof enumerable.length === 'number' && typeof enumerable.key === 'function')
    for (let i = 0; i < enumerable.length; i++) {
      const key = enumerable.key(i);
      if (key) found.add(key);
    }
  return [...found];
}
export interface NativeDraftRecoveryRecord {
  storageKey: string;
  raw: string;
  legacy: boolean;
  entry?: NativeDraftArchiveEntry;
}
const legacyKey = (
  userId: string,
  projectId: string,
  category: NativeDraftCategory,
  logicalKey: string,
) =>
  category === 'editor'
    ? 'ezerd.native.editor:' + JSON.stringify([userId, projectId, logicalKey])
    : 'ezerd.native.draft:' + JSON.stringify([userId, projectId, ...JSON.parse(logicalKey)]);
const dismissalKey = (writer: string, key: string, raw: string) =>
  dismissedPrefix + JSON.stringify([writer, key, requestFingerprint(raw)]);
const recordKey = (
  entry: Pick<NativeDraftArchiveEntry, 'userId' | 'projectId' | 'writerId' | 'entryId'>,
) => prefix + JSON.stringify([entry.userId, entry.projectId, entry.writerId, entry.entryId]);
const headKey = (
  userId: string,
  projectId: string,
  category: NativeDraftCategory,
  key: string,
  writer: string,
) => headPrefix + JSON.stringify([userId, projectId, category, key, writer]);
export const nativePropertyArchiveKey = (kind: string, objectId: string) =>
  JSON.stringify([kind, objectId]);
function parse(raw: string): NativeDraftArchiveEntry {
  const value = JSON.parse(raw) as NativeDraftArchiveEntry;
  if (
    value.formatVersion !== 1 ||
    typeof value.entryId !== 'string' ||
    typeof value.writerId !== 'string' ||
    typeof value.logicalKey !== 'string' ||
    typeof value.revision !== 'string' ||
    typeof value.savedAt !== 'string' ||
    !['editor', 'property'].includes(value.category)
  )
    throw Error('native.draft-invalid');
  const draft =
    value.category === 'editor'
      ? nativeEditorDraftSchema.parse(value.draft)
      : nativePropertyDraftSchema.parse(value.draft);
  if (
    draft.userId !== value.userId ||
    draft.projectId !== value.projectId ||
    (value.category === 'editor'
      ? 'key' in draft && (draft.key !== value.logicalKey || draft.revision !== value.revision)
      : 'kind' in draft &&
        nativePropertyArchiveKey(draft.kind, draft.objectId) !== value.logicalKey)
  )
    throw Error('native.draft-invalid');
  return structuredClone(value);
}

/** Snapshots have unique keys. The only overwritten pointer belongs to this document's writer. */
export class NativeDraftArchive {
  constructor(
    readonly storage: NativeDraftStorage,
    readonly writerId = nativeDraftWriterId(),
  ) {}
  legacy(userId: string, projectId: string, category: NativeDraftCategory, logicalKey: string) {
    const key = legacyKey(userId, projectId, category, logicalKey),
      raw = this.storage.getItem(key);
    registry(this.storage).add(key);
    if (raw === null || this.storage.getItem(dismissalKey(this.writerId, key, raw)) !== null)
      return null;
    // Legacy evidence is validated, but never adopted, overwritten or removed by a normal form.
    const draft =
      category === 'editor'
        ? nativeEditorDraftSchema.parse(JSON.parse(raw))
        : nativePropertyDraftSchema.parse(JSON.parse(raw));
    if (
      draft.userId !== userId ||
      draft.projectId !== projectId ||
      ('key' in draft ? draft.key : nativePropertyArchiveKey(draft.kind, draft.objectId)) !==
        logicalKey
    )
      throw Error('native.draft-invalid');
    return draft;
  }
  dismissLegacy(
    userId: string,
    projectId: string,
    category: NativeDraftCategory,
    logicalKey: string,
  ) {
    const key = legacyKey(userId, projectId, category, logicalKey),
      raw = this.storage.getItem(key);
    registry(this.storage).add(key);
    if (raw !== null) this.dismiss(userId, projectId, { storageKey: key, raw, legacy: true });
  }
  reset(userId: string, projectId: string, category: NativeDraftCategory, logicalKey: string) {
    const head = headKey(userId, projectId, category, logicalKey, this.writerId);
    const pointer = this.storage.getItem(head);
    if (pointer !== null && this.ownsRecordKey(userId, projectId, pointer)) {
      const record = this.records(userId, projectId).find((value) => value.storageKey === pointer);
      if (record) this.dismiss(userId, projectId, record);
    }
    this.dismissLegacy(userId, projectId, category, logicalKey);
    this.storage.removeItem(head);
    if (this.storage.getItem(head) !== null) throw Error('native.draft-storage-failed');
  }
  private ownsRecordKey(userId: string, projectId: string, key: string) {
    if (!key.startsWith(prefix)) return false;
    try {
      const scope: unknown = JSON.parse(key.slice(prefix.length));
      return (
        Array.isArray(scope) &&
        scope.length === 4 &&
        scope[0] === userId &&
        scope[1] === projectId &&
        scope[2] === this.writerId
      );
    } catch {
      return false;
    }
  }
  records(userId: string, projectId: string): NativeDraftRecoveryRecord[] {
    const result: NativeDraftRecoveryRecord[] = [];
    for (const key of keys(this.storage)) {
      const start = [prefix, 'ezerd.native.editor:', 'ezerd.native.draft:'].find((p) =>
        key.startsWith(p),
      );
      if (!start) continue;
      let scope: unknown;
      try {
        scope = JSON.parse(key.slice(start.length));
      } catch {
        continue;
      }
      if (!Array.isArray(scope) || scope[0] !== userId || scope[1] !== projectId) continue;
      const raw = this.storage.getItem(key);
      if (raw === null) continue;
      const legacy = start !== prefix;
      if (legacy && this.storage.getItem(dismissalKey(this.writerId, key, raw)) !== null) continue;
      let entry: NativeDraftArchiveEntry | undefined;
      try {
        if (!legacy) {
          entry = parse(raw);
          if (recordKey(entry) !== key) entry = undefined;
        } else {
          const category = start === 'ezerd.native.editor:' ? 'editor' : 'property';
          const draft =
            category === 'editor'
              ? nativeEditorDraftSchema.parse(JSON.parse(raw))
              : nativePropertyDraftSchema.parse(JSON.parse(raw));
          const logicalKey =
            category === 'editor' ? String(scope[2]) : JSON.stringify(scope.slice(2));
          if (legacyKey(draft.userId, draft.projectId, category, logicalKey) !== key)
            throw Error('native.draft-invalid');
          entry = {
            formatVersion: 1,
            entryId: key,
            writerId: 'legacy',
            userId,
            projectId,
            category,
            logicalKey,
            revision: 'revision' in draft ? draft.revision : 'legacy',
            savedAt: '',
            draft,
          };
        }
      } catch {
        /* Corrupt source bytes remain downloadable and explicitly discardable. */
      }
      result.push({ storageKey: key, raw, legacy, ...(entry ? { entry } : {}) });
    }
    return result;
  }
  private verifyRecord(userId: string, projectId: string, record: NativeDraftRecoveryRecord) {
    const live = this.records(userId, projectId).find(
      (value) => value.storageKey === record.storageKey,
    );
    if (!live || live.raw !== record.raw) throw Error('native.draft-changed');
    return live;
  }
  dismiss(userId: string, projectId: string, record: NativeDraftRecoveryRecord) {
    this.verifyRecord(userId, projectId, record);
    if (record.legacy) {
      // A content-addressed per-writer dismissal never races a legacy tab's new write.
      const key = dismissalKey(this.writerId, record.storageKey, record.raw);
      this.storage.setItem(key, 'dismissed');
      if (this.storage.getItem(key) !== 'dismissed') throw Error('native.draft-storage-failed');
    } else {
      this.storage.removeItem(record.storageKey);
      if (this.storage.getItem(record.storageKey) !== null)
        throw Error('native.draft-storage-failed');
      if (record.entry) forgetMatchingMemory(record.entry, this.storage);
    }
  }
  recoverRecord(userId: string, projectId: string, record: NativeDraftRecoveryRecord) {
    const entry = this.verifyRecord(userId, projectId, record).entry;
    if (!entry) throw Error('native.draft-invalid');
    const draft = structuredClone(entry.draft);
    if ('revision' in draft) draft.revision = nativeDurableId();
    const memoryKey = legacyKey(userId, projectId, entry.category, entry.logicalKey);
    const memory = getNativeMemoryDraft<Draft>(memoryKey, this.storage);
    // Recovery must first preserve even an input whose previous write hit quota.
    if (this.writerId === nativeDraftWriterId() && memory)
      this.store(entry.category, entry.logicalKey, memory);
    const recovered = this.store(entry.category, entry.logicalKey, draft, entry.entryId);
    if (this.writerId === nativeDraftWriterId())
      retainNativeMemoryDraft(memoryKey, draft, false, this.storage);
    return recovered;
  }
  read(userId: string, projectId: string, category: NativeDraftCategory, logicalKey: string) {
    const pointer = this.storage.getItem(
      headKey(userId, projectId, category, logicalKey, this.writerId),
    );
    if (pointer === null) return null;
    if (!this.ownsRecordKey(userId, projectId, pointer)) throw Error('native.draft-invalid');
    const raw = this.storage.getItem(pointer);
    if (raw === null) return null; // An explicitly discarded snapshot may leave a harmless pointer.
    const entry = parse(raw);
    if (
      entry.userId !== userId ||
      entry.projectId !== projectId ||
      entry.writerId !== this.writerId ||
      entry.category !== category ||
      entry.logicalKey !== logicalKey ||
      recordKey(entry) !== pointer
    )
      throw Error('native.draft-invalid');
    return entry;
  }
  store(category: NativeDraftCategory, logicalKey: string, draft: Draft, recoveredFrom?: string) {
    const checked =
      category === 'editor'
        ? nativeEditorDraftSchema.parse(draft)
        : nativePropertyDraftSchema.parse(draft);
    if (
      ('key' in checked
        ? checked.key
        : nativePropertyArchiveKey(checked.kind, checked.objectId)) !== logicalKey
    )
      throw Error('native.draft-invalid');
    const current = this.read(draft.userId, draft.projectId, category, logicalKey);
    if (
      current &&
      requestFingerprint(current.draft) === requestFingerprint(draft) &&
      !recoveredFrom
    )
      return current;
    const entry: NativeDraftArchiveEntry = {
      formatVersion: 1,
      entryId: nativeDurableId(),
      writerId: this.writerId,
      userId: checked.userId,
      projectId: checked.projectId,
      category,
      logicalKey,
      revision: category === 'editor' && 'revision' in draft ? draft.revision : nativeDurableId(),
      savedAt: new Date().toISOString(),
      draft: structuredClone(draft),
      ...(recoveredFrom ? { recoveredFrom } : {}),
    };
    const key = recordKey(entry),
      raw = JSON.stringify(entry);
    registry(this.storage).add(key);
    this.storage.setItem(key, raw);
    if (this.storage.getItem(key) !== raw) throw Error('native.draft-storage-failed');
    const head = headKey(entry.userId, entry.projectId, category, logicalKey, this.writerId);
    this.storage.setItem(head, key);
    if (this.storage.getItem(head) !== key) throw Error('native.draft-storage-failed');
    return entry;
  }
  entries(userId: string, projectId: string): NativeDraftArchiveEntry[] {
    const result: NativeDraftArchiveEntry[] = [];
    for (const key of keys(this.storage)) {
      if (!key.startsWith(prefix)) continue;
      const scope: unknown[] = JSON.parse(key.slice(prefix.length));
      if (scope[0] !== userId || scope[1] !== projectId) continue;
      const raw = this.storage.getItem(key);
      if (raw === null) continue;
      const entry = parse(raw);
      if (recordKey(entry) !== key || entry.userId !== userId || entry.projectId !== projectId)
        throw Error('native.draft-invalid');
      result.push(entry);
    }
    return result.sort(
      (a, b) => a.savedAt.localeCompare(b.savedAt) || a.entryId.localeCompare(b.entryId),
    );
  }
  discard(userId: string, projectId: string, entry: NativeDraftArchiveEntry) {
    if (entry.userId !== userId || entry.projectId !== projectId)
      throw Error('native.draft-actor-mismatch');
    const key = recordKey(entry),
      raw = this.storage.getItem(key);
    if (raw === null) return;
    if (requestFingerprint(parse(raw)) !== requestFingerprint(entry))
      throw Error('native.draft-changed');
    this.storage.removeItem(key);
    if (this.storage.getItem(key) !== null) throw Error('native.draft-storage-failed');
  }
  recover(userId: string, projectId: string, entry: NativeDraftArchiveEntry) {
    if (entry.userId !== userId || entry.projectId !== projectId)
      throw Error('native.draft-actor-mismatch');
    const raw = this.storage.getItem(recordKey(entry));
    if (raw === null || requestFingerprint(parse(raw)) !== requestFingerprint(entry))
      throw Error('native.draft-changed');
    const draft = structuredClone(entry.draft);
    if ('revision' in draft) draft.revision = nativeDurableId();
    return this.store(entry.category, entry.logicalKey, draft, entry.entryId);
  }
}
function forgetMatchingMemory(entry: NativeDraftArchiveEntry, storage: NativeDraftStorage) {
  // A later snapshot with identical text still has its own archive identity.
  const archive = new NativeDraftArchive(storage, entry.writerId);
  const current = archive.read(entry.userId, entry.projectId, entry.category, entry.logicalKey);
  if (entry.writerId !== nativeDraftWriterId() || (current && current.entryId !== entry.entryId))
    return;
  const key = legacyKey(entry.userId, entry.projectId, entry.category, entry.logicalKey);
  const memory = getNativeMemoryDraft(key, storage);
  if (requestFingerprint(memory) === requestFingerprint(entry.draft))
    forgetNativeMemoryDraft(key, storage);
}
export const nativeDraftArchive = (storage?: NativeDraftStorage) =>
  new NativeDraftArchive(nativeDraftStorage(storage));

/** Wire DTOs stay unchanged. This immutable local evidence identifies the exact staged inputs. */
export function preserveNativeDraftAckSources(
  userId: string,
  projectId: string,
  operationId: string,
  request: unknown,
  entries: NativeDraftArchiveEntry[],
  storage?: NativeDraftStorage,
) {
  if (!entries.length) return;
  if (
    entries.some(
      (entry) =>
        entry.userId !== userId ||
        entry.projectId !== projectId ||
        entry.writerId !== nativeDraftWriterId(),
    )
  )
    throw Error('native.draft-actor-mismatch');
  const target = nativeDraftStorage(storage),
    key = ackPrefix + JSON.stringify([userId, projectId, operationId]);
  const raw = JSON.stringify({
    userId,
    projectId,
    operationId,
    fingerprint: requestFingerprint(request),
    entries,
  });
  const existing = target.getItem(key);
  if (existing !== null && existing !== raw) throw Error('native.draft-changed');
  target.setItem(key, raw);
  if (target.getItem(key) !== raw) throw Error('native.draft-storage-failed');
}
export function consumeNativeDraftAckSources(
  userId: string,
  projectId: string,
  operationId: string,
  request: unknown,
  storage?: NativeDraftStorage,
) {
  const archive = nativeDraftArchive(storage),
    key = ackPrefix + JSON.stringify([userId, projectId, operationId]),
    raw = archive.storage.getItem(key);
  if (raw === null) return false;
  const evidence = JSON.parse(raw) as {
    userId: string;
    projectId: string;
    operationId: string;
    fingerprint: string;
    entries: NativeDraftArchiveEntry[];
  };
  if (
    evidence.userId !== userId ||
    evidence.projectId !== projectId ||
    evidence.operationId !== operationId ||
    evidence.fingerprint !== requestFingerprint(request) ||
    !Array.isArray(evidence.entries)
  )
    throw Error('native.ack-mismatch');
  for (const entry of evidence.entries) {
    archive.discard(userId, projectId, entry);
    forgetMatchingMemory(entry, archive.storage);
  }
  archive.storage.removeItem(key);
  if (archive.storage.getItem(key) !== null) throw Error('native.draft-storage-failed');
  return true;
}
