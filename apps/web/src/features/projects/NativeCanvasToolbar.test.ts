import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NativeCanvasToolbar, NativeCameraControls } from './NativeCanvasToolbar.js';
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
  it('restores original view buttons, current filtered path and a guarded auto layout action', () => {
    const html = renderToStaticMarkup(
      createElement(NativeCanvasToolbar, {
        viewId: '__tables__',
        views: [{ id: '__tables__', name: '전체 테이블' }],
        domains: [{ id: 'sales', name: 'Sales', color: undefined }],
        filter: { domainIds: ['sales'], unassigned: false },
        onFilter() {},
        onView() {},
        onNote() {},
        onAutoLayout() {},
        onMode() {},
        onToggleInspector() {},
        editable: true,
        noteEditable: true,
        disabled: true,
        mode: 'physical',
        inspectorOpen: true,
      }),
    );
    expect(html).toContain('title="전체 테이블 · Sales"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*><span[^>]*>자동 배치<\/span><\/button>/);
    expect(html).toContain('도메인 맵');
    expect(html).toContain('aria-controls="native-canvas-inspector"');
  });
});
