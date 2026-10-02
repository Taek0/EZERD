import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeDocumentPhysicalTypes, normalizeSharedTableCanvas } from '@ezerd/model';
import {
  exportCurrentProjectFile,
  exportVersionedProjectFile,
  downloadProjectTransfer,
} from './project-versioned-export.js';
import {
  transferState,
  transferEnvelope,
  transferControl,
  transferProject,
  transferActor,
  transferWorkspace,
  transferStorage,
} from './native-transfer-test-fixtures.js';
import type { ProjectDocumentState } from '@ezerd/contracts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const ready = async () => undefined;
function transport(state = transferState(), confirmed: ProjectDocumentState = state) {
  let reads = 0;
  const file = transferEnvelope(state);
  const api = vi.fn(async (url: string) => {
    if (url.endsWith('/document-state')) return ++reads === 1 ? state : confirmed;
    if (url.endsWith('/native-transfer')) return file;
    if (url.endsWith('/export') && state.sourceDocument.schemaVersion === 1)
      return {
        format: 'ezerd-project',
        formatVersion: 1,
        exportedAt: file.exportedAt,
        project: { name: state.project.name, databaseKind: state.project.databaseKind },
        document: normalizeSharedTableCanvas(normalizeDocumentPhysicalTypes(state.sourceDocument)),
      };
    throw Error(url);
  });
  return { api, file };
}
describe('fresh server JSON export', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'selects complete native format2 from fresh %s state',
    async (kind) => {
      const { api, file } = transport(transferState(kind));
      const download = vi.fn();
      await exportCurrentProjectFile(transferProject, {
        api,
        control: transferControl(),
        assertReady: ready,
        download,
      });
      expect(api.mock.calls.map(([url]) => url.split('/').at(-1))).toEqual([
        'document-state',
        'native-transfer',
        'document-state',
      ]);
      expect(download.mock.calls[0]?.[0]).toEqual(file);
      expect(file.sourceDocument.schemaVersion).toBe(2);
      expect(file.sourceDocument.schemaVersion === 2 && file.sourceDocument.checks).toHaveLength(1);
    },
  );
  it('keeps format1 server export compatible and allows explicit v1 versioned backup', async () => {
    const state = transferState('postgresql', 1);
    const { api } = transport(state);
    const download = vi.fn();
    await exportCurrentProjectFile(transferProject, {
      api,
      control: transferControl(),
      assertReady: ready,
      download,
    });
    expect(download.mock.calls[0]?.[0].formatVersion).toBe(1);
    const versioned = transport(state);
    await exportVersionedProjectFile(transferProject, state.project.databaseRevision, {
      api: versioned.api,
      control: transferControl(),
      assertReady: ready,
      download,
    });
    expect(download.mock.calls[1]?.[0]).toEqual(versioned.file);
    expect(versioned.file.sourceDocument.schemaVersion).toBe(1);
  });
  it.each(['version', 'sequence', 'databaseRevision', 'status'] as const)(
    'drops files after %s changes during export',
    async (field) => {
      const state = transferState(),
        current = structuredClone(state);
      if (field === 'sequence') current.sequence++;
      else if (field === 'status') current.project.status = 'archived';
      else current.project[field]++;
      const { api } = transport(state, current),
        download = vi.fn();
      await expect(
        exportCurrentProjectFile(transferProject, {
          api,
          control: transferControl(),
          assertReady: ready,
          download,
        }),
      ).rejects.toThrow('changed');
      expect(download).not.toHaveBeenCalled();
    },
  );
  it('rejects mismatched export coordinates and incomplete project metadata', async () => {
    const state = transferState(),
      file = transferEnvelope(state),
      download = vi.fn();
    const api = async (url: string) =>
      url.endsWith('/document-state') ? state : { ...file, source: { ...file.source, version: 0 } };
    await expect(
      exportCurrentProjectFile(transferProject, {
        api,
        control: transferControl(),
        assertReady: ready,
        download,
      }),
    ).rejects.toThrow('changed');
    await expect(
      exportCurrentProjectFile(transferProject, {
        api: async () => ({ ...state, project: { id: transferProject } }),
        control: transferControl(),
        assertReady: ready,
        download,
      }),
    ).rejects.toThrow();
    await expect(
      exportVersionedProjectFile(transferProject, 0, {
        api,
        control: transferControl(),
        assertReady: ready,
        download,
      }),
    ).rejects.toThrow('context-changed');
    expect(download).not.toHaveBeenCalled();
  });
  it.each(['userId', 'workspaceId', 'projectId'] as const)(
    'drops a file when visible %s changes across awaits',
    async (field) => {
      const control = transferControl();
      let current = { ...control.scope };
      control.currentScope = () => current;
      const { api: base } = transport();
      const api = async (url: string) => {
        const result = await base(url);
        if (url.endsWith('/native-transfer')) current = { ...current, [field]: 'changed' };
        return result;
      };
      const download = vi.fn();
      await expect(
        exportCurrentProjectFile(transferProject, { api, control, assertReady: ready, download }),
      ).rejects.toThrow('대상');
      expect(download).not.toHaveBeenCalled();
    },
  );
  it('awaits durable readiness before reading and again immediately before downloading', async () => {
    const { api } = transport(),
      download = vi.fn();
    let calls = 0;
    const assertReady = vi.fn(async () => {
      if (++calls === 2) throw Error('project-export.pending');
    });
    await expect(
      exportCurrentProjectFile(transferProject, {
        api,
        control: transferControl(),
        assertReady,
        download,
      }),
    ).rejects.toThrow('pending');
    expect(assertReady).toHaveBeenCalledTimes(2);
    expect(download).not.toHaveBeenCalled();
    api.mockClear();
    await expect(
      exportCurrentProjectFile(transferProject, {
        api,
        control: transferControl(),
        assertReady: async () => {
          throw Error('storage-unknown');
        },
        download,
      }),
    ).rejects.toThrow('unknown');
    expect(api).not.toHaveBeenCalled();
  });
  it('drops account-changed responses even before parent props update with the same token', async () => {
    const session = transferStorage();
    const identity = {
      userId: transferActor,
      token: 'same-token',
      expiresAt: '2050-01-01T00:00:00Z',
    };
    session.setItem('ezerd.sync.session', JSON.stringify(identity));
    vi.stubGlobal('sessionStorage', session);
    const { api: base } = transport();
    let reads = 0;
    const api = async (url: string) => {
      const result = await base(url);
      if (url.endsWith('/document-state') && ++reads === 2)
        session.setItem(
          'ezerd.sync.session',
          JSON.stringify({ ...identity, userId: transferWorkspace }),
        );
      return result;
    };
    const download = vi.fn();
    await expect(
      exportCurrentProjectFile(transferProject, {
        api,
        control: transferControl(),
        assertReady: ready,
        download,
      }),
    ).rejects.toThrow('대상');
    expect(download).not.toHaveBeenCalled();
  });
  it('creates no Blob before scope validation and cleans up a failed click', () => {
    const createObjectURL = vi.fn(() => 'blob:test'),
      revokeObjectURL = vi.fn();
    const link = {
      href: '',
      download: '',
      click: vi.fn(() => {
        throw Error('click-failed');
      }),
      remove: vi.fn(),
    };
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.stubGlobal('document', { createElement: () => link, body: { append: vi.fn() } });
    expect(() =>
      downloadProjectTransfer(transferEnvelope(), () => {
        throw Error('scope');
      }),
    ).toThrow('scope');
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(() => downloadProjectTransfer(transferEnvelope())).toThrow('click-failed');
    expect(link.remove).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
});
