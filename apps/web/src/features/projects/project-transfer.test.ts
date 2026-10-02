import { describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, addDomain, addNote } from '@ezerd/model';
import {
  parseProjectTransfer,
  projectTransferFilename,
  importProjectTransfer,
  projectTransferGuard,
} from './project-transfer.js';
import {
  transferState,
  transferEnvelope,
  transferActor,
  transferWorkspace,
} from './native-transfer-test-fixtures.js';
import { ApiError } from '../../shared/api/client.js';

const document = addNote(
  addDomain(createEmptyDocument(), { id: 'domain', name: '', description: '' }, { x: 1, y: 2 }),
  { id: 'note', viewId: 'domain', text: '메모', color: '#fedcba' },
  { x: 5, y: 6 },
);
const file = {
  format: 'ezerd-project',
  formatVersion: 1,
  exportedAt: '2026-09-17T00:00:00.000Z',
  project: { name: '가져오기' },
  document,
};
describe('project file selection', () => {
  it('preserves a valid design including unfinished names, layout, notes, and identities', () => {
    expect(parseProjectTransfer(JSON.stringify(file))).toEqual(file);
  });
  it('rejects malformed JSON, future versions, unknown private fields, and broken references', () => {
    expect(() => parseProjectTransfer('{')).toThrow('JSON');
    expect(() => parseProjectTransfer(JSON.stringify({ ...file, formatVersion: 3 }))).toThrow(
      '버전',
    );
    expect(() => parseProjectTransfer(JSON.stringify({ ...file, pin: '1234' }))).toThrow('형식');
    expect(() =>
      parseProjectTransfer(JSON.stringify({ ...file, document: { ...document, domains: [] } })),
    ).toThrow('설계');
  });
  it('limits raw UTF-8 file size including whitespace before parsing', () => {
    expect(() => parseProjectTransfer(' '.repeat(2_000_001))).toThrow('2 MB');
    expect(() => parseProjectTransfer('한'.repeat(700_000))).toThrow('2 MB');
  });
  it('creates safe download filenames', () => {
    expect(projectTransferFilename('a/b:c')).toBe('a_b_c.ezerd.json');
    expect(projectTransferFilename('')).toBe('project.ezerd.json');
  });
});
describe('versioned JSON transfer', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'preserves the complete %s native graph and context',
    (kind) => {
      const native = transferEnvelope(transferState(kind));
      expect(parseProjectTransfer(JSON.stringify(native))).toEqual(native);
      expect(
        parseProjectTransfer(
          JSON.stringify({
            format: native.format,
            formatVersion: 2,
            exportedAt: native.exportedAt,
            project: native.project,
            document: native.sourceDocument,
          }),
        ),
      ).toMatchObject({ document: native.sourceDocument });
    },
  );
  it('preserves v1 source aliases and separately labelled migration evidence in format2', () => {
    const native = transferEnvelope(transferState('mysql', 1));
    expect(parseProjectTransfer(JSON.stringify(native))).toEqual(native);
    expect(native.sourceDocument.columns?.[0]?.physical.type).toEqual({
      name: 'int4',
      isArray: false,
    });
    expect(
      native.native.status === 'available' && native.native.migrationIssues.length,
    ).toBeGreaterThan(0);
  });
  it('rejects broken AST references, missing full contracts and mixed DB/profile contexts', () => {
    const native = transferEnvelope();
    const broken = structuredClone(native);
    if (broken.sourceDocument.schemaVersion === 2) broken.sourceDocument.columns = [];
    expect(() => parseProjectTransfer(JSON.stringify(broken))).toThrow('설계');
    expect(() =>
      parseProjectTransfer(
        JSON.stringify({ ...native, project: { ...native.project, databaseKind: 'mysql' } }),
      ),
    ).toThrow('형식');
    expect(() =>
      parseProjectTransfer(JSON.stringify({ ...native, source: { projectId: 'private' } })),
    ).toThrow('형식');
  });
  it('uses native endpoint, preserves DB fields on rename and parses all returned metadata', async () => {
    const native = transferEnvelope(transferState('mysql'));
    const project = {
      ...transferState('mysql').project,
      name: 'Renamed',
      version: 1,
      databaseRevision: 0,
    };
    const api = vi.fn(async (_url: string, _init?: RequestInit) => ({
      project,
      sequence: 0,
      migrationIssues: [],
      issues: [],
    }));
    expect(
      await importProjectTransfer(native, ' Renamed ', transferWorkspace, {
        userId: transferActor,
        api,
      }),
    ).toEqual(project);
    expect(api.mock.calls[0]?.[0]).toBe('/api/projects/native-transfer/import');
    const input = JSON.parse(String(api.mock.calls[0]?.[1]?.body));
    expect(input.transfer).toEqual({ ...native, project: { ...native.project, name: 'Renamed' } });
  });
  it('keeps the legacy endpoint and defaults compatible for a format1 file', async () => {
    const project = transferState().project;
    const api = vi.fn(async (_url: string, _init?: RequestInit) => project);
    await expect(
      importProjectTransfer(
        parseProjectTransfer(JSON.stringify(file)),
        'Legacy',
        transferWorkspace,
        {
          userId: transferActor,
          api,
        },
      ),
    ).resolves.toEqual(project);
    expect(api.mock.calls[0]?.[0]).toBe('/api/projects/import');
  });
  it('retains source evidence after a server-denied native import response', async () => {
    const native = transferEnvelope(transferState('mysql'));
    const before = JSON.stringify(native);
    const api = async () => {
      throw new ApiError(403, 'database.feature-unavailable');
    };
    await expect(
      importProjectTransfer(native, 'Retained', transferWorkspace, { userId: transferActor, api }),
    ).rejects.toThrow('unavailable');
    expect(JSON.stringify(native)).toBe(before);
  });
  it('rejects wrong workspace, malformed metadata and drops account-changed responses', async () => {
    const native = transferEnvelope();
    const project = transferState().project;
    await expect(
      importProjectTransfer(native, 'x', transferWorkspace, {
        userId: transferActor,
        api: async () => ({
          project: { ...project, workspaceId: transferActor },
          sequence: 0,
          migrationIssues: [],
          issues: [],
        }),
      }),
    ).rejects.toThrow('context');
    await expect(
      importProjectTransfer(native, 'x', transferWorkspace, {
        userId: transferActor,
        api: async () => ({
          project: { id: project.id },
          sequence: 0,
          migrationIssues: [],
          issues: [],
        }),
      }),
    ).rejects.toThrow();
    let actor = transferActor;
    const scope = { userId: actor, workspaceId: transferWorkspace };
    const assertCurrent = projectTransferGuard(
      { scope, currentScope: () => ({ ...scope, userId: actor }) },
      () => undefined,
    );
    await expect(
      importProjectTransfer(native, 'x', transferWorkspace, {
        userId: transferActor,
        assertCurrent,
        api: async () => {
          actor = 'different';
          return { project, sequence: 0, migrationIssues: [], issues: [] };
        },
      }),
    ).rejects.toThrow('대상');
  });
});
