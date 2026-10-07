import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  addDomain,
  addNote,
  addTable,
  diagnoseDocument,
  ensureTableCanvasLayout,
  TABLES_VIEW_ID,
} from '@ezerd/model';
import { designDocumentSchema, MAX_DOCUMENT_BYTES } from '@ezerd/contracts';
import { WorkspaceService } from '../src/workspace/workspace.service.js';
import { WorkspaceController } from '../src/workspace/workspace.controller.js';
import { normalizeServerDocument } from '../src/shared/normalize-document.js';

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
const actorId = randomUUID();
const workspaceId = randomUUID();
const input = { workspaceId, transfer: file };
function setup(fail = false) {
  const stored: { row?: Record<string, unknown> } = {};
  const inserted: Array<Record<string, unknown>> = [];
  const db = {
    select: vi.fn(() => ({
      from: () => ({ where: async () => (stored.row ? [stored.row] : []) }),
    })),
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
  const access = {
    runProject: vi.fn(async (_actorId, _projectId, _permission, run) => run(db)),
    runWorkspace: vi.fn(async (_actorId, _workspaceId, _permission, run) => run(db)),
  };
  return {
    service: new WorkspaceService({ db } as never, access as never),
    db,
    inserted,
    access,
    stored,
  };
}
describe('project file transfer', () => {
  it.each(['bytes', 'nodes'] as const)(
    'rejects legacy imports exceeding normalized %s limits before insertion',
    (limit) => {
      const legacy = addTable(
        structuredClone(document),
        {
          id: 't',
          domainId: 'domain',
          scope: 'both',
          logical: { name: 'T', definition: '' },
          physical: { name: 't', schema: 'public', comment: '' },
          customProperties: { common: {}, logical: {}, physical: {} },
        },
        { x: 0, y: 0 },
      );
      legacy.layout.nodes = legacy.layout.nodes.filter((node) => node.viewId !== TABLES_VIEW_ID);
      if (limit === 'bytes') {
        for (let index = 0; index < 74; index++) {
          legacy.notes.push({ id: `padding${index}`, viewId: 'overview', text: 'x'.repeat(20000) });
          legacy.layout.nodes.push({
            id: `np${index}`,
            objectId: `padding${index}`,
            viewId: 'overview',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          });
        }
        const padding = { id: 'remaining', viewId: 'overview', text: '' };
        legacy.notes.push(padding);
        legacy.layout.nodes.push({
          id: 'nr',
          objectId: 'remaining',
          viewId: 'overview',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        });
        const remaining =
          MAX_DOCUMENT_BYTES - Buffer.byteLength(JSON.stringify(legacy), 'utf8') - 32;
        expect(remaining).toBeGreaterThan(0);
        expect(remaining).toBeLessThanOrEqual(20000);
        padding.text = 'x'.repeat(remaining);
      } else {
        legacy.notes = [];
        legacy.domains = Array.from({ length: 1000 }, (_, index) => ({
          id: `d${index}`,
          name: '',
          description: '',
        }));
        legacy.tables = Array.from({ length: 11 }, (_, index) => ({
          ...legacy.tables![0]!,
          id: `t${index}`,
          domainId: 'd0',
        }));
        legacy.layout.nodes = legacy.domains.map((domain, index) => ({
          id: `d${index}`,
          objectId: domain.id,
          viewId: 'overview',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        }));
        for (const domain of legacy.domains)
          for (const table of legacy.tables)
            legacy.layout.nodes.push({
              id: `${domain.id}${table.id}`,
              objectId: table.id,
              viewId: domain.id,
              x: 0,
              y: 0,
              width: 1,
              height: 1,
            });
        expect(legacy.layout.nodes).toHaveLength(12000);
      }
      expect(diagnoseDocument(legacy)).toEqual([]);
      expect(designDocumentSchema.safeParse(legacy).success).toBe(true);
      expect(designDocumentSchema.safeParse(ensureTableCanvasLayout(legacy)).success).toBe(false);
      const { service, db } = setup();
      expect(() =>
        service.importProject(actorId, {
          workspaceId,
          transfer: { ...file, document: legacy },
        }),
      ).toThrow(BadRequestException);
      expect(db.insert).not.toHaveBeenCalled();
    },
  );
  it('imports version 1 direct tables with colors and global placements intact', async () => {
    const direct = addTable(
      createEmptyDocument(),
      {
        id: 'free',
        domainId: null,
        color: '#123456',
        scope: 'both',
        logical: { name: 'Free', definition: '' },
        physical: { name: 'free', schema: 'public', comment: '' },
        customProperties: { common: {}, logical: {}, physical: {} },
      },
      { x: 120, y: 340 },
    );
    const { service, inserted, stored } = setup();
    const result = await service.importProject(actorId, {
      workspaceId,
      transfer: { ...file, document: direct },
    });
    expect(result.preview?.tableCount).toBe(1);
    expect(inserted[0]!.document).toEqual(direct);
    stored.row = {
      ...result,
      document: direct,
      createdAt: new Date(result.createdAt),
      updatedAt: new Date(result.updatedAt),
    };
    const exported = await service.exportProject(actorId, result.id);
    expect(exported).toMatchObject({ formatVersion: 1, document: direct });
    expect(exported.document.layout.nodes[0]).toMatchObject({
      viewId: TABLES_VIEW_ID,
      x: 120,
      y: 340,
    });
  });

  it('normalizes owner-only legacy version 1 imports while retaining the old owner placement', async () => {
    const owned = addTable(
      document,
      {
        id: 'owned',
        domainId: 'domain',
        scope: 'both',
        logical: { name: 'Owned', definition: '' },
        physical: { name: 'owned', schema: 'public', comment: '' },
        customProperties: { common: {}, logical: {}, physical: {} },
      },
      { x: 120, y: 340 },
    );
    owned.layout.nodes = owned.layout.nodes.filter((node) => node.viewId !== TABLES_VIEW_ID);
    const original = structuredClone(owned);
    const { service, inserted } = setup();
    await service.importProject(actorId, { workspaceId, transfer: { ...file, document: owned } });
    const saved = inserted[0]!.document as typeof owned;
    expect(saved).toEqual(normalizeServerDocument(owned));
    expect(saved.layout.nodes).toContainEqual(
      owned.layout.nodes.find((node) => node.objectId === 'owned')!,
    );
    expect(
      saved.layout.nodes.find(
        (node) => node.viewId === TABLES_VIEW_ID && node.objectId === 'owned',
      ),
    ).toMatchObject({
      objectId: 'owned',
      x: 120,
      y: 340,
    });
    expect(owned).toEqual(original);
  });
  it('creates independent projects and preserves document-local identities in workspace transactions', async () => {
    const { service, inserted, db, access } = setup();
    const first = await service.importProject(actorId, input);
    const second = await service.importProject(actorId, input);
    expect(first.id).not.toBe(second.id);
    expect(first).toMatchObject({ workspaceId, version: 0, status: 'active' });
    expect(inserted).toEqual([
      {
        name: '설계',
        databaseKind: 'postgresql',
        databaseProfileId: 'postgresql-18-v1',
        workspaceId,
        document: normalizeServerDocument(document),
      },
      {
        name: '설계',
        databaseKind: 'postgresql',
        databaseProfileId: 'postgresql-18-v1',
        workspaceId,
        document: normalizeServerDocument(document),
      },
    ]);
    expect(access.runWorkspace).toHaveBeenCalledTimes(2);
    expect(access.runWorkspace).toHaveBeenCalledWith(
      actorId,
      workspaceId,
      'createProject',
      expect.any(Function),
    );
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
      expect(() => service.importProject(actorId, { workspaceId, transfer: invalid })).toThrow(
        BadRequestException,
      );
    expect(db.insert).not.toHaveBeenCalled();
  });
  it('reports storage failure without a partially created design', async () => {
    const { service, inserted } = setup(true);
    await expect(service.importProject(actorId, input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(inserted).toEqual([]);
  });
  it('exports only the name and document from a single server snapshot', async () => {
    const { service, db, stored, access } = setup();
    const projectId = randomUUID();
    stored.row = {
      id: projectId,
      workspaceId,
      name: '서버 이름',
      databaseKind: 'mysql',
      status: 'archived',
      version: 12,
      createdAt: new Date(),
      updatedAt: new Date(),
      document,
    };
    const result = await service.exportProject(actorId, projectId);
    expect(result).toEqual({
      ...file,
      exportedAt: expect.any(String),
      project: { name: '서버 이름', databaseKind: 'mysql' },
      document: normalizeServerDocument(document),
    });
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(access.runProject).toHaveBeenCalledWith(
      actorId,
      projectId,
      'read',
      expect.any(Function),
    );
    expect(Object.keys(result)).toEqual([
      'format',
      'formatVersion',
      'exportedAt',
      'project',
      'document',
    ]);
  });
  it('preserves a selected database kind on import', async () => {
    const { service } = setup();
    const result = await service.importProject(actorId, {
      workspaceId,
      transfer: { ...file, project: { ...file.project, databaseKind: 'sqlite' } },
    });
    expect(result.databaseKind).toBe('sqlite');
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
    await expect(controller.importProject(undefined, input)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(importProject).not.toHaveBeenCalled();
  });
});
