import { isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeTableDomainSelect } from './NativeProjectView.js';
import { Select } from '../../components/ui/index.js';
import { clipboardSnapshot } from './native-clipboard-test-fixtures.js';

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[] }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [
      hooks.slots[index],
      (value: unknown) => {
        hooks.slots[index] = value;
      },
    ];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    return (hooks.slots[index] ??= { current: initial });
  },
}));
vi.mock('../../shared/i18n/index.js', async (original) => ({
  ...(await original<typeof import('../../shared/i18n/index.js')>()),
  useI18n: () => ({ t: (value: string) => value }),
}));
function nodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
function setup() {
  const snapshot = clipboardSnapshot();
  if (snapshot.native?.status !== 'available') throw Error('Missing document');
  const document = snapshot.native.document;
  const table = document.tables![0]!;
  table.domainId = 'd';
  document.domains.push({ id: 'other', name: 'Other domain', description: '' });
  const onSave = vi.fn(async () => true);
  const props = { document, tableId: table.id, editable: true, onSave };
  function render() {
    hooks.cursor = 0;
    const tree = NativeTableDomainSelect(props);
    const select = nodes(tree).find((node) => node.type === Select)!;
    return { tree, select, change: select.props.onValueChange as (value: string) => Promise<void> };
  }
  return { table, props, onSave, render };
}
beforeEach(() => {
  hooks.cursor = 0;
  hooks.slots = [];
});

describe('table inspector domain selection', () => {
  it('shows a normal field and immediately saves the move command without optimistic mutation', async () => {
    const { table, render, onSave } = setup();
    const { tree, select, change } = render();
    expect(tree.props.className).toBe('native-property-editor inspector-fields');
    expect(select.props['aria-label']).toBe('소속 도메인');
    expect(select.props.value).toBe('d');
    expect(
      nodes(tree)
        .filter((node) => node.type === 'option')
        .map((node) => node.props.value),
    ).toEqual(['', 'd', 'other']);
    await change('other');
    expect(onSave).toHaveBeenCalledWith([
      { type: 'move_table_domain', tableId: table.id, targetDomainId: 'other' },
    ]);
    expect(table.domainId).toBe('d');
    expect(render().select.props.value).toBe('d');
    table.domainId = 'other';
    expect(render().select.props.value).toBe('other');
  });
  it('supports unassigned and ignores the current domain', async () => {
    const { table, render, onSave } = setup();
    await render().change('d');
    expect(onSave).not.toHaveBeenCalled();
    await render().change('');
    expect(onSave).toHaveBeenCalledWith([
      { type: 'move_table_domain', tableId: table.id, targetDomainId: null },
    ]);
  });
  it('blocks read-only writes and retains the current domain', async () => {
    const { props, render, onSave } = setup();
    props.editable = false;
    expect(render().select.props.disabled).toBe(true);
    await render().change('other');
    expect(onSave).not.toHaveBeenCalled();
    expect(render().select.props.value).toBe('d');
  });
  it.each(['rejected', 'thrown'] as const)(
    'retains the saved domain after %s saves',
    async (failure) => {
      const { render, onSave } = setup();
      if (failure === 'rejected') onSave.mockResolvedValue(false);
      else onSave.mockRejectedValue(Error('Save failed'));
      await render().change('other');
      expect(render().select.props.value).toBe('d');
      expect(render().select.props.disabled).toBe(false);
    },
  );
  it('prevents duplicate requests while awaiting save', async () => {
    const { render, onSave } = setup();
    let complete!: (result: boolean) => void;
    onSave.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const { change } = render();
    const pending = change('other');
    await change('');
    expect(render().select.props.disabled).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
    complete(false);
    await pending;
    expect(render().select.props.value).toBe('d');
  });
  it('rejects missing target domains before saving', async () => {
    const { render, onSave } = setup();
    await render().change('missing');
    expect(onSave).not.toHaveBeenCalled();
    expect(render().select.props.value).toBe('d');
  });
});
