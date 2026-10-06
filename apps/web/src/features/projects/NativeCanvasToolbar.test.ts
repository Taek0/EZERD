import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NativeCanvasToolbar, NativeCameraControls } from './NativeCanvasToolbar.js';
import { setLocale } from '../../shared/i18n/index.js';
describe('native canvas chrome', () => {
  it('keeps create controls disabled for read-only views and exposes view navigation', () => {
    const html = renderToStaticMarkup(
      createElement(NativeCanvasToolbar, {
        viewId: '__tables__',
        views: [{ id: '__tables__', name: 'All' }],
        onView: () => {},
        onCreate: () => {},
        onNote: () => {},
        editable: false,
        noteEditable: false,
        disabled: false,
        mode: 'physical',
      }),
    );
    expect(html).toContain('data-view-id="__tables__"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('class="path-current"');
    expect(html).toContain('aria-pressed="true"');
  });
  it('exposes the selected tool and current zoom without document inputs', () => {
    const html = renderToStaticMarkup(
      createElement(NativeCameraControls, {
        tool: 'hand',
        onTool: () => {},
        zoom: 1.25,
        onZoom: () => {},
        onReset: () => {},
        onFit: () => {},
      }),
    );
    expect(html).toContain('125%');
    expect(html).toContain('aria-label="손 도구"');
    expect(html).toContain('aria-pressed="true"');
  });
  it.each(['ko', 'en'] as const)(
    'keeps domain filters and removes view chooser and auto layout in %s',
    (locale) => {
      setLocale(locale);
      const html = renderToStaticMarkup(
        createElement(NativeCanvasToolbar, {
          viewId: '__tables__',
          views: [
            { id: '__tables__', name: locale === 'ko' ? '전체 테이블' : 'All tables' },
            { id: 'saved', name: 'Saved view' },
          ],
          domains: [{ id: 'sales', name: 'Sales', color: undefined }],
          filter: { domainIds: ['sales'], unassigned: false },
          onFilter() {},
          onView() {},
          onNote() {},
          onMode() {},
          onToggleInspector() {},
          editable: true,
          noteEditable: true,
          disabled: true,
          mode: 'physical',
          inspectorOpen: true,
        }),
      );
      expect(html).toContain(locale === 'ko' ? '전체 테이블 · Sales' : 'All tables · Sales');
      expect(html).toContain(locale === 'ko' ? '도메인 필터' : 'Domain filter');
      expect(html).toContain(locale === 'ko' ? '필터 해제' : 'Clear filter');
      expect(html).not.toMatch(/보기 선택|Choose view|자동 배치|Automatic layout/);
      expect(html).toContain(locale === 'ko' ? '도메인 맵' : 'Domain map');
      setLocale('ko');
      expect(html).toContain('aria-controls="native-canvas-inspector"');
    },
  );
});
