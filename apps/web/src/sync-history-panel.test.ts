import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SyncHistoryPanel } from './sync-history-panel.js';
import type { SyncSnapshot } from './sync-client.js';

describe('unified sync history panel', () => {
  it('offers copy for unresolved edits and preview plus restore for deletions', () => {
    const snapshot = {
      document: {} as SyncSnapshot['document'], status: 'action-needed', canUndo: false, canRedo: false,
      pending: [{ operationId: 'pending', createdAt: 1, state: 'unresolved', reason: '충돌', operation: { changes: [{ path: '/domains/a/name', before: '기존', after: '초안' }] } }],
      history: [{ operationId: 'deleted', createdAt: new Date(0).toISOString(), actor: { username: '설계자' }, changes: [{ path: '/domains/a', before: { name: '주문' }, after: null, afterExists: false }], changedPaths: ['/domains/a'] }],
    } as unknown as SyncSnapshot;

    const html = renderToStaticMarkup(h(SyncHistoryPanel, { snapshot, notice: '관계·배치 2개는 제외했습니다.', onRestore: () => {}, onReapply: () => {}, onDiscard: () => {} }));

    expect(html).toContain('재적용');
    expect(html).toContain('변경 내용 복사');
    expect(html).toContain('폐기');
    expect(html).toContain('삭제 당시 내용 미리보기');
    expect(html).toContain('새 객체로 복원');
    expect(html).toContain('주문');
    expect(html).toContain('관계·배치 2개는 제외했습니다.');
  });
});
