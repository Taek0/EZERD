import { expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { NativePrimaryKeyControl } from './NativePrimaryKeyControl.js';
import { decorationSnapshot, decorationUserId } from './native-canvas-decoration-test-fixtures.js';
const h = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  plan: vi.fn(() => ({ commands: [] as any[], code: undefined as string | undefined })),
}));
vi.mock('./native-primary-key.js', () => ({ nativePrimaryKeyPlan: h.plan }));
vi.mock('../../shared/i18n/index.js', () => ({
  useI18n: () => ({ t: (v: string) => v }),
  registerTranslations() {},
}));
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return {
    ...react,
    useState(initial: any) {
      const i = h.index++;
      if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial;
      return [
        h.slots[i],
        (v: any) => {
          h.slots[i] = v;
        },
      ];
    },
    useRef(initial: any) {
      return (h.slots[h.index++] ??= { current: initial });
    },
    useMemo(make: () => unknown, deps: unknown[]) {
      const i = h.index++;
      const old = h.slots[i];
      if (!old || deps.some((v, j) => !Object.is(v, old.deps[j])))
        h.slots[i] = { deps, value: make() };
      return h.slots[i].value;
    },
  };
});
function nodes(tree: unknown): ReactElement<any>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<any>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
it('reuses only the same document preview and validates with the latest context on a PK gesture', async () => {
  h.slots = [];
  h.plan.mockClear();
  const snapshot = decorationSnapshot();
  if (snapshot.native.status !== 'available') throw Error();
  const originalSave = vi.fn(async () => true),
    latestSave = vi.fn(async () => true);
  let props = {
    document: snapshot.native.document,
    column: snapshot.native.document.columns![0]!,
    context: { userId: decorationUserId, snapshot, busy: false, onSave: originalSave },
  };
  const render = () => {
    h.index = 0;
    return nodes(NativePrimaryKeyControl(props)).find(
      (n) => n.props['aria-label'] === '기본 키(PK)',
    )!;
  };
  render();
  expect(h.plan).toHaveBeenCalledTimes(1);
  props = {
    ...props,
    column: { ...props.column, physical: { ...props.column.physical, name: 'local name' } },
    context: { ...props.context, onSave: latestSave, snapshot: { ...snapshot, sequence: 11 } },
  };
  let control = render();
  expect(h.plan).toHaveBeenCalledTimes(1);
  await control.props.onChange({ target: { checked: true } });
  expect(h.plan).toHaveBeenCalledTimes(2);
  expect(latestSave).toHaveBeenCalledWith([], expect.objectContaining({ sequence: 11 }));
  expect(originalSave).not.toHaveBeenCalled();
  props = { ...props, document: { ...props.document, keys: [] } };
  render();
  expect(h.plan).toHaveBeenCalledTimes(3);
  props = { ...props, context: { ...props.context, busy: true } };
  control = render();
  expect(control.props.disabled).toBe(true);
  await control.props.onChange({ target: { checked: true } });
  expect(h.plan).toHaveBeenCalledTimes(3);
});
