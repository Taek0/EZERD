// @vitest-environment jsdom
import { act, createElement as h, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeTableLines } from './NativeTableLines.js';
import { NativeCanvasScene, type NativeCanvasSceneProps } from './NativeCanvasScene.js';
import { nativeCanvasScene } from './NativeERDCanvas.js';
import { clipboardFixture } from './native-clipboard-test-fixtures.js';
import { registerTranslations, setLocale } from '../../shared/i18n/index.js';

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  setLocale('ko');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setLocale('ko');
  vi.unstubAllGlobals();
});
function fixture() {
  const base = clipboardFixture();
  for (const table of base.tables!) table.scope = 'both';
  for (const column of base.columns!) column.scope = 'both';
  base.tableRelations![0]!.scope = 'both';
  base.tableRelations![0]!.physical = {
    name: 'fk_audit',
    sourceColumnIds: ['cb'],
    targetColumnIds: ['ca'],
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  };
  const drawn = nativeCanvasScene(base, '__tables__', 'physical');
  // Reads distinguish real SVG renders from content derivation without mocking React.
  const geometry = drawn.relations[0]!.geometry;
  const path = geometry.path;
  const pathReads = vi.fn(() => path);
  Object.defineProperty(geometry, 'path', { get: pathReads, configurable: true });
  const descriptionReads = vi.fn(() => 'Audit description');
  Object.defineProperty(base.tableRelations![0]!.logical, 'description', {
    get: descriptionReads,
    configurable: true,
  });
  return { base, drawn, pathReads, descriptionReads };
}

