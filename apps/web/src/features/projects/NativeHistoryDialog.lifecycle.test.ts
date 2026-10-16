// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { NativeHistoryPage } from '@ezerd/contracts';
import { NativeHistoryDialog } from './NativeHistoryDialog.js';
import { advancedFixture } from './native-advanced-test-fixtures.js';

const fetchRecent = vi.hoisted(() => vi.fn());
vi.mock('./native-history.js', async () => ({
  ...(await vi.importActual('./native-history.js')),
  fetchRecentNativeHistory: fetchRecent,
  loadNativeHistoryPending: async () => null,
}));
let root: Root, host: HTMLDivElement;
const fixture = advancedFixture();
const page = (sequences: number[], nextBefore: number | null = null) =>
  ({
    protocolVersion: 2,
    version: fixture.snapshot.project.version,
    sequence: 60,
    nextSince: null,
    nextBefore,
    history: sequences.map((sequence) => ({
      operationId: `op-${sequence}`,
      sequence,
      format: 'native',
      changes: [],
      result: {
        status: 'accepted',
        actor: { id: fixture.context.userId, username: `Actor-${sequence}` },
        createdAt: '2026-10-07T00:00:00Z',
      },
    })),
  }) as unknown as NativeHistoryPage;
const props = () => ({
  embedded: true,
  userId: fixture.context.userId,
  snapshot: fixture.snapshot,
  canEdit: true,
  onClose: vi.fn(),
  onReload: vi.fn(),
});
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fetchRecent.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it('loads latest immediately, paginates older records and deduplicates overlaps', async () => {
  fetchRecent.mockResolvedValueOnce(page([60, 59], 59)).mockResolvedValueOnce(page([59, 58]));
  await act(async () => root.render(createElement(NativeHistoryDialog, props())));
  expect(fetchRecent).toHaveBeenCalledWith(
    fixture.snapshot.project.id,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(host.textContent).toContain('Actor-60');
  const more = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === '이력 더 보기',
  )!;
  await act(async () => more.click());
  expect(fetchRecent.mock.calls[1]?.[1]).toMatchObject({ before: 59 });
  expect(host.querySelectorAll('.native-history-list > li')).toHaveLength(3);
  expect(host.textContent!.indexOf('Actor-60')).toBeLessThan(host.textContent!.indexOf('Actor-58'));
});
it('refreshes on sequence changes and discards late responses from previous snapshots', async () => {
  let resolve!: (page: NativeHistoryPage) => void;
  fetchRecent
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce(page([61]));
  const initial = props();
  await act(async () => root.render(createElement(NativeHistoryDialog, initial)));
  const signal = fetchRecent.mock.calls[0]?.[1].signal as AbortSignal;
  await act(async () =>
    root.render(
      createElement(NativeHistoryDialog, {
        ...initial,
        snapshot: { ...initial.snapshot, sequence: initial.snapshot.sequence + 1 },
      }),
    ),
  );
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(page([60])));
  expect(host.textContent).toContain('Actor-61');
  expect(host.textContent).not.toContain('Actor-60');
});
it('allows default wheel scrolling without bubbling into canvas handlers', async () => {
  fetchRecent.mockResolvedValue(page([60]));
  const wheel = vi.fn();
  document.body.addEventListener('wheel', wheel);
  await act(async () => root.render(createElement(NativeHistoryDialog, props())));
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80 });
  host.querySelector('.native-history-list')!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(wheel).not.toHaveBeenCalled();
  document.body.removeEventListener('wheel', wheel);
});
it('aborts pagination and clears old actor/project data when the context changes', async () => {
  let resolve!: (page: NativeHistoryPage) => void;
  fetchRecent
    .mockResolvedValueOnce(page([60], 60))
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce(page([80]));
  const initial = props();
  await act(async () => root.render(createElement(NativeHistoryDialog, initial)));
  const more = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === '이력 더 보기',
  )!;
  await act(async () => more.click());
  const signal = fetchRecent.mock.calls[1]?.[1].signal as AbortSignal;
  await act(async () =>
    root.render(
      createElement(NativeHistoryDialog, {
        ...initial,
        userId: 'other-user',
        snapshot: {
          ...initial.snapshot,
          project: { ...initial.snapshot.project, id: 'other-project' },
        },
      }),
    ),
  );
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(page([59])));
  expect(host.textContent).toContain('Actor-80');
  expect(host.textContent).not.toContain('Actor-60');
  expect(host.textContent).not.toContain('Actor-59');
});
it('offers retry after an initial failure and aborts on unmount', async () => {
  fetchRecent.mockRejectedValueOnce(Error('History unavailable')).mockResolvedValueOnce(page([60]));
  await act(async () => root.render(createElement(NativeHistoryDialog, props())));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('History unavailable');
  const retry = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === '다시 시도',
  )!;
  await act(async () => retry.click());
  expect(host.textContent).toContain('Actor-60');
  const signal = fetchRecent.mock.calls[1]?.[1].signal as AbortSignal;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});
it('keeps the mounted history and scroll position on an unchanged snapshot refresh', async () => {
  fetchRecent.mockResolvedValue(page([60]));
  const initial = props();
  await act(async () => root.render(createElement(NativeHistoryDialog, initial)));
  const list = host.querySelector('.native-history-list');
  host.scrollTop = 120;
  await act(async () =>
    root.render(
      createElement(NativeHistoryDialog, { ...initial, snapshot: { ...initial.snapshot } }),
    ),
  );
  expect(fetchRecent).toHaveBeenCalledOnce();
  expect(host.querySelector('.native-history-list')).toBe(list);
  expect(host.scrollTop).toBe(120);
});
it('preserves loaded older pages and their cursor when the refreshed latest page overlaps', async () => {
  fetchRecent
    .mockResolvedValueOnce(page([60, 59], 59))
    .mockResolvedValueOnce(page([58, 57], 57))
    .mockResolvedValueOnce(page([61, 60], 60))
    .mockResolvedValueOnce(page([56]));
  const initial = props();
  const more = () =>
    [...host.querySelectorAll('button')].find((button) => button.textContent === '이력 더 보기')!;
  await act(async () => root.render(createElement(NativeHistoryDialog, initial)));
  await act(async () => more().click());
  const oldest = host.querySelector('li[value="57"]');
  await act(async () =>
    root.render(
      createElement(NativeHistoryDialog, {
        ...initial,
        snapshot: { ...initial.snapshot, sequence: initial.snapshot.sequence + 1 },
      }),
    ),
  );
  expect(host.querySelectorAll('.native-history-list > li')).toHaveLength(5);
  expect(host.querySelector('li[value="57"]')).toBe(oldest);
  await act(async () => more().click());
  expect(fetchRecent.mock.calls[3]?.[1]).toMatchObject({ before: 57 });
});
it('resets the cursor and loaded history when the refreshed latest page has a gap', async () => {
  fetchRecent
    .mockResolvedValueOnce(page([60, 59], 59))
    .mockResolvedValueOnce(page([90, 89], 89))
    .mockResolvedValueOnce(page([88]));
  const initial = props();
  await act(async () => root.render(createElement(NativeHistoryDialog, initial)));
  await act(async () =>
    root.render(
      createElement(NativeHistoryDialog, {
        ...initial,
        snapshot: { ...initial.snapshot, sequence: initial.snapshot.sequence + 30 },
      }),
    ),
  );
  expect(host.textContent).not.toContain('Actor-60');
  const more = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === '이력 더 보기',
  )!;
  await act(async () => more.click());
  expect(fetchRecent.mock.calls[2]?.[1]).toMatchObject({ before: 89 });
});
