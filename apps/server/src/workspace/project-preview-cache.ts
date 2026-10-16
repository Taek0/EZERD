import type { ProjectRow } from '../db/schema.js';
import type { projectPreview } from './project-preview.js';

type ProjectHead = Pick<
  ProjectRow,
  | 'id'
  | 'workspaceId'
  | 'createdAt'
  | 'updatedAt'
  | 'version'
  | 'syncSequence'
  | 'databaseKind'
  | 'databaseProfileId'
  | 'databaseRevision'
>;
type Preview = ReturnType<typeof projectPreview>;

function headKey(head: ProjectHead) {
  return JSON.stringify([
    head.id,
    head.workspaceId,
    head.createdAt.toISOString(),
    head.updatedAt.toISOString(),
    head.version,
    head.syncSequence,
    head.databaseKind,
    head.databaseProfileId,
    head.databaseRevision,
  ]);
}

/** Preview only: callers must read current membership and project heads before lookup. */
export class ProjectPreviewCache {
  private readonly entries = new Map<string, { key: string; preview: Preview; bytes: number }>();
  private bytes = 0;

  constructor(
    private readonly maxEntries = 256,
    private readonly maxBytes = 1024 * 1024,
  ) {}

  get(head: ProjectHead): Preview | undefined {
    const entry = this.entries.get(head.id);
    if (!entry || entry.key !== headKey(head)) return undefined;
    this.entries.delete(head.id);
    this.entries.set(head.id, entry);
    return structuredClone(entry.preview);
  }

  set(head: ProjectHead, preview: Preview): void {
    const previous = this.entries.get(head.id);
    if (previous) {
      this.bytes -= previous.bytes;
      this.entries.delete(head.id);
    }
    const key = headKey(head);
    const bytes = Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(preview));
    // Large valid labels may be served without displacing every useful cache entry.
    if (this.maxEntries < 1 || bytes > this.maxBytes) return;
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
    this.entries.set(head.id, { key, preview: structuredClone(preview), bytes });
    this.bytes += bytes;
  }
}
