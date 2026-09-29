import { ConfirmProvider } from '../../components/ui/ConfirmProvider.js';
import { describe, expect, it } from 'vitest';
import { moveColumn, parseMetadata, setMappingPair } from './TableEditor.js';
describe('table editor actions', () => {
  it('reorders only the selected table columns while preserving unrelated positions', () => {
    const doc = {
      columns: [
        { id: 'a', tableId: 'one' },
        { id: 'x', tableId: 'two' },
        { id: 'b', tableId: 'one' },
      ],
    };
    expect(moveColumn(doc as never, 'b', -1).columns?.map((c) => c.id)).toEqual(['b', 'x', 'a']);
    expect(doc.columns.map((c) => c.id)).toEqual(['a', 'x', 'b']);
  });
  it('preserves explicit ordered FK mapping when editing either endpoint', () => {
    expect(
      setMappingPair(
        { sourceColumnIds: ['a', 'b'], targetColumnIds: ['x', 'y'] },
        1,
        'target',
        'z',
      ),
    ).toEqual({ sourceColumnIds: ['a', 'b'], targetColumnIds: ['x', 'z'] });
  });
  it('accepts string metadata and rejects nested or non-string data without dropping it', () => {
    expect(parseMetadata('{"owner":"billing"}')).toEqual({ owner: 'billing' });
    expect(() => parseMetadata('{"owner":2}')).toThrow();
    expect(() => parseMetadata('[]')).toThrow();
  });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TableInspector, TableNodeContent, TableWorkspaceTools } from './TableEditor.js';
import { createEmptyDocument, addDomain, addTable, addColumn } from '@ezerd/model';
import { setLocale } from '../../shared/i18n/index.js';
import { columnDefaultOptions } from './column-defaults.js';
import { EnumManager } from './EnumManager.js';
const metadata = { common: {}, logical: {}, physical: {} };
function example() {
  let doc = addDomain(
    createEmptyDocument(),
    { id: 'd', name: '결제', description: '' },
    { x: 0, y: 0 },
  );
  doc = addTable(
    doc,
    {
      id: 't',
      domainId: 'd',
      scope: 'both',
      logical: { name: '청구서', definition: '' },
      physical: { name: 'invoice', schema: 'public', comment: '' },
      customProperties: metadata,
    },
    { x: 0, y: 0 },
  );
  doc = addColumn(doc, {
    id: 'c',
    tableId: 't',
    scope: 'logical',
    logical: { name: '논리 전용 항목', definition: '', semanticType: '금액', required: true },
    physical: {
      name: 'hidden_column',
      type: { name: 'numeric', isArray: false },
      nullable: true,
      defaultExpression: null,
      comment: '',
    },
    customProperties: metadata,
  });
  return doc;
}
describe('table editor rendered controls', () => {
  it.each([
    [{ name: 'varchar', length: 32, isArray: false }, 'VARCHAR(32)'],
    [{ name: 'timestamp with time zone', precision: 3, isArray: true }, 'TIMESTAMPTZ(3)[]'],
    [{ name: 'decimal', precision: 10, scale: 2, isArray: false }, 'NUMERIC(10,2)'],
    [{ name: 'numeric', precision: 10, scale: 2, isArray: true }, 'NUMERIC(10,2)[]'],
    [{ name: 'old', enumId: 'status', isArray: true }, '주문_상태[]'],
  ] as const)('provides the complete saved type for PNG export: %s', (type, display) => {
    const doc = example();
    doc.columns![0]!.scope = 'physical';
    doc.columns![0]!.physical.type = type;
    doc.enums = [{ id: 'status', schema: 'public', name: '주문_상태', values: ['완료'] }];
    for (const editable of [true, false]) {
      const html = renderToStaticMarkup(
        createElement(ConfirmProvider, {
          children: createElement(TableNodeContent, {
            document: doc,
            tableId: 't',
            viewMode: 'physical',
            onChange: () => {},
            readOnly: !editable,
          }),
        }),
      );
      expect(html).toContain(`data-export-text="${display}"`);
    }
  });

  it('switches editor labels while preserving schema names and SQL defaults', () => {
    const doc = example();
    doc.tables![0]!.physical.name = '결제_테이블';
    doc.columns![0]!.scope = 'physical';
    doc.columns![0]!.physical.name = '금액_컬럼';
    const original = structuredClone(doc);
    const renderCard = () =>
      renderToStaticMarkup(
        createElement(ConfirmProvider, {
          children: createElement(TableNodeContent, {
            document: doc,
            tableId: 't',
            viewMode: 'physical',
            onChange: () => {},
          }),
        }),
      );
    try {
      setLocale('en');
      const english = renderCard();
      expect(english).toContain('aria-label="Edit 금액_컬럼 type"');
      expect(english).toContain('Allow NULL for 금액_컬럼');
      expect(english).toContain('결제_테이블');
      expect(english).not.toContain('더블클릭하여 편집');
      const defaults = columnDefaultOptions({
        ...doc.columns![0]!.physical,
        type: { name: 'date', isArray: false },
      });
      expect(defaults).toContainEqual({
        value: 'CURRENT_DATE',
        label: 'Current date · CURRENT_DATE',
      });
      expect(doc).toEqual(original);
      setLocale('ko');
      expect(renderCard()).toContain('금액_컬럼 타입 편집');
      expect(doc).toEqual(original);
    } finally {
      setLocale('ko');
    }
  });
  it('renders English ENUM controls without translating user-defined values', () => {
    const doc = example();
    doc.enums = [{ id: 'enum', schema: 'public', name: '상태', values: ['편집', '삭제'] }];
    try {
      setLocale('en');
      const html = renderToStaticMarkup(
        createElement(EnumManager, {
          document: doc,
          onChange: () => {},
          readOnly: false,
        }),
      );
      expect(html).toContain('Search ENUMs');
      expect(html).toContain('2 values ·');
      expect(html).toContain('Create ENUM');
      expect(html).toContain('<strong>상태</strong>');
      expect(html).toContain('<span>편집</span>');
      expect(html).toContain('<span>삭제</span>');
    } finally {
      setLocale('ko');
    }
  });
  it('shows owner and respects logical-only column visibility in physical cards', () => {
    const doc = example();
    const logical = renderToStaticMarkup(
      createElement(ConfirmProvider, {
        children: createElement(TableNodeContent, {
          document: doc,
          tableId: 't',
          viewMode: 'logical',
          viewId: 'external',
        }),
      }),
    );
    expect(logical).toContain('외부 참조 · ');
    expect(logical).not.toContain('논리 전용 항목');
    const physical = renderToStaticMarkup(
      createElement(ConfirmProvider, {
        children: createElement(TableNodeContent, {
          document: doc,
          tableId: 't',
          viewMode: 'physical',
        }),
      }),
    );
    expect(physical).toContain('background:#8993a3');
    expect(physical).toContain('invoice');
    expect(physical).not.toContain('hidden_column');
  });
  it('keeps physical inspector mutations read-only without exposing model view controls', () => {
    const doc = example();
    const inspector = renderToStaticMarkup(
      createElement(ConfirmProvider, {
        children: createElement(TableInspector, {
          document: doc,
          tableId: 't',
          onChange: () => {},
          readOnly: true,
        }),
      }),
    );
    expect(inspector).toContain('<fieldset disabled=""');
    expect(inspector).toContain('테이블명');
    expect(inspector).toContain('aria-label="도메인"');
    const domainControl = [...inspector.matchAll(/<button\b([^>]*)>/g)].find((match) =>
      match[1]?.includes('aria-label="도메인"'),
    );
    expect(domainControl?.[1]).toContain('disabled=""');
    expect(inspector).toContain('키 · PK / UNIQUE');
    const tools = renderToStaticMarkup(
      createElement(TableWorkspaceTools, {
        document: doc,
        viewId: 'd',
        viewMode: 'both',
        onViewModeChange: () => {},
        onChange: () => {},
        readOnly: true,
        position: { x: 0, y: 0 },
        onSelect: () => {},
      }),
    );
    const addTableButton = [...tools.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(
      (match) => match[2]?.includes('+ 테이블'),
    );
    expect(addTableButton?.[1]).toMatch(/\bdisabled=""/);
    const viewSelect = tools.match(/<select\b([^>]*)>([\s\S]*?)<\/select>/);
    expect(viewSelect).toBeNull();
  });
});

import { relationGeometry } from './TableEditor.js';
describe('table relation routing', () => {
  it('routes tight adjacent cards above both headers with a readable label', () => {
    const a = { x: 0, y: 50, width: 280, height: 220 },
      b = { x: 300, y: 60, width: 280, height: 220 };
    const line = relationGeometry(a, b, 160, 0);
    expect(line.labelY + 14).toBeLessThan(Math.min(a.y, b.y));
    expect(line.path).toContain('L 440');
  });
  it('keeps self-reference labels above the card and endpoints outside its body', () => {
    const a = { x: 10, y: 90, width: 280, height: 220 };
    const line = relationGeometry(a, a, 140, 0);
    expect(line.labelY + 14).toBeLessThan(a.y);
    expect(line.path).toContain('150 82');
  });
});

import { TableRelationsSvg } from './TableEditor.js';
import { upsertTableRelation } from '@ezerd/model';
describe('table relation view semantics', () => {
  it('hides relations without FK definitions in physical view while keeping logical view', () => {
    const doc = upsertTableRelation(example(), {
      id: 'r',
      sourceTableId: 't',
      targetTableId: 't',
      scope: 'both',
      logical: { name: '논리 검토 관계', cardinality: 'one-to-many', required: false },
      physical: null,
    });
    const physical = renderToStaticMarkup(
      createElement(TableRelationsSvg, {
        document: doc,
        viewId: 'd',
        viewMode: 'physical',
        onSelect: () => {},
      }),
    );
    const logical = renderToStaticMarkup(
      createElement(TableRelationsSvg, {
        document: doc,
        viewId: 'd',
        viewMode: 'logical',
        onSelect: () => {},
      }),
    );
    expect(physical).toBe('');
    expect(logical).toContain('논리 검토 관계');
    expect(logical).toContain('marker-end');
    expect(logical).toContain('marker-start');
  });
});

it('renders explicit endpoint cardinality consistently with crowfoot markers rather than legacy cardinality', () => {
  const doc = upsertTableRelation(example(), {
    id: 'explicit',
    sourceTableId: 't',
    targetTableId: 't',
    scope: 'both',
    logical: {
      name: '연결',
      cardinality: 'one-to-many',
      required: false,
      sourceCardinality: { min: 1, max: 1 },
      targetCardinality: { min: 0, max: 'many' },
    },
    physical: null,
  });
  const markup = renderToStaticMarkup(
    createElement(TableRelationsSvg, {
      document: doc,
      viewId: 'd',
      viewMode: 'both',
      onSelect: () => {},
    }),
  );
  expect(markup).toContain('?:?');
  expect(markup).not.toContain('invoice.연결:invoice');
  expect(markup).not.toContain('1..1 → 0..N');
  expect(markup).not.toContain(' · 1:N');
  expect(markup).toContain('marker-start="url(#table-crow-explicit-0)"');
  expect(markup).toContain('marker-end="url(#table-crow-explicit-1)"');
});

import { canSaveKey, typeParameterEnabled } from './TableEditor.js';
describe('physical editor validation', () => {
  it('requires a unique ordered key mapping from the same physical table', () => {
    const columns = [
      { id: 'a', tableId: 't', scope: 'physical' },
      { id: 'b', tableId: 'other', scope: 'physical' },
    ] as never;
    const key = {
      id: 'k',
      tableId: 't',
      scope: 'physical',
      kind: 'unique',
      name: '',
      columnIds: [],
    } as import('@ezerd/model').TableKey;
    expect(canSaveKey(key, columns, [])).toBe(false);
    expect(canSaveKey({ ...key, columnIds: ['a'] }, columns, [])).toBe(true);
    expect(canSaveKey({ ...key, columnIds: ['b'] }, columns, [])).toBe(false);
    expect(canSaveKey({ ...key, columnIds: ['a', 'a'] }, columns, [])).toBe(false);
    expect(
      canSaveKey({ ...key, columnIds: ['a'] }, columns, [{ ...key, id: 'old', columnIds: ['a'] }]),
    ).toBe(false);
  });
  it('enables only meaningful type parameters and never enables enum parameters', () => {
    expect(typeParameterEnabled({ name: 'varchar', isArray: false }, 'length')).toBe(true);
    expect(typeParameterEnabled({ name: 'integer', isArray: false }, 'precision')).toBe(false);
    expect(typeParameterEnabled({ name: 'numeric', isArray: false, precision: 10 }, 'scale')).toBe(
      true,
    );
    expect(typeParameterEnabled({ name: 'timestamp', isArray: false }, 'precision')).toBe(true);
    expect(typeParameterEnabled({ name: 'varchar', isArray: false, enumId: 'e' }, 'length')).toBe(
      false,
    );
  });
});

it('presents existing relations before creation with PK first for every endpoint control', () => {
  let doc = example();
  doc = addTable(
    doc,
    {
      id: 'parent',
      domainId: 'd',
      scope: 'physical',
      logical: { name: '부모', definition: '' },
      physical: { name: 'parent', schema: 'public', comment: '' },
      customProperties: metadata,
    },
    { x: 400, y: 0 },
  );
  doc = {
    ...doc,
    tableRelations: [
      {
        id: 'ordered',
        sourceTableId: 't',
        targetTableId: 'parent',
        scope: 'physical',
        logical: { name: '참조', cardinality: 'one-to-many', required: false },
        physical: {
          name: 'fk_test',
          sourceColumnIds: ['c'],
          targetColumnIds: ['pk'],
          onDelete: 'NO ACTION',
          onUpdate: 'NO ACTION',
        },
      },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(ConfirmProvider, {
      children: createElement(TableInspector, {
        document: doc,
        tableId: 't',
        onChange: () => {},
        readOnly: false,
      }),
    }),
  );
  expect(html.indexOf('출발 테이블 (PK)')).toBeLessThan(html.indexOf('대상 테이블 (FK)'));
  expect(html.indexOf('출발 끝점 (PK)')).toBeLessThan(html.indexOf('대상 끝점 (FK)'));
  expect(html.indexOf('PK / UNIQUE 컬럼 1')).toBeLessThan(html.indexOf('FK 컬럼 1'));
  expect(html.indexOf('FK 이름')).toBeLessThan(html.indexOf('PK 출발 컬럼'));
  expect(html).not.toContain('속성명');
});
import { setColumnPrimaryKey } from './column-primary-key.js';
it('renders directly editable card type and NULL controls with a PK NULL lock', () => {
  let doc = example();
  doc.columns![0]!.scope = 'physical';
  doc = setColumnPrimaryKey(doc, 'c', true);
  const html = renderToStaticMarkup(
    createElement(ConfirmProvider, {
      children: createElement(TableNodeContent, {
        document: doc,
        tableId: 't',
        viewMode: 'physical',
        onChange: () => {},
      }),
    }),
  );
  expect(html).not.toContain('role="combobox"');
  expect(html).toContain('aria-label="hidden_column 타입 편집"');
  expect(html).toContain('NUMERIC');
  expect(html).toContain('hidden_column NULL 허용');
  expect(html).toContain('PK 컬럼은 NULL을 허용하지 않습니다.');
  expect(html).not.toContain('더블클릭하여 NULL');
});

import { updateTableCanvasDisplay } from './TableEditor.js';
import { tableCardMetrics } from './table-geometry.js';
it('shrinks the current view card and restores width while keeping manually added space', () => {
  for (const extra of [0, 300]) {
    const doc = example();
    const minimum = tableCardMetrics(doc, 't').width;
    const node = doc.layout.nodes.find((item) => item.objectId === 't')!;
    node.width = minimum + extra;
    const other = { ...node, id: 'other-view', viewId: 'other', width: 950 };
    doc.layout.nodes.push(other);
    const hidden = updateTableCanvasDisplay(doc, 't', node.viewId, {
      showNullable: false,
      showComment: false,
    });
    const resized = hidden.layout.nodes.find((item) => item.id === node.id)!;
    expect(resized.width).toBe(tableCardMetrics(hidden, 't').width + extra);
    expect(resized.width).toBeLessThan(node.width);
    expect({ ...resized, width: node.width }).toEqual(node);
    expect(hidden.layout.nodes.find((item) => item.id === other.id)).toEqual(other);
    const restored = updateTableCanvasDisplay(hidden, 't', node.viewId, {
      showNullable: true,
      showComment: true,
    });
    expect(restored.layout.nodes.find((item) => item.id === node.id)!.width).toBe(node.width);
  }
});
