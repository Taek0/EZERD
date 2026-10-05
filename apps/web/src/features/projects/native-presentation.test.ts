import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { decorationFixture } from './native-canvas-decoration-test-fixtures.js';
import { nativeTableCanvasRows, nativeTableHeaderColor } from './native-canvas-style.js';
import { NativeCanvasTableRows } from './NativeCanvasTableRows.js';
import { NativeTableLines } from './NativeTableLines.js';
import { nativeCanvasScene } from './NativeERDCanvas.js';

describe('native canvas presentation', () => {
  it('preserves native data and row heights while adding visible physical FK keys', () => {
    const doc = decorationFixture(),
      table = doc.tables![0]!;
    const before = nativeTableCanvasRows(doc, table, 'physical')[0]!;
    doc.tableRelations = [
      {
        id: 'fk',
        sourceTableId: table.id,
        targetTableId: table.id,
        scope: 'physical',
        logical: { name: 'link', required: true, cardinality: 'one-to-many' },
        physical: {
          name: 'fk',
          sourceColumnIds: ['c'],
          targetColumnIds: ['c'],
          onDelete: 'NO ACTION',
          onUpdate: 'NO ACTION',
        },
      },
    ];
    const original = structuredClone(doc);
    const row = nativeTableCanvasRows(doc, table, 'physical')[0]!;
    expect(row.keys).toContain('FK');
    expect(row.height).toBe(before.height);
    expect(nativeTableCanvasRows(doc, table, 'logical')[0]!.keys).not.toContain('FK');
    const html = renderToStaticMarkup(
      createElement(NativeCanvasTableRows, {
        document: doc,
        table,
        mode: 'physical',
        onSelect: () => {},
      }),
    );
    expect(html).toContain('data-fk="true"');
    expect(html).toContain('role="table"');
    expect(html.match(/role="columnheader"/g)).toHaveLength(5);
    expect(html.match(/role="row"/g)).toHaveLength(2);
    expect(html).not.toContain('<table');
    expect(html).toContain('ORIGINAL_TYPE');
    expect(html).toContain('&lt;script&gt;comment&lt;/script&gt;');
    expect(doc).toEqual(original);
  });
  it('honors nullable/comment visibility and header color fallback', () => {
    const doc = decorationFixture(),
      table = doc.tables![0]!;
    expect(nativeTableHeaderColor(doc, table)).toBe('#123456');
    expect(nativeTableHeaderColor(doc, { ...table, color: undefined })).toBe('#654321');
    table.canvasDisplay = { showNullable: false, showComment: false };
    const html = renderToStaticMarkup(
      createElement(NativeCanvasTableRows, {
        document: doc,
        table,
        mode: 'physical',
        onSelect: () => {},
      }),
    );
    expect(html).not.toContain('native-null-cell');
    expect(html).not.toContain('native-comment-cell');
    expect(html.match(/role="columnheader"/g)).toHaveLength(3);
  });
  it('renders both cardinality ends and logical dash without changing path geometry', () => {
    const doc = decorationFixture(),
      node = nativeCanvasScene(doc, '__tables__', 'physical').nodes[0]!;
    const relation = {
      id: 'rel',
      sourceTableId: 't',
      targetTableId: 't',
      scope: 'logical' as const,
      logical: { name: 'owns', required: true, cardinality: 'one-to-many' as const },
      physical: null,
    };
    const scene = nativeCanvasScene(doc, '__tables__', 'physical');
    const geometry = {
      path: 'M 0 0 L 120 0',
      labelX: 60,
      labelY: 0,
      points: [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
      ],
    } as (typeof scene.relations)[number]['geometry'];
    const html = renderToStaticMarkup(
      createElement(NativeTableLines, {
        relations: [{ relation, geometry, label: 'owns' }],
        mode: 'logical',
      }),
    );
    expect(node).toBeDefined();
    expect(html).toContain('marker-start=');
    expect(html).toContain('marker-end=');
    expect(html).toContain('stroke-dasharray="6 4"');
    expect(html).toContain('d="M 0 0 L 120 0"');
    expect(html).toContain('rx="9"');
  });
});
