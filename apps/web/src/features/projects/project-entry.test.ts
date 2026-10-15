import { it, describe, expect, vi } from 'vitest';
import {
  createEmptyDocument,
  createEmptyNativeDocument,
  defaultDatabaseContext,
} from '@ezerd/model';
import { projectEntry, loadProjectEntry } from './project-entry.js';
function snapshot(native = false) {
  const context = defaultDatabaseContext('mysql');
  const doc = createEmptyNativeDocument(context);
  return {
    protocolVersion: 2,
    project: {
      id: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      name: 'test',
      databaseKind: 'mysql',
      databaseProfileId: context.profileId,
      databaseRevision: 2,
      version: 9,
      status: 'active',
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    },
    sequence: 10,
    sourceDocument: native ? doc : createEmptyDocument(),
    native: { status: 'available', document: doc, migrationIssues: [], issues: [] },
  };
}
describe('versioned editor entry boundary', () => {
  it('rejects source-v1 even with an available native preview without mutating the source', () => {
    for (const status of ['available', 'unavailable'] as const) {
      for (const projectStatus of ['active', 'archived'] as const) {
        const state = snapshot();
        state.project.status = projectStatus;
        const input =
          status === 'available'
            ? state
            : {
                ...state,
                native: { status: 'unavailable', code: 'document.native-preview-invalid' },
              };
        const before = structuredClone(input);
        expect(() => projectEntry(input)).toThrow('v1 프로젝트');
        expect(input).toEqual(before);
      }
    }
  });
  it('rejects a fetched v1 project without starting any write or sync transport', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(snapshot()), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    try {
      await expect(loadProjectEntry('legacy-id')).rejects.toThrow('v1 프로젝트');
      expect(fetcher.mock.calls.length).toBe(1);
      for (const [url, init] of fetcher.mock.calls as unknown as [string, RequestInit][]) {
        expect(url).toMatch(/\/document-state$/);
        expect(init.method ?? 'GET').toBe('GET');
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('never projects source-v2 into a v1 document, including when preview/DB context is unavailable', () => {
    const state = snapshot(true);
    const entry = projectEntry(state);
    expect(entry.kind).toBe('native');
    if (entry.kind !== 'native') throw new Error('Expected native');
    expect(entry.document?.schemaVersion).toBe(2);
    expect(entry.document?.database.kind).toBe('mysql');
    const unavailable = projectEntry({
      ...state,
      native: { status: 'unavailable', code: 'document.native-preview-invalid' },
    });
    expect(unavailable).toMatchObject({ kind: 'native', document: null });
  });
  it('only fetches the shared snapshot; never starts baseline or operation transport', async () => {
    const fetcher = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith('/personal-state')
              ? {
                  version: 0,
                  projectVersion: 9,
                  syncSequence: 10,
                  state: { views: [], notes: [], nodes: [], viewports: [], relations: [] },
                }
              : snapshot(true),
          ),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetcher);
    try {
      expect((await loadProjectEntry('project-id')).kind).toBe('native');
      expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
        '/api/projects/project-id/document-state',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
