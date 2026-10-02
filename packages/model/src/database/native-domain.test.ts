import { describe, expect, it } from 'vitest';
import { addNote, addTableReference, upsertCombinedView } from '../document.js';
import { createEmptyNativeDocument, type NativeDesignDocument } from './native-document.js';
import { createNativeColumn, createNativeTable } from './editing.js';
import { defaultDatabaseContext } from './profiles.js';
import { nativeReferenceProblems } from './reference-graph.js';
import { inspectNativeLegacyChanges, validateDatabaseDocument } from './validation.js';
import {
  addNativeDomain,
  updateNativeDomain,
  moveNativeTableDomain,
  planNativeDomainDeletion,
  removeNativeDomain,
} from './native-domain.js';

function fixture(kind: 'postgresql' | 'mysql' | 'sqlite' = 'postgresql'): NativeDesignDocument {
  const database = defaultDatabaseContext(kind);
  const a = createNativeTable(database, 'a', 'd1'),
    b = createNativeTable(database, 'b', 'd2');
  a.physical.name = 'parent';
  b.physical.name = 'child';
  const ca = createNativeColumn(database, a, 'ca'),
    cb = createNativeColumn(database, b, 'cb');
  ca.physical.name = 'id';
  cb.physical.name = 'parent_id';
  ca.physical.defaultValue = { kind: 'literal', literalType: 'string', value: '9007199254740993' };
  let document: NativeDesignDocument = {
    ...createEmptyNativeDocument(database),
    domains: [
      { id: 'd1', name: 'First', description: 'one', color: '#123456' },
      { id: 'd2', name: 'Second', description: 'two' },
    ],
    domainRelations: [
      {
        id: 'dr',
        sourceDomainId: 'd1',
        targetDomainId: 'd2',
        name: 'connects',
        direction: 'forward',
        description: '',
      },
    ],
    tables: [a, b],
    columns: [ca, cb],
    keys: [
      { id: 'ka', tableId: 'a', kind: 'primary', name: 'pk', columnIds: ['ca'], scope: 'both' },
    ],
    tableRelations: [
      {
        id: 'fk',
        sourceTableId: 'b',
        targetTableId: 'a',
        scope: 'both',
        logical: { name: 'parent', cardinality: 'one-to-many', required: false },
        physical: {
          name: 'fk_parent',
          sourceColumnIds: ['cb'],
          targetColumnIds: ['ca'],
          onDelete: 'NO ACTION',
          onUpdate: 'NO ACTION',
        },
      },
    ],
    indexes: [
      {
        id: 'ia',
        tableId: 'a',
        name: 'ix',
        scope: 'both',
        unique: false,
        parts: [{ expression: { kind: 'column', columnId: 'ca' }, direction: 'asc' }],
        options:
          kind === 'postgresql'
            ? { database: 'postgresql', method: 'btree' }
            : kind === 'mysql'
              ? { database: 'mysql', kind: 'btree' }
              : { database: 'sqlite' },
      },
    ],
    checks: [
      {
        id: 'qa',
        tableId: 'a',
        name: 'check',
        scope: 'both',
        expression: { kind: 'isNull', operand: { kind: 'column', columnId: 'ca' }, negate: true },
      },
    ],
    layout: {
      nodes: [
        { id: 'nd1', objectId: 'd1', viewId: 'overview', x: 0, y: 0, width: 240, height: 210 },
        { id: 'nd2', objectId: 'd2', viewId: 'overview', x: 400, y: 0, width: 240, height: 210 },
      ],
      viewports: [
        { viewId: 'd1', x: 100, y: 20, zoom: 1.5 },
        { viewId: '__tables__', x: 70, y: 20, zoom: 2 },
      ],
    },
  };
  document = addTableReference(document, 'a', '__tables__', { x: 50, y: 60 });
  document = addTableReference(document, 'b', '__tables__', { x: 500, y: 60 });
  document = addTableReference(document, 'a', 'd1', { x: 10, y: 20 });
  document = addTableReference(document, 'a', 'd2', { x: 100, y: 120 });
  document = upsertCombinedView(document, {
    id: 'only-first',
    name: 'Private first',
    domainIds: ['d1'],
  });
  document = upsertCombinedView(document, {
    id: 'mixed',
    name: 'Private mixed',
    domainIds: ['d1', 'd2'],
  });
  document = addNote(
    document,
    { id: 'domain-note', viewId: 'd1', text: 'owned' },
    { x: 0, y: 300 },
  );
  document = addNote(
    document,
    { id: 'private-note', viewId: 'only-first', text: 'private' },
    { x: 0, y: 300 },
  );
  document = addNote(
    document,
    { id: 'shared-note', viewId: '__tables__', text: 'keep' },
    { x: 0, y: 300 },
  );
  document.layout.relations = [
    { relationId: 'fk', viewId: '__tables__', offset: 20, waypoints: [{ x: 100, y: 80 }] },
    { relationId: 'fk', viewId: 'mixed', offset: 40 },
  ];
  return document;
}
describe('native domain grouping and metadata', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'creates/updates a %s domain and preserves physical payloads and source immutability',
    (kind) => {
      const original = fixture(kind),
        before = structuredClone(original);
      let candidate = addNativeDomain(
        original,
        { id: 'new', name: 'New', description: 'metadata' },
        { x: -1e7, y: 1e7 },
        { nodeId: 'new-node' },
      );
      expect(candidate.layout.nodes.find((node) => node.id === 'new-node')).toMatchObject({
        objectId: 'new',
        viewId: 'overview',
        x: -1e7,
        y: 1e7,
      });
      candidate = updateNativeDomain(candidate, 'd1', { name: 'Renamed', color: null });
      expect(candidate.domains[0]).toEqual({ id: 'd1', name: 'Renamed', description: 'one' });
      for (const key of [
        'database',
        'tables',
        'columns',
        'keys',
        'tableRelations',
        'indexes',
        'checks',
      ] as const)
        expect(candidate[key]).toEqual(before[key]);
      expect(nativeReferenceProblems(candidate)).toEqual([]);
      expect(
        validateDatabaseDocument(candidate, candidate.database, {
          mode: 'write',
          previous: original,
        }),
      ).toEqual([]);
      expect(original).toEqual(before);
    },
  );
  it('rejects identity, metadata, namespace and ownership injection without stripping fields', () => {
    const doc = fixture();
    for (const patch of [
      { id: 'new' },
      { domainId: null },
      { physical: { namespace: 'other' } },
      { name: 9 },
      { color: 'red' },
    ])
      expect(() => updateNativeDomain(doc, 'd1', patch as never)).toThrow();
    expect(() => addNativeDomain(doc, { id: 'ca', name: 'N', description: '' })).toThrow(
      'document.duplicate-identities',
    );
    expect(() =>
      addNativeDomain(
        doc,
        { id: 'new', name: 'N', description: '' },
        { x: 0, y: 0 },
        { nodeId: 'ka' },
      ),
    ).toThrow('document.duplicate-identities');
    expect(() => addNativeDomain(doc, { id: ' padded ', name: 'N', description: '' })).toThrow(
      'document.invalid-identity',
    );
    expect(() =>
      addNativeDomain(doc, { id: 'new', name: 'N', description: '' }, { x: Infinity, y: 0 }),
    ).toThrow();
    const invalidPlacement = structuredClone(doc);
    invalidPlacement.layout.nodes.push({
      id: 'dangling-domain-node',
      objectId: 'fresh',
      viewId: 'overview',
      x: 0,
      y: 0,
      width: 240,
      height: 210,
    });
    expect(() =>
      addNativeDomain(invalidPlacement, { id: 'fresh', name: 'N', description: '' }),
    ).toThrow('document.duplicate-placement');
  });
  it('bounds generated Unicode node IDs, handles prefix collisions, and retains exact object identities', () => {
    let doc = fixture();
    const first = '😀'.repeat(79) + 'aa',
      second = '😀'.repeat(79) + 'bb';
    doc = addNativeDomain(doc, { id: first, name: 'One', description: '' });
    doc = addNativeDomain(doc, { id: second, name: 'Two', description: '' });
    const nodes = doc.layout.nodes.filter((node) => [first, second].includes(node.objectId));
    expect(new Set(nodes.map((node) => node.id)).size).toBe(2);
    expect(nodes.every((node) => node.id.length <= 160 && !node.id.endsWith('\ud83d'))).toBe(true);
  });
});
describe('native table domain ownership moves', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'moves %s grouping without rewriting native/legacy payloads or FK ownership',
    (kind) => {
      const doc = fixture(kind);
      doc.columns![0]!.physical.type = {
        kind: 'legacy',
        source: 'document-v1',
        original: { name: 'opaque', isArray: false },
      };
      doc.columns![0]!.physical.defaultValue = {
        kind: 'legacyExpression',
        source: 'document-v1',
        original: 'old()',
      };
      doc.tables![0]!.physical.namespace = {
        kind: 'legacyNamespace',
        source: 'document-v1',
        original: 'public',
      };
      const before = structuredClone(doc),
        moved = moveNativeTableDomain(doc, 'a', 'd2');
      expect(moved.tables![0]).toEqual({ ...before.tables![0], domainId: 'd2' });
      for (const key of ['columns', 'keys', 'indexes', 'checks', 'tableRelations'] as const)
        expect(moved[key]).toEqual(before[key]);
      expect(
        moved.layout.nodes.find((node) => node.objectId === 'a' && node.viewId === '__tables__'),
      ).toEqual(
        before.layout.nodes.find((node) => node.objectId === 'a' && node.viewId === '__tables__'),
      );
      expect(
        moved.layout.nodes.some(
          (node) => node.objectId === 'a' && ['d1', 'only-first'].includes(node.viewId),
        ),
      ).toBe(false);
      expect(moved.layout.nodes.some((node) => node.objectId === 'a' && node.viewId === 'd2')).toBe(
        true,
      );
      expect(moved.layout.relations).toEqual(before.layout.relations);
      expect(inspectNativeLegacyChanges(moved, doc)).toEqual([]);
      expect(
        validateDatabaseDocument(moved, moved.database, { mode: 'write', previous: doc }),
      ).toEqual([]);
      const reparentedColumn = structuredClone(moved);
      reparentedColumn.columns![0]!.tableId = 'b';
      expect(
        inspectNativeLegacyChanges(reparentedColumn, doc).some(
          (issue) => issue.code === 'legacy.source-not-trusted',
        ),
      ).toBe(true);
      expect(doc).toEqual(before);
    },
  );
  it('moves an owner-only placement to the canonical canvas with the same ID and geometry', () => {
    const doc = fixture();
    doc.layout.nodes = doc.layout.nodes.filter(
      (node) => node.objectId !== 'a' || node.viewId === 'd1',
    );
    doc.layout.relations = [];
    const node = structuredClone(doc.layout.nodes.find((node) => node.objectId === 'a')!);
    const moved = moveNativeTableDomain(doc, 'a', null);
    expect(moved.layout.nodes.find((item) => item.objectId === 'a')).toEqual({
      ...node,
      viewId: '__tables__',
    });
    expect(
      moved.layout.nodes.some((item) => item.objectId === 'a' && item.viewId === 'mixed'),
    ).toBe(false);
    expect(nativeReferenceProblems(moved)).toEqual([]);
    expect(() => moveNativeTableDomain(doc, 'a', 'missing')).toThrow('domain.target-not-found');
  });
});
describe('native domain deletion explicit policies', () => {
  it('rejects nonempty deletion by default and invalid move/delete policies atomically', () => {
    const doc = fixture(),
      before = structuredClone(doc);
    expect(() => removeNativeDomain(doc, 'd1')).toThrow('domain.not-empty');
    for (const policy of [
      { kind: 'moveTables', targetDomainId: 'd1' },
      { kind: 'moveTables', targetDomainId: 'missing' },
      { kind: 'deleteTables', cascadeGeneratedColumns: 'yes' },
      { kind: 'rejectNonempty', delete: true },
    ])
      expect(() => removeNativeDomain(doc, 'd1', policy as never)).toThrow();
    expect(doc).toEqual(before);
  });
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'moves %s tables on domain deletion while pruning dependent views/notes/layouts',
    (kind) => {
      const doc = fixture(kind),
        before = structuredClone(doc);
      const plan = planNativeDomainDeletion(doc, 'd1', {
        kind: 'moveTables',
        targetDomainId: 'd2',
      });
      expect(plan.movedTableIds).toEqual(['a']);
      expect(plan.document.tables![0]!.domainId).toBe('d2');
      expect(plan.document.columns).toEqual(before.columns);
      expect(plan.document.tableRelations).toEqual(before.tableRelations);
      expect(plan.removedDomainRelationIds).toEqual(['dr']);
      expect(plan.removedViewIds).toEqual(['only-first']);
      expect(plan.removedNoteIds).toEqual(['domain-note', 'private-note']);
      expect(plan.removedViewportViewIds).toEqual(['d1']);
      expect(plan.document.views).toEqual([
        { id: 'mixed', name: 'Private mixed', domainIds: ['d2'] },
      ]);
      expect(plan.document.layout.viewports).toEqual(
        before.layout.viewports.filter((viewport) => viewport.viewId !== 'd1'),
      );
      expect(plan.document.layout.relations).toEqual(before.layout.relations);
      expect(nativeReferenceProblems(plan.document)).toEqual([]);
      expect(doc).toEqual(before);
    },
  );
  it('deletes owned native tables with incoming FK/key/index/check cleanup but preserves outside columns', () => {
    const doc = fixture(),
      before = structuredClone(doc);
    const plan = planNativeDomainDeletion(doc, 'd1', { kind: 'deleteTables' });
    expect(plan.document.tables!.map((table) => table.id)).toEqual(['b']);
    expect(plan.document.columns).toEqual([before.columns![1]!]);
    expect(plan.document.keys).toEqual([]);
    expect(plan.document.indexes).toEqual([]);
    expect(plan.document.checks).toEqual([]);
    expect(plan.document.tableRelations).toEqual([]);
    expect(plan.document.layout.relations).toEqual([]);
    expect(plan.deletion!.removed).toContainEqual({ collection: 'tableRelations', id: 'fk' });
    expect(plan.removedRelationLayouts).toEqual([
      { relationId: 'fk', viewId: '__tables__' },
      { relationId: 'fk', viewId: 'mixed' },
    ]);
    expect(nativeReferenceProblems(plan.document)).toEqual([]);
    expect(doc).toEqual(before);
  });
  it('exposes external expression blockers and requires explicit generated-column cascade', () => {
    const doc = fixture();
    doc.columns![1]!.physical.generation = {
      kind: 'computed',
      database: 'postgresql',
      storage: 'stored',
      expression: { kind: 'column', columnId: 'ca' },
    };
    const blocked = planNativeDomainDeletion(doc, 'd1', { kind: 'deleteTables' });
    expect(blocked.deletion!.blockers).toContainEqual(
      expect.objectContaining({
        code: 'deletion.expression-dependent',
        objectId: 'cb',
        referencedIds: ['ca'],
      }),
    );
    expect(blocked.document).toEqual(doc);
    expect(() => removeNativeDomain(doc, 'd1', { kind: 'deleteTables' })).toThrow(
      'deletion.expression-dependent',
    );
    const cascaded = planNativeDomainDeletion(doc, 'd1', {
      kind: 'deleteTables',
      cascadeGeneratedColumns: true,
    });
    expect(cascaded.deletion!.cascadedColumnIds).toEqual(['cb']);
    expect(cascaded.document.columns).toEqual([]);
    expect(cascaded.document.tables!.map((table) => table.id)).toEqual(['b']);
    expect(nativeReferenceProblems(cascaded.document)).toEqual([]);
  });
  it('deletes an empty domain without inventing placements or optional empty collections', () => {
    const doc = createEmptyNativeDocument(defaultDatabaseContext('sqlite'));
    const added = addNativeDomain(doc, { id: 'empty', name: '', description: '' });
    expect(removeNativeDomain(added, 'empty')).toEqual(doc);
  });
  it('evaluates bulk moves as one final candidate and preserves routes that become valid after all canonical relocations', () => {
    const doc = fixture();
    doc.tables![1]!.domainId = 'd1';
    doc.layout.nodes = doc.layout.nodes.filter(
      (node) => !['a', 'b'].includes(node.objectId) || node.viewId === 'd1',
    );
    const ownerA = doc.layout.nodes.find((node) => node.objectId === 'a')!;
    doc.layout.nodes.push({ ...ownerA, id: 'owner-b', objectId: 'b', x: 500 });
    doc.layout.relations = [{ relationId: 'fk', viewId: '__tables__', offset: 77 }];
    const candidate = removeNativeDomain(doc, 'd1', { kind: 'moveTables', targetDomainId: 'd2' });
    expect(candidate.tables!.map((table) => table.domainId)).toEqual(['d2', 'd2']);
    expect(candidate.layout.relations).toEqual(doc.layout.relations);
    expect(nativeReferenceProblems(candidate)).toEqual([]);
  });
});
