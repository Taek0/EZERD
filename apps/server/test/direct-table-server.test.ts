import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  deletionSnapshots,
  deriveOperationChanges,
  removeTable,
  updateTable,
  sharedDocument,
  TABLES_VIEW_ID,
  type DesignDocument,
} from '@ezerd/model';
import {
  projects,
  syncClientBaselines,
  syncFieldVersions,
  syncOperations,
  syncTombstones,
} from '../src/db/schema.js';
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
  it.each([
    'same-owner',
    'missing-tombstone',
    'repurposed-node',
    'custom-node-id',
    'retired-entity',
    'nullable-field',
  ] as const)(
    'retains entity ID safety while permitting canonical reassignment: %s',
    async (scenario) => {
      const source = normalizeServerDocument(legacyDocument());
      source.tables![0]!.domainId = null;
      source.layout.nodes = source.layout.nodes.filter((node) => node.viewId !== 'sales');
      const { sync, row, rows, writes } = fixture(source);
      row.syncSequence = 3;
      const baseline = sharedDocument(source);
      let proposed = updateTable(baseline, 'orders', { domainId: 'sales' });
      const owner = proposed.layout.nodes.find((node) => node.viewId === 'sales')!;
      const retired = structuredClone(owner);
      let path = `/layout/nodes/${owner.id}`;
      if (scenario === 'repurposed-node') retired.objectId = 'other';
      if (scenario === 'custom-node-id') {
        owner.id = retired.id = 'custom-owner';
        path = '/layout/nodes/custom-owner';
      }
      if (scenario === 'retired-entity') {
        proposed = structuredClone(baseline);
        proposed.domains.push({ id: 'retired-domain', name: 'Reused', description: '' });
        proposed.layout.nodes.push({
          id: 'retired-domain-node',
          objectId: 'retired-domain',
          viewId: 'overview',
          x: 0,
          y: 0,
          width: 240,
          height: 140,
        });
        path = '/domains/retired-domain';
      }
      if (scenario === 'nullable-field') path = '/tables/orders/domainId';
      rows.set(syncFieldVersions, [[{ path, sequence: 2 }]]);
      if (scenario !== 'missing-tombstone')
        rows.set(syncTombstones, [[{ sequence: 2, snapshot: { path, snapshot: retired } }]]);
      const issuedAt = new Date();
      rows.set(syncClientBaselines, [
        [{ document: baseline, lastSuccessfulSyncAt: issuedAt, lastSequence: 3 }],
      ]);
      const result = await sync.apply(
        row.id,
        {
          operationId: crypto.randomUUID(),
          groupId: crypto.randomUUID(),
          clientId: crypto.randomUUID(),
          baselineId: crypto.randomUUID(),
          baseSequence: 3,
          baselineIssuedAt: issuedAt.toISOString(),
          kind: 'online',
          dependencyPaths: [],
          changes: deriveOperationChanges(baseline, proposed),
          baselineDocument: baseline,
          document: proposed,
        },
        actor,
      );
      const accepted =
        scenario === 'same-owner' ||
        scenario === 'nullable-field' ||
        scenario === 'missing-tombstone';
      expect(result.status).toBe(accepted ? 'accepted' : 'rejected');
      if (accepted) {
        expect(result.document!.tables![0]!.domainId).toBe('sales');
        if (scenario === 'missing-tombstone') {
          const restored = result.document!.layout.nodes.find((node) => node.viewId === 'sales')!;
          expect(restored.id).not.toBe(owner.id);
          expect(restored).toMatchObject({
            objectId: owner.objectId,
            viewId: owner.viewId,
            x: owner.x,
            y: owner.y,
          });
          expect(result.changedPaths).toContain(`/layout/nodes/${restored.id}`);
          expect(
            result.document!.layout.nodes.find((node) => node.viewId === TABLES_VIEW_ID),
          ).toEqual(source.layout.nodes.find((node) => node.viewId === TABLES_VIEW_ID));
          expect(result.changedPaths).not.toContain(path);
        } else expect(result.document!.layout.nodes).toContainEqual(owner);
      } else {
        expect(result.reason).toContain('객체 ID');
        expect(writes.find((write) => write.table === projects)!.value).not.toHaveProperty(
          'document',
        );
      }
    },
  );

  it('migrates only shared annotations consistently across shared load/export/baseline/reset', async () => {
    const source = legacyAnnotations();
    const original = structuredClone(source);
    const { sync, workspace, row, rows, writes } = fixture(source);
    const canonical = normalizeServerDocument(source);
    for (const document of [
      (await workspace.getProject(actor.id, row.id)).document,
      (await workspace.getProjectState(actor.id, row.id)).document,
      (await workspace.exportProject(actor.id, row.id)).document,
    ])
      expect(document).toEqual(canonical);
    const baseline = await sync.establishBaseline(row.id, crypto.randomUUID(), actor);
    expect(baseline.document).toEqual(sharedDocument(canonical));
    expect(baseline.document.notes).toEqual([
      { id: 'shared-note', viewId: TABLES_VIEW_ID, text: 'Shared' },
    ]);
    expect(
      baseline.document.layout.nodes.find((node) => node.id === 'shared-note-node')?.viewId,
    ).toBe(TABLES_VIEW_ID);
    expect(baseline.document.layout.relations).toEqual([
      expect.objectContaining({ relationId: 'self', viewId: TABLES_VIEW_ID, offset: 12 }),
    ]);
    expect(canonical.notes.find((note) => note.id === 'private-note')).toEqual(source.notes[1]);
    expect(canonical.layout.nodes.find((node) => node.id === 'private-note-node')).toEqual(
      source.layout.nodes.find((node) => node.id === 'private-note-node'),
    );
    expect(canonical.layout.relations?.find((route) => route.viewId === 'private-view')).toEqual(
      source.layout.relations![1],
    );
    expect(writes.every((write) => write.table !== projects)).toBe(true);
    rows.set(projects, [[{ sequence: 2, document: source }]]);
    expect((await sync.events(actor.id, row.id, 0)).document).toEqual(canonical);
    expect(normalizeServerDocument(canonical)).toEqual(canonical);
    expect(source).toEqual(original);
  });

  it.each(['legacy-note-edit', 'global-route-edit', 'forged-migration'] as const)(
    'checks raw claims before migration and persists canonical annotations: %s',
    async (scenario) => {
      const { sync, row, rows, writes, gateway } = fixture(legacyAnnotations());
      const canonical = sharedDocument(normalizeServerDocument(row.document));
      const baseline = scenario === 'global-route-edit' ? canonical : sharedDocument(row.document);
      const proposed = structuredClone(baseline);
      if (scenario === 'global-route-edit') proposed.layout.relations![0]!.offset = 88;
      else proposed.notes[0]!.text = 'Edited';
      const issuedAt = new Date();
      rows.set(syncClientBaselines, [
        [{ document: canonical, lastSuccessfulSyncAt: issuedAt, lastSequence: 0 }],
      ]);
      const changes = deriveOperationChanges(baseline, proposed);
      if (scenario === 'forged-migration')
        changes.push({ path: '/notes/shared-note/viewId', before: 'sales', after: TABLES_VIEW_ID });
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
      if (scenario === 'forged-migration') {
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
      expect(result.document!.notes.find((note) => note.id === 'private-note')).toEqual(
        row.document.notes[1],
      );
      expect(
        result.document!.layout.relations?.find((route) => route.viewId === 'private-view'),
      ).toEqual(row.document.layout.relations![1]);
      expect(writes.find((write) => write.table === syncClientBaselines)!.value.document).toEqual(
        sharedDocument(result.document!),
      );
    },
  );

  it('normalizes retained operation documents on event, lookup and secured replay reads', async () => {
    const source = legacyAnnotations();
    const { sync, row, rows, writes } = fixture(source);
    const operationId = crypto.randomUUID();
    const result = {
      operationId,
      groupId: crypto.randomUUID(),
      sequence: 1,
      status: 'accepted',
      actor,
      changedPaths: [],
      createdAt: new Date().toISOString(),
      document: source,
      nextBaseline: {
        baselineId: crypto.randomUUID(),
        baseSequence: 1,
        baselineIssuedAt: new Date().toISOString(),
      },
    };
    rows.set(syncOperations, [
      [{ result, operationId, sequence: 1, changes: [], actorId: actor.id, fingerprint: 'hash' }],
    ]);
    const canonical = normalizeServerDocument(source);
    expect((await sync.lookup(row.id, operationId, actor)).document).toEqual(canonical);
    expect((await sync.findReplay(row.id, operationId, 'hash', actor))?.document).toEqual(
      canonical,
    );
    rows.set(projects, [[{ sequence: 1, document: source }]]);
    const events = await sync.events(actor.id, row.id, 0);
    expect(events.resetRequired).toBe(false);
    expect(events.events[0]!.document).toEqual(canonical);
    expect(result.document).toEqual(source);
    expect(writes).toEqual([]);
  });

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
            result: {
              operationId: sourceId,
              groupId: crypto.randomUUID(),
              sequence: 1,
              status: 'accepted',
              actor,
              changedPaths: [],
              createdAt: new Date().toISOString(),
              nextBaseline: {
                baselineId: crypto.randomUUID(),
                baseSequence: 1,
                baselineIssuedAt: new Date().toISOString(),
              },
            },
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
