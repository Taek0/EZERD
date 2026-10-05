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
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('value="__tables__"');
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
});
