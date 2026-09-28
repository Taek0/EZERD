import { describe, expect, it } from 'vitest';
import type { SyncHistoryEntry, SyncOperationResult } from '@ezerd/contracts';
import { operationResult, projectHistory } from '../src/mcp/mcp-response.js';

const now = new Date().toISOString();
const document = {
  schemaVersion: 1 as const,
  domains: [],
  domainRelations: [],
  notes: [],
  layout: { nodes: [], viewports: [{ viewId: 'overview', x: 0, y: 0, zoom: 1 }] },
};
const result: SyncOperationResult = {
  operationId: crypto.randomUUID(),
  groupId: crypto.randomUUID(),
  sequence: 3,
  status: 'accepted',
  actor: { id: crypto.randomUUID(), username: 'actor', color: '#4169e1' },
  changedPaths: ['/domains/sales'],
  createdAt: now,
  nextBaseline: {
    baselineId: crypto.randomUUID(),
    baseSequence: 3,
    baselineIssuedAt: now,
  },
  document,
};
const entry: SyncHistoryEntry = {
  ...result,
  clientId: crypto.randomUUID(),
  kind: 'reconnect',
  changes: [
    {
      path: '/domains/sales',
      before: null,
      after: { id: 'sales', name: 'Sales' },
    },
  ],
  deletionSnapshot: { items: [{ id: 'deleted' }] },
};

describe('MCP compact responses', () => {
  it('omits the full document in write results unless requested', () => {
    expect(operationResult(result, false)).not.toHaveProperty('document');
    expect(operationResult(result, true)).toHaveProperty('document.domains');
    expect(result).toHaveProperty('document');
  });

  it('returns a small history page with optional details', () => {
    const page = { history: [entry], nextSince: 3 };
    const compact = projectHistory(page, {
      includeChanges: false,
      includeDocument: false,
      includeDeletionSnapshot: false,
    });
    expect(compact).toHaveProperty('nextSince', 3);
    expect(compact.history[0]).toMatchObject({
      operationId: result.operationId,
      changedPaths: ['/domains/sales'],
    });
    expect(compact.history[0]).not.toHaveProperty('changes');
    expect(compact.history[0]).not.toHaveProperty('document');
    expect(compact.history[0]).not.toHaveProperty('deletionSnapshot');
    const full = projectHistory(page, {
      includeChanges: true,
      includeDocument: true,
      includeDeletionSnapshot: true,
    });
    expect(full.history[0]).toHaveProperty('changes.0.after.name', 'Sales');
    expect(full.history[0]).toHaveProperty('document.domains');
    expect(full.history[0]).toHaveProperty('deletionSnapshot.items');
  });
});
