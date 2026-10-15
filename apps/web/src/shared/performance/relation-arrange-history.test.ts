import { describe, expect, it } from 'vitest';
import type { NativeSyncOperationResult } from '@ezerd/contracts';
import type { DocumentChange } from '@ezerd/model';
import { nativeUndoCandidates } from '../../features/projects/NativeHistoryControls.js';
import { createNativePerformanceFixture } from './native-fixture.js';
import { relationArrangeFixtureHistory } from './relation-arrange-history.js';

const actor = '90000000-0000-4000-8000-000000000031';
const { document } = createNativePerformanceFixture(10, 5);
const change: DocumentChange = {
  path: '/layout/nodes/node/position',
  before: { x: 0, y: 0 },
  after: { x: 10, y: 20 },
};
function accepted(sequence: number, reasonCode?: string): NativeSyncOperationResult {
  const operationId = `90000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  return {
    protocolVersion: 2,
    database: document.database,
    databaseRevision: 0,
    operationId,
    groupId: operationId,
    sequence,
    status: 'accepted',
    ...(reasonCode ? { reasonCode } : {}),
    document,
    delta: { baseSequence: sequence - 1, projectVersion: sequence, changes: [change] },
    actor: { id: actor, username: 'fixture', color: '#06b6d4' },
    changedPaths: [change.path],
    createdAt: '2026-10-15T00:00:00Z',
    nextBaseline: {
      baselineId: operationId,
      baseSequence: sequence,
      baselineIssuedAt: '2026-10-15T00:00:00Z',
      databaseRevision: 0,
    },
  };
}

describe('relation fixture history', () => {
  it('marks a compensated table layout so toolbar Undo stops and Redo remains available', () => {
    const layout = accepted(1);
    const undo = accepted(2, 'history.undo');
    const redo = accepted(3, 'history.undo');
    const changes = new Map([layout, undo, redo].map((item) => [item.operationId, [change]]));
    const clients = new Map(
      [layout, undo, redo].map((item) => [item.operationId, item.operationId]),
    );
    const sources = new Map([[undo.operationId, layout.operationId]]);
    const page = relationArrangeFixtureHistory([layout, undo], changes, clients, sources, 0, 25);
    expect(page.history[1]!.deletionSnapshot).toEqual({
      nativeHistory: { command: 'undo', sourceOperationId: layout.operationId, identityMap: [] },
    });
    expect(nativeUndoCandidates(page.history, actor)).toEqual([]);

    sources.set(redo.operationId, undo.operationId);
    const afterRedo = relationArrangeFixtureHistory(
      [layout, undo, redo],
      changes,
      clients,
      sources,
      0,
      25,
    );
    expect(nativeUndoCandidates(afterRedo.history, actor, [redo.operationId])).toEqual([
      redo.operationId,
    ]);
  });

  it('reports a continuation cursor when more than one history page exists', () => {
    const results = Array.from({ length: 30 }, (_, index) => accepted(index + 1));
    const changes = new Map(results.map((item) => [item.operationId, [change]]));
    const clients = new Map(results.map((item) => [item.operationId, item.operationId]));
    const first = relationArrangeFixtureHistory(results, changes, clients, new Map(), 0, 25);
    const second = relationArrangeFixtureHistory(
      results,
      changes,
      clients,
      new Map(),
      first.nextSince!,
      25,
    );
    expect(first.history).toHaveLength(25);
    expect(first.nextSince).toBe(25);
    expect(second.history).toHaveLength(5);
    expect(second.nextSince).toBeNull();
  });
});
