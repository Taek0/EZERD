import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, TABLES_VIEW_ID, type DesignDocument } from '@ezerd/model';

import { normalizeServerDocument } from '../src/shared/normalize-document.js';
import { WorkspaceService } from '../src/workspace/workspace.service.js';

const actor = { id: crypto.randomUUID(), username: 'actor', color: '#4169e1' };

function legacyDocument(): DesignDocument {
  return {
    ...createEmptyDocument(),
    domains: [{ id: 'sales', name: 'Sales', description: '' }],
    tables: [
      {
        id: 'orders',
        domainId: 'sales',
        scope: 'both',
        color: '#123456',
        logical: { name: 'Orders', definition: '' },
        physical: { name: 'orders', schema: 'public', comment: '' },
        customProperties: { common: {}, logical: {}, physical: {} },
      },
    ],
    layout: {
      nodes: [
        {
          id: 'node:sales',
          objectId: 'sales',
          viewId: 'overview',
          x: 0,
          y: 0,
          width: 240,
          height: 140,
        },
        {
          id: 'node:orders',
          objectId: 'orders',
          viewId: 'sales',
          x: 25,
          y: 50,
          width: 320,
          height: 260,
        },
      ],
      viewports: [{ viewId: 'overview', x: 0, y: 0, zoom: 1 }],
    },
  };
}

function legacyAnnotations(): DesignDocument {
  const document = legacyDocument();
  document.views = [{ id: 'private-view', name: 'Private', domainIds: ['sales'] }];
  document.notes = [
    { id: 'shared-note', viewId: 'sales', text: 'Shared' },
    { id: 'private-note', viewId: 'private-view', text: 'Private' },
  ];
  document.layout.nodes.push(
    {
      id: 'shared-note-node',
      objectId: 'shared-note',
      viewId: 'sales',
      x: 80,
      y: 100,
      width: 200,
      height: 120,
    },
    {
      id: 'private-note-node',
      objectId: 'private-note',
      viewId: 'private-view',
      x: 900,
      y: 1000,
      width: 200,
      height: 120,
    },
    {
      id: 'private-order-node',
      objectId: 'orders',
      viewId: 'private-view',
      x: 999,
      y: 999,
      width: 320,
      height: 260,
    },
  );
  document.tableRelations = [
    {
      id: 'self',
      sourceTableId: 'orders',
      targetTableId: 'orders',
      scope: 'logical',
      logical: { name: 'Self', cardinality: 'one-to-many', required: false },
      physical: null,
    },
  ];
  document.layout.relations = [
    { relationId: 'self', viewId: 'sales', offset: 12, waypoints: [{ x: 80, y: 90 }] },
    { relationId: 'self', viewId: 'private-view', offset: 999 },
  ];
  return document;
}

function fixture(document = legacyDocument()) {
  const row = {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    name: 'Project',
    databaseKind: 'postgresql',
    status: 'active',
    version: 0,
    syncSequence: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    document,
  };
  const tx = {
    select: () => ({ from: () => ({ where: async () => [row] }) }),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const access = { runProject: vi.fn(async (_actor, _project, _permission, run) => run(tx)) };
  return { row, tx, workspace: new WorkspaceService({ db: tx } as never, access as never) };
}

describe('legacy transfer normalization remains available after API retirement', () => {
  it.each([legacyDocument, legacyAnnotations])(
    'exports canonical placements without mutating the saved source',
    async (make) => {
      const source = make(),
        before = structuredClone(source);
      const { row, tx, workspace } = fixture(source);
      const canonical = normalizeServerDocument(source);
      const transfer = await workspace.exportProject(actor.id, row.id);
      expect(transfer.document).toEqual(canonical);
      expect(transfer.formatVersion).toBe(1);
      expect(source).toEqual(before);
      expect(normalizeServerDocument(canonical)).toEqual(canonical);
      expect(tx.insert).not.toHaveBeenCalled();
      expect(tx.update).not.toHaveBeenCalled();
      expect(tx.delete).not.toHaveBeenCalled();
    },
  );
  it('preserves private annotations while normalizing only shared placements for export', async () => {
    const source = legacyAnnotations();
    const { row, workspace } = fixture(source);
    const canonical = (await workspace.exportProject(actor.id, row.id)).document;
    expect(canonical.notes.find((note) => note.id === 'shared-note')?.viewId).toBe(TABLES_VIEW_ID);
    expect(canonical.notes.find((note) => note.id === 'private-note')).toEqual(source.notes[1]);
    expect(canonical.layout.nodes.find((node) => node.id === 'private-note-node')).toEqual(
      source.layout.nodes.find((node) => node.id === 'private-note-node'),
    );
    expect(canonical.layout.relations?.find((route) => route.viewId === 'private-view')).toEqual(
      source.layout.relations![1],
    );
  });
});
