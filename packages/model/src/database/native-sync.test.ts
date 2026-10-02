import { describe, expect, it } from 'vitest';
import { defaultDatabaseContext } from './profiles.js';
import {
  createEmptyNativeDocument,
  type NativeDesignDocument,
  type NativeExpression,
} from './native-document.js';
import {
  applyChanges,
  applyOperationsOverlay,
  claimedChangesMatch,
  deletionSnapshots,
  deriveStructuralDependencyPaths,
  diffSharedDocument,
  findFieldVersionConflicts,
  inverseChanges,
  mergeCandidateOntoDocument,
  sharedDocument,
} from '../sync.js';
import { createEmptyDocument } from '../document.js';

const pg = defaultDatabaseContext('postgresql');
const properties = { common: {}, logical: {}, physical: {} };
const ref = (columnId: string): NativeExpression => ({ kind: 'column', columnId });
function fixture(): NativeDesignDocument {
  const document = createEmptyNativeDocument(pg);
  document.tables = [
    {
      id: 't',
      domainId: null,
      scope: 'physical',
      logical: { name: '', definition: '' },
      physical: {
        name: 'items',
        namespace: { kind: 'postgresSchema', name: 'public' },
        comment: '',
        options: { database: 'postgresql' },
      },
      customProperties: properties,
    },
  ];
  document.columns = ['a/~', 'b'].map((id) => ({
    id,
    tableId: 't',
    scope: 'physical',
    logical: { name: '', definition: '', semanticType: '', required: false },
    physical: {
      name: id,
      type: {
        kind: 'builtin',
        database: 'postgresql',
        typeId: 'postgresql:integer',
        parameters: {},
      },
      nullable: false,
      generation: { kind: 'none' },
      defaultValue: { kind: 'none' },
      options: { database: 'postgresql' },
      comment: '',
    },
    customProperties: properties,
  }));
  return document;
}
describe('native ID-based synchronization model', () => {
  it.each([['a/~'], ['a/~', 'b'], ['b']].map((removedIds) => ({ removedIds })))(
    'restores deletions with their exact original order: %j',
    ({ removedIds }) => {
      const base = fixture();
      base.columns!.push({
        ...structuredClone(base.columns![1]!),
        id: 'last',
        tableId: 'another-table',
      });
      base.keys = [
        {
          id: 'k1',
          tableId: 't',
          scope: 'physical',
          kind: 'unique',
          name: 'one',
          columnIds: ['a/~'],
        },
        {
          id: 'k2',
          tableId: 't',
          scope: 'physical',
          kind: 'primary',
          name: 'two',
          columnIds: ['b'],
        },
      ];
      const next = structuredClone(base);
      next.columns = next.columns!.filter((column) => !removedIds.includes(column.id));
      next.keys = next.keys!.filter((key) => !removedIds.some((id) => key.columnIds.includes(id)));
      const changes = diffSharedDocument(base, next);
      expect(applyChanges(sharedDocument(base), changes)).toEqual(sharedDocument(next));
      expect(applyChanges(sharedDocument(next), inverseChanges(changes))).toEqual(
        sharedDocument(base),
      );
    },
  );
  it('reverses a deletion combined with a survivor reorder and a new entity', () => {
    const base = fixture();
    base.columns!.push({ ...structuredClone(base.columns![1]!), id: 'last' });
    const next = structuredClone(base);
    next.columns = [
      next.columns![2]!,
      next.columns![1]!,
      { ...structuredClone(next.columns![1]!), id: 'new' },
    ];
    const changes = diffSharedDocument(base, next);
    expect(applyChanges(sharedDocument(base), changes)).toEqual(sharedDocument(next));
    expect(applyChanges(sharedDocument(next), inverseChanges(changes))).toEqual(
      sharedDocument(base),
    );
  });
  it('keeps v1 deletion claims unchanged for older durable queues', () => {
    const old = createEmptyDocument();
    old.domains = [
      { id: 'a', name: 'A', description: '' },
      { id: 'b', name: 'B', description: '' },
    ];
    expect(diffSharedDocument(old, { ...old, domains: old.domains.slice(1) })).toEqual([
      { path: '/domains/a', before: old.domains[0], after: null, afterExists: false },
    ]);
  });
  it('materializes indexes/checks individually, preserves all native values, and records deletion snapshots', () => {
    const base = fixture();
    const next = structuredClone(base);
    next.indexes = [
      {
        id: 'i',
        tableId: 't',
        scope: 'physical',
        name: 'idx',
        unique: false,
        parts: [{ expression: ref('a/~'), direction: 'asc' }],
        options: { database: 'postgresql', method: 'btree' },
      },
    ];
    next.checks = [
      {
        id: 'q',
        tableId: 't',
        scope: 'physical',
        name: 'check',
        expression: { kind: 'isNull', operand: ref('b'), negate: true },
      },
    ];
    const changes = diffSharedDocument(base, next);
    expect(changes.map((change) => change.path).sort()).toEqual(['/checks/q', '/indexes/i']);
    expect(applyChanges(sharedDocument(base), changes)).toEqual(sharedDocument(next));
    // Consumers can materialize an absent optional collection from the same ID-based edit.
    expect(applyChanges(base, changes).indexes).toEqual(next.indexes);
    const deletions = inverseChanges(changes);
    expect(
      deletionSnapshots(deletions)
        .map((item) => item.path)
        .sort(),
    ).toEqual(['/checks/q', '/indexes/i']);
    expect(applyChanges(sharedDocument(next), deletions)).toEqual(sharedDocument(base));
  });
  it('keeps discriminator-bearing generation/default/index options/check AST atomic', () => {
    const base = fixture();
    base.checks = [
      {
        id: 'q',
        tableId: 't',
        scope: 'physical',
        name: 'q',
        expression: {
          kind: 'binary',
          operator: '>',
          left: ref('b'),
          right: { kind: 'literal', literalType: 'number', value: '0' },
        },
      },
    ];
    const next = structuredClone(base);
    next.columns![0]!.physical.generation = {
      kind: 'identity',
      database: 'postgresql',
      mode: 'always',
    };
    next.columns![1]!.physical.defaultValue = {
      kind: 'literal',
      literalType: 'number',
      value: '9007199254740993',
    };
    next.checks![0]!.expression = {
      kind: 'in',
      operand: ref('b'),
      values: [{ kind: 'literal', literalType: 'number', value: '1' }],
      negate: false,
    };
    expect(
      diffSharedDocument(base, next)
        .map((change) => change.path)
        .sort(),
    ).toEqual([
      '/checks/q/expression',
      '/columns/a~1~0/physical/generation',
      '/columns/b/physical/defaultValue',
    ]);
    expect(applyChanges(sharedDocument(base), diffSharedDocument(base, next))).toEqual(
      sharedDocument(next),
    );
    expect(
      claimedChangesMatch(diffSharedDocument(base, next), [
        { path: '/columns/a~1~0/physical/generation/kind', before: 'none', after: 'identity' },
      ]),
    ).toBe(false);
  });
  it('tracks generation, check, index predicate/include references and structural property changes', () => {
    const base = fixture();
    const next = structuredClone(base);
    next.columns![1]!.physical.generation = {
      kind: 'computed',
      database: 'postgresql',
      storage: 'stored',
      expression: {
        kind: 'binary',
        operator: '+',
        left: ref('a/~'),
        right: { kind: 'literal', literalType: 'number', value: '1' },
      },
    };
    next.indexes = [
      {
        id: 'i',
        tableId: 't',
        scope: 'physical',
        name: 'i',
        unique: true,
        parts: [{ expression: ref('b'), direction: 'desc' }],
        options: {
          database: 'postgresql',
          method: 'btree',
          predicate: { kind: 'isNull', operand: ref('a/~'), negate: true },
          includeColumnIds: ['a/~'],
        },
      },
    ];
    next.checks = [
      {
        id: 'q',
        tableId: 't',
        scope: 'physical',
        name: 'q',
        expression: { kind: 'call', functionId: 'postgresql:abs', args: [ref('b')] },
      },
    ];
    const changes = diffSharedDocument(base, next);
    const dependencies = deriveStructuralDependencyPaths(next, changes);
    expect(dependencies).toEqual(
      expect.arrayContaining([
        '/tables/t/physical/options',
        '/tables/t/physical/namespace',
        '/columns/a~1~0/@exists',
        '/columns/a~1~0/physical/type',
        '/columns/b/physical/generation',
      ]),
    );
    expect(
      findFieldVersionConflicts(
        { kind: 'online', baseSequence: 1, changes, dependencyPaths: dependencies },
        { '/columns/a~1~0/physical/type': 2 },
      ),
    ).toContain('/columns/a~1~0/physical/type');
    expect(
      findFieldVersionConflicts(
        { kind: 'reconnect', baseSequence: 1, changes, dependencyPaths: dependencies },
        { '/tables/t/physical/options/strict': 2 },
      ),
    ).toContain('/tables/t/physical/options');
    // Removed objects still expose their old reference set for inverse/conflict protection.
    expect(deriveStructuralDependencyPaths(base, inverseChanges(changes))).toContain(
      '/columns/a~1~0/physical/type',
    );
  });
  it('merges disjoint native changes and keeps pending overlays and their inverse independent', () => {
    const base = fixture();
    const candidate = structuredClone(base);
    candidate.columns![0]!.physical.generation = { kind: 'serial', database: 'postgresql' };
    const current = structuredClone(base);
    current.tables![0]!.physical.comment = 'remote';
    const merged = mergeCandidateOntoDocument(base, current, candidate);
    expect(merged.document.tables![0]!.physical.comment).toBe('remote');
    expect(merged.document.columns![0]!.physical.generation.kind).toBe('serial');
    expect(applyOperationsOverlay(sharedDocument(current), [{ changes: merged.changes }])).toEqual(
      sharedDocument(merged.document),
    );
    expect(applyChanges(sharedDocument(merged.document), inverseChanges(merged.changes))).toEqual(
      sharedDocument(current),
    );
  });
  it('removes private view layout without discarding native index/check collections', () => {
    const document = fixture();
    document.views = [{ id: 'private', name: 'private', domainIds: [] }];
    document.notes = [{ id: 'n', viewId: 'private', text: 'private' }];
    document.indexes = [];
    document.checks = [];
    const shared = sharedDocument(document);
    expect(shared.schemaVersion).toBe(2);
    expect(shared.database).toEqual(pg);
    expect(shared.notes).toEqual([]);
    expect(shared).not.toHaveProperty('views');
    expect(shared.indexes).toEqual([]);
    expect(document.notes).toHaveLength(1);
  });
  it('rejects protocol upgrades and database changes through ordinary edits, merge, or overlay', () => {
    const base = fixture();
    const changed = { ...base, database: defaultDatabaseContext('mysql') };
    expect(() => diffSharedDocument(base, changed)).toThrow('database.context-changed');
    expect(() => mergeCandidateOntoDocument(base, changed, base)).toThrow(
      'database.context-changed',
    );
    expect(() => applyOperationsOverlay(base, [{ document: changed, changes: [] }])).toThrow(
      'database.context-changed',
    );
    expect(() =>
      diffSharedDocument(
        createEmptyDocument() as NativeDesignDocument | ReturnType<typeof createEmptyDocument>,
        base,
      ),
    ).toThrow('document.upgrade-required');
    for (const path of ['/database/kind', '/database', '/schemaVersion']) {
      expect(() =>
        applyChanges(base, [
          { path, before: null, after: null, beforeExists: false, afterExists: false },
        ]),
      ).toThrow();
    }
    expect(base.database).toEqual(pg);
  });
});
