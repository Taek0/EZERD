// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NativePrimaryKeyControl } from './NativePrimaryKeyControl.js';
import { decorationSnapshot, decorationUserId } from './native-canvas-decoration-test-fixtures.js';
import type { NativeWebCommand } from './native-save.js';
const plan = vi.hoisted(() => vi.fn(() => ({ commands: [] as NativeWebCommand[] })));
vi.mock('./native-primary-key.js', () => ({ nativePrimaryKeyPlan: plan }));
vi.mock('../../shared/i18n/index.js', () => ({
  useI18n: () => ({ t: (value: string) => value }),
  registerTranslations() {},
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  plan.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it('reuses the unchanged preview while real clicks honor pending saves and the latest context', async () => {
  const snapshot = decorationSnapshot();
  if (snapshot.native.status !== 'available') throw Error();
  let acknowledge!: (accepted: boolean) => void;
  const ack = new Promise<boolean>((resolve) => {
    acknowledge = resolve;
  });
  const originalSave = vi.fn(async () => true),
    latestSave = vi.fn(() => ack);
  let props = {
    document: snapshot.native.document,
    column: snapshot.native.document.columns![0]!,
    context: { userId: decorationUserId, snapshot, busy: false, onSave: originalSave },
  };
  const render = async () => {
    await act(async () => root.render(createElement(NativePrimaryKeyControl, props)));
  };
  const checkbox = () => {
    const input = host.querySelector<HTMLInputElement>('input[aria-label="기본 키(PK)"]');
    expect(input).not.toBeNull();
    return input!;
  };
  await render();
  expect(plan).toHaveBeenCalledTimes(1);
  props = {
    ...props,
    column: { ...props.column, physical: { ...props.column.physical, name: 'local name' } },
    context: { ...props.context, onSave: latestSave, snapshot: { ...snapshot, sequence: 11 } },
  };
  await render();
  expect(plan).toHaveBeenCalledTimes(1);
  await act(async () => checkbox().click());
  expect(plan).toHaveBeenCalledTimes(2);
  expect(latestSave).toHaveBeenCalledWith([], expect.objectContaining({ sequence: 11 }));
  expect(originalSave).not.toHaveBeenCalled();
  expect(checkbox().disabled).toBe(true);
  await act(async () => checkbox().click());
  expect(latestSave).toHaveBeenCalledOnce();
  await act(async () => acknowledge(true));
  expect(checkbox().disabled).toBe(false);
  props = { ...props, document: { ...props.document, keys: [] } };
  await render();
  expect(plan).toHaveBeenCalledTimes(3);
  props = { ...props, context: { ...props.context, busy: true } };
  await render();
  expect(checkbox().disabled).toBe(true);
  await act(async () => checkbox().click());
  expect(plan).toHaveBeenCalledTimes(3);
});
