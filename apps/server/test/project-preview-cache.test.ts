import { describe, expect, it } from 'vitest';
import { ProjectPreviewCache } from '../src/workspace/project-preview-cache.js';

const head = {
  id: 'project',
  workspaceId: 'workspace',
  createdAt: new Date('2026-10-16T00:00:00Z'),
  updatedAt: new Date('2026-10-16T00:00:00Z'),
  version: 1,
  syncSequence: 1,
  databaseKind: 'postgresql' as const,
  databaseProfileId: 'postgresql-18-v1' as const,
  databaseRevision: 0,
};
const preview = { tableCount: 1, relationCount: 0, tables: [{ name: 'table', columns: [] }] };

describe('project preview cache', () => {
  it('clones stored and returned previews and checks every head component', () => {
    const cache = new ProjectPreviewCache();
    const source = structuredClone(preview);
    cache.set(head, source);
    source.tables[0]!.name = 'mutated';
    cache.get(head)!.tables[0]!.name = 'mutated again';
    expect(cache.get(head)).toEqual(preview);
    const changes = {
      id: 'other',
      workspaceId: 'other',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      version: 2,
      syncSequence: 2,
      databaseKind: 'mysql' as const,
      databaseProfileId: 'mysql-8.4-innodb-v1' as const,
      databaseRevision: 1,
    };
    for (const [field, value] of Object.entries(changes))
      expect(cache.get({ ...head, [field]: value }), field).toBeUndefined();
  });

  it('evicts least recently used entries by count and bytes and replaces old versions', () => {
    const cache = new ProjectPreviewCache(2);
    const second = { ...head, id: 'second' },
      third = { ...head, id: 'third' };
    cache.set(head, preview);
    cache.set(second, preview);
    cache.get(head);
    cache.set(third, preview);
    expect(cache.get(second)).toBeUndefined();
    expect(cache.get(head)).toEqual(preview);
    cache.set({ ...head, version: 2 }, preview);
    expect(cache.get(head)).toBeUndefined();
    expect(cache.get({ ...head, version: 2 })).toEqual(preview);
    const bytes = new ProjectPreviewCache(10, 350);
    bytes.set(head, preview);
    bytes.set(second, preview);
    expect(bytes.get(head)).toBeUndefined();
    expect(bytes.get(second)).toEqual(preview);
  });

  it('serves oversized previews without evicting useful entries', () => {
    const cache = new ProjectPreviewCache(10, 500);
    cache.set(head, preview);
    const oversized = { ...head, id: 'oversized' };
    cache.set(oversized, { ...preview, tables: [{ name: 'x'.repeat(1000), columns: [] }] });
    expect(cache.get(head)).toEqual(preview);
    expect(cache.get(oversized)).toBeUndefined();
    const disabled = new ProjectPreviewCache(0);
    disabled.set(head, preview);
    expect(disabled.get(head)).toBeUndefined();
  });
});
