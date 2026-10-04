import {
  projectDocumentStateSchema,
  projectDatabaseChangeResultSchema,
  userSchema,
} from '@ezerd/contracts';
import { requestFingerprint } from '@ezerd/model';
import type { NativeGalleryConversionPlan } from './native-gallery-conversion.js';
import type { ProjectDocumentState, ProjectDatabaseChangeResult } from '@ezerd/contracts';

export interface GalleryConversionArchive {
  formatVersion: 1;
  outcome: 'accepted' | 'unconfirmed';
  savedAt: string;
  plan: NativeGalleryConversionPlan;
  ack: ProjectDatabaseChangeResult | null;
  fresh: ProjectDocumentState;
}
const prefix = 'ezerd.native.database-change.archive:';
const key = (record: GalleryConversionArchive) =>
  prefix +
  JSON.stringify([
    record.plan.userId,
    record.plan.projectId,
    record.plan.input.operationId,
    record.outcome,
  ]);
function parse(raw: string): GalleryConversionArchive {
  const record = JSON.parse(raw) as GalleryConversionArchive;
  if (
    !record ||
    typeof record !== 'object' ||
    record.formatVersion !== 1 ||
    Object.keys(record).sort().join(',') !== 'ack,formatVersion,fresh,outcome,plan,savedAt' ||
    !['accepted', 'unconfirmed'].includes(record.outcome) ||
    (record.outcome === 'accepted') !== (record.ack !== null)
  )
    throw Error('database.change-archive-invalid');
  userSchema.shape.createdAt.parse(record.savedAt);
  projectDocumentStateSchema.parse(record.fresh);
  if (record.ack !== null) projectDatabaseChangeResultSchema.parse(record.ack);
  return record;
}
/** Called synchronously inside the exact queue fence. Failure prevents queue release. */
export function retainGalleryConversionArchive(
  record: GalleryConversionArchive,
  storage: Storage,
): GalleryConversionArchive {
  const target = key(record),
    previous = storage.getItem(target);
  if (previous !== null) {
    const stored = parse(previous);
    if (
      key(stored) !== target ||
      requestFingerprint(stored.plan) !== requestFingerprint(record.plan) ||
      requestFingerprint(stored.ack) !== requestFingerprint(record.ack)
    )
      throw Error('database.change-archive-conflict');
    return stored;
  }
  const text = JSON.stringify(record);
  storage.setItem(target, text);
  if (storage.getItem(target) !== text) throw Error('database.change-archive-unavailable');
  return parse(text);
}
/** Only this actor/project is read; malformed own evidence is retained and blocks recovery. */
export function galleryConversionArchives(
  userId: string,
  projectId: string,
  storage: Storage,
): GalleryConversionArchive[] {
  const ownPrefix = prefix + JSON.stringify([userId, projectId]).slice(0, -1) + ',';
  const result: GalleryConversionArchive[] = [];
  for (let i = 0; i < storage.length; i++) {
    const entry = storage.key(i);
    if (!entry?.startsWith(ownPrefix)) continue;
    const raw = storage.getItem(entry);
    if (raw === null) throw Error('database.change-archive-unavailable');
    const record = parse(raw);
    if (
      key(record) !== entry ||
      record.plan.userId !== userId ||
      record.plan.projectId !== projectId
    )
      throw Error('database.change-archive-invalid');
    result.push(record);
  }
  return result.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
