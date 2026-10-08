import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type Column, type DesignDocument } from '@ezerd/model';
import { nativeTransferStore } from './native-transfer-store.js';

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
    const { service, stored } = nativeTransferStore();
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
    expect(stored[0].document.columns[0].physical.type).toMatchObject({
      kind: 'builtin',
      database: 'postgresql',
      typeId: `postgresql:${expected}`,
    });
  });

  it('preserves unresolved old modifiers as legacy evidence instead of creating invalid native types', async () => {
    const { service, stored } = nativeTransferStore();
    const source = document({ name: 'integer', length: 12, isArray: false });
    await service.importProject(actor.id, {
      workspaceId: crypto.randomUUID(),
      transfer: {
        format: 'ezerd-project',
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        project: { name: 'Import' },
        document: source,
      },
    });
    expect(stored[0].document.columns[0].physical.type).toMatchObject({
      kind: 'legacy',
      original: source.columns![0]!.physical.type,
    });
  });
});
