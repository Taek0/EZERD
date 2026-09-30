import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  deletionSnapshots,
  deriveOperationChanges,
  removeTable,
  sharedDocument,
  TABLES_VIEW_ID,
  type DesignDocument,
} from '@ezerd/model';
import { projects, syncClientBaselines, syncOperations } from '../src/db/schema.js';
import { normalizeServerDocument } from '../src/shared/normalize-document.js';
import { SyncService } from '../src/sync/sync.service.js';
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

function fixture(document = legacyDocument()) {
  const row = {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    name: 'Project',
    databaseKind: 'postgresql' as const,
    status: 'active',
    version: 0,
    syncSequence: 0,
    document,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const rows = new Map<unknown, unknown[][]>([[projects, [[row]]]]);
  const writes: Array<{ table: unknown; value: Record<string, unknown> }> = [];
  const tx = {
    select: () => {
      let table: unknown;
      const query = {
        from(value: unknown) {
          table = value;
          return query;
        },
        where() {
          return query;
        },
        for() {
          return query;
        },
        orderBy() {
          return query;
        },
        then(resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) {
          const choices = rows.get(table) ?? [[]];
          return Promise.resolve(choices.length > 1 ? choices.shift()! : choices[0]!).then(
            resolve,
            reject,
          );
        },
      };
      return query;
    },
    insert: (table: unknown) => ({
      values(value: Record<string, unknown>) {
        writes.push({ table, value });
        return Object.assign(Promise.resolve(), { onConflictDoUpdate: async () => undefined });
      },
    }),
    update: (table: unknown) => ({
      set(value: Record<string, unknown>) {
        writes.push({ table, value });
        return { where: async () => undefined };
      },
    }),
  };
  const database = {
    db: {
      ...tx,
      transaction: async (run: (value: typeof tx) => unknown) => run(tx),
    },
  };
  const access = {
    requireProject: vi.fn(async () => undefined),
    runProject: vi.fn(async (_actorId, _projectId, _permission, run) => run(tx)),
  };
  const gateway = { publish: vi.fn() };
  return {
    row,
    rows,
    writes,
    gateway,
    sync: new SyncService(database as never, gateway as never, access as never),
    workspace: new WorkspaceService(database as never, access as never),
  };
}

describe('direct table server normalization boundaries', () => {
  it('uses identical placements for reads, export, issued baselines and reset snapshots', async () => {
    const { sync, workspace, row, rows, writes } = fixture();
    const original = structuredClone(row.document);
    const canonical = normalizeServerDocument(row.document);
    expect((await workspace.getProject(actor.id, row.id)).document).toEqual(canonical);
    expect((await workspace.getProjectState(actor.id, row.id)).document).toEqual(canonical);
    expect((await workspace.exportProject(actor.id, row.id)).document).toEqual(canonical);
    const baseline = await sync.establishBaseline(row.id, crypto.randomUUID(), actor);
    expect(baseline.document).toEqual(sharedDocument(canonical));
    expect(writes.find((write) => write.table === syncClientBaselines)!.value.document).toEqual(
      baseline.document,
    );
    row.syncSequence = 1;
    rows.set(projects, [[{ sequence: 1, document: row.document }]]);
    const reset = await sync.events(actor.id, row.id, 0);
    expect(reset).toMatchObject({ resetRequired: true, document: canonical });
    expect(row.document).toEqual(original);
    expect(normalizeServerDocument(canonical)).toEqual(canonical);
  });

  it.each(['global-position', 'legacy-edit', 'forged'] as const)(
    'validates raw claims before applying canonical changes: %s',
    async (scenario) => {
      const { sync, row, rows, writes, gateway } = fixture();
      const canonical = sharedDocument(normalizeServerDocument(row.document));
      const baseline = scenario === 'legacy-edit' ? sharedDocument(row.document) : canonical;
      const proposed = structuredClone(baseline);
      const global = canonical.layout.nodes.find((node) => node.viewId === TABLES_VIEW_ID)!;
      if (scenario === 'global-position') {
        proposed.layout.nodes.find((node) => node.id === global.id)!.x = 600;
      } else proposed.tables![0]!.logical.name = 'New name';
      const issuedAt = new Date();
      rows.set(syncClientBaselines, [
        [
          {
            document: canonical,
            lastSuccessfulSyncAt: issuedAt,
            lastSequence: 0,
          },
        ],
      ]);
      const changes = deriveOperationChanges(baseline, proposed);
      if (scenario === 'forged')
        changes.push({
          path: `/layout/nodes/${global.id}/position`,
          before: { x: global.x, y: global.y },
          after: { x: 900, y: 900 },
        });
      const pending = sync.apply(
        row.id,
        {
          operationId: crypto.randomUUID(),
          groupId: crypto.randomUUID(),
          clientId: crypto.randomUUID(),
          baselineId: crypto.randomUUID(),
          baseSequence: 0,
          baselineIssuedAt: issuedAt.toISOString(),
          kind: 'online',
          dependencyPaths: [],
          changes,
          baselineDocument: baseline,
          document: proposed,
        },
        actor,
      );
      if (scenario === 'forged') {
        await expect(pending).rejects.toBeInstanceOf(BadRequestException);
        expect(writes).toEqual([]);
        expect(gateway.publish).not.toHaveBeenCalled();
        return;
      }
      const result = await pending;
      expect(result.status).toBe('accepted');
      expect(sharedDocument(result.document!)).toEqual(
        sharedDocument(normalizeServerDocument(proposed)),
      );
      expect(result.changedPaths).toEqual(changes.map((change) => change.path));
      expect(writes.find((write) => write.table === projects)!.value.document).toEqual(
        result.document,
      );
      expect(writes.find((write) => write.table === syncClientBaselines)!.value.document).toEqual(
        sharedDocument(result.document!),
      );
      expect(gateway.publish).toHaveBeenCalledWith(
        row.id,
        expect.objectContaining({
          document: result.document,
          changes,
        }),
      );
      expect(row.document.layout.nodes.some((node) => node.viewId === TABLES_VIEW_ID)).toBe(false);
    },
  );

  it.each(['legacy-owner-only', 'global-snapshot'] as const)(
    'restores table layouts with the global view reserved: %s',
    async (scenario) => {
      const before =
        scenario === 'global-snapshot'
          ? normalizeServerDocument(legacyDocument())
          : legacyDocument();
      const deleted = removeTable(before, 'orders');
      const { sync, row, rows } = fixture(deleted);
      const sourceId = crypto.randomUUID();
      rows.set(syncOperations, [
        [],
        [
          {
            operationId: sourceId,
            createdAt: new Date(),
            deletionSnapshot: { items: deletionSnapshots(deriveOperationChanges(before, deleted)) },
          },
        ],
      ]);
      const apply = vi.spyOn(sync, 'apply').mockResolvedValue({ status: 'accepted' } as never);
      await sync.restore(
        row.id,
        sourceId,
        {
          operationId: crypto.randomUUID(),
          groupId: crypto.randomUUID(),
          clientId: crypto.randomUUID(),
        },
        actor,
      );
      const candidate = apply.mock.calls[0]![1].document;
      const restored = candidate.tables![0]!;
      expect(restored).toMatchObject({ domainId: 'sales', color: '#123456' });
      expect(restored.id).not.toBe('orders');
      expect(
        candidate.layout.nodes
          .filter((node) => node.objectId === restored.id)
          .map((node) => node.viewId)
          .sort(),
      ).toEqual([TABLES_VIEW_ID, 'sales'].sort());
      expect(apply.mock.calls[0]![1].changes).toEqual(
        deriveOperationChanges(apply.mock.calls[0]![1].baselineDocument, candidate),
      );
    },
  );
});
