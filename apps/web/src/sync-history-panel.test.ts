import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SyncHistoryContent, SyncHistoryPanel } from './sync-history-panel.js';
import type { SyncSnapshot } from './sync-client.js';

const entityId = '11111111-2222-4333-8444-555555555555';

describe('unified sync history panel', () => {
  it('offers copy for unresolved edits and preview plus restore for deletions', () => {
    const snapshot = {
      document: {} as SyncSnapshot['document'],
      status: 'action-needed',
      canUndo: false,
      canRedo: false,
      pending: [
        {
          operationId: 'pending',
          createdAt: 1,
          state: 'unresolved',
          reason: '충돌',
          operation: {
            changes: [{ path: `/domains/${entityId}/name`, before: '기존', after: '초안' }],
          },
        },
      ],
      history: [
        {
          operationId: 'deleted',
          createdAt: new Date(0).toISOString(),
          actor: { username: '설계자' },
          changes: [
            {
              path: `/domains/${entityId}`,
              before: { id: entityId, name: '주문' },
              after: null,
              afterExists: false,
            },
          ],
          changedPaths: [`/domains/${entityId}`],
        },
      ],
    } as unknown as SyncSnapshot;

    const html = renderToStaticMarkup(
      h(SyncHistoryContent, {
        snapshot,
        notice: '관계·배치 2개는 제외했습니다.',
        onRestore: () => {},
        onReapply: () => {},
        onDiscard: () => {},
      }),
    );

    expect(html).toContain('재적용');
    expect(html).toContain('변경 내용 복사');
    expect(html).toContain('폐기');
    expect(html).toContain('삭제 당시 내용 미리보기');
    expect(html).toContain('새 객체로 복원');
    expect(html).toContain('주문');
    expect(html).toContain('관계·배치 2개는 제외했습니다.');
    expect(html).toContain('설계자');
    expect(html).toContain(
      new Date(0).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }),
    );
    expect(html).toContain('히스토리');
    expect(html).not.toContain(entityId);
    expect(html).not.toContain(`/domains/${entityId}`);
  });

  it('renders a shared button trigger with a dialog popup', () => {
    const html = renderToStaticMarkup(h(SyncHistoryPanel, { snapshot: null }));
    expect(html).toContain('히스토리');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('sync-history-trigger');
    expect(html).not.toContain('<summary');
  });
});

it('keeps removed optional properties in changes rather than offering object restoration', () => {
  const snapshot = {
    document: {},
    pending: [],
    history: [
      {
        operationId: 'unset',
        createdAt: new Date(0).toISOString(),
        actor: { username: '설계자' },
        changedPaths: ['/columns/' + entityId + '/physical/type/length'],
        changes: [
          {
            path: '/columns/' + entityId + '/physical/type/length',
            before: 32,
            after: null,
            afterExists: false,
          },
        ],
      },
    ],
  } as unknown as SyncSnapshot;
  const html = renderToStaticMarkup(h(SyncHistoryContent, { snapshot, onRestore: () => {} }));
  expect(html).not.toContain('새 객체로 복원');
  expect(html).toContain('타입 설정 변경');
  expect(html).not.toContain(entityId);
});
