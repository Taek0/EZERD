import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, tableCardMetrics } from '@ezerd/model';
import { NativeCanvasTableRows } from './NativeCanvasTableRows.js';
import { nativeTableCanvasMetrics, nativeRelationLabelWidth } from './native-canvas-style.js';
import { decorationFixture } from './native-canvas-decoration-test-fixtures.js';
import { Checkbox } from '../../components/ui/index.js';

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
});
