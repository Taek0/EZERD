import { describe, expect, it } from 'vitest';
import { filterNativeHistory, nativeHistoryKinds } from './native-history.js';

describe('native history operation filters', () => {
  const change = (path: string, before: unknown = 'old', after: unknown = 'new') => ({
    path,
    before,
    after,
  });
  it('matches a mixed operation without truncating its changes or undo identity', () => {
    const entry = {
      operationId: 'mixed',
      changes: [
        { ...change('/tables/t'), beforeExists: false },
        change('/columns/c/physical/name'),
        { ...change('/tableRelations/r'), afterExists: false },
        change('/layout/nodes/n/position/x', 0, 20),
      ],
    };
    for (const filter of ['add', 'edit', 'delete', 'relation', 'move'] as const) {
      expect(filterNativeHistory([entry], filter)).toEqual([entry]);
      expect(filterNativeHistory([entry], filter)[0]).toBe(entry);
    }
    expect(filterNativeHistory([entry], 'resize')).toEqual([]);
  });
  it('recognizes layout, order and database paths and keeps field null values as edits', () => {
    expect([
      ...nativeHistoryKinds({
        changes: [
          change('/layout/nodes/n/size', {}, {}),
          change('/columns/@move/c', null, 'first'),
          change('/database', {}, {}),
          change('/columns/c/physical/defaultValue', null, {}),
        ],
      }),
    ]).toEqual(['resize', 'reorder', 'database', 'edit']);
    expect([...nativeHistoryKinds({ changes: [change('/tables/t', null, {})] })]).toEqual(['add']);
    expect([...nativeHistoryKinds({ changes: [change('/tables/t', {}, null)] })]).toEqual([
      'delete',
    ]);
  });
  it('retains unknown and rejected operations in all and resets an empty selection', () => {
    const empty = { changes: [] };
    const unknown = { changes: [change('/futureSetting', false, true)] };
    const entries = [empty, unknown];
    expect(filterNativeHistory(entries, 'delete')).toEqual([]);
    expect(filterNativeHistory(entries, 'all')).toEqual(entries);
  });
});
