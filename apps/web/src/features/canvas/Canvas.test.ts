import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createEmptyDocument, addDomain, addTable, upsertDomainRelation } from '@ezerd/model';
import { ConfirmProvider } from '../../components/ui/ConfirmProvider.js';
import { Canvas } from './Canvas.js';
import { setLocale } from '../../shared/i18n/index.js';

function example() {
  let doc = addDomain(
    createEmptyDocument(),
    { id: 'a', name: '결제', description: '결제 업무 영역' },
    { x: 0, y: 0 },
  );
  doc = addDomain(doc, { id: 'b', name: '주문', description: '' }, { x: 400, y: 0 });
  return upsertDomainRelation(doc, {
    id: 'r',
    sourceDomainId: 'a',
    targetDomainId: 'b',
    name: '주문 결제',
    direction: 'forward',
    description: '',
  });
}

function markup(readOnly = false) {
  return render(
    h(ConfirmProvider, null, h(Canvas, { document: example(), onChange: () => {}, readOnly })),
  );
}

describe('editor sidebar structure', () => {
  it('starts an empty project globally and makes both canvas modes accessible without saving on render', () => {
    const document = createEmptyDocument();
    const before = structuredClone(document);
    const changes: DesignDocument[] = [];
    const html = render(
      h(
        ConfirmProvider,
        null,
        h(Canvas, { document, onChange: (doc) => changes.push(doc), readOnly: false }),
      ),
    );
    expect(html).toContain('aria-label="전체 테이블 캔버스"');
    expect(html).toContain('테이블부터 시작하세요');
    expect(html).toContain('첫 테이블 만들기');
    expect(html).toContain('＋ 테이블');
    expect(html).toContain('도메인 맵');
    expect(changes).toEqual([]);
    expect(document).toEqual(before);
    const legacy = markup();
    expect(legacy).toContain('aria-label="도메인 맵 캔버스"');
    expect(legacy).toContain('전체 테이블');
  });

  it('renders all unassigned physical tables globally with owner labels and keeps viewers read-only', () => {
    const document = addTable(
      createEmptyDocument(),
      {
        id: 't',
        domainId: null,
        scope: 'physical',
        logical: { name: 'Order', definition: '' },
        physical: { name: 'orders', schema: 'public', comment: '' },
        customProperties: { common: {}, logical: {}, physical: {} },
        color: '#ffffff',
      },
      { x: 10, y: 20 },
    );
    const html = render(
      h(
        ConfirmProvider,
        null,
        h(Canvas, { document, onChange: () => {}, readOnly: true, personalReadOnly: false }),
      ),
    );
    expect(html).toContain('orders');
    expect(html).toContain('background:#ffffff;color:#ffffff');
    expect(html).toContain('class="table-owner-badge" title="미지정">미지정');
    expect(html).not.toContain('외부 참조 · ');
    expect(html).not.toContain('이 화면의 참조 제거');
    const create = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find((match) =>
      match[2]?.includes('＋ 테이블'),
    );
    expect(create?.[1]).toMatch(/\bdisabled=""/);
  });
  it('switches editor labels to English while preserving user-authored domain content', () => {
    const doc = example();
    const before = JSON.stringify(doc);
    try {
      setLocale('en');
      const html = render(
        h(ConfirmProvider, null, h(Canvas, { document: doc, onChange: () => {}, readOnly: false })),
      );
      expect(html).toContain('Domain map');
      expect(html).toContain('Create a domain');
      expect(html).toContain('＋ Domain');
      expect(html).toContain('Cursor tool');
      expect(html).toContain('결제 업무 영역');
      expect(html).toContain('주문 결제');
      expect(JSON.stringify(doc)).toBe(before);
      setLocale('ko');
      expect(markup()).toContain('도메인 맵');
    } finally {
      setLocale('ko');
    }
  });

  it('keeps one panel frame with a place, a selection slot and both panel views', () => {
    const html = markup();
    expect(html).toContain('inspector-topbar');
    expect(html).toContain('inspector-tabs');
    expect(html.replace(/<[^>]*>/g, '')).toContain('속성');
    expect(html).toContain('panel-count');
    expect(html).not.toContain('02 / INSPECTOR');
  });

  it('shows only the selected panel view so both questions never compete for the same space', () => {
    const html = markup();
    expect(html).toContain('새 도메인 만들기');
    expect(html).toContain('새 도메인 관계');
    expect(html).not.toContain('현재 화면 검색');
  });

  it('creates from the toolbar and keeps auto layout on the canvas menu only', () => {
    const html = markup();
    const toolbar = html.slice(html.indexOf('canvas-toolbar'), html.indexOf('canvas-surface'));
    expect(toolbar).toContain('＋ 도메인');
    expect(toolbar).toContain('＋ 메모');
    expect(toolbar).toContain('canvas-inspector');
    expect(toolbar).not.toContain('자동 배치');
  });

  it('keeps the same frame while archived projects stay read-only', () => {
    const html = markup(true);
    expect(html).toContain('inspector-tabs');
    const create = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find((match) =>
      match[2]?.includes('＋ 도메인'),
    );
    expect(create?.[1]).toMatch(/\bdisabled=""/);
  });
});

import { referencedDomainTables } from './Canvas.js';
import type { DesignDocument } from '@ezerd/model';
describe('saved view reference table list', () => {
  it('lists only physical cross-domain relations shared through a saved domain view, in either direction', () => {
    const doc = {
      ...example(),
      views: [{ id: 'view', name: '함께', domainIds: ['a', 'b'] }],
      tables: [
        { id: 'own', domainId: 'a', scope: 'physical' },
        { id: 'parent', domainId: 'b', scope: 'physical' },
        { id: 'child', domainId: 'b', scope: 'physical' },
        { id: 'unrelated', domainId: 'b', scope: 'physical' },
        { id: 'not-shared', domainId: 'c', scope: 'physical' },
        { id: 'logical', domainId: 'b', scope: 'logical' },
        { id: 'unassigned', domainId: null, scope: 'physical' },
      ],
      tableRelations: [
        { sourceTableId: 'own', targetTableId: 'parent', scope: 'physical', physical: {} },
        { sourceTableId: 'child', targetTableId: 'own', scope: 'physical', physical: {} },
        { sourceTableId: 'own', targetTableId: 'not-shared', scope: 'physical', physical: {} },
        { sourceTableId: 'own', targetTableId: 'logical', scope: 'both', physical: {} },
        { sourceTableId: 'own', targetTableId: 'unassigned', scope: 'physical', physical: {} },
      ],
    } as unknown as DesignDocument;
    expect(referencedDomainTables(doc, 'a').map((t) => t.id)).toEqual(['parent', 'child']);
    expect(referencedDomainTables({ ...doc, views: [] }, 'a')).toEqual([]);
    expect(referencedDomainTables({ ...doc, tableRelations: [] }, 'a')).toEqual([]);
  });
});
