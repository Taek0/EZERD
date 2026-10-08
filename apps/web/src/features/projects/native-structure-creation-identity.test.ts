import { isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeCreateForm, NativeStructureEditor } from './native-editor-structure.js';
import { advancedFixture } from './native-advanced-test-fixtures.js';

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[] }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots))
      hooks.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [
      hooks.slots[index],
      (value: unknown) => {
        hooks.slots[index] = value;
      },
    ];
  },
  useRef(initial: unknown) {
    return (hooks.slots[hooks.cursor++] ??= { current: initial });
  },
}));
vi.mock('../../shared/i18n/index.js', () => ({
  registerTranslations() {},
  useI18n: () => ({ t: (value: string) => value }),
}));
vi.mock('./NativeLogicalMode.js', () => ({
  useNativeLogicalMode: () => ({ enabled: false, onEnabledChange() {} }),
}));

function nodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
function fixture() {
  const f = advancedFixture('postgresql');
  const structureSlots: unknown[] = [];
  let childSlots: unknown[] = [];
  let childKey: string | null = null;
  function render() {
    hooks.slots = structureSlots;
    hooks.cursor = 0;
    const tree = NativeStructureEditor({
      document: f.document,
      context: f.context,
      focused: true,
      initialSelection: { action: 'enum', target: '' },
    });
    const child = nodes(tree).find((node) => node.type === NativeCreateForm)!;
    if (child.key !== childKey) {
      childSlots = [];
      childKey = child.key;
    }
    hooks.slots = childSlots;
    hooks.cursor = 0;
    return {
      key: child.key,
      form: NativeCreateForm(child.props as Parameters<typeof NativeCreateForm>[0]),
    };
  }
  return { f, render };
}
beforeEach(() => {
  hooks.cursor = 0;
  hooks.slots = [];
});

describe('structure creation identity across ACK', () => {
  it('creates an ENUM once and patches that same ID after successive snapshot ACKs', async () => {
    const { f, render } = fixture();
    const first = render();
    const before = first.form.props.initial;
    const values = { ...before, name: 'status', enumLabelsJSON: '["draft"]' };
    const commands = first.form.props.build(values, before);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: 'add_enum',
      value: { id: values.id, name: 'status', values: ['draft'] },
    });
    expect(await first.form.props.context.onSave(commands)).toBe(true);
    // Even if the updated document trails the ACK, the accepted creation remains the edit target.
    f.context.snapshot = {
      ...f.context.snapshot,
      sequence: f.context.snapshot.sequence + 1,
      project: { ...f.context.snapshot.project, version: f.context.snapshot.project.version + 1 },
    };
    const second = render();
    expect(second.key).toBe(first.key);
    expect(second.form.props.initial.id).toBe(values.id);
    const renamed = { ...values, name: 'order_status', enumLabelsJSON: '["draft","paid"]' };
    const patch = second.form.props.build(renamed, values);
    expect(patch).toEqual([
      {
        type: 'patch_enum',
        id: values.id,
        patch: { name: 'order_status', values: ['draft', 'paid'] },
      },
    ]);
    expect(await second.form.props.context.onSave(patch)).toBe(true);
    f.context.snapshot = { ...f.context.snapshot, sequence: f.context.snapshot.sequence + 1 };
    expect(render().form.props.initial.id).toBe(values.id);
    expect(f.context.onSave).toHaveBeenCalledTimes(2);
  });
  it('still replaces creation identity when actor, project or database revision changes', () => {
    const { f, render } = fixture();
    const first = render();
    f.context.userId = 'another-actor';
    const actor = render();
    expect(actor.key).not.toBe(first.key);
    expect(actor.form.props.initial.id).not.toBe(first.form.props.initial.id);
    f.context.snapshot = {
      ...f.context.snapshot,
      project: { ...f.context.snapshot.project, id: 'another-project' },
    };
    const project = render();
    expect(project.key).not.toBe(actor.key);
    f.context.snapshot = {
      ...f.context.snapshot,
      project: {
        ...f.context.snapshot.project,
        databaseRevision: f.context.snapshot.project.databaseRevision + 1,
      },
    };
    expect(render().key).not.toBe(project.key);
  });
});
