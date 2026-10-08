import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defaultDatabaseContext } from '@ezerd/model';
import {
  projectChanges,
  projectChangesInputSchema,
  type ChangeHistoryRow,
} from '../src/mcp/mcp-native-changes.js';

const projectId = randomUUID();
const database = { ...defaultDatabaseContext('postgresql'), revision: 3 };
const head = { projectId, version: 4, sequence: 4, schemaVersion: 2, database };
const input = (raw: Record<string, unknown> = {}) =>
  projectChangesInputSchema.parse({ projectId, since: 0, ...raw });
function row(
  sequence: number,
  changes: unknown = [],
  result: Record<string, unknown> = {},
): ChangeHistoryRow {
  return {
    operationId: randomUUID(),
    sequence,
    changes,
    result: {
      protocolVersion: 2,
      status: 'accepted',
      databaseRevision: 3,
      reasonCode: null,
      ...result,
    },
  };
}

describe('bounded MCP native change projection', () => {
  it('returns only paths and decoded IDs, with deletion identifiers', () => {
    const result = projectChanges({ ...head, sequence: 1 }, input(), [
      row(1, [
        { path: '/tables/a~1b~0c/logical/name' },
        { path: '/columns/deleted', beforeExists: true, afterExists: false },
        { path: '/layout/nodes/old', beforeExists: true, afterExists: false },
      ]),
    ]);
    expect(result.resyncRequired).toBe(false);
    expect(result.changedObjects).toContainEqual({ collection: 'tables', id: 'a/b~c' });
    expect(result.removedObjects).toEqual([
      { collection: 'columns', id: 'deleted' },
      { collection: 'layout.nodes', id: 'old' },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/document|deletionSnapshot|"before"|"after"/);
  });

  it('fixes a stable high watermark and pages despite new operations', () => {
    const first = projectChanges(head, input({ limit: 2 }), [row(1), row(2), row(3)]);
    expect(first.nextCursor).toEqual({ since: 2, untilSequence: 4, databaseRevision: 3 });
    const second = projectChanges(
      { ...head, sequence: 5 },
      input({ ...first.nextCursor, limit: 2 }),
      [row(3), row(4)],
    );
    expect(second.resyncRequired).toBe(false);
    expect(second.untilSequence).toBe(4);
    expect(second.sequence).toBe(5);
    expect(second.nextCursor).toBeNull();
  });

  it('keeps rejected sequence positions without inventing changes', () => {
    const result = projectChanges({ ...head, sequence: 1 }, input(), [
      row(1, [], { status: 'rejected' }),
    ]);
    expect(result.operations[0]?.status).toBe('rejected');
    expect(result.changedObjects).toEqual([]);
  });

  it.each([
    [[], 'missing all history'],
    [[row(2), row(3), row(4)], 'missing prefix'],
    [[row(1), row(3), row(4)], 'missing middle'],
    [[row(1), row(2), row(3)], 'missing tail'],
  ])('requires resync for %s (%s)', (rows) => {
    const result = projectChanges(head, input(), rows as ChangeHistoryRow[]);
    expect(result.reason).toBe('history-gap');
    expect(result.operations).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it('detects gaps at a page boundary', () => {
    expect(projectChanges(head, input({ limit: 2 }), [row(1), row(2), row(4)]).reason).toBe(
      'history-gap',
    );
  });

  it.each([{ protocolVersion: 1 }, { reasonCode: 'document.upgraded' }])(
    'requires resync at a format boundary',
    (metadata) => {
      expect(projectChanges({ ...head, sequence: 1 }, input(), [row(1, [], metadata)]).reason).toBe(
        'format-boundary',
      );
    },
  );

  it('requires resync for database changes and invalid sequence tokens', () => {
    expect(projectChanges(head, input({ databaseRevision: 2 }), []).reason).toBe(
      'database-changed',
    );
    expect(
      projectChanges({ ...head, sequence: 1 }, input(), [row(1, [], { databaseRevision: 2 })])
        .reason,
    ).toBe('database-changed');
    expect(projectChanges(head, input({ since: 5 }), []).reason).toBe('sequence-invalid');
    expect(projectChanges(head, input({ untilSequence: 5 }), []).reason).toBe('sequence-invalid');
  });

  it('does not return personal view IDs or values from malformed ledger entries', () => {
    const result = projectChanges({ ...head, sequence: 1 }, input(), [
      row(1, [{ path: '/views/private' }]),
    ]);
    expect(result.reason).toBe('history-invalid');
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('removes a restored object from the deleted identifiers', () => {
    const result = projectChanges({ ...head, sequence: 2 }, input(), [
      row(1, [{ path: '/tables/a', afterExists: false }]),
      row(2, [{ path: '/tables/a', beforeExists: false, afterExists: null }]),
    ]);
    expect(result.removedObjects).toEqual([]);
  });

  it('bounds response bytes without partially advancing the cursor', () => {
    const changes = Array.from({ length: 500 }, (_, i) => ({
      path: `/tables/${i}/${'x'.repeat(900)}`,
    }));
    const result = projectChanges({ ...head, sequence: 1 }, input(), [row(1, changes)]);
    expect(result.reason).toBe('response-too-large');
    expect(result.nextCursor).toBeNull();
    expect(result.changedPaths).toEqual([]);
  });

  it('validates explicit bounded input and handles current sequence with no changes', () => {
    expect(projectChangesInputSchema.safeParse({ projectId, since: 0, limit: 101 }).success).toBe(
      false,
    );
    expect(projectChangesInputSchema.safeParse({ projectId, since: -1 }).success).toBe(false);
    expect(projectChanges(head, input({ since: 4 }), []).resyncRequired).toBe(false);
  });
});
