import { describe, it, expect, vi } from 'vitest';
import { previewDatabaseChange } from './database-preview.js';
const project = {
  id: '00000000-0000-4000-8000-000000000001',
  version: 3,
  databaseKind: 'postgresql' as const,
  databaseRevision: 0,
};
const preview = {
  projectId: project.id,
  version: 3,
  sequence: 4,
  current: { kind: 'postgresql', profileId: 'postgresql-18-v1', revision: 0 },
  target: { kind: 'mysql', profileId: 'mysql-8.4-innodb-v1' },
  canChange: true,
};
describe('card database change preview', () => {
  it('skips same-context name edits and requests the exact selected version for a change', async () => {
    const call = vi.fn(async (_url: string, _init: RequestInit) => preview);
    await previewDatabaseChange(project, 'postgresql', call);
    expect(call).not.toHaveBeenCalled();
    await previewDatabaseChange(project, 'mysql', call);
    expect(call).toHaveBeenCalledWith(
      `/api/projects/${project.id}/database/preview`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(String(call.mock.calls[0]?.[1]?.body))).toEqual({
      expectedVersion: 3,
      targetKind: 'mysql',
    });
  });
  it('explains physical-design conversion instead of approving a metadata reinterpretation', async () => {
    await expect(
      previewDatabaseChange(project, 'mysql', async () => ({
        ...preview,
        canChange: false,
        reasonCode: 'database.conversion-required',
      })),
    ).rejects.toThrow('변환');
  });
  it('rejects stale or mismatched preview snapshots', async () => {
    for (const value of [
      { ...preview, version: 4 },
      { ...preview, current: { ...preview.current, revision: 1 } },
      { ...preview, projectId: '00000000-0000-4000-8000-000000000002' },
    ])
      await expect(previewDatabaseChange(project, 'mysql', async () => value)).rejects.toThrow(
        '최신',
      );
  });
});
