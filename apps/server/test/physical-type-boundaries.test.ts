import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { createEmptyDocument, type Column, type DesignDocument } from '@ezerd/model';
import { WorkspaceService } from '../src/workspace/workspace.service.js';

const actor = { id: crypto.randomUUID(), username: 'actor', color: '#4169e1' };
const properties = { common: {}, logical: {}, physical: {} };
function document(type: Column['physical']['type']): DesignDocument {
  return {
    ...createEmptyDocument(),
    domains: [{ id: 'd', name: 'Domain', description: '' }],
    layout: {
      nodes: [
        { id: 'node:d', objectId: 'd', viewId: 'overview', x: 0, y: 0, width: 240, height: 180 },
        { id: 'node:t', objectId: 't', viewId: 'd', x: 0, y: 0, width: 240, height: 180 },
      ],
      viewports: [
        { viewId: 'overview', x: 0, y: 0, zoom: 1 },
        { viewId: 'd', x: 0, y: 0, zoom: 1 },
      ],
    },
    tables: [
      {
        id: 't',
        domainId: 'd',
        scope: 'both',
        logical: { name: 'T', definition: '' },
        physical: { name: 't', schema: 'public', comment: '' },
        customProperties: properties,
      },
    ],
    columns: [
      {
        id: 'c',
        tableId: 't',
        scope: 'both',
        logical: { name: 'C', definition: '', semanticType: '', required: false },
        physical: { name: 'c', type, nullable: true, defaultExpression: null, comment: '' },
        customProperties: properties,
      },
    ],
  };
}
describe('legacy file import type boundaries', () => {
  it.each([
    ['float4', 'real'],
    ['float8', 'double precision'],
    ['decimal', 'numeric'],
  ])('stores canonical %s on import', async (name, expected) => {
    const values = vi.fn((value) => ({
      returning: async () => [
        {
          ...value,
          id: crypto.randomUUID(),
          status: 'active',
          version: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    }));
    const db = { insert: vi.fn(() => ({ values })) };
    const access = {
      runWorkspace: vi.fn(async (_actorId, _workspaceId, _permission, run) => run(db)),
    };
    const service = new WorkspaceService({ db } as never, access as never);
    await service.importProject(actor.id, {
      workspaceId: crypto.randomUUID(),
      transfer: {
        format: 'ezerd-project',
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        project: { name: 'Import' },
        document: document({ name, isArray: false }),
      },
    });
    expect(values.mock.calls[0]![0].document.columns[0].physical.type.name).toBe(expected);
  });

  it('rejects invalid types before import insertion', () => {
    const db = { insert: vi.fn() };
    const service = new WorkspaceService({ db } as never, {} as never);
    expect(() =>
      service.importProject(actor.id, {
        workspaceId: crypto.randomUUID(),
        transfer: {
          format: 'ezerd-project',
          formatVersion: 1,
          exportedAt: new Date().toISOString(),
          project: { name: 'Import' },
          document: document({ name: 'integer', length: 12, isArray: false }),
        },
      }),
    ).toThrow(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
