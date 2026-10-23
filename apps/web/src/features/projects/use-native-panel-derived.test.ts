// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { decorationFixture } from './native-canvas-decoration-test-fixtures.js';
import * as canvasStyle from './native-canvas-style.js';
import * as inspector from './native-inspector-state.js';
import { useNativePanelDerived } from './use-native-panel-derived.js';

it('reuses document work across unrelated renders and search while refreshing content, mode and scope', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const rows = vi.spyOn(canvasStyle, 'nativeTableCanvasRows');
  const outline = vi.spyOn(inspector, 'nativeInspectorOutline');
  const host = document.createElement('div');
  const root = createRoot(host);
  let input: Parameters<typeof useNativePanelDerived>[0] = {
    doc: decorationFixture(),
    mode: 'physical',
    canvasScope: null,
    canvasView: '__tables__',
    selected: 't',
    selectedTableRelation: null,
    logicalEnabled: true,
    search: '',
    domain: '*',
    untitledTable: 'Untitled table',
  };
  let result!: ReturnType<typeof useNativePanelDerived>;
  function Probe() {
    result = useNativePanelDerived(input);
    return null;
  }
  async function render(patch: Partial<typeof input> = {}) {
    input = { ...input, ...patch };
    await act(async () => root.render(createElement(Probe)));
    return result;
  }
  try {
    const first = await render();
    await render();
    expect(rows).toHaveBeenCalledTimes(1);
    expect(outline).toHaveBeenCalledTimes(1);
    expect(result.navigatorColumns).toBe(first.navigatorColumns);
    expect(result.tables).toBe(first.tables);
    expect(result.filteredTableRelations).toBe(first.filteredTableRelations);
    expect(result.tablesByDomain).toBe(first.tablesByDomain);
    await render({ search: 'nonexistent-xyz' });
    expect(result.tables).toEqual([]);
    expect(result.selectedRows).toBe(first.selectedRows);
    expect(result.navigatorColumns).toBe(first.navigatorColumns);
    expect(rows).toHaveBeenCalledTimes(1);
    expect(outline).toHaveBeenCalledTimes(1);
    await render({ search: '', mode: 'logical' });
    expect(rows).toHaveBeenCalledTimes(2);
    expect(outline).toHaveBeenCalledTimes(2);
    expect(result.navigatorColumns).not.toBe(first.navigatorColumns);
    const doc = structuredClone(input.doc!);
    doc.tables![0]!.logical.name = 'Changed name';
    doc.columns![0]!.logical.name = 'Changed column';
    await render({ doc });
    expect(result.tableName('t')).toBe('Changed name');
    expect(result.columnName('c')).toBe('Changed column');
    expect(rows).toHaveBeenCalledTimes(3);
    const beforeScope = result;
    const scope: inspector.NativeCanvasScope = {
      viewId: '__tables__',
      filter: null,
      visibleObjectIds: [],
      selectedObjectId: null,
      selectedNode: null,
    };
    await render({ canvasScope: scope });
    expect(result.tables).toEqual([]);
    expect(result.selectedRows).toBe(beforeScope.selectedRows);
    expect(outline).toHaveBeenCalledTimes(4);
    await render({ canvasScope: { ...scope, selectedObjectId: 't' } });
    expect(outline).toHaveBeenCalledTimes(4);
    await render({ untitledTable: '이름 없는 테이블' });
    expect(result.tableName('missing')).toBe('이름 없는 테이블');
    expect(rows).toHaveBeenCalledTimes(3);
    await render({ doc: null });
    expect(result.selectedRows).toEqual([]);
    await render({ doc });
    expect(result.columnName('c')).toBe('Changed column');
    // Replacing content must invalidate rows even when the table object is retained.
    const previousRows = result.selectedRows;
    const withKey = {
      ...doc,
      keys: [
        {
          id: 'pk',
          tableId: 't',
          scope: 'both' as const,
          kind: 'primary' as const,
          columnIds: ['c'],
          name: 'pk_records',
        },
      ],
    };
    await render({ doc: withKey, mode: 'physical', canvasScope: null });
    expect(result.selectedRows).not.toBe(previousRows);
    expect(result.selectedTableKeys).toEqual(withKey.keys);
    expect(result.selectedRows).toEqual(
      canvasStyle.nativeTableCanvasRows(withKey, withKey.tables![0]!, 'physical'),
    );
    const unnamed = structuredClone(withKey);
    unnamed.tables![0]!.physical.name = '';
    unnamed.columns![0]!.physical.name = '';
    await render({ doc: unnamed, logicalEnabled: false });
    expect(result.tableName('t')).toBe('이름 없는 테이블');
    expect(result.columnName('c')).toBe('c');
    await render({ logicalEnabled: true });
    expect(result.tableName('t')).toBe('Changed name');
    expect(result.columnName('c')).toBe('Changed column');
    await render({ domain: 'b' });
    expect(result.tables).toEqual([]);
    await render({ domain: '*', search: 'Orders' });
    expect(result.tables.map((table) => table.id)).toEqual(['t']);
    expect(result.filteredDomainRelations.map((relation) => relation.id)).toEqual(['r']);
  } finally {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
