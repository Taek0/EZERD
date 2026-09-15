import { describe, expect, it } from 'vitest';
import { SyncEventCursor } from './sync-events.js';

describe('SyncEventCursor', () => {
  it('fetches a missing interior event before applying the live event', async () => {
    const applied: number[] = [];
    const cursor = new SyncEventCursor(2, async since => since === 2 ? [{ sequence: 3 }] : [], event => applied.push(event.sequence));
    await cursor.receive({ sequence: 4 });
    expect(applied).toEqual([3, 4]);
  });

  it('uses a head update to catch a dropped final event', async () => {
    const applied: number[] = [];
    const cursor = new SyncEventCursor(7, async () => [{ sequence: 8 }], event => applied.push(event.sequence));
    await cursor.receiveHead(8);
    expect(applied).toEqual([8]);
    expect(cursor.current).toBe(8);
  });

  it('ignores duplicate events', async () => {
    const applied: number[] = [];
    const cursor = new SyncEventCursor<{sequence:number}>(3, async () => [], event => applied.push(event.sequence));
    await cursor.receive({ sequence: 3 });
    expect(applied).toEqual([]);
  });
});
