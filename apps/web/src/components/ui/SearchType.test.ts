import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { Input } from 'react-aria-components';
import { SearchType } from './SearchType.js';

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[] }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useRef: (value: unknown) => {
    const index = hooks.cursor++;
    return (hooks.slots[index] ??= { current: value });
  },
  useState: (value: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = value;
    return [
      hooks.slots[index],
      (next: unknown) => {
        hooks.slots[index] = next;
      },
    ];
  },
  useEffect() {},
}));
vi.mock('../../shared/i18n/index.js', () => ({
  useI18n: () => ({ t: (text: string) => text }),
  registerTranslations() {},
}));
function nodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
beforeEach(() => {
  hooks.cursor = 0;
  hooks.slots = [];
});
describe('type search input and database IDs', () => {
  it('selects only the initial focus and preserves characters after popover focus returns', () => {
    const tree = SearchType({
      value: 'postgresql:text',
      options: [{ value: 'postgresql:text', label: 'text' }],
      label: 'Type',
      onValueChange: vi.fn(),
      onQueryChange: vi.fn(),
    });
    const input = nodes(tree).find((node) => node.type === Input)!;
    const select = vi.fn();
    const focus = () =>
      (input.props.onFocus as (event: unknown) => void)({ currentTarget: { select } });
    focus();
    (input.props.onChange as (event: unknown) => void)({ currentTarget: { value: 'v' } });
    focus();
    expect(select).toHaveBeenCalledOnce();
  });
  it('does not select the first typed character when input focus arrives late', () => {
    const onQueryChange = vi.fn();
    const tree = SearchType({
      value: 'postgresql:text',
      options: [{ value: 'postgresql:text', label: 'text' }],
      label: 'Type',
      onValueChange: vi.fn(),
      onQueryChange,
    });
    const input = nodes(tree).find((node) => node.type === Input)!;
    (input.props.onChange as (event: unknown) => void)({ currentTarget: { value: 'v' } });
    const select = vi.fn();
    (input.props.onFocus as (event: unknown) => void)({ currentTarget: { select } });
    expect(select).not.toHaveBeenCalled();
    expect(onQueryChange).toHaveBeenCalledWith('v');
  });
  it('keeps text across option rerenders and sends a DB ID only on selection', () => {
    const onValueChange = vi.fn(),
      onQueryChange = vi.fn(),
      onEditEnd = vi.fn();
    const render = (query?: string) => {
      hooks.cursor = 0;
      return SearchType({
        value: 'postgresql:text',
        options: [
          { value: 'postgresql:text', label: 'text' },
          { value: 'postgresql:integer', label: 'integer' },
        ],
        label: 'Type',
        onValueChange,
        onQueryChange,
        onEditEnd,
        query,
      });
    };
    let tree = render();
    expect(tree.props.inputValue).toBe('TEXT');
    expect(tree.props.selectedKey).toBe('postgresql:text');
    tree.props.onInputChange('inte');
    const input = nodes(tree).find((node) => node.type === Input)!;
    (input.props.onChange as (event: unknown) => void)({ currentTarget: { value: 'inte' } });
    tree = render();
    expect(tree.props.inputValue).toBe('inte');
    expect(onQueryChange).toHaveBeenCalledWith('inte');
    expect(onValueChange).not.toHaveBeenCalled();
    expect(render('recovered query').props.inputValue).toBe('recovered query');
    tree.props.onSelectionChange('postgresql:integer');
    expect(onValueChange).toHaveBeenCalledWith('postgresql:integer');
    expect(onEditEnd).toHaveBeenCalledWith('selection');
    expect(render().props.inputValue).toBe('INTEGER');
  });
});
