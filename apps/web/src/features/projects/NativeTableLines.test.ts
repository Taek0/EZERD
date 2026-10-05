import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NativeTableLines } from './NativeTableLines.js';
import { NativeDomainLines, nativeDomainGeometry } from './native-domain-lines.js';
import { decorationFixture } from './native-canvas-decoration-test-fixtures.js';
import { nativeCanvasScene } from './NativeERDCanvas.js';
import { nativeRelationLabelWidth } from './native-canvas-style.js';

function relationFixture() {
  const document = decorationFixture();
  document.tables!.push({ ...structuredClone(document.tables![0]!), id: 'target' });
  document.layout.nodes.push({
    id: 'target-node',
    objectId: 'target',
    viewId: '__tables__',
    x: 500,
    y: 0,
    width: 360,
    height: 260,
  });
  document.tableRelations = [
    {
      id: 'fk',
      sourceTableId: 't',
      targetTableId: 'target',
      scope: 'both',
      logical: {
        name: '한글관계설명입니다',
        cardinality: 'many-to-many',
        required: true,
        sourceCardinality: { min: 1, max: 1 },
        targetCardinality: { min: 0, max: 'many' },
      },
      physical: {
        name: '한글관계설명입니다',
        sourceColumnIds: ['c'],
        targetColumnIds: [],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
    },
  ];
  return document;
}
describe('source relationship presentation on native routes', () => {
  it('describes named endpoints, paired columns and logical meaning without exposing only IDs', () => {
    const document = relationFixture();
    document.tables![0]!.physical.name = 'orders';
    document.tables![1]!.physical.name = 'customers';
    document.tableRelations![0]!.logical.description = 'Keep <script>description</script>';
    const scene = nativeCanvasScene(document, '__tables__', 'physical');
    const html = renderToStaticMarkup(
      createElement(NativeTableLines, { document, relations: scene.relations, mode: 'physical' }),
    );
    expect(html).toContain('customers → orders (opaque)');
    expect(html).toContain('Keep &lt;script&gt;description&lt;/script&gt;');
    expect(html).not.toContain(': t → target');
  });
  it('keeps explicit native cardinalities and source logical dashes and Unicode label bounds', () => {
    const document = relationFixture(),
      before = structuredClone(document);
    const html = renderToStaticMarkup(
      createElement(NativeTableLines, {
        relations: nativeCanvasScene(document, '__tables__', 'logical').relations,
        mode: 'logical',
        selectedId: 'fk',
        onSelect() {},
      }),
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('native-table-relation selected');
    expect(html).toContain('stroke-dasharray="6 4"');
    expect(html).toMatch(/marker-start="url\(#[^)]+-crow-1-1\)"/);
    expect(html).toMatch(/marker-end="url\(#[^)]+-crow-0-many\)"/);
    expect(html).toContain(`width="${nativeRelationLabelWidth('한글관계설명입니다')}"`);
    expect(html).toContain('native-relation-hit');
    expect(document).toEqual(before);
  });
  it('keeps graph-local marker IDs when rendering multiple native canvases in one page', () => {
    const document = relationFixture();
    const html = renderToStaticMarkup(
      createElement(
        'div',
        null,
        createElement(NativeTableLines, {
          relations: nativeCanvasScene(document, '__tables__', 'physical').relations,
          mode: 'physical',
        }),
        createElement(NativeTableLines, {
          relations: nativeCanvasScene(document, '__tables__', 'physical').relations,
          mode: 'physical',
        }),
        createElement(NativeDomainLines, {
          document,
          nodes: nativeCanvasScene(document, 'overview', 'physical').nodes,
          onSelect() {},
        }),
        createElement(NativeDomainLines, {
          document,
          nodes: nativeCanvasScene(document, 'overview', 'physical').nodes,
          onSelect() {},
        }),
      ),
    );
    const markers = [...html.matchAll(/<marker[^>]+id="([^"]+)"/g)].map((match) => match[1]);
    expect(markers).toHaveLength(10);
    expect(new Set(markers).size).toBe(markers.length);
  });
  it('renders source leaders for crowded domain labels using the common geometry', () => {
    const document = decorationFixture();
    document.domainRelations = Array.from({ length: 20 }, (_, index) => ({
      ...document.domainRelations[0]!,
      id: `r${index}`,
      name: `Crowded relation ${index}`,
    }));
    const nodes = nativeCanvasScene(document, 'overview', 'physical').nodes;
    const displaced = nativeDomainGeometry(document, nodes).filter(
      ({ geometry }) => geometry.labelAnchor,
    );
    expect(displaced.length).toBeGreaterThan(0);
    const html = renderToStaticMarkup(
      createElement(NativeDomainLines, { document, nodes, onSelect() {} }),
    );
    expect(html.match(/class="native-domain-label-leader"/g)).toHaveLength(displaced.length);
    for (const { geometry } of displaced)
      expect(html).toContain(
        `M ${geometry.labelAnchor!.x} ${geometry.labelAnchor!.y} L ${geometry.label.x} ${geometry.label.y + 4}`,
      );
  });
});
