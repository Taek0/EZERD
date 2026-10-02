import {
  createEmptyDocument,
  tableCardSize,
  TABLES_VIEW_ID,
  type DesignDocument,
} from '@ezerd/model';

export function fixtureFingerprint(value: unknown) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Deterministic valid physical schema; no clock, network, storage or random IDs. */
export function createHistoricalPerformanceFixture(count = 10, columns = 5): DesignDocument {
  if (![10, 50, 100, 300].includes(count) || ![5, 10, 30].includes(columns))
    throw new Error('Unsupported fixture size');
  const doc = createEmptyDocument();
  doc.domains = [{ id: 'perf', name: 'Performance fixture', description: '', color: '#4169e1' }];
  const meta = () => ({ common: {}, logical: {}, physical: {} });
  doc.tables = Array.from({ length: count }, (_, i) => ({
    id: `t${i}`,
    domainId: 'perf',
    scope: 'physical',
    logical: { name: `table_${i}`, definition: '' },
    physical: { name: `table_${i}`, schema: 'public', comment: '' },
    customProperties: meta(),
  }));
  doc.columns = doc.tables.flatMap((t) =>
    Array.from({ length: columns }, (_, i) => ({
      id: `${t.id}-c${i}`,
      tableId: t.id,
      scope: 'physical' as const,
      logical: { name: `col_${i}`, definition: '', semanticType: '', required: true },
      physical: {
        name: i === 0 ? 'id' : `col_${i}`,
        type: { name: 'integer', isArray: false },
        nullable: false,
        defaultExpression: null,
        comment: '',
      },
      customProperties: meta(),
    })),
  );
  doc.keys = doc.tables.map((t) => ({
    id: `${t.id}-pk`,
    tableId: t.id,
    scope: 'physical',
    kind: 'primary',
    name: `${t.id}_pk`,
    columnIds: [`${t.id}-c0`],
  }));
  doc.tableRelations = doc.tables.map((t, i) => {
    const target = `t${(i + 1) % count}`;
    return {
      id: `r${i}`,
      sourceTableId: t.id,
      targetTableId: target,
      scope: 'physical',
      logical: { name: `relation_${i}`, cardinality: 'one-to-many', required: true },
      physical: {
        name: `${t.id}_fk`,
        sourceColumnIds: [`${t.id}-c1`],
        targetColumnIds: [`${target}-c0`],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
    };
  });
  const size = tableCardSize(doc, 't0');
  doc.layout.nodes = doc.tables.map((t, i) => ({
    id: `node-${t.id}`,
    objectId: t.id,
    viewId: 'perf',
    x: (i % 5) * (size.width + 180),
    y: Math.floor(i / 5) * (size.height + 180),
    ...size,
  }));
  doc.layout.viewports = [{ viewId: 'perf', x: 20, y: 20, zoom: 1 }];
  doc.layout.nodes.push({
    id: 'domain-perf',
    objectId: 'perf',
    viewId: 'overview',
    x: 0,
    y: 0,
    width: 240,
    height: 210,
  });
  return doc;
}

/** Current shared canvas fixture. Historical source data remains available for old records. */
export function createPerformanceFixture(count = 10, columns = 5): DesignDocument {
  const doc = createHistoricalPerformanceFixture(count, columns);
  return {
    ...doc,
    layout: {
      ...doc.layout,
      nodes: [
        ...doc.layout.nodes.map((n) =>
          n.viewId === 'perf' ? { ...n, viewId: TABLES_VIEW_ID } : n,
        ),
        ...doc.layout.nodes
          .filter((n) => n.viewId === 'perf')
          .map((n) => ({ ...n, id: 'owned-' + n.id })),
      ],
      viewports: [{ viewId: TABLES_VIEW_ID, x: 20, y: 20, zoom: 1 }],
    },
  };
}
