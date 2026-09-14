import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createEmptyDocument, addDomain, upsertDomainRelation } from '@ezerd/model';
import { Canvas } from './Canvas.js';

function example() {
  let doc = addDomain(createEmptyDocument(), { id: 'a', name: '결제', description: '결제 업무 영역' }, { x: 0, y: 0 });
  doc = addDomain(doc, { id: 'b', name: '주문', description: '' }, { x: 400, y: 0 });
  return upsertDomainRelation(doc, { id: 'r', sourceDomainId: 'a', targetDomainId: 'b', name: '주문 결제', direction: 'forward', description: '' });
}

function markup(readOnly = false) {
  return render(h(Canvas, { document: example(), onChange: () => {}, readOnly }));
}

describe('editor sidebar structure', () => {
  it('keeps one panel frame with a place, a selection slot and both panel views', () => {
    const html = markup();
    expect(html).toContain('inspector-topbar');
    expect(html).toContain('inspector-tabs');
    expect(html).toContain('>속성</button>');
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
    expect(toolbar).toContain('＋ 텍스트');
    expect(toolbar).toContain('canvas-inspector');
    expect(toolbar).not.toContain('자동 배치');
  });

  it('keeps the same frame while archived projects stay read-only', () => {
    const html = markup(true);
    expect(html).toContain('inspector-tabs');
    const create = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(match => match[2]?.includes('＋ 도메인'));
    expect(create?.[1]).toMatch(/\bdisabled=""/);
  });
});

