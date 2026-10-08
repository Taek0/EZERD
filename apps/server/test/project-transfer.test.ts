import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { addDomain, addNote, createEmptyDocument } from '@ezerd/model';
import { WorkspaceService } from '../src/workspace/workspace.service.js';
import { normalizeServerDocument } from '../src/shared/normalize-document.js';

it('keeps legacy stored-project export available without exposing workspace metadata or mutating source', async () => {
  const actorId = randomUUID(),
    projectId = randomUUID();
  const document = addNote(
    addDomain(
      createEmptyDocument(),
      { id: 'domain', name: '판매', description: '설명', color: '#123456' },
      { x: 20, y: 30 },
    ),
    { id: 'note', viewId: 'domain', text: '메모', color: '#ffeebb' },
    { x: 50, y: 80 },
  );
  const before = structuredClone(document);
  const row = {
    id: projectId,
    workspaceId: randomUUID(),
    name: '서버 이름',
    databaseKind: 'mysql',
    status: 'archived',
    version: 12,
    createdAt: new Date(),
    updatedAt: new Date(),
    document,
  };
  const db = { select: vi.fn(() => ({ from: () => ({ where: async () => [row] }) })) };
  const access = { runProject: vi.fn(async (_actor, _project, _permission, read) => read(db)) };
  const service = new WorkspaceService({ db } as never, access as never);
  const result = await service.exportProject(actorId, projectId);
  expect(result).toEqual({
    format: 'ezerd-project',
    formatVersion: 1,
    exportedAt: expect.any(String),
    project: { name: '서버 이름', databaseKind: 'mysql' },
    document: normalizeServerDocument(document),
  });
  expect(db.select).toHaveBeenCalledTimes(1);
  expect(access.runProject).toHaveBeenCalledWith(actorId, projectId, 'read', expect.any(Function));
  expect(document).toEqual(before);
});
