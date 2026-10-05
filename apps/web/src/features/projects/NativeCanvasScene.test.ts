import { createElement, isValidElement, type ReactNode, type ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeCanvasScene, type NativeCanvasSceneProps } from './NativeCanvasScene.js';
import { nativeCanvasScene } from './NativeERDCanvas.js';
import { decorationFixture } from './native-canvas-decoration-test-fixtures.js';
import { DomainDescription } from '../domains/DomainDescription.js';
import { nativeCanvasSvg } from './native-canvas-png.js';
import { NativeCanvasInlineCell } from './NativeCanvasInlineCell.js';
import { NativeCanvasTableRows } from './NativeCanvasTableRows.js';
import { decorationSnapshot, decorationUserId } from './native-canvas-decoration-test-fixtures.js';
afterEach(() => vi.unstubAllGlobals());
vi.mock('../../shared/i18n/index.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (text: string) => text }),
}));
function props(): NativeCanvasSceneProps {
  const base = decorationFixture();
  return {
    base,
    sharedSource: base,
    drawn: nativeCanvasScene(base, '__tables__', 'physical'),
    effectiveView: '__tables__',
    mode: 'physical',
    selectedNode: null,
    selectedTableId: undefined,
    selectedDomainId: undefined,
    selectedDomainRelation: null,
    draftObjectId: undefined,
    setSelectedNode: vi.fn(),
    setSelectedDomainRelation: vi.fn(),
    onSelect: vi.fn(),
    onSelectDomain: vi.fn(),
    gesture: { current: null },
    actions: {
      current: { zoom: 1, begin: vi.fn(), preserve: vi.fn(), savePlacement: vi.fn(async () => {}) },
    },
  };
}
function scene(p: NativeCanvasSceneProps) {
  const component = (
    NativeCanvasScene as unknown as { type: (p: NativeCanvasSceneProps) => ReactNode }
  ).type;
  return component(p);
}
function article(p: NativeCanvasSceneProps, objectId = 't') {
  const visit = (node: ReactNode): ReactElement<Record<string, unknown>> | undefined => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = visit(child);
        if (found) return found;
      }
    }
    if (isValidElement<Record<string, unknown>>(node)) {
      if (node.type === 'article' && node.props['data-object-id'] === objectId) return node;
      return visit(node.props.children as ReactNode);
    }
    return undefined;
  };
  return visit(scene(p))!.props as Record<string, (event: unknown) => void>;
}
function descendants(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...descendants(node.props.children as ReactNode)];
}
describe('native scene render boundary', () => {
  it('binds the original 240ms domain entry animation to the native keyed wrapper with reduced motion disabled', () => {
    const originalCss = readFileSync(new URL('../../styles/styles.css', import.meta.url), 'utf8');
    const nativeCss = readFileSync(new URL('./NativeERDCanvas.css', import.meta.url), 'utf8');
    expect(originalCss).toContain('animation: domain-enter 0.24s ease-out;');
    expect(originalCss).toMatch(
      /@keyframes domain-enter[\s\S]*?opacity: 0\.55;[\s\S]*?scale\(0\.985\)/,
    );
    expect(nativeCss).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.native-scene-entry\s*\{\s*animation: domain-enter 240ms ease-out;/,
    );
    expect(nativeCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.native-scene-entry\s*\{\s*animation: none;/,
    );
  });
  it('keeps event handlers on the latest committed actions and zoom without rebuilding the scene', () => {
    const p = props(),
      handlers = article(p),
      node = p.drawn.nodes.find((n) => n.objectId === 't')!;
    const previous = p.actions.current;
    const next = {
      zoom: 2,
      begin: vi.fn(),
      preserve: vi.fn(),
      savePlacement: vi.fn(async () => {}),
    };
    p.actions.current = next;
    handlers.onPointerDown!({});
    expect(next.begin).toHaveBeenCalledWith({}, node);
    expect(previous.begin).not.toHaveBeenCalled();
    p.gesture.current = { node, x: 100, y: 100, pointerId: 7 };
    handlers.onPointerMove!({ pointerId: 7, clientX: 140, clientY: 160 });
    expect(next.preserve).toHaveBeenCalledWith(node, node.x + 20, node.y + 30);
    handlers.onPointerUp!({ pointerId: 7, currentTarget: { hasPointerCapture: () => false } });
    expect(next.savePlacement).toHaveBeenCalledOnce();
    expect(previous.savePlacement).not.toHaveBeenCalled();
    expect(p.gesture.current).toBeNull();
  });
  it('updates document labels and selection through ordinary props', () => {
    const p = props();
    const before = renderToStaticMarkup(createElement(NativeCanvasScene, p));
    const updated = structuredClone(p.base);
    updated.tables![0]!.physical.name = 'renamed_table';
    const after = renderToStaticMarkup(
      createElement(NativeCanvasScene, {
        ...p,
        base: updated,
        sharedSource: updated,
        drawn: nativeCanvasScene(updated, '__tables__', 'physical'),
        selectedTableId: 't',
      }),
    );
    expect(before).not.toContain('renamed_table');
    expect(after).toContain('renamed_table');
    expect(after).toContain('data-selected="true"');
  });
  it('uses the current selection callback and respects keyboard draft state', () => {
    const p = props();
    p.onSelect = vi.fn();
    p.draftObjectId = 't';
    const handlers = article(p),
      target = {};
    handlers.onKeyDown!({ target, currentTarget: target, key: 'Enter', preventDefault: vi.fn() });
    expect(p.actions.current.savePlacement).toHaveBeenCalledOnce();
    expect(p.onSelect).not.toHaveBeenCalled();
    p.draftObjectId = undefined;
    article(p).onKeyDown!({ target, currentTarget: target, key: 'Enter', preventDefault: vi.fn() });
    expect(p.onSelect).toHaveBeenCalledWith('t');
  });
  it('delegates modifier clicks without focus or title buttons collapsing multi selection', () => {
    vi.stubGlobal('Element', class {});
    const p = props();
    p.selectedObjectIds = ['t', 'n'];
    p.onNodeSelect = vi.fn();
    const target = {},
      event = { target, currentTarget: target, ctrlKey: true, shiftKey: false, metaKey: false };
    const handlers = article(p);
    handlers.onFocus!(event);
    handlers.onClick!(event);
    expect(p.setSelectedNode).not.toHaveBeenCalled();
    expect(p.onSelect).not.toHaveBeenCalled();
    expect(p.onNodeSelect).toHaveBeenCalledWith(
      p.drawn.nodes.find((node) => node.objectId === 't'),
      event,
    );
    const title = descendants(scene(p)).find(
      (node) => node.type === 'button' && node.props.children === 'records',
    )!;
    (title.props.onClick as (event: unknown) => void)(event);
    expect(p.onSelect).not.toHaveBeenCalled();
    expect(
      renderToStaticMarkup(createElement(NativeCanvasScene, p)).match(/data-selected="true"/g),
    ).toHaveLength(2);
  });
  it('does not select child focus and uses original note body without a synthetic title header', () => {
    const p = props();
    article(p).onFocus!({ target: {}, currentTarget: {} });
    expect(p.setSelectedNode).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(createElement(NativeCanvasScene, p));
    const note = html.split('data-object-id="n"')[1]!;
    expect(note).toContain('class="note-content"');
    expect(note).not.toContain('<header');
  });
  it('reuses original domain/note editor and disables edits and movement on an unsaved domain preview', () => {
    const p = props();
    p.onDescriptionCommit = vi.fn();
    let editor = descendants(scene(p)).find(
      (node) => node.type === DomainDescription && node.props.memo,
    )!;
    expect(editor.props.readOnly).toBe(false);
    (editor.props.onCommit as (value: string) => void)('Revised note');
    expect(p.onDescriptionCommit).toHaveBeenCalledWith('n', 'Revised note');
    p.effectiveView = 'overview';
    p.drawn = nativeCanvasScene(p.base, 'overview', 'physical');
    p.sharedSource = { ...p.base, layout: { ...p.base.layout, nodes: [] } };
    editor = descendants(scene(p)).find(
      (node) => node.type === DomainDescription && node.props.name === 'Orders',
    )!;
    expect(editor.props.readOnly).toBe(true);
    article(p, 'a').onPointerDown!({});
    expect(p.actions.current.begin).not.toHaveBeenCalled();
    const target = {};
    article(p, 'a').onKeyDown!({
      target,
      currentTarget: target,
      key: 'ArrowRight',
      preventDefault: vi.fn(),
    });
    expect(p.actions.current.preserve).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(createElement(NativeCanvasScene, p));
    expect(html).toContain('업무 영역을 설명해 주세요');
    expect(html).toContain('data-preview="true"');
    expect(html).not.toContain('native-card-resize');
  });
  it('delegates the object context menu and domain Enter navigation while preserving child text menus', () => {
    class FakeElement {
      constructor(private readonly editable: boolean) {}
      closest() {
        return this.editable ? this : null;
      }
    }
    vi.stubGlobal('Element', FakeElement);
    const p = props();
    p.onNodeContextMenu = vi.fn();
    const event = { target: new FakeElement(false) };
    article(p).onContextMenu!(event);
    expect(p.onNodeContextMenu).toHaveBeenCalledWith(
      p.drawn.nodes.find((node) => node.objectId === 't'),
      event,
    );
    article(p).onContextMenu!({ target: new FakeElement(true) });
    expect(p.onNodeContextMenu).toHaveBeenCalledOnce();
    p.effectiveView = 'overview';
    p.drawn = nativeCanvasScene(p.base, 'overview', 'physical');
    p.onOpenDomain = vi.fn();
    const target = {};
    article(p, 'a').onKeyDown!({
      target,
      currentTarget: target,
      key: 'Enter',
      preventDefault: vi.fn(),
    });
    expect(p.onOpenDomain).toHaveBeenCalledWith('a');
  });
  it('keeps original 1px and shift 10px movement against the current actions ref', () => {
    const p = props(),
      target = {};
    const node = p.drawn.nodes.find((value) => value.objectId === 't')!;
    const handlers = article(p);
    handlers.onKeyDown!({
      target,
      currentTarget: target,
      key: 'ArrowRight',
      shiftKey: false,
      preventDefault: vi.fn(),
    });
    expect(p.actions.current.preserve).toHaveBeenLastCalledWith(node, node.x + 1, node.y);
    handlers.onKeyDown!({
      target,
      currentTarget: target,
      key: 'ArrowDown',
      shiftKey: true,
      preventDefault: vi.fn(),
    });
    expect(p.actions.current.preserve).toHaveBeenLastCalledWith(node, node.x, node.y + 10);
  });
  it.each([
    ['postgresSchema', '', 'physical', 'records', 'public'],
    ['postgresSchema', 'BusinessSchema', 'physical', 'records', 'BusinessSchema'],
    ['postgresSchema', 'BusinessSchema', 'logical', 'Records', ''],
    ['mysqlCurrentDatabase', '', 'physical', 'records', ''],
    ['sqliteMain', '', 'physical', 'records', ''],
    ['legacyNamespace', 'OriginalSchema', 'physical', 'records', ''],
  ] as const)(
    'keeps %s / %s namespace and %s names identical in header and PNG',
    (kind, name, mode, title, badge) => {
      const p = props();
      const namespace =
        kind === 'postgresSchema'
          ? { kind, name }
          : kind === 'legacyNamespace'
            ? { kind, source: 'document-v1' as const, original: name }
            : { kind };
      p.base.tables![0]!.physical.namespace = namespace;
      p.mode = mode;
      p.drawn = nativeCanvasScene(p.base, '__tables__', mode);
      const html = renderToStaticMarkup(createElement(NativeCanvasScene, p));
      const { svg } = nativeCanvasSvg(p.base, p.drawn, mode);
      expect(html).toContain(`>${title}</button>`);
      expect(svg).toContain(`>${title}</text>`);
      if (badge) {
        expect(html).toContain(`class="native-table-schema" title="${badge}"`);
        expect(svg).toContain(`>${badge}</text>`);
      } else {
        expect(html).not.toContain('class="native-table-schema"');
        expect(svg).not.toContain('>public</text>');
        expect(svg).not.toContain('>BusinessSchema</text>');
      }
    },
  );
  it('uses matching physical/logical fallback and unnamed title in header and export', () => {
    const p = props();
    p.base.tables![0]!.physical.name = '';
    let html = renderToStaticMarkup(createElement(NativeCanvasScene, p));
    let svg = nativeCanvasSvg(p.base, p.drawn, p.mode).svg;
    expect(html).toContain('>Records</button>');
    expect(svg).toContain('>Records</text>');
    p.base.tables![0]!.logical.name = '';
    html = renderToStaticMarkup(createElement(NativeCanvasScene, p));
    svg = nativeCanvasSvg(p.base, p.drawn, p.mode).svg;
    expect(html).toContain('>이름 없는 테이블</button>');
    expect(svg).toContain('>이름 없는 테이블</text>');
  });
  it('forwards the parent inline policy and structure requests to title and column cells', () => {
    const p = props();
    p.editorContext = {
      userId: decorationUserId,
      snapshot: decorationSnapshot(p.base),
      busy: false,
      onSave: vi.fn(async () => true),
    };
    p.onEdit = vi.fn();
    p.onRequestStructure = vi.fn();
    p.onRequestAction = vi.fn();
    const tree = descendants(scene(p));
    const title = tree.find((node) => node.type === NativeCanvasInlineCell)!;
    expect(title.props.context).toBe(p.editorContext);
    expect(title.props.target).toEqual({ tableId: 't', mode: 'physical', field: 'name' });
    expect(title.props.title).toBe(true);
    expect(title.props.onAdvancedFormat).toBe(p.onEdit);
    const rows = tree.find((node) => node.type === NativeCanvasTableRows)!;
    expect(rows.props.editorContext).toBe(p.editorContext);
    expect(rows.props.onRequestStructure).toBe(p.onRequestStructure);
    expect(rows.props.onRequestAction).toBe(p.onRequestAction);
    p.editorContext = undefined;
    expect(descendants(scene(p)).some((node) => node.type === NativeCanvasInlineCell)).toBe(false);
  });
  it('captures modifier clicks before an inline cell starts editing or replaces group selection', () => {
    class InlineElement {
      closest() {
        return this;
      }
    }
    vi.stubGlobal('Element', InlineElement);
    const p = props();
    p.onNodeSelect = vi.fn();
    const target = new InlineElement(),
      preventDefault = vi.fn(),
      stopPropagation = vi.fn();
    const event = {
      target,
      ctrlKey: true,
      shiftKey: false,
      metaKey: false,
      preventDefault,
      stopPropagation,
    };
    const handlers = article(p);
    handlers.onPointerDownCapture!(event);
    handlers.onClickCapture!(event);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(p.onNodeSelect).toHaveBeenCalledWith(
      p.drawn.nodes.find((node) => node.objectId === 't'),
      event,
    );
    expect(p.onSelect).not.toHaveBeenCalled();
  });
});
