import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu } from '../../components/ui/index.js';
import { NativeCanvasTableRows } from './NativeCanvasTableRows.js';
import {
  decorationFixture,
  decorationSnapshot,
  decorationUserId,
} from './native-canvas-decoration-test-fixtures.js';

const state = vi.hoisted(() => ({ menu: null as unknown }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: () => [
    state.menu,
    (value: unknown) => {
      state.menu = value;
    },
  ],
}));
vi.mock('../../shared/i18n/index.js', async (original) => ({
  ...(await original<object>()),
  useI18n: () => ({ t: (text: string) => text }),
}));

class Target {
  getBoundingClientRect = vi.fn(() => ({ left: 30, top: 40 }));
  constructor(private editing = false) {}
  closest(selector: string) {
    return selector === '[data-column-id]' || this.editing ? this : null;
  }
  getAttribute() {
    return 'c';
  }
}
function elements(tree: unknown): ReactElement<Record<string, any>>[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!isValidElement<Record<string, any>>(tree)) return [];
  return [tree, ...elements(tree.props.children)];
}
function fixture() {
  const document = decorationFixture();
  const props = {
    document,
    table: document.tables![0]!,
    mode: 'physical' as const,
    onSelect: vi.fn(),
    onRequestStructure: vi.fn(),
    editorContext: {
      userId: decorationUserId,
      snapshot: decorationSnapshot(document),
      busy: false,
      onSave: vi.fn(async () => true),
    },
  };
  const render = () => {
    const menu = NativeCanvasTableRows(props);
    return elements((menu.type as Function)(menu.props));
  };
  return { props, render };
}
beforeEach(() => {
  state.menu = null;
  vi.stubGlobal('Element', Target);
});
afterEach(() => vi.unstubAllGlobals());

describe('column context menu input path', () => {
  it('opens on secondary click without focusing an inline editor or opening the inspector', () => {
    const { props, render } = fixture();
    const row = new Target();
    const event = {
      target: row,
      button: 2,
      clientX: 100,
      clientY: 120,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    const table = render().find((element) => element.props.role === 'table')!;
    table.props.onPointerDownCapture?.(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    table.props.onContextMenu(event);
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(row.getBoundingClientRect).not.toHaveBeenCalled();
    const menu = render().find((element) => element.type === ContextMenu)!;
    expect(menu.props.position).toMatchObject({ x: 100, y: 120, columnId: 'c' });
    menu.props.items.find((item: { id: string }) => item.id === 'edit-column').onAction();
    expect(props.onRequestStructure).toHaveBeenCalledWith('patch', '["columns","c"]', 't');
  });
  it('preserves normal primary clicks and existing text editor pointer behavior', () => {
    const { render } = fixture();
    const table = render().find((element) => element.props.role === 'table')!;
    for (const [button, editing] of [
      [0, false],
      [2, true],
    ] as const) {
      const preventDefault = vi.fn();
      table.props.onPointerDownCapture?.({ target: new Target(editing), button, preventDefault });
      expect(preventDefault).not.toHaveBeenCalled();
    }
  });
  it('anchors keyboard opening to the row and leaves text input shortcuts alone', () => {
    const { props, render } = fixture();
    const table = render().find((element) => element.props.role === 'table')!;
    const event = {
      target: new Target(),
      key: 'F10',
      shiftKey: true,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    table.props.onKeyDownCapture(event);
    expect(state.menu).toEqual({ x: 40, y: 68, columnId: 'c' });
    expect(props.onSelect).not.toHaveBeenCalled();
    state.menu = null;
    table.props.onKeyDownCapture({ ...event, target: new Target(true) });
    expect(state.menu).toBeNull();
  });
});
