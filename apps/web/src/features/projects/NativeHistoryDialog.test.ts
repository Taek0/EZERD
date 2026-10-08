import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NativeHistoryPage } from '@ezerd/contracts';
import { expect, it, vi } from 'vitest';
import { NativeHistoryDialog } from './NativeHistoryDialog.js';
import { advancedFixture } from './native-advanced-test-fixtures.js';

const harness = vi.hoisted(() => ({ page: null as NativeHistoryPage | null, stateIndex: 0 }));
vi.mock('react', async () => {
  const react = await vi.importActual<typeof import('react')>('react');
  return {
    ...react,
    useEffect: () => {},
    useState: (initial: unknown) =>
      react.useState(harness.stateIndex++ === 0 ? harness.page : initial),
  };
});

it('shows action filtering and deletion restore without per-entry undo', () => {
  const fixture = advancedFixture();
  harness.stateIndex = 0;
  harness.page = {
    protocolVersion: 2,
    version: fixture.snapshot.project.version,
    sequence: fixture.snapshot.sequence,
    nextSince: null,
    history: [
      {
        operationId: 'delete-table',
        sequence: 1,
        format: 'native',
        changes: [
          { path: '/tables/t', beforeExists: true, afterExists: false, before: fixture.table },
        ],
        result: {
          status: 'accepted',
          actor: { id: fixture.context.userId, username: 'Tester' },
          createdAt: '2026-10-07T00:00:00Z',
        },
      },
    ],
  } as NativeHistoryPage;
  const markup = renderToStaticMarkup(
    createElement(NativeHistoryDialog, {
      embedded: true,
      userId: fixture.context.userId,
      snapshot: fixture.snapshot,
      canEdit: true,
      onClose: vi.fn(),
      onReload: vi.fn(),
    }),
  );
  expect(markup).toContain('히스토리 동작 필터');
  expect(markup).toContain('1 / 1개');
  expect(markup).toContain('삭제 복원');
  expect(markup).not.toContain('실행 취소');
  expect(markup).not.toContain('불러온 이력에서 필터링합니다.');
});

it('displays newest loaded edits first without mutating cursor data or source ordering', () => {
  const fixture = advancedFixture();
  const base = {
    format: 'native' as const,
    changes: [],
    result: {
      status: 'accepted' as const,
      actor: { id: fixture.context.userId, username: 'Tester' },
      createdAt: '2026-10-07T00:00:00Z',
    },
  };
  harness.page = {
    protocolVersion: 2,
    version: fixture.snapshot.project.version,
    sequence: 30,
    nextSince: 30,
    history: [10, 30, 20].map((sequence) => ({
      ...base,
      operationId: `operation-${sequence}`,
      sequence,
      result: { ...base.result, actor: { ...base.result.actor, username: `Actor-${sequence}` } },
    })),
  } as unknown as NativeHistoryPage;
  const original = structuredClone(harness.page);
  harness.stateIndex = 0;
  const markup = renderToStaticMarkup(
    createElement(NativeHistoryDialog, {
      embedded: true,
      userId: fixture.context.userId,
      snapshot: fixture.snapshot,
      canEdit: true,
      onClose: vi.fn(),
      onReload: vi.fn(),
    }),
  );
  expect(markup.indexOf('Actor-30')).toBeLessThan(markup.indexOf('Actor-20'));
  expect(markup.indexOf('Actor-20')).toBeLessThan(markup.indexOf('Actor-10'));
  expect(markup).toContain('이력 더 보기');
  expect(markup).toContain('최근 편집 순');
  expect(harness.page).toEqual(original);
});
