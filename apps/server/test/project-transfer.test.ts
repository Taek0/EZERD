import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, addDomain, addNote } from '@ezerd/model';
import { WorkspaceService } from '../src/workspace.service.js';
import { WorkspaceController } from '../src/workspace.controller.js';

const document = addNote(
  addDomain(
    createEmptyDocument(),
    { id: 'domain', name: '판매', description: '설명', color: '#123456' },
    { x: 20, y: 30 },
  ),
  { id: 'note', viewId: 'domain', text: '메모', color: '#ffeebb' },
  { x: 50, y: 80 },
);
const file = {
  format: 'ezerd-project',
  formatVersion: 1,
  exportedAt: '2026-09-17T00:00:00.000Z',
  project: { name: '설계' },
  document,
};
function setup(fail = false) {
  const inserted: Array<Record<string, unknown>> = [];
  const db = {
    insert: vi.fn(() => ({
      values: (value: Record<string, unknown>) => ({
        returning: async () => {
          if (fail) throw new Error('database unavailable');
          inserted.push(value);
          return [
            {
              ...value,
              id: randomUUID(),
              version: 0,
              syncSequence: 0,
              status: 'active',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ];
        },
      }),
    })),
  };
  return { service: new WorkspaceService({ db } as never), db, inserted };
}
describe('project file transfer', () => {
  it('creates independent projects and preserves document-local identities with one atomic insert each', async () => {
    const { service, inserted, db } = setup();
    const first = await service.importProject(file);
    const second = await service.importProject(file);
    expect(first.id).not.toBe(second.id);
    expect(first).toMatchObject({ version: 0, status: 'active' });
    expect(inserted).toEqual([
      { name: '설계', document },
      { name: '설계', document },
    ]);
    expect(db.insert).toHaveBeenCalledTimes(2);
  });
  it('rejects invalid references, unsupported versions, and private fields before insertion', () => {
    const { service, db } = setup();
    for (const invalid of [
      { ...file, formatVersion: 2 },
      { ...file, token: 'secret' },
      { ...file, project: { name: '설계', id: randomUUID() } },
      { ...file, document: { ...document, notes: [{ id: 'n', viewId: 'missing', text: 'x' }] } },
      { ...file, document: { ...document, schemaVersion: 2 } },
      {
        ...file,
        document: {
          ...document,
          layout: { ...document.layout, nodes: [{ ...document.layout.nodes[0], x: Infinity }] },
        },
      },
    ])
      expect(() => service.importProject(invalid)).toThrow(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });
  it('reports storage failure without a partially created design', async () => {
    const { service, inserted } = setup(true);
    await expect(service.importProject(file)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(inserted).toEqual([]);
  });
  it('exports only the name and document from a single server snapshot', async () => {
    const { service } = setup();
    const get = vi.spyOn(service, 'getProject').mockResolvedValue({
      project: {
        id: randomUUID(),
        name: '서버 이름',
        status: 'archived',
        version: 12,
        createdAt: '',
        updatedAt: '',
      },
      document,
    });
    const result = await service.exportProject(randomUUID());
    expect(result).toEqual({
      ...file,
      exportedAt: expect.any(String),
      project: { name: '서버 이름' },
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(Object.keys(result)).toEqual([
      'format',
      'formatVersion',
      'exportedAt',
      'project',
      'document',
    ]);
  });
  it('authenticates import before accessing the workspace', async () => {
    const importProject = vi.fn();
    const sessions = {
      authenticateHeader: vi.fn(async () => {
        throw new UnauthorizedException();
      }),
    };
    const controller = new WorkspaceController(
      {} as never,
      sessions as never,
      { importProject } as never,
      {} as never,
    );
    await expect(controller.importProject(undefined, file)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(importProject).not.toHaveBeenCalled();
  });
});
