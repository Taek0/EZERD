import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  NativeCanvasToolbar,
  NativeCameraControls,
  type NativeCanvasToolbarProps,
} from './NativeCanvasToolbar.js';
import { Dropdown } from '../../components/ui/index.js';
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

it.each(['ko', 'en'] as const)(
  'keeps recovery menu reachable while writes are blocked in %s',
  (locale) => {
    setLocale(locale);
    const html = renderToStaticMarkup(
      createElement(NativeCanvasToolbar, {
        viewId: '__tables__',
        views: [],
        onView() {},
        onNote() {},
        onOpenRecovery() {},
        editable: true,
        noteEditable: true,
        disabled: true,
        mode: 'physical',
      }),
    );
    const more = html.match(
      new RegExp('<button[^>]*aria-label="' + (locale === 'ko' ? '더 보기' : 'More') + '"[^>]*>'),
    )?.[0];
    expect(more).toBeDefined();
    expect(more).not.toContain('disabled');
    expect(html).not.toContain(locale === 'ko' ? '보관된 입력 복구' : 'Recover preserved input');
    setLocale('ko');
  },
);

vi.mock('../../shared/i18n/index.js', async (original) => {
  const actual = await original<typeof import('../../shared/i18n/index.js')>();
  return { ...actual, useI18n: () => ({ t: actual.translate }) };
});
function toolbarNodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(toolbarNodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...toolbarNodes(tree.props.children)];
}
it('keeps only design review and recovery in More, invoking their actions while writes are blocked', () => {
  const onOpenIssues = vi.fn(),
    onOpenRecovery = vi.fn();
  const tree = (
    NativeCanvasToolbar as unknown as { type: (props: NativeCanvasToolbarProps) => ReactElement }
  ).type({
    viewId: '__tables__',
    views: [],
    onView() {},
    onCreate() {},
    onNote() {},
    onOpenIssues,
    onOpenRecovery,
    editable: false,
    noteEditable: false,
    disabled: true,
    mode: 'physical',
  });
  const menu = toolbarNodes(tree).find((node) => node.type === Dropdown)!;
  const items = menu.props.items as { id: string; disabled?: boolean; onAction: () => void }[];
  expect(items.map((item) => item.id)).toEqual(['design-issues', 'recovery']);
  for (const item of items) {
    expect(item.disabled).not.toBe(true);
    item.onAction();
  }
  expect(onOpenIssues).toHaveBeenCalledOnce();
  expect(onOpenRecovery).toHaveBeenCalledOnce();
});
