import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  createEmptyDocument,
  deriveOperationChanges,
  sharedDocument,
  type Column,
  type DesignDocument,
} from '@ezerd/model';
import { SyncService } from '../src/sync/sync.service.js';
import { projects } from '../src/db/schema.js';
import { McpDocumentService } from '../src/mcp/mcp-document.service.js';
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
function mcp(baseline: DesignDocument) {
  const sync = {
    findReplay: vi.fn(async () => undefined),
    establishBaseline: vi.fn(async () => ({
      baselineId: crypto.randomUUID(),
      sequence: 0,
      baselineIssuedAt: new Date().toISOString(),
      document: baseline,
    })),
    apply: vi.fn(async (_projectId, operation) => ({
      status: 'accepted' as const,
      document: operation.document,
    })),
  };
  const service = new McpDocumentService(sync as never);
  const request = {
    projectId: crypto.randomUUID(),
    expectedVersion: 0,
    expectedSequence: 0,
    operationId: crypto.randomUUID(),
    groupId: crypto.randomUUID(),
    clientId: crypto.randomUUID(),
  };
  return { sync, service, request };
}

describe('physical type write boundaries', () => {
  it.each(['alias', 'forged', 'correction'])(
    'checks raw claims and legacy correction before canonicalizing: %s',
    async (scenario) => {
      const forged = scenario === 'forged';
      const correction = scenario === 'correction';
      const stored = document(
        correction
          ? { name: 'decimal', length: 5, isArray: false }
          : { name: 'float4', isArray: false },
      );
      const baseline = sharedDocument(stored);
      const proposed = structuredClone(baseline);
      if (correction) delete proposed.columns![0]!.physical.type.length;
      else proposed.domains[0]!.description = 'Edited';
      const issuedAt = new Date();
      const selections = [
        [],
        [{ document: stored, syncSequence: 0, status: 'active' }],
        [],
        [],
        [{ document: baseline, lastSuccessfulSyncAt: issuedAt, lastSequence: 0 }],
      ];
      const writes: Array<{ table: unknown; value: Record<string, unknown> }> = [];
      const tx = {
        select: () => {
          const rows = selections.shift();
          const chain = {
            from: () => chain,
            where: () => chain,
            for: () => Promise.resolve(rows),
            then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
          };
          return chain;
        },
        update: (table: unknown) => ({
          set: (value: Record<string, unknown>) => {
            writes.push({ table, value });
            return { where: async () => undefined };
          },
        }),
        insert: () => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) }),
      };
      const gateway = { publish: vi.fn() };
      const service = new SyncService(
        { db: { transaction: async (run: (value: typeof tx) => unknown) => run(tx) } } as never,
        gateway as never,
      );
      const changes = deriveOperationChanges(baseline, proposed);
      if (forged)
        changes.push({
          path: '/columns/c/physical/type',
          before: { name: 'float4', isArray: false },
          after: { name: 'real', isArray: false },
        });
      const pending = service.apply(
        crypto.randomUUID(),
        {
          operationId: crypto.randomUUID(),
          groupId: crypto.randomUUID(),
          clientId: crypto.randomUUID(),
          baselineId: crypto.randomUUID(),
          baseSequence: 0,
          baselineIssuedAt: issuedAt.toISOString(),
          kind: 'online',
          dependencyPaths: [],
          baselineDocument: baseline,
          document: proposed,
          changes,
        },
        actor,
      );
      if (forged) {
        await expect(pending).rejects.toBeInstanceOf(BadRequestException);
        expect(writes).toEqual([]);
        expect(gateway.publish).not.toHaveBeenCalled();
        return;
      }
      const result = await pending;
      expect(result.status).toBe('accepted');
      expect(result.changedPaths).toEqual([
        correction ? '/columns/c/physical/type' : '/domains/d/description',
      ]);
      const saved = writes.find((write) => write.table === projects)!.value
        .document as DesignDocument;
      expect(saved.columns![0]!.physical.type.name).toBe(correction ? 'numeric' : 'real');
      if (correction) expect(saved.columns![0]!.physical.type).not.toHaveProperty('length');
      expect(gateway.publish).toHaveBeenCalledOnce();
    },
  );
  it.each([
    ['FLOAT4', 'real'],
    ['float8', 'double precision'],
    ['decimal', 'numeric'],
  ])('canonicalizes merged MCP %s patch before deriving changes', async (name, expected) => {
    const { sync, service, request } = mcp(document({ name: 'integer', isArray: false }));
    await service.apply(
      {
        ...request,
        commands: [{ type: 'patch_column', id: 'c', patch: { physical: { type: { name } } } }],
      },
      actor,
    );
    const operation = sync.apply.mock.calls[0]![1];
    expect(operation.document.columns[0].physical.type.name).toBe(expected);
    expect(operation.changes).toContainEqual(
      expect.objectContaining({
        path: '/columns/c/physical/type',
        after: { name: expected, isArray: false },
      }),
    );
  });

  it('rejects invalid merged modifiers without applying an operation', async () => {
    const { sync, service, request } = mcp(
      document({ name: 'numeric', precision: 5, scale: 2, isArray: false }),
    );
    await expect(
      service.apply(
        {
          ...request,
          commands: [
            { type: 'patch_column', id: 'c', patch: { physical: { type: { name: 'integer' } } } },
          ],
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sync.apply).not.toHaveBeenCalled();
  });

  it('preserves an ENUM name that matches a built-in alias', async () => {
    const baseline = document({ name: 'FLOAT4', enumId: 'e', isArray: false });
    baseline.enums = [{ id: 'e', name: 'FLOAT4', schema: 'public', values: ['a', 'b'] }];
    const { sync, service, request } = mcp(baseline);
    await service.apply(
      {
        ...request,
        commands: [{ type: 'patch_column', id: 'c', patch: { physical: { comment: 'Changed' } } }],
      },
      actor,
    );
    expect(sync.apply.mock.calls[0]![1].document.columns[0].physical.type).toEqual({
      name: 'FLOAT4',
      enumId: 'e',
      isArray: false,
    });
  });

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
    const service = new WorkspaceService({ db } as never);
    await service.importProject({
      format: 'ezerd-project',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      project: { name: 'Import' },
      document: document({ name, isArray: false }),
    });
    expect(values.mock.calls[0]![0].document.columns[0].physical.type.name).toBe(expected);
  });

  it('rejects invalid types before import insertion', () => {
    const db = { insert: vi.fn() };
    const service = new WorkspaceService({ db } as never);
    expect(() =>
      service.importProject({
        format: 'ezerd-project',
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        project: { name: 'Import' },
        document: document({ name: 'integer', length: 12, isArray: false }),
      }),
    ).toThrow(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