describe('relationship memo boundary with real React', () => {
  it('indexes shared endpoint names once for a hundred relationships and retains ID fallbacks', async () => {
    const { base, drawn } = fixture();
    const nameReads = vi.fn(() => 'amount');
    Object.defineProperty(base.columns![0]!.physical, 'name', { get: nameReads });
    const relations = Array.from({ length: 100 }, (_, index) => ({
      ...drawn.relations[0]!,
      relation: { ...drawn.relations[0]!.relation, id: `relation-${index}` },
    }));
    await act(async () =>
      root.render(h(NativeTableLines, { document: base, relations, mode: 'physical' })),
    );
    expect(host.querySelectorAll('[data-relation-id]')).toHaveLength(100);
    expect(nameReads).toHaveBeenCalledTimes(1);
    const missing = [
      {
        ...relations[0]!,
        relation: {
          ...relations[0]!.relation,
          targetTableId: 'missing-table',
          physical: {
            ...relations[0]!.relation.physical!,
            targetColumnIds: ['ca', 'missing-column'],
          },
        },
      },
    ];
    await act(async () =>
      root.render(h(NativeTableLines, { document: base, relations: missing, mode: 'physical' })),
    );
    expect(host.querySelector('title')!.textContent).toContain(
      'missing-table (ca, missing-column)',
    );
    expect(nameReads).toHaveBeenCalledTimes(1);
    await act(async () =>
      root.render(h(NativeTableLines, { relations: missing, mode: 'physical' })),
    );
    expect(host.querySelector('title')!.textContent).toContain(
      'missing-table (ca, missing-column) → b (cb)',
    );
  });

  it('updates endpoint row highlights on scene hover/focus without rendering SVG or rebuilding tooltips', async () => {
    const { base, drawn, pathReads, descriptionReads } = fixture();
    const props: NativeCanvasSceneProps = {
      base,
      sharedSource: base,
      drawn,
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
      onSelectDomain: undefined,
      onSelectRelation: vi.fn(),
      gesture: { current: null },
      actions: {
        current: {
          zoom: 1,
          begin: vi.fn(),
          preserve: vi.fn(),
          savePlacement: vi.fn(async () => {}),
        },
      },
    };
    await act(async () => root.render(h(NativeCanvasScene, props)));
    const group = host.querySelector('[data-relation-id="fk"]')!;
    const svg = host.querySelector('svg')!;
    const before = svg.outerHTML;
    const initialPathReads = pathReads.mock.calls.length;
    const initialDescriptionReads = descriptionReads.mock.calls.length;
    expect(initialPathReads).toBeGreaterThan(0);
    expect(initialDescriptionReads).toBeGreaterThan(0);
    const highlights = () =>
      [...host.querySelectorAll('[data-relation-highlight="true"]')]
        .map((row) => row.getAttribute('data-column-id'))
        .sort();
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        group.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
      });
      expect(highlights()).toEqual(['ca', 'cb']);
      await act(async () => {
        group.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }));
      });
      expect(highlights()).toEqual([]);
    }
    await act(async () => {
      group.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    expect(highlights()).toEqual(['ca', 'cb']);
    await act(async () => {
      group.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(highlights()).toEqual([]);
    expect(pathReads).toHaveBeenCalledTimes(initialPathReads);
    expect(descriptionReads).toHaveBeenCalledTimes(initialDescriptionReads);
    expect(svg.outerHTML).toBe(before);
    expect(host.querySelector('svg')).toBe(svg);
    await act(async () =>
      root.render(h(NativeCanvasScene, { ...props, selectedRelationId: 'fk' })),
    );
    expect(group.getAttribute('aria-pressed')).toBe('true');
    expect(highlights()).toEqual(['ca', 'cb']);
    expect(pathReads.mock.calls.length).toBeGreaterThan(initialPathReads);
    expect(descriptionReads).toHaveBeenCalledTimes(initialDescriptionReads);
  });

  it('reuses content on selection but refreshes names, mode, labels, locale and current event callbacks', async () => {
    const { base, drawn, pathReads, descriptionReads } = fixture();
    let props: ComponentProps<typeof NativeTableLines> = {
      document: base,
      relations: drawn.relations,
      mode: 'physical',
      onSelect: vi.fn(),
      onHover: vi.fn(),
    };
    const render = async () => {
      await act(async () => root.render(h(NativeTableLines, props)));
    };
    await render();
    const group = host.querySelector('g[data-relation-id]')!;
    const title = () => group.querySelector('title')!.textContent;
    expect(title()).toContain('orders (amount) → audit (copy)');
    const reads = descriptionReads.mock.calls.length;
    props = { ...props, selectedId: 'fk' };
    await render();
    expect(group.getAttribute('aria-pressed')).toBe('true');
    expect(descriptionReads).toHaveBeenCalledTimes(reads);
    // A document revision unrelated to tables/columns also reuses content.
    props = { ...props, document: { ...base, notes: [] } };
    await render();
    expect(descriptionReads).toHaveBeenCalledTimes(reads);
    props = {
      ...props,
      document: {
        ...base,
        tables: base.tables!.map((table) =>
          table.id === 'a' ? { ...table, physical: { ...table.physical, name: 'renamed' } } : table,
        ),
        columns: base.columns!.map((column) =>
          column.id === 'ca'
            ? { ...column, physical: { ...column.physical, name: 'new_amount' } }
            : column,
        ),
      },
    };
    await render();
    expect(title()).toContain('renamed (new_amount)');
    expect(descriptionReads).toHaveBeenCalledTimes(reads + 1);
    props = { ...props, mode: 'logical' };
    await render();
    expect(title()).toContain('Orders (Amount) → Audit (Copied amount)');
    expect(group.querySelector('.native-relation-stroke')!.getAttribute('stroke-dasharray')).toBe(
      '6 4',
    );
    const changed = {
      ...drawn.relations[0]!,
      label: 'Changed label',
      relation: {
        ...drawn.relations[0]!.relation,
        logical: {
          ...drawn.relations[0]!.relation.logical,
          name: '',
          description: 'Changed description',
        },
      },
    };
    props = { ...props, relations: [changed] };
    await render();
    expect(title()).toContain('Changed label');
    expect(title()).toContain('Changed description');
    expect(group.querySelector('text')!.textContent).toBe('Changed label');
    registerTranslations({ '테이블 관계': 'Table relationships' });
    const beforeLocale = pathReads.mock.calls.length;
    await act(async () => setLocale('en'));
    expect(host.querySelector('svg')!.getAttribute('aria-label')).toBe('Table relationships');
    expect(group.getAttribute('aria-label')).toBe('Table relationships Changed label');
    expect(pathReads.mock.calls.length).toBeGreaterThan(beforeLocale);
    const onSelect = vi.fn(),
      onHover = vi.fn(),
      parentClick = vi.fn();
    props = { ...props, onSelect, onHover };
    await render();
    document.body.addEventListener('click', parentClick);
    await act(async () => {
      group.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      group.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      group.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      group.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      group.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      group.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(onSelect.mock.calls).toEqual([['fk'], ['fk'], ['fk'], [null]]);
    expect(onHover.mock.calls).toEqual([['fk'], [null]]);
    document.body.removeEventListener('click', parentClick);
    expect(parentClick).not.toHaveBeenCalled();
  });
});
