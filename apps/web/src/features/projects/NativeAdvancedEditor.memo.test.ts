import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { NativeAdvancedEditor } from './NativeAdvancedEditor.js';
import type { NativeEditorContext } from './native-editor-form.js';
import { advancedFixture } from './native-advanced-test-fixtures.js';
const host = vi.hoisted(() => ({
  slots: [] as { value?: unknown; deps?: readonly unknown[] }[],
  cursor: 0,
  effects: [] as (() => void)[],
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useRef(initial: unknown) {
    return (host.slots[host.cursor++] ??= { value: { current: initial } }).value;
  },
  useState(initial: () => unknown) {
    return [(host.slots[host.cursor++] ??= { value: initial() }).value, () => {}];
  },
  useMemo(factory: () => unknown, deps: readonly unknown[]) {
    const slot = (host.slots[host.cursor++] ??= {});
    if (!slot.deps || deps.some((v, i) => !Object.is(v, slot.deps![i]))) {
      slot.value = factory();
      slot.deps = deps;
    }
    return slot.value;
  },
  useLayoutEffect(effect: () => void) {
    host.effects.push(effect);
  },
}));
beforeEach(() => {
  host.slots = [];
  host.cursor = 0;
  host.effects = [];
});
function render(props: Parameters<typeof NativeAdvancedEditor>[0]) {
  host.cursor = 0;
  host.effects = [];
  const element = NativeAdvancedEditor(props) as ReactElement<{
    context: NativeEditorContext;
    recoveryRevision?: string;
  }>;
  host.effects.forEach((effect) => effect());
  return element;
}
describe('advanced editor panel boundary', () => {
  it('keeps the same form context for panel-only rerenders while dispatching the latest save', async () => {
    const f = advancedFixture();
    const firstSave = vi.fn(async () => true),
      latestSave = vi.fn(async () => false);
    const props = {
      document: f.document,
      table: f.table,
      context: { ...f.context, onSave: firstSave },
    };
    const first = render(props);
    const next = render({ ...props, context: { ...props.context, onSave: latestSave } });
    expect(next.type).toBe(first.type);
    expect(next.props.context).toBe(first.props.context);
    const expected = { version: 1, sequence: 2, databaseRevision: 0 };
    expect(await next.props.context.onSave([], expected)).toBe(false);
    expect(latestSave).toHaveBeenCalledWith([], expected);
    expect(firstSave).not.toHaveBeenCalled();
  });
  it('invalidates memo input for permissions, actor, snapshot and explicit recovery changes', () => {
    const f = advancedFixture(),
      props = { document: f.document, table: f.table, context: f.context };
    const first = render(props);
    const busy = render({ ...props, context: { ...props.context, busy: !props.context.busy } });
    expect(busy.props.context).not.toBe(first.props.context);
    const changed = render({
      ...props,
      context: {
        ...props.context,
        snapshot: { ...props.context.snapshot, sequence: props.context.snapshot.sequence + 1 },
      },
    });
    expect(changed.props.context).not.toBe(first.props.context);
    const actor = render({ ...props, context: { ...props.context, userId: 'different-actor' } });
    expect(actor.props.context.userId).toBe('different-actor');
    const recovery = render({ ...props, recoveryRevision: 'new-recovery' });
    expect(recovery.props.recoveryRevision).toBe('new-recovery');
  });
});
