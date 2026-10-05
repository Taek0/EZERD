import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, tableCardMetrics } from '@ezerd/model';
import { NativeCanvasTableRows, nativeCanvasColumnMenuItems } from './NativeCanvasTableRows.js';
import { nativeTableCanvasMetrics, nativeRelationLabelWidth } from './native-canvas-style.js';
import {
  decorationFixture,
  decorationSnapshot,
  decorationUserId,
} from './native-canvas-decoration-test-fixtures.js';
import { Checkbox } from '../../components/ui/index.js';
import { NativeCanvasInlineCell } from './NativeCanvasInlineCell.js';

vi.mock('../../shared/i18n/index.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (text: string) => text }),
}));
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function fixture() {
  const document = decorationFixture();
  return { document, table: document.tables![0]!, mode: 'physical' as const, onSelect: vi.fn() };
}
describe('source card rows rendered from native values', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'retains %s native payloads while measuring opaque types',
    (kind) => {
      const document = decorationFixture(kind),
        before = structuredClone(document);
      const metrics = nativeTableCanvasMetrics(document, document.tables![0]!, 'physical');
      expect(metrics.rows[0]!.type).toContain('ORIGINAL_TYPE');
      expect(metrics.rows[0]!.column.physical.defaultValue).toEqual(
        before.columns![0]!.physical.defaultValue,
      );
      expect(document).toEqual(before);
    },
  );
  it('matches original grid, wrapping, chrome and minimum bounds on equivalent displayed values', () => {
    const p = fixture(),
      source = createEmptyDocument();
    p.document.columns![0]!.physical.type = {
      kind: 'legacy',
      source: 'document-v1',
      original: { name: 'INTEGER', isArray: false },
    };
    p.document.columns![0]!.physical.name = 'long_column_name_that_wraps_twice';
    p.document.columns![0]!.physical.comment = '여러 줄로 표시하는 업무 설명\n두 번째 설명';
    source.tables = [
      {
        id: 't',
        domainId: 'a',
        scope: 'both',
        logical: p.table.logical,
        physical: { name: p.table.physical.name, schema: 'public', comment: '' },
        customProperties: p.table.customProperties,
      },
    ];
    source.columns = [
      {
        id: 'c',
        tableId: 't',
        scope: 'both',
        logical: p.document.columns![0]!.logical,
        physical: {
          name: p.document.columns![0]!.physical.name,
          type: { name: 'integer', isArray: false },
          nullable: false,
          defaultExpression: null,
          comment: p.document.columns![0]!.physical.comment,
        },
        customProperties: p.document.columns![0]!.customProperties,
      },
    ];
    const before = structuredClone(p.document);
    const original = tableCardMetrics(source, 't');
    const native = nativeTableCanvasMetrics(p.document, p.table, 'physical');
    expect({
      width: native.width,
      height: native.height,
      grid: native.grid,
      rows: native.rows.map((row) => row.height),
    }).toEqual(original);
    expect(native.rows[0]!.height).toBeGreaterThan(37);
    expect(p.document).toEqual(before);
  });
  it('keeps read-only native types/defaults in the tooltip and hides optional cells without losing source fields', () => {
    const p = fixture(),
      before = structuredClone(p.document.columns);
    let html = renderToStaticMarkup(createElement(NativeCanvasTableRows, p));
    expect(html).toContain('ORIGINAL_TYPE');
    expect(html).toContain('original(9007199254740993)');
    expect(html).toContain('&lt;script&gt;comment&lt;/script&gt;');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('disabled=""');
    p.table.canvasDisplay = { showNullable: false, showComment: false };
    html = renderToStaticMarkup(createElement(NativeCanvasTableRows, p));
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('native-comment-cell');
    expect(p.document.columns).toEqual(before);
  });
  it('keeps PK NULL protection even for a synthetic change and exposes guarded connection from PK only', () => {
    const p = fixture(),
      onToggleNullable = vi.fn(),
      onConnectFromColumn = vi.fn();
    p.document.keys = [
      {
        id: 'pk',
        tableId: 't',
        name: 'records_pk',
        kind: 'primary',
        columnIds: ['c'],
        scope: 'physical',
      },
    ];
    const tree = elements(NativeCanvasTableRows({ ...p, onToggleNullable, onConnectFromColumn }));
    const checkbox = tree.find((element) => element.type === Checkbox)!;
    expect(checkbox.props.disabled).toBe(true);
    (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    expect(onToggleNullable).not.toHaveBeenCalled();
    const connect = tree.find((element) => element.props.title === 'PK에서 관계 연결')!;
    const stopPropagation = vi.fn();
    (connect.props.onClick as (event: unknown) => void)({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(onConnectFromColumn).toHaveBeenCalledWith('c');
    p.document.keys = [];
    expect(
      elements(NativeCanvasTableRows({ ...p, onConnectFromColumn })).some(
        (element) => element.props.title === 'PK에서 관계 연결',
      ),
    ).toBe(false);
  });
  it('dispatches native boolean edits without moving the card and preserves modifier selection bubbling', () => {
    const p = fixture(),
      onToggleNullable = vi.fn(),
      onEdit = vi.fn();
    const tree = elements(NativeCanvasTableRows({ ...p, onToggleNullable, onEdit }));
    const checkbox = tree.find((element) => element.type === Checkbox)!;
    (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    expect(onToggleNullable).toHaveBeenCalledWith('t', 'c', true, 'physical');
    const name = tree.find(
      (element) =>
        element.type === 'button' && element.props.title === 'opaque · 더블클릭 또는 F2로 편집',
    )!;
    const stopPropagation = vi.fn();
    (name.props.onClick as (event: unknown) => void)({ ctrlKey: true, stopPropagation });
    expect(stopPropagation).not.toHaveBeenCalled();
    expect(p.onSelect).not.toHaveBeenCalled();
    (name.props.onDoubleClick as (event: unknown) => void)({ stopPropagation });
    expect(onEdit).toHaveBeenCalledWith({
      tableId: 't',
      columnId: 'c',
      mode: 'physical',
      field: 'name',
    });
    expect(stopPropagation).toHaveBeenCalledOnce();
  });
  it('uses logical required independently of physical PK and shows the source empty-row instruction', () => {
    const p = fixture(),
      onToggleNullable = vi.fn();
    p.document.columns![0]!.logical.required = true;
    p.document.keys = [
      { id: 'pk', tableId: 't', name: 'pk', kind: 'primary', columnIds: ['c'], scope: 'both' },
    ];
    const checkbox = elements(
      NativeCanvasTableRows({ ...p, mode: 'logical', onToggleNullable }),
    ).find((element) => element.type === Checkbox)!;
    expect(checkbox.props.checked).toBe(true);
    expect(checkbox.props.disabled).toBe(false);
    (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: false } });
    expect(onToggleNullable).toHaveBeenCalledWith('t', 'c', false, 'logical');
    p.document.columns = [];
    expect(renderToStaticMarkup(createElement(NativeCanvasTableRows, p))).toContain(
      '컬럼을 추가해 설계를 시작하세요.',
    );
  });
  it('reserves the source label width for Korean and mixed Unicode text', () => {
    expect(nativeRelationLabelWidth('한글관계설명입니다')).toBe(24 + 9 * 14);
    expect(nativeRelationLabelWidth('ABCDEFGHIJ')).toBe(24 + 10 * 8);
  });
  it.each(['physical', 'logical'] as const)(
    'forwards native inline context and the %s field targets to cells',
    (mode) => {
      const p = fixture(),
        onAdvancedFormat = vi.fn();
      const context = {
        userId: decorationUserId,
        snapshot: decorationSnapshot(p.document),
        busy: false,
        onSave: vi.fn(async () => true),
      };
      const tree = elements(
        NativeCanvasTableRows({ ...p, mode, editorContext: context, onEdit: onAdvancedFormat }),
      );
      const cells = tree.filter((node) => node.type === NativeCanvasInlineCell);
      expect(cells).toHaveLength(3);
      expect(cells.map((node) => node.props.target)).toEqual([
        { tableId: 't', columnId: 'c', mode, field: 'name' },
        {
          tableId: 't',
          columnId: 'c',
          mode,
          field: mode === 'physical' ? 'format' : 'semanticType',
        },
        { tableId: 't', columnId: 'c', mode, field: 'comment' },
      ]);
      for (const cell of cells) {
        expect(cell.props.context).toBe(context);
        expect(cell.props.onAdvancedFormat).toBe(onAdvancedFormat);
      }
      (cells[0]!.props.onSelect as (target: unknown) => void)(cells[0]!.props.target);
      expect(p.onSelect).toHaveBeenCalledWith('t', 'c');
      const html = renderToStaticMarkup(createElement(NativeCanvasTableRows, p));
      expect(html).not.toContain('data-inline-cell');
      expect(html).not.toContain('고급 형식 편집');
      expect(context.onSave).not.toHaveBeenCalled();
    },
  );
  it('requests contextual column/PK review and deletion through parent callbacks without mutating data', () => {
    const p = fixture(),
      before = structuredClone(p.document),
      onRequestStructure = vi.fn(),
      onRequestAction = vi.fn();
    const context = {
      userId: decorationUserId,
      snapshot: decorationSnapshot(p.document),
      busy: false,
      onSave: vi.fn().mockResolvedValue(true),
    };
    let items = nativeCanvasColumnMenuItems(
      { ...p, editorContext: context, onRequestStructure, onRequestAction },
      'c',
      (value) => value,
    );
    items.find((item) => item.id === 'edit-column')!.onAction();
    expect(onRequestStructure).toHaveBeenLastCalledWith(
      'patch',
      JSON.stringify(['columns', 'c']),
      't',
    );
    items.find((item) => item.id === 'delete-column')!.onAction();
    expect(onRequestStructure).toHaveBeenLastCalledWith(
      'delete',
      JSON.stringify(['columns', 'c']),
      't',
    );
    items.find((item) => item.id === 'add-column')!.onAction();
    expect(onRequestStructure).toHaveBeenLastCalledWith('column', '', 't');
    items.find((item) => item.id === 'primary-key')!.onAction();
    expect(onRequestAction).toHaveBeenLastCalledWith('key', '', {
      tableId: 't',
      keyKind: 'primary',
      columnIds: 'c',
    });
    expect(p.document).toEqual(before);
    p.document.keys = [
      { id: 'pk', tableId: 't', name: 'pk', kind: 'primary', scope: 'physical', columnIds: ['c'] },
    ];
    items = nativeCanvasColumnMenuItems(
      { ...p, editorContext: context, onRequestStructure },
      'c',
      (value) => value,
    );
    items.find((item) => item.id === 'primary-key')!.onAction();
    expect(onRequestStructure).toHaveBeenLastCalledWith(
      'patch',
      JSON.stringify(['keys', 'pk']),
      't',
    );
  });
  it('guards stale, hidden and busy column menu actions even when invoked directly', () => {
    const readOnly = fixture(),
      readonlyCallback = vi.fn();
    const readonlyItems = nativeCanvasColumnMenuItems(
      { ...readOnly, onRequestStructure: readonlyCallback },
      'c',
      (value) => value,
    );
    expect(
      readonlyItems
        .filter((item) => ['delete-column', 'add-column', 'primary-key'].includes(item.id))
        .every((item) => item.disabled),
    ).toBe(true);
    readonlyItems.find((item) => item.id === 'delete-column')!.onAction();
    expect(readonlyCallback).not.toHaveBeenCalled();
    const p = fixture(),
      onRequestStructure = vi.fn(),
      onRequestAction = vi.fn(),
      onConnectFromColumn = vi.fn();
    expect(
      nativeCanvasColumnMenuItems({ ...p, onRequestStructure }, 'missing', (value) => value),
    ).toEqual([]);
    p.document.columns![0]!.scope = 'logical';
    expect(
      nativeCanvasColumnMenuItems({ ...p, onRequestStructure }, 'c', (value) => value),
    ).toEqual([]);
    p.document.columns![0]!.scope = 'both';
    p.document.keys = [
      { id: 'pk', tableId: 't', name: 'pk', kind: 'primary', scope: 'physical', columnIds: ['c'] },
    ];
    const context = {
      userId: decorationUserId,
      snapshot: decorationSnapshot(p.document),
      busy: true,
      onSave: vi.fn(async () => true),
    };
    const items = nativeCanvasColumnMenuItems(
      { ...p, onRequestStructure, onRequestAction, onConnectFromColumn, editorContext: context },
      'c',
      (value) => value,
    );
    for (const item of items) {
      expect(item.disabled).toBe(true);
      item.onAction();
    }
    expect(onRequestStructure).not.toHaveBeenCalled();
    expect(onRequestAction).not.toHaveBeenCalled();
    expect(onConnectFromColumn).not.toHaveBeenCalled();
    const onToggleNullable = vi.fn();
    p.document.keys = [];
    const checkbox = elements(
      NativeCanvasTableRows({ ...p, editorContext: context, onToggleNullable }),
    ).find((element) => element.type === Checkbox)!;
    expect(checkbox.props.disabled).toBe(true);
    (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    expect(onToggleNullable).not.toHaveBeenCalled();
  });
  it('opens incoming and outgoing relationship selections while retaining physical-only scope', () => {
    const p = fixture(),
      onSelectRelation = vi.fn();
    p.document.tableRelations = [
      {
        id: 'incoming',
        sourceTableId: 't',
        targetTableId: 't',
        scope: 'physical',
        logical: { name: 'Logical link', required: true, cardinality: 'one-to-many' },
        physical: {
          name: 'records_fk',
          sourceColumnIds: ['c'],
          targetColumnIds: ['c'],
          onDelete: 'NO ACTION',
          onUpdate: 'NO ACTION',
        },
      },
    ];
    const items = nativeCanvasColumnMenuItems({ ...p, onSelectRelation }, 'c', (value) => value);
    const incoming = items.find((item) => item.id === 'relation:incoming')!;
    expect(incoming.label).toContain('들어오는 관계 · records_fk · records');
    expect(incoming.disabled).toBe(false);
    incoming.onAction();
    expect(onSelectRelation).toHaveBeenCalledWith('incoming');
    expect(
      nativeCanvasColumnMenuItems(
        { ...p, mode: 'logical', onSelectRelation },
        'c',
        (value) => value,
      ).some((item) => item.id.startsWith('relation:')),
    ).toBe(false);
  });
});
