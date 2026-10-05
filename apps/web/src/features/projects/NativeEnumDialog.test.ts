import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { NativeEnumDialog } from './NativeEnumDialog.js';
import { advancedFixture } from './native-advanced-test-fixtures.js';
const harness = vi.hoisted(() => ({
  effect: null as (() => (() => void) | void) | null,
  dialog: { showModal: vi.fn(), close: vi.fn() },
  content: null as ReactElement<Record<string, any>> | null,
}));
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useEffect: (effect: () => void) => {
    harness.effect = effect;
  },
  useRef: () => ({ current: harness.dialog }),
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
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  harness.effect = null;
  harness.content = null;
});
it('uses native modal/escape semantics and restores the previous connected trigger on closing', () => {
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
  expect(onClose).toHaveBeenCalledOnce();
  cleanup!();
  expect(harness.dialog.close).toHaveBeenCalledOnce();
  expect(previous.focus).toHaveBeenCalledOnce();
});
