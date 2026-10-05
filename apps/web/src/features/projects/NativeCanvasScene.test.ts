import { createElement, isValidElement, type ReactNode, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NativeCanvasScene, type NativeCanvasSceneProps } from './NativeCanvasScene.js';
import { nativeCanvasScene } from './NativeERDCanvas.js';
import { decorationFixture } from './native-canvas-decoration-test-fixtures.js';
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
function article(p: NativeCanvasSceneProps) {
  const component = (
    NativeCanvasScene as unknown as { type: (p: NativeCanvasSceneProps) => ReactNode }
  ).type;
  const visit = (node: ReactNode): ReactElement<Record<string, unknown>> | undefined => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = visit(child);
        if (found) return found;
      }
    }
    if (isValidElement<Record<string, unknown>>(node)) {
      if (node.type === 'article' && node.props['data-object-id'] === 't') return node;
      return visit(node.props.children as ReactNode);
    }
    return undefined;
  };
  return visit(component(p))!.props as Record<string, (event: unknown) => void>;
}
describe('native scene render boundary', () => {
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
});
