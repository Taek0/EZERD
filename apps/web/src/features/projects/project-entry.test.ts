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
  it('keeps source-v1 on the old canonical editor even when the preview has native legacy diagnostics', () => {
    const state = snapshot();
    const source = state.sourceDocument as ReturnType<typeof createEmptyDocument>;
    source.tables = [
      {
        id: 't',
        domainId: null,
        scope: 'physical',
        logical: { name: '', definition: '' },
        physical: { name: 't', schema: 'public', comment: '' },
        customProperties: { common: {}, logical: {}, physical: {} },
      },
    ];
    source.columns = [
      {
        id: 'c',
        tableId: 't',
        scope: 'physical',
        logical: { name: '', definition: '', semanticType: '', required: false },
        physical: {
          name: 'c',
          type: { name: ' FLOAT4 ', isArray: false },
          nullable: true,
          defaultExpression: null,
          comment: '',
        },
        customProperties: { common: {}, logical: {}, physical: {} },
      },
    ];
    const before = structuredClone(state);
    const entry = projectEntry(state);
    expect(entry.kind).toBe('legacy');
    if (entry.kind !== 'legacy') throw new Error('Expected legacy');
    expect(entry.value.document.schemaVersion).toBe(1);
    expect(entry.value.document.columns![0]!.physical.type.name).toBe('real');
    expect(entry.value.document.layout.nodes[0]!.viewId).toBe('__tables__');
    expect(state).toEqual(before);
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
  it('merges only reconciled personal state and falls back safely on identity collisions', () => {
    const state = snapshot(true);
    state.native.document.domains = [{ id: 'd', name: '', description: '' }];
    state.sourceDocument = structuredClone(state.native.document);
    const personal = {
      version: 3,
      projectVersion: 9,
      syncSequence: 10,
      state: {
        views: [{ id: 'v', name: '', domainIds: ['d'] }],
        notes: [{ id: 'note', viewId: 'v', text: 'private' }],
        nodes: [],
        viewports: [],
        relations: [],
      },
    };
    const entry = projectEntry(state, personal);
    expect(entry).toMatchObject({
      kind: 'native',
      personalUnavailable: false,
      document: { notes: [{ text: 'private' }] },
    });
    personal.state.notes[0]!.id = 'd';
    expect(projectEntry(state, personal)).toMatchObject({
      kind: 'native',
      personalUnavailable: true,
      document: { notes: [] },
    });
    expect(state.native.document.notes).toEqual([]);
  });
  it('only fetches snapshot and own personal state; never starts baseline or operation transport', async () => {
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
        '/api/projects/project-id/personal-state',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
