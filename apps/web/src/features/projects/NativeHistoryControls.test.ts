import { describe, expect, it } from 'vitest';
import type { NativeHistoryPage } from '@ezerd/contracts';
import { nativeUndoCandidates } from './NativeHistoryControls.js';
function entry(id: string, sequence: number, source?: string) {
  return {
    operationId: id,
    sequence,
    format: 'native',
    changes: [{ path: '/tables/t/physical/name' }],
    result: { status: 'accepted', actor: { id: 'me' } },
    ...(source ? { deletionSnapshot: { nativeHistory: { sourceOperationId: source } } } : {}),
  } as NativeHistoryPage['history'][number];
}
describe('native toolbar undo selection', () => {
  it('excludes another actor, upgrades and compensated work, without treating undo as new forward work', () => {
    const other = {
      ...entry('other', 4),
      result: {
        ...entry('other', 4).result,
        actor: { id: 'other', username: 'Other', color: '#4169e1' },
      },
    };
    expect(
      nativeUndoCandidates(
        [
          entry('first', 1),
          entry('second', 2),
          entry('undo-second', 3, 'second'),
          other,
          { ...entry('upgrade', 5), format: 'upgrade' },
        ],
        'me',
      ),
    ).toEqual(['first']);
  });
  it('allows a successful local redo to be undone again', () => {
    expect(
      nativeUndoCandidates(
        [entry('first', 1), entry('undo', 2, 'first'), entry('redo', 3, 'undo')],
        'me',
        ['redo'],
      ),
    ).toEqual(['redo']);
  });
  it('does not consume a source when compensation was rejected', () => {
    const rejected = {
      ...entry('failed', 2, 'first'),
      result: { ...entry('failed', 2).result, status: 'rejected' as const },
    };
    expect(nativeUndoCandidates([entry('first', 1), rejected], 'me')).toEqual(['first']);
  });
});
