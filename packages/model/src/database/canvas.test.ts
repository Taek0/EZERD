import { describe, expect, it } from 'vitest';
import {
  addDomain,
  addNote,
  addTableReference,
  createEmptyDocument,
  removeCombinedView,
  removeNote,
  removeTableReference,
  setViewport,
  updateNodeLayout,
  updateNote,
  upsertCombinedView,
  upsertRelationLayout,
} from '../document.js';
import { createEmptyNativeDocument } from './native-document.js';
import { createNativeColumn, createNativeTable } from './editing.js';
import { defaultDatabaseContext } from './profiles.js';
import type { DatabaseKind } from './definitions.js';

function fixture(kind: DatabaseKind) {
  const database = defaultDatabaseContext(kind);
  const tables = ['a', 'b'].map((id) => createNativeTable(database, id, 'd'));
  const doc = {
    ...createEmptyNativeDocument(database),
    tables,
    domains: [{ id: 'd', name: 'Domain', description: '' }],
    columns: [createNativeColumn(database, tables[0]!, 'c')],
    indexes: [
      {
        id: 'i',
        tableId: 'a',
        name: 'idx',
        scope: 'logical' as const,
        unique: false,
        parts: [
          { direction: 'asc' as const, expression: { kind: 'column' as const, columnId: 'c' } },
        ],
        options:
          kind === 'mysql'
            ? { database: 'mysql' as const, kind: 'btree' as const }
            : kind === 'postgresql'
              ? { database: 'postgresql' as const, method: 'btree' as const }
              : { database: 'sqlite' as const },
      },
    ],
    checks: [
      {
        id: 'q',
        tableId: 'a',
        scope: 'logical' as const,
        name: 'check',
        expression: { kind: 'literal' as const, literalType: 'boolean' as const, value: true },
      },
    ],
    tableRelations: [
      {
        id: 'r',
        sourceTableId: 'a',
        targetTableId: 'b',
        scope: 'logical' as const,
        logical: { name: 'relation', cardinality: 'one-to-many' as const, required: false },
        physical: null,
      },
    ],
    layout: {
      nodes: tables.map((table, index) => ({
        id: 'node-' + table.id,
        objectId: table.id,
        viewId: '__tables__',
        x: index * 400 + 100,
        y: 200,
        width: 320,
        height: 260,
      })),
      viewports: [],
    },
  };
  doc.columns[0]!.physical.defaultValue = {
    kind: 'literal',
    literalType: 'string',
    value: '9007199254740993',
  };
  return doc;
}
describe('version-preserving common canvas commands', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'edits %s personal canvases while preserving every native payload',
    (kind) => {
      const original = fixture(kind),
        before = structuredClone(original);
      let document = upsertCombinedView(original, { id: 'v', name: 'Private', domainIds: ['d'] });
      expect(document.layout.nodes.filter((node) => node.viewId === 'v')).toHaveLength(2);
      document = addNote(document, { id: 'note', viewId: 'v', text: 'original' }, { x: 10, y: 20 });
      document = updateNote(document, 'note', { text: 'changed', color: '#123456' });
      const node = document.layout.nodes.find(
        (item) => item.objectId === 'a' && item.viewId === 'v',
      )!;
      document = updateNodeLayout(document, node.id, { x: 80, width: 600 });
      document = setViewport(document, { viewId: 'v', x: 120, y: 30, zoom: 1.5 });
      document = upsertRelationLayout(document, {
        relationId: 'r',
        viewId: 'v',
        offset: 20,
        waypoints: [{ x: 60, y: 30 }],
      });
      document = removeTableReference(document, node.id);
      expect(document.layout.relations).toEqual([]);
      document = addTableReference(document, 'a', 'v', { x: 70, y: 80 });
      expect(document.schemaVersion).toBe(2);
      for (const key of [
        'database',
        'tables',
        'columns',
        'indexes',
        'checks',
        'tableRelations',
      ] as const)
        expect(document[key]).toEqual(before[key]);
      document = removeNote(document, 'note');
      document = removeCombinedView(document, 'v');
      expect(document.views).toEqual([]);
      expect(document.layout.nodes).toEqual(before.layout.nodes);
      expect(document.layout.viewports).toEqual([]);
      expect(original).toEqual(before);
    },
  );
  it('uses legacy owner placements first and canonical shared placements as fallback for v1', () => {
    const native = fixture('postgresql');
    const original = {
      ...createEmptyDocument(),
      domains: native.domains,
      tables: [],
      layout: native.layout,
    };
    // Common canvas commands need only table ownership, without importing a native type into v1.
    const source = {
      ...original,
      tables: native.tables.map((table) => ({
        ...table,
        physical: { name: table.id, schema: 'public', comment: '' },
      })),
    };
    let result = upsertCombinedView(source, { id: 'v', name: 'View', domainIds: ['d'] });
    expect(
      result.layout.nodes.filter((node) => node.viewId === 'v').map((node) => node.id),
    ).toEqual(['node:a:v', 'node:b:v']);
    source.layout = {
      ...source.layout,
      nodes: [
        ...source.layout.nodes,
        { id: 'old', objectId: 'a', viewId: 'd', x: 10, y: 20, width: 700, height: 260 },
      ],
    };
    result = upsertCombinedView(source, { id: 'v', name: 'View', domainIds: ['d'] });
    expect(
      result.layout.nodes.find((node) => node.viewId === 'v' && node.objectId === 'a')!.width,
    ).toBe(700);
    const note = addNote(result, { id: 'note', viewId: 'v', text: 'V1' }, { x: 0, y: 0 });
    expect(note.layout.nodes.find((node) => node.objectId === 'note')!.id).toBe('node:note');
    expect(
      addDomain(createEmptyDocument(), { id: 'd', name: 'D', description: '' }, { x: 0, y: 0 })
        .layout.nodes[0]!.id,
    ).toBe('node:d');
  });
  it('bounds long native generated IDs and resolves prefix collisions without changing references', () => {
    const source = fixture('sqlite');
    const tableIds = ['x'.repeat(159) + 'a', 'x'.repeat(159) + 'b'];
    source.tables.forEach((table, index) => (table.id = tableIds[index]!));
    source.columns[0]!.tableId = tableIds[0]!;
    source.layout.nodes.forEach((node, index) => (node.objectId = tableIds[index]!));
    const viewId = 'v'.repeat(160);
    let result = upsertCombinedView(source, { id: viewId, name: 'Long', domainIds: ['d'] });
    result = addNote(result, { id: '😀'.repeat(80), viewId, text: 'Long note' }, { x: 0, y: 0 });
    const nodes = result.layout.nodes.filter((node) => node.viewId === viewId);
    expect(new Set(nodes.map((node) => node.id)).size).toBe(3);
    expect(nodes.every((node) => node.id.length <= 160 && !node.id.endsWith('\ud83d'))).toBe(true);
    expect(nodes.map((node) => node.objectId)).toEqual([...tableIds, '😀'.repeat(80)]);
    expect(nodes.every((node) => node.viewId === viewId)).toBe(true);
    expect(() =>
      addNote(result, { id: 'i', viewId, text: 'Cannot reuse index ID' }, { x: 0, y: 0 }),
    ).toThrow();
    expect(() =>
      upsertCombinedView(result, { id: 'q', name: 'Cannot reuse check ID', domainIds: ['d'] }),
    ).toThrow();
  });
});
