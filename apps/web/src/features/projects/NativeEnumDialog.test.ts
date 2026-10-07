import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { NativeEnumDialog } from './NativeEnumDialog.js';
import { advancedFixture } from './native-advanced-test-fixtures.js';
import type { NativeEditorContext } from './native-editor-form.js';
const harness = vi.hoisted(() => ({
  effect: null as (() => (() => void) | void) | null,
  dialog: {
    showModal: vi.fn(),
    close: vi.fn(),
    scrollIntoView: vi.fn(),
    querySelector: vi.fn(() => null),
  },
  content: null as ReactElement<Record<string, any>> | null,
  states: null as unknown[] | null,
  stateIndex: 0,
}));
vi.mock('react', async () => {
  const react = await vi.importActual<typeof import('react')>('react');
  return {
    ...react,
    useState: (initial: unknown) => {
      if (!harness.states) return react.useState(initial);
      const index = harness.stateIndex++;
      return [
        harness.states[index],
        (value: unknown) => {
          harness.states![index] = value;
        },
      ];
    },
    useEffect: (effect: () => void) => {
      harness.effect = effect;
    },
    useRef: (initial: unknown) => ({ current: initial === null ? harness.dialog : initial }),
  };
});
vi.mock('./native-editor-structure.js', () => ({
  NativeStructureEditor: ({
    initialSelection,
    focused,
  }: {
    initialSelection: { action: string };
    focused: boolean;
  }) =>
    createElement(
      'form',
      { 'data-action': initialSelection.action, 'data-focused': focused },
      createElement('input'),
    ),
  NativeDeleteForm: () => createElement('form'),
}));
vi.mock('react-dom', async () => ({
  ...(await vi.importActual<typeof import('react-dom')>('react-dom')),
  createPortal: (content: ReactElement<Record<string, any>>) => {
    harness.content = content;
    return content;
  },
}));
vi.mock('../../components/ui/index.js', () => ({
  Button: (props: Record<string, unknown>) => createElement('button', props),
  IconButton: (props: Record<string, unknown>) => createElement('button', props),
  Input: (props: Record<string, unknown>) => createElement('input', props),
  AnimatedDetails: (props: Record<string, unknown>) => createElement('details', props),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  harness.effect = null;
  harness.content = null;
  harness.states = null;
  harness.stateIndex = 0;
});
it('uses native modal/escape semantics and restores the previous connected trigger on closing', () => {
  vi.useFakeTimers();
  class FakeElement {
    isConnected = true;
    focus = vi.fn();
  }
  const previous = new FakeElement();
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('document', { activeElement: previous, body: {} });
  const f = advancedFixture(),
    onClose = vi.fn();
  f.document.enums = [
    { id: 'e', schema: 'public', name: 'state', values: ['', 'a\nb', '<saved>'] },
  ];
  const html = renderToStaticMarkup(
    createElement(NativeEnumDialog, { document: f.document, onClose }),
  );
  const cleanup = harness.effect!();
  expect(harness.dialog.showModal).toHaveBeenCalledOnce();
  expect(html).toContain('<dialog');
  expect(html).toContain('aria-labelledby="native-enum-dialog-title"');
  expect(html).toContain('ENUM 검색');
  expect(html).toContain('a\nb');
  expect(html).toContain('&lt;saved&gt;');
  const event = { preventDefault: vi.fn() };
  harness.content!.props.onCancel(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
  vi.advanceTimersByTime(160);
  expect(onClose).toHaveBeenCalledOnce();
  cleanup!();
  expect(harness.dialog.close).toHaveBeenCalledOnce();
  expect(previous.focus).toHaveBeenCalledOnce();
});
it('closes immediately when reduced motion is requested', () => {
  vi.stubGlobal('document', { body: {} });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
  const onClose = vi.fn();
  renderToStaticMarkup(
    createElement(NativeEnumDialog, { document: advancedFixture().document, onClose }),
  );
  harness.content!.props.onCancel({ preventDefault: vi.fn() });
  expect(onClose).toHaveBeenCalledOnce();
});
it('opens the focused create form above the list immediately and keeps it on repeated add clicks', () => {
  vi.stubGlobal('document', { body: {} });
  harness.states = ['', null, false, false];
  const fixture = advancedFixture();
  fixture.document.enums = [{ id: 'e', schema: 'public', name: 'existing', values: ['one'] }];
  const render = () => {
    harness.stateIndex = 0;
    return renderToStaticMarkup(
      createElement(NativeEnumDialog, {
        document: fixture.document,
        context: { busy: false } as NativeEditorContext,
        onClose: vi.fn(),
      }),
    );
  };
  const findAdd = (node: ReactNode): ReactElement<Record<string, any>> | undefined => {
    for (const child of Children.toArray(node)) {
      if (!isValidElement<Record<string, any>>(child)) continue;
      if (child.props.children === 'ENUM 추가') return child;
      const found = findAdd(child.props.children);
      if (found) return found;
    }
  };
  expect(render()).not.toContain('native-enum-editor');
  findAdd(harness.content)!.props.onClick();
  const markup = render();
  expect(markup).toContain('data-action="enum" data-focused="true"');
  expect(markup.indexOf('native-enum-editor')).toBeLessThan(markup.indexOf('table-enum-list'));
  // An already open editor retains the same selection and therefore the same durable form.
  findAdd(harness.content)!.props.onClick();
  expect(harness.states[1]).toBe('new');
  expect(render()).toContain('data-action="enum" data-focused="true"');
});

it('identifies the selected ENUM and separates editing from deletion confirmation', () => {
  vi.stubGlobal('document', { body: {} });
  harness.states = ['', 'e', false, false];
  const fixture = advancedFixture();
  fixture.document.enums = [{ id: 'e', schema: 'public', name: 'order_state', values: ['open'] }];
  const render = () => {
    harness.stateIndex = 0;
    return renderToStaticMarkup(
      createElement(NativeEnumDialog, {
        document: fixture.document,
        context: { busy: false } as NativeEditorContext,
        onClose: vi.fn(),
      }),
    );
  };
  const find = (node: ReactNode, label: string): ReactElement<Record<string, any>> | undefined => {
    for (const child of Children.toArray(node)) {
      if (!isValidElement<Record<string, any>>(child)) continue;
      if (child.props.children === label || child.props['aria-label'] === label) return child;
      const result = find(child.props.children, label);
      if (result) return result;
    }
  };
  const markup = render();
  expect(markup).toContain('ENUM 편집');
  expect(markup).toContain('data-selected="true"');
  expect(markup).toContain('aria-pressed="true"');
  expect(markup).toContain('data-action="patch"');
  find(harness.content, '삭제')!.props.onClick();
  const deleting = render();
  expect(deleting).toContain('ENUM 삭제 확인');
  expect(deleting).toContain('data-deleting="true"');
  expect(deleting).not.toContain('data-action="patch"');
  find(harness.content, '편집 영역 닫기')!.props.onClick();
  expect(render()).not.toContain('native-enum-editor-title');
  expect(harness.states[1]).toBeNull();
});
