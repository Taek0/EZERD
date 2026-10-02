import { describe, it, expect, vi } from 'vitest';
import { createEmptyNativeDocument, defaultDatabaseContext } from '@ezerd/model';
import type { ProjectDDLExport, ProjectDocumentState } from '@ezerd/contracts';
import {
  assertNativeExportReady,
  fetchProjectDDL,
  confirmProjectDDLSnapshot,
} from './project-ddl-export.js';
import { storeNativeDraft } from './native-save.js';
import { request } from '../../shared/api/client.js';
const userId = '00000000-0000-4000-8000-000000000001',
  projectId = '00000000-0000-4000-8000-000000000002';
function store() {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
function exported(): ProjectDDLExport {
  return {
    projectId,
    projectName: 'Project',
    version: 2,
    sequence: 3,
    database: { ...defaultDatabaseContext('postgresql'), revision: 4 },
    documentSchemaVersion: 2,
    filename: 'Project.postgresql.sql',
    encoding: 'UTF-8',
    sql: 'CREATE TABLE "example" (id INTEGER);\n',
    canExport: true,
    issues: [],
  };
}
function state(): ProjectDocumentState {
  const document = createEmptyNativeDocument(defaultDatabaseContext('postgresql'));
  return {
    protocolVersion: 2,
    project: {
      id: projectId,
      workspaceId: userId,
      name: 'Project',
      status: 'active',
      version: 2,
      databaseKind: 'postgresql',
      databaseProfileId: 'postgresql-18-v1',
      databaseRevision: 4,
      createdAt: '2026-10-02T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
    },
    sequence: 3,
    sourceDocument: document,
    native: { status: 'available', document, migrationIssues: [], issues: [] },
  };
}
describe('DDL export uses a saved consistent project state', () => {
  it('blocks own unsaved inputs but ignores another user and project', () => {
    const storage = store(),
      values = { physicalName: 'id', comment: '', logicalName: 'ID', definition: '' };
    const draft = {
      userId,
      projectId,
      kind: 'column' as const,
      objectId: 'c',
      expected: { version: 2, sequence: 3, databaseRevision: 4 },
      before: values,
      values: { ...values, comment: 'Unsaved' },
    };
    storeNativeDraft({ ...draft, userId: '00000000-0000-4000-8000-000000000003' }, storage);
    expect(() => assertNativeExportReady(userId, projectId, storage)).not.toThrow();
    storeNativeDraft(draft, storage);
    expect(() => assertNativeExportReady(userId, projectId, storage)).toThrow(
      'project-export.unsaved-draft',
    );
    storeNativeDraft({ ...draft, values }, storage);
    expect(() => assertNativeExportReady(userId, projectId, storage)).not.toThrow();
  });
  it('keeps a damaged own draft rather than exporting old content', () => {
    const storage = store(),
      key = `ezerd.native.editor:${JSON.stringify([userId, projectId, 'column:c'])}`;
    storage.setItem(key, 'damaged');
    expect(() => assertNativeExportReady(userId, projectId, storage)).toThrow();
    expect(storage.getItem(key)).toBe('damaged');
  });
  it('refuses a different project or DB revision before showing the generated file', async () => {
    const api = vi.fn().mockResolvedValue(exported());
    expect(await fetchProjectDDL(projectId, 4, api as typeof request)).toEqual(exported());
    await expect(fetchProjectDDL(projectId, 5, api as typeof request)).rejects.toThrow(
      'database.context-changed',
    );
    api.mockResolvedValue({ ...exported(), projectId: userId });
    await expect(fetchProjectDDL(projectId, 4, api as typeof request)).rejects.toThrow();
  });
  it('rechecks version, sequence and profile/revision before any download', async () => {
    const api = vi.fn().mockResolvedValue(state());
    await confirmProjectDDLSnapshot(exported(), api as typeof request);
    const changed = state();
    changed.sequence = 4;
    api.mockResolvedValue(changed);
    await expect(confirmProjectDDLSnapshot(exported(), api as typeof request)).rejects.toThrow(
      'ddl.snapshot-changed',
    );
    const revision = state();
    revision.project.databaseRevision = 5;
    api.mockResolvedValue(revision);
    await expect(confirmProjectDDLSnapshot(exported(), api as typeof request)).rejects.toThrow(
      'ddl.snapshot-changed',
    );
  });
  it('never fetches a download confirmation for a failed or empty export', async () => {
    const api = vi.fn();
    await expect(
      confirmProjectDDLSnapshot(
        { ...exported(), canExport: false, sql: '' },
        api as typeof request,
      ),
    ).rejects.toThrow('ddl.export-blocked');
    expect(api).not.toHaveBeenCalled();
  });
});
