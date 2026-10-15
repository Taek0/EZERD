import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeSyncOperationResult } from '@ezerd/contracts';
import {
  applyChanges,
  deriveOperationChanges,
  inverseChanges,
  updateNodeLayout,
  upsertRelationLayout,
  TABLES_VIEW_ID,
} from '@ezerd/model';
import { createNativePerformanceFixture } from '../../shared/performance/native-fixture.js';
import { nativeEntryAfterAck } from './native-ack-entry.js';
import { projectEntry } from './project-entry.js';
import { enqueueNativeSave } from './native-save-intents.js';
import {
  projectNativeLocalColumns,
  pruneNativeLocalBridges,
  readNativeLocalEntries,
  recordNativeLocalResult,
} from './native-local-projection.js';
import { createNativeTestIndexedDB } from './native-durable-test-environment.js';
import { nativeAutoLayoutPlacements, nativeCanvasMoveCommand } from './native-canvas-selection.js';

const actor = '90000000-0000-4000-8000-000000000031';
function storage() {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
beforeEach(() => vi.stubGlobal('indexedDB', createNativeTestIndexedDB()));
afterEach(() => vi.unstubAllGlobals());

describe('relation arrangement across local projection and history', () => {
  it('restores every table placement from one auto-layout operation with one undo', () => {
    const { document, snapshot } = createNativePerformanceFixture(10, 5);
    const before = {
      ...document,
      layout: {
        ...document.layout,
        nodes: document.layout.nodes.map((node, index) => ({
          ...node,
          x: 500 + index * 13,
          y: 200 + index * 17,
        })),
      },
    };
    snapshot.sourceDocument = before;
    if (snapshot.native.status !== 'available') throw Error('Native fixture required');
    snapshot.native.document = before;
    const store = storage();
    const visible = before.layout.nodes.filter((node) => node.viewId === TABLES_VIEW_ID);
    const placements = nativeAutoLayoutPlacements(before, visible, TABLES_VIEW_ID);
    const operationId = enqueueNativeSave(
      actor,
      snapshot,
      placements.map((node) => nativeCanvasMoveCommand(before, node, { x: node.x, y: node.y })),
      undefined,
      undefined,
      store,
    );
    const intents = readNativeLocalEntries(actor, snapshot.project.id, store);
    expect(intents).toHaveLength(1);
    expect(intents[0]!.pending.request).toMatchObject({
      operationId,
      groupId: operationId,
      commands: expect.arrayContaining([expect.objectContaining({ type: 'update_node_layout' })]),
    });
    let arranged = before;
    for (const command of intents[0]!.pending.request.commands) {
      if (command.type !== 'update_node_layout') throw Error('Expected node placement');
      arranged = updateNodeLayout(arranged, command.nodeId, command.patch);
    }
    const changes = deriveOperationChanges(before, arranged);
    expect(changes.length).toBeGreaterThan(1);
    expect(changes.every((change) => /^\/layout\/nodes\/[^/]+\/position$/.test(change.path))).toBe(
      true,
    );
    const undone = applyChanges(arranged, inverseChanges(changes));
    expect(undone.layout.nodes).toEqual(before.layout.nodes);
    expect(undone).toEqual(before);
  });

  it('shows a pending batch, bridges its ACK, then converges to the confirmed document', () => {
    const { document, snapshot } = createNativePerformanceFixture(10, 5);
    const store = storage();
    const relations = document.tableRelations!.slice(0, 2);
    const routes = relations.map((relation, index) => ({
      relationId: relation.id,
      offset: 20 + index * 10,
    }));
    const operationId = enqueueNativeSave(
      actor,
      snapshot,
      [{ type: 'batch_upsert_relation_layouts', viewId: TABLES_VIEW_ID, routes }],
      undefined,
      undefined,
      store,
    );
    const [entry] = readNativeLocalEntries(actor, snapshot.project.id, store);
    expect(entry!.pending.request.operationId).toBe(operationId);
    const projected = projectNativeLocalColumns(document, [entry!], snapshot.sequence, 0);
    expect(projected.pending).toBe(1);
    expect(projected.document.layout.relations).toMatchObject(
      routes.map((route) => ({ ...route, viewId: TABLES_VIEW_ID })),
    );
    expect(document.layout.relations ?? []).toHaveLength(0);

    const accepted = routes.reduce(
      (next, route) => upsertRelationLayout(next, { ...route, viewId: TABLES_VIEW_ID }),
      document,
    );
    const changes = deriveOperationChanges(document, accepted);
    const ack: NativeSyncOperationResult = {
      protocolVersion: 2,
      operationId,
      groupId: operationId,
      sequence: snapshot.sequence + 1,
      status: 'accepted',
      database: document.database,
      databaseRevision: snapshot.project.databaseRevision,
      document: accepted,
      delta: {
        baseSequence: snapshot.sequence,
        projectVersion: snapshot.project.version + 1,
        changes,
      },
      actor: { id: actor, username: 'fixture', color: '#06b6d4' },
      changedPaths: changes.map((change) => change.path),
      createdAt: '2026-10-15T00:00:00Z',
      nextBaseline: {
        baselineId: '90000000-0000-4000-8000-000000000032',
        baseSequence: snapshot.sequence + 1,
        baselineIssuedAt: '2026-10-15T00:00:00Z',
        databaseRevision: snapshot.project.databaseRevision,
      },
    };
    recordNativeLocalResult(entry!, true, ack.sequence, store);
    store.removeItem(entry!.key);
    expect(
      projectNativeLocalColumns(
        document,
        readNativeLocalEntries(actor, snapshot.project.id, store),
        snapshot.sequence,
        snapshot.project.databaseRevision,
      ).document.layout.relations,
    ).toEqual(accepted.layout.relations);

    const current = projectEntry(snapshot);
    if (current.kind !== 'native') throw Error('Native entry required');
    const confirmed = nativeEntryAfterAck(current, ack)!;
    expect(confirmed.snapshot.sourceDocument.layout.relations).toEqual(accepted.layout.relations);
    expect(nativeEntryAfterAck(confirmed, ack)).toBe(confirmed);
    pruneNativeLocalBridges(
      actor,
      snapshot.project.id,
      ack.sequence,
      snapshot.project.databaseRevision,
      store,
    );
    expect(readNativeLocalEntries(actor, snapshot.project.id, store)).toEqual([]);
  });

  it('reverses only arranged routes after a later table move', () => {
    const { document } = createNativePerformanceFixture(10, 5);
    const relation = document.tableRelations![0]!;
    const arranged = upsertRelationLayout(document, {
      viewId: TABLES_VIEW_ID,
      relationId: relation.id,
      offset: 42,
    });
    const routeChanges = deriveOperationChanges(document, arranged);
    expect(routeChanges).toHaveLength(1);
    expect(routeChanges[0]!.path).toContain('/layout/relations/');
    const node = arranged.layout.nodes.find((value) => value.objectId === relation.sourceTableId)!;
    const moved = updateNodeLayout(arranged, node.id, { x: node.x + 80 });
    const undone = applyChanges(moved, inverseChanges(routeChanges));
    expect(undone.layout.relations ?? []).toEqual(document.layout.relations ?? []);
    expect(undone.layout.nodes.find((value) => value.id === node.id)?.x).toBe(node.x + 80);
    expect(undone.tableRelations).toEqual(document.tableRelations);
  });
});
