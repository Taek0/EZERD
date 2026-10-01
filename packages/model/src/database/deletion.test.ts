import { describe, it, expect } from 'vitest';
import {
  createEmptyNativeDocument,
  type NativeDesignDocument,
  type NativeColumn,
  type NativeExpression,
} from './native-document.js';
import { defaultDatabaseContext } from './profiles.js';
import type { DatabaseKind } from './definitions.js';
import { inspectNativeDatabaseDocument } from './validation.js';
import { planNativeDeletion, deleteNativeObjects } from './deletion.js';
import {
  applyChanges,
  deletionSnapshots,
  diffSharedDocument,
  inverseChanges,
  sharedDocument,
} from '../sync.js';

const properties = { common: {}, logical: {}, physical: {} };
const ref = (columnId: string): NativeExpression => ({ kind: 'column', columnId });
function column(id: string, tableId = 'p'): NativeColumn {
  return {
    id,
    tableId,
    scope: 'both',
    logical: { name: id, definition: '', semanticType: '', required: false },
    physical: {
      name: id,
      type: {
        kind: 'builtin',
        database: 'postgresql',
        typeId: 'postgresql:integer',
        parameters: {},
      },
      generation: { kind: 'none' },
      defaultValue: { kind: 'none' },
      options: { database: 'postgresql' },
      nullable: false,
      comment: '',
    },
    customProperties: properties,
  };
}
function fixture(databaseKind: DatabaseKind = 'postgresql'): NativeDesignDocument {
  const document = createEmptyNativeDocument(defaultDatabaseContext(databaseKind));
  document.tables = ['p', 'c'].map((id) => ({
    id,
    domainId: null,
    scope: 'both',
    logical: { name: id, definition: '' },
    physical: {
      name: id,
      namespace: { kind: 'postgresSchema', name: 'public' },
      options: { database: 'postgresql' },
      comment: '',
    },
    customProperties: properties,
  }));
  document.columns = [column('id'), column('n/~'), column('pid', 'c')];
  document.keys = [
    { id: 'pk', tableId: 'p', kind: 'primary', scope: 'physical', name: 'pk', columnIds: ['id'] },
    {
      id: 'composite',
      tableId: 'p',
      kind: 'unique',
      scope: 'physical',
      name: 'unique_pair',
      columnIds: ['id', 'n/~'],
    },
  ];
  document.tableRelations = [
    {
      id: 'r',
      sourceTableId: 'c',
      targetTableId: 'p',
      scope: 'both',
      logical: { name: 'Relation', cardinality: 'one-to-many', required: false },
      physical: {
        name: 'fk',
        sourceColumnIds: ['pid'],
        targetColumnIds: ['id'],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      deferrable: { initially: 'deferred' },
    },
  ];
  document.indexes = [
    {
      id: 'i',
      tableId: 'p',
      name: 'i',
      scope: 'physical',
      unique: false,
      parts: [{ expression: ref('id'), direction: 'asc' }],
      options: { database: 'postgresql', method: 'btree', includeColumnIds: ['n/~'] },
    },
  ];
  document.checks = [
    {
      id: 'q',
      tableId: 'p',
      name: 'q',
      scope: 'physical',
      expression: {
        kind: 'binary',
        operator: '>',
        left: ref('n/~'),
        right: { kind: 'literal', literalType: 'number', value: '0' },
      },
    },
  ];
  document.layout.nodes = document.tables.map((table) => ({
    id: 'node:' + table.id,
    objectId: table.id,
    viewId: '__tables__',
    x: 0,
    y: 0,
    width: 320,
    height: 260,
  }));
  document.layout.relations = [{ relationId: 'r', viewId: '__tables__', offset: 8 }];
  if (databaseKind !== 'postgresql') {
    for (const table of document.tables!) {
      table.physical.namespace =
        databaseKind === 'mysql' ? { kind: 'mysqlCurrentDatabase' } : { kind: 'sqliteMain' };
      table.physical.options =
        databaseKind === 'mysql'
          ? { database: 'mysql', engine: 'InnoDB' }
          : { database: 'sqlite', strict: false, withoutRowid: false };
    }
    for (const column of document.columns!) {
      column.physical.type =
        databaseKind === 'mysql'
          ? { kind: 'builtin', database: 'mysql', typeId: 'mysql:int', parameters: {} }
          : { kind: 'builtin', database: 'sqlite', typeId: 'sqlite:integer', parameters: {} };
      column.physical.options = { database: databaseKind };
    }
    for (const index of document.indexes!)
      index.options =
        databaseKind === 'mysql' ? { database: 'mysql', kind: 'btree' } : { database: 'sqlite' };
    if (databaseKind === 'mysql') delete document.tableRelations![0]!.deferrable;
  }
  return document;
}

describe('native deletion plans preserve references and reviewable effects', () => {
  it('finds index predicates independently of parts or include columns and cleans stale logical FK payloads', () => {
    const original = fixture();
    original.indexes![0]!.options = {
      database: 'postgresql',
      method: 'btree',
      predicate: { kind: 'isNull', operand: ref('n/~'), negate: true },
    };
    original.tableRelations![0]!.scope = 'logical';
    original.tableRelations![0]!.physical!.targetColumnIds = ['n/~'];
    const plan = planNativeDeletion(original, [{ collection: 'columns', id: 'n/~' }]);
    expect(plan.document.indexes).toEqual([]);
    expect(plan.document.tableRelations![0]!.physical).toBeNull();
    expect(plan.logicalOnlyRelationIds).toEqual(['r']);
  });
  it('handles a large reverse dependency chain and a repair of a generated cycle without repeated scans', () => {
    const original = fixture();
    for (let index = 1999; index >= 0; index--) {
      const item = column('g' + index);
      item.physical.generation = {
        kind: 'computed',
        database: 'postgresql',
        storage: 'stored',
        expression: ref(index === 0 ? 'n/~' : 'g' + (index - 1)),
      };
      original.columns!.push(item);
    }
    const plan = planNativeDeletion(original, [{ collection: 'columns', id: 'n/~' }], {
      cascadeGeneratedColumns: true,
    });
    expect(plan.cascadedColumnIds).toHaveLength(2000);
    expect(plan.document.columns!.map((item) => item.id)).toEqual(['id', 'pid']);
    const cyclic = fixture();
    cyclic.columns![0]!.physical.generation = {
      kind: 'computed',
      database: 'postgresql',
      storage: 'stored',
      expression: ref('n/~'),
    };
    cyclic.columns![1]!.physical.generation = {
      kind: 'computed',
      database: 'postgresql',
      storage: 'stored',
      expression: ref('id'),
    };
    expect(
      planNativeDeletion(cyclic, [{ collection: 'columns', id: 'id' }], {
        cascadeGeneratedColumns: true,
      }).cascadedColumnIds,
    ).toEqual(['n/~']);
  });
  it('removes composite keys and include/check references while retaining unrelated FK and original data', () => {
    const original = fixture();
    const before = structuredClone(original);
    const plan = planNativeDeletion(original, [{ collection: 'columns', id: 'n/~' }]);
    expect(plan.removed).toEqual(
      expect.arrayContaining([
        { collection: 'columns', id: 'n/~' },
        { collection: 'keys', id: 'composite' },
        { collection: 'indexes', id: 'i' },
        { collection: 'checks', id: 'q' },
      ]),
    );
    expect(plan.blockers).toEqual([]);
    expect(plan.document.tableRelations![0]!.physical).toEqual(
      original.tableRelations![0]!.physical,
    );
    expect(plan.document.columns!.map((item) => item.id)).toEqual(['id', 'pid']);
    expect(original).toEqual(before);
    const changes = diffSharedDocument(original, plan.document);
    expect(deletionSnapshots(changes)).toHaveLength(4);
    expect(applyChanges(sharedDocument(plan.document), inverseChanges(changes))).toEqual(
      sharedDocument(original),
    );
  });
  it('previews generated dependencies, and cascades them transitively only when explicitly selected', () => {
    const original = fixture();
    const b = column('b');
    b.physical.generation = {
      kind: 'computed',
      database: 'postgresql',
      storage: 'stored',
      expression: ref('n/~'),
    };
    const a = column('a');
    a.physical.generation = {
      kind: 'computed',
      database: 'postgresql',
      storage: 'stored',
      expression: ref('b'),
    };
    original.columns!.push(a, b); // Reverse order exercises the fixed point, not a single scan.
    const targets = [{ collection: 'columns' as const, id: 'n/~' }];
    expect(planNativeDeletion(original, targets).blockers).toMatchObject([
      {
        code: 'deletion.expression-dependent',
        objectId: 'b',
        path: '/columns/b/physical/generation',
        referencedIds: ['n/~'],
      },
    ]);
    expect(() => deleteNativeObjects(original, targets)).toThrow('deletion.expression-dependent');
    const plan = planNativeDeletion(original, targets, { cascadeGeneratedColumns: true });
    expect(plan.cascadedColumnIds.sort()).toEqual(['a', 'b']);
    expect(plan.blockers).toEqual([]);
    expect(
      deleteNativeObjects(original, targets, { cascadeGeneratedColumns: true }).columns!.map(
        (item) => item.id,
      ),
    ).toEqual(['id', 'pid']);
    expect(original.columns).toHaveLength(5);
  });
  it('never silently clears defaults or onUpdate expressions', () => {
    const original = fixture();
    original.columns![0]!.physical.defaultValue = { kind: 'expression', expression: ref('n/~') };
    original.columns![0]!.physical.options = { database: 'mysql', onUpdate: ref('n/~') };
    const plan = planNativeDeletion(original, [{ collection: 'columns', id: 'n/~' }], {
      cascadeGeneratedColumns: true,
    });
    expect(plan.blockers.map((blocker) => blocker.path)).toEqual([
      '/columns/id/physical/defaultValue',
      '/columns/id/physical/options/onUpdate',
    ]);
    expect(plan.document.columns![0]!.physical.defaultValue).toEqual(
      original.columns![0]!.physical.defaultValue,
    );
    expect(() => deleteNativeObjects(original, [{ collection: 'columns', id: 'n/~' }])).toThrow();
  });
  it('preserves both-model logical relationships after losing the target key, including undo', () => {
    const original = fixture();
    const plan = planNativeDeletion(original, [{ collection: 'keys', id: 'pk' }]);
    expect(plan.logicalOnlyRelationIds).toEqual(['r']);
    expect(plan.document.tableRelations![0]).toMatchObject({
      id: 'r',
      scope: 'logical',
      physical: null,
    });
    expect(plan.document.tableRelations![0]).not.toHaveProperty('deferrable');
    expect(plan.document.layout.relations).toEqual(original.layout.relations);
    const changes = diffSharedDocument(original, plan.document);
    expect(applyChanges(sharedDocument(plan.document), inverseChanges(changes))).toEqual(
      sharedDocument(original),
    );
  });
  it('removes physical-only relations and route layouts while retaining FK if an alternate target key remains', () => {
    const original = fixture();
    original.tableRelations![0]!.scope = 'physical';
    const removed = planNativeDeletion(original, [{ collection: 'keys', id: 'pk' }]);
    expect(removed.document.tableRelations).toEqual([]);
    expect(removed.document.layout.relations).toEqual([]);
    original.keys!.push({
      ...original.keys![0]!,
      id: 'alternate',
      name: 'alternate',
      kind: 'unique',
    });
    const retained = planNativeDeletion(original, [{ collection: 'keys', id: 'pk' }]);
    expect(retained.document.tableRelations).toEqual(original.tableRelations);
    expect(retained.logicalOnlyRelationIds).toEqual([]);
  });
  it('deletes table-owned objects and all referencing relations without changing peer layouts or enums', () => {
    const original = fixture();
    original.enums = [{ id: 'e', schema: 'public', name: 'e', values: ['a'] }];
    const plan = planNativeDeletion(original, [{ collection: 'tables', id: 'p' }]);
    expect(plan.blockers).toEqual([]);
    expect(plan.document.tables!.map((item) => item.id)).toEqual(['c']);
    expect(plan.document.columns!.map((item) => item.id)).toEqual(['pid']);
    expect(plan.document.keys).toEqual([]);
    expect(plan.document.indexes).toEqual([]);
    expect(plan.document.checks).toEqual([]);
    expect(plan.document.layout.nodes.map((item) => item.objectId)).toEqual(['c']);
    expect(plan.document.enums).toEqual(original.enums);
  });
  it('blocks ENUM references including opaque legacy identities until their columns are explicitly removed', () => {
    const original = fixture();
    original.enums = [{ id: 'e', schema: 'public', name: 'e', values: ['a'] }];
    original.columns![0]!.physical.type = {
      kind: 'projectEnum',
      database: 'postgresql',
      enumId: 'e',
    };
    original.columns![1]!.physical.type = {
      kind: 'legacy',
      source: 'document-v1',
      original: { name: 'raw', enumId: 'e', isArray: false },
    };
    expect(
      planNativeDeletion(original, [{ collection: 'enums', id: 'e' }]).blockers.map(
        (item) => item.path,
      ),
    ).toEqual(['/columns/id/physical/type', '/columns/n~1~0/physical/type']);
    expect(
      planNativeDeletion(original, [
        { collection: 'enums', id: 'e' },
        { collection: 'tables', id: 'p' },
      ]).blockers,
    ).toEqual([]);
  });
  it('blocks loss of the last MySQL generation key but allows another supporting index', () => {
    const original = fixture('mysql');
    original.columns![0]!.physical.generation = { kind: 'autoIncrement', database: 'mysql' };
    original.indexes = [];
    expect(
      inspectNativeDatabaseDocument(original, original.database).filter(
        (issue) => issue.severity === 'error',
      ),
    ).toEqual([]);
    const targets = [
      { collection: 'keys' as const, id: 'pk' },
      { collection: 'keys' as const, id: 'composite' },
    ];
    expect(planNativeDeletion(original, targets).blockers).toMatchObject([
      { code: 'deletion.generation-key-required', objectId: 'id' },
    ]);
    original.indexes = [
      {
        id: 'mysql-i',
        tableId: 'p',
        name: 'i',
        unique: false,
        scope: 'physical',
        parts: [{ expression: ref('id'), direction: 'asc' }],
        options: { database: 'mysql', kind: 'btree' },
      },
    ];
    expect(planNativeDeletion(original, targets).blockers).toEqual([]);
  });
  it('protects SQLite generation/without-rowid primary keys and permits whole table deletion', () => {
    const original = fixture('sqlite');
    original.columns![0]!.physical.generation = { kind: 'autoIncrement', database: 'sqlite' };
    expect(
      inspectNativeDatabaseDocument(original, original.database).filter(
        (issue) => issue.severity === 'error',
      ),
    ).toEqual([]);
    expect(planNativeDeletion(original, [{ collection: 'keys', id: 'pk' }]).blockers).toMatchObject(
      [{ code: 'deletion.generation-key-required', objectId: 'id' }],
    );
    original.columns![0]!.physical.generation = { kind: 'none' };
    original.tables![0]!.physical.options = {
      database: 'sqlite',
      strict: true,
      withoutRowid: true,
    };
    expect(planNativeDeletion(original, [{ collection: 'keys', id: 'pk' }]).blockers).toMatchObject(
      [{ code: 'deletion.primary-key-required', objectId: 'p' }],
    );
    expect(planNativeDeletion(original, [{ collection: 'tables', id: 'p' }]).blockers).toEqual([]);
  });
  it('preserves optional collections on empty plans and rejects missing identities without mutation', () => {
    const original = createEmptyNativeDocument(defaultDatabaseContext('sqlite'));
    expect(planNativeDeletion(original, []).document).toEqual(original);
    expect(() => planNativeDeletion(original, [{ collection: 'columns', id: 'missing' }])).toThrow(
      'deletion.object-not-found',
    );
    expect(original).toEqual(createEmptyNativeDocument(defaultDatabaseContext('sqlite')));
  });
});
