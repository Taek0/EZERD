import { describe, it, expect } from 'vitest';
import {
  createEmptyNativeDocument,
  nativeExpressionColumnIds,
  type NativeDesignDocument,
  type NativeColumn,
} from './native-document.js';
import { defaultDatabaseContext } from './profiles.js';
import { remapNativeDocumentIds, type NativeIdentityRemap } from './remap.js';

const properties = { common: { literal: 'a' }, logical: {}, physical: {} };
function column(id: string, tableId = 'p'): NativeColumn {
  return {
    id,
    tableId,
    scope: 'both',
    logical: { name: id, definition: 'a', semanticType: '', required: false },
    physical: {
      name: id,
      type: {
        kind: 'builtin',
        database: 'postgresql',
        typeId: 'postgresql:bigint',
        parameters: {},
      },
      nullable: false,
      generation: { kind: 'none' },
      defaultValue: { kind: 'none' },
      comment: 'a',
      options: { database: 'postgresql' },
    },
    customProperties: properties,
  };
}
function fixture() {
  const document = createEmptyNativeDocument(defaultDatabaseContext('postgresql'));
  document.domains = [
    { id: 'd', name: 'a', description: 'a' },
    { id: 'postgresql:bigint', name: 'other', description: '' },
  ];
  document.domainRelations = [
    {
      id: 'dr',
      sourceDomainId: 'd',
      targetDomainId: 'postgresql:bigint',
      name: 'a',
      description: '',
      direction: 'forward',
    },
  ];
  document.views = [{ id: 'v', name: 'a', domainIds: ['d', 'postgresql:bigint'] }];
  document.notes = [{ id: 'n', viewId: 'v', text: 'a' }];
  document.enums = [{ id: 'e', name: 'a', schema: 'public', values: ['a', 'b'] }];
  document.tables = ['p', 'c'].map((id) => ({
    id,
    domainId: 'd',
    scope: 'both',
    logical: { name: 'a', definition: '' },
    physical: {
      name: 'a',
      comment: 'a',
      namespace: { kind: 'postgresSchema', name: 'public' },
      options: { database: 'postgresql' },
    },
    customProperties: properties,
  }));
  const a = column('a');
  a.physical.generation = {
    kind: 'identity',
    database: 'postgresql',
    mode: 'always',
    sequence: { start: '9007199254740993', increment: '1' },
  };
  const b = column('b');
  b.physical.generation = {
    kind: 'computed',
    database: 'postgresql',
    storage: 'stored',
    expression: { kind: 'unary', operator: '-', operand: { kind: 'column', columnId: 'a' } },
  };
  const enumColumn = column('enum-col');
  enumColumn.physical.type = {
    kind: 'projectEnum',
    database: 'postgresql',
    enumId: 'e',
    array: { dimensions: 2 },
  };
  enumColumn.physical.defaultValue = { kind: 'literal', literalType: 'string', value: 'a' };
  const child = column('pid', 'c');
  child.physical.defaultValue = {
    kind: 'expression',
    expression: {
      kind: 'call',
      functionId: 'postgresql:coalesce',
      args: [
        { kind: 'column', columnId: 'a' },
        { kind: 'literal', literalType: 'number', value: '9007199254740993' },
      ],
    },
  };
  document.columns = [a, b, enumColumn, child];
  document.keys = [
    { id: 'k', tableId: 'p', scope: 'physical', kind: 'primary', name: 'a', columnIds: ['a'] },
  ];
  document.tableRelations = [
    {
      id: 'r',
      sourceTableId: 'c',
      targetTableId: 'p',
      scope: 'both',
      logical: { name: 'a', cardinality: 'one-to-many', required: false },
      physical: {
        name: 'a',
        sourceColumnIds: ['pid'],
        targetColumnIds: ['a'],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      deferrable: { initially: 'immediate' },
    },
  ];
  document.indexes = [
    {
      id: 'i',
      tableId: 'p',
      name: 'a',
      unique: false,
      scope: 'physical',
      parts: [{ expression: { kind: 'column', columnId: 'a' }, direction: 'desc' }],
      options: {
        database: 'postgresql',
        method: 'btree',
        includeColumnIds: ['b'],
        predicate: { kind: 'isNull', operand: { kind: 'column', columnId: 'a' }, negate: true },
      },
    },
  ];
  document.checks = [
    {
      id: 'q',
      tableId: 'p',
      name: 'a',
      scope: 'physical',
      expression: {
        kind: 'binary',
        operator: '>',
        left: { kind: 'column', columnId: 'b' },
        right: { kind: 'literal', literalType: 'number', value: '0' },
      },
    },
  ];
  document.layout.nodes = [
    { id: 'a', objectId: 'p', viewId: '__tables__', x: 1, y: 2, width: 320, height: 260 },
    { id: 'node-n', objectId: 'n', viewId: 'v', x: 3, y: 4, width: 240, height: 120 },
  ];
  document.layout.viewports = [
    { viewId: 'overview', x: 0, y: 0, zoom: 1 },
    { viewId: 'v', x: 1, y: 2, zoom: 1.5 },
  ];
  document.layout.relations = [
    { relationId: 'r', viewId: '__tables__', offset: 9, waypoints: [{ x: 10, y: 20 }] },
  ];
  return document;
}
function ids(document: NativeDesignDocument): NativeIdentityRemap {
  const items = [
    ...document.domains,
    ...document.domainRelations,
    ...document.notes,
    ...(document.views ?? []),
    ...(document.enums ?? []),
    ...(document.tables ?? []),
    ...(document.columns ?? []),
    ...(document.keys ?? []),
    ...(document.tableRelations ?? []),
    ...(document.indexes ?? []),
    ...(document.checks ?? []),
  ];
  return {
    entities: new Map(items.map((item) => [item.id, 'copy:' + item.id])),
    nodes: new Map(document.layout.nodes.map((item) => [item.id, 'copy:node:' + item.id])),
  };
}
describe('native identity/reference remapping', () => {
  it('remaps the whole graph including AST/ENUM/FK/index/check and personal/shared layout references', () => {
    const source = fixture();
    const original = structuredClone(source);
    const next = remapNativeDocumentIds(source, ids(source));
    expect(next.domains[1]!.id).toBe('copy:postgresql:bigint');
    expect(next.domainRelations[0]).toMatchObject({
      id: 'copy:dr',
      sourceDomainId: 'copy:d',
      targetDomainId: 'copy:postgresql:bigint',
    });
    expect(next.views![0]!.domainIds).toEqual(['copy:d', 'copy:postgresql:bigint']);
    expect(next.notes[0]).toMatchObject({ id: 'copy:n', viewId: 'copy:v', text: 'a' });
    expect(next.tables![0]).toMatchObject({
      id: 'copy:p',
      domainId: 'copy:d',
      physical: { name: 'a' },
    });
    expect(next.columns![0]).toMatchObject({
      id: 'copy:a',
      tableId: 'copy:p',
      physical: {
        type: { typeId: 'postgresql:bigint' },
        generation: { sequence: { start: '9007199254740993' } },
      },
    });
    expect(next.columns![1]!.physical.generation).toMatchObject({
      expression: { operand: { columnId: 'copy:a' } },
    });
    expect(next.columns![2]!.physical.type).toMatchObject({
      enumId: 'copy:e',
      array: { dimensions: 2 },
    });
    expect(next.columns![2]!.physical.defaultValue).toEqual({
      kind: 'literal',
      literalType: 'string',
      value: 'a',
    });
    expect(next.columns![3]!.physical.defaultValue).toMatchObject({
      expression: { args: [{ columnId: 'copy:a' }, { value: '9007199254740993' }] },
    });
    expect(next.keys![0]).toMatchObject({ id: 'copy:k', tableId: 'copy:p', columnIds: ['copy:a'] });
    expect(next.tableRelations![0]).toMatchObject({
      sourceTableId: 'copy:c',
      targetTableId: 'copy:p',
      physical: { sourceColumnIds: ['copy:pid'], targetColumnIds: ['copy:a'] },
      deferrable: { initially: 'immediate' },
    });
    expect(next.indexes![0]).toMatchObject({
      tableId: 'copy:p',
      parts: [{ expression: { columnId: 'copy:a' } }],
      options: { includeColumnIds: ['copy:b'], predicate: { operand: { columnId: 'copy:a' } } },
    });
    expect(nativeExpressionColumnIds(next.checks![0]!.expression)).toEqual(['copy:b']);
    expect(next.layout.nodes[0]).toMatchObject({
      id: 'copy:node:a',
      objectId: 'copy:p',
      viewId: '__tables__',
      x: 1,
      y: 2,
    });
    expect(next.layout.nodes[1]).toMatchObject({ objectId: 'copy:n', viewId: 'copy:v' });
    expect(next.layout.viewports.map((view) => view.viewId)).toEqual(['overview', 'copy:v']);
    expect(next.layout.relations![0]).toMatchObject({
      relationId: 'copy:r',
      viewId: '__tables__',
      offset: 9,
    });
    expect(next.database).toEqual(source.database);
    expect(next.enums![0]!.values).toEqual(['a', 'b']);
    expect(next.columns![0]!.customProperties).toEqual(source.columns![0]!.customProperties);
    expect(source).toEqual(original);
  });
  it('remaps MySQL onUpdate and SQLite partial-index AST without changing their database tags', () => {
    for (const databaseKind of ['mysql', 'sqlite'] as const) {
      const source = fixture();
      source.database = defaultDatabaseContext(databaseKind);
      source.columns![0]!.physical.options = {
        database: 'mysql',
        onUpdate: { kind: 'column', columnId: 'b' },
      };
      source.indexes![0]!.options = {
        database: 'sqlite',
        predicate: {
          kind: 'in',
          operand: { kind: 'column', columnId: 'a' },
          values: [{ kind: 'column', columnId: 'b' }],
          negate: false,
        },
      };
      const next = remapNativeDocumentIds(source, ids(source));
      expect(next.columns![0]!.physical.options).toEqual({
        database: 'mysql',
        onUpdate: { kind: 'column', columnId: 'copy:b' },
      });
      expect(next.indexes![0]!.options).toMatchObject({
        database: 'sqlite',
        predicate: { operand: { columnId: 'copy:a' }, values: [{ columnId: 'copy:b' }] },
      });
    }
  });
  it('preserves legacy evidence byte-for-byte; consumers separately decide provenance/clone permissions', () => {
    const source = fixture();
    source.columns![0]!.physical.type = {
      kind: 'legacy',
      source: 'document-v1',
      original: { name: ' a ', enumId: 'e', isArray: false },
    };
    source.columns![0]!.physical.defaultValue = {
      kind: 'legacyExpression',
      source: 'document-v1',
      original: 'a() ',
    };
    source.tables![0]!.physical.namespace = {
      kind: 'legacyNamespace',
      source: 'document-v1',
      original: ' a ',
    };
    const next = remapNativeDocumentIds(source, ids(source));
    expect(next.columns![0]!.physical.type).toEqual(source.columns![0]!.physical.type);
    expect(next.columns![0]!.physical.defaultValue).toEqual(
      source.columns![0]!.physical.defaultValue,
    );
    expect(next.tables![0]!.physical.namespace).toEqual(source.tables![0]!.physical.namespace);
  });
  it('rejects missing/duplicate/reserved mappings and node/entity destination collisions', () => {
    const source = fixture();
    const good = ids(source);
    for (const [id, target] of [
      ['a', 'copy:b'],
      ['a', 'overview'],
      ['a', ''],
      ['a', ' spaces '],
    ]) {
      const entities = new Map(good.entities);
      entities.set(id!, target!);
      expect(() => remapNativeDocumentIds(source, { ...good, entities })).toThrow();
    }
    const entities = new Map(good.entities);
    entities.delete('q');
    expect(() => remapNativeDocumentIds(source, { ...good, entities })).toThrow(
      'remap.identity-missing',
    );
    const nodes = new Map(good.nodes);
    nodes.set('a', 'copy:a');
    expect(() => remapNativeDocumentIds(source, { ...good, nodes })).toThrow(
      'remap.identity-collision',
    );
    nodes.delete('a');
    expect(() => remapNativeDocumentIds(source, { ...good, nodes })).toThrow(
      'remap.node-identity-missing',
    );
    expect(() =>
      remapNativeDocumentIds(source, { ...good, retainedEntityIds: new Set(['copy:node:a']) }),
    ).toThrow('remap.identity-collision');
  });
  it('allows only explicit retained external identities and rejects missing references atomically', () => {
    const source = fixture();
    source.tables![0]!.domainId = 'external';
    const good = ids(source);
    expect(() => remapNativeDocumentIds(source, good)).toThrow('remap.reference-missing');
    expect(
      remapNativeDocumentIds(source, { ...good, retainedEntityIds: new Set(['external']) })
        .tables![0]!.domainId,
    ).toBe('external');
    const entities = new Map(good.entities);
    entities.set('external', 'destination');
    expect(
      remapNativeDocumentIds(source, {
        ...good,
        entities,
        retainedEntityIds: new Set(['destination']),
      }).tables![0]!.domainId,
    ).toBe('destination');
    entities.set('external', '');
    expect(() =>
      remapNativeDocumentIds(source, {
        ...good,
        entities,
        retainedEntityIds: new Set(['external']),
      }),
    ).toThrow('remap.reference-missing');
    expect(source.tables![0]!.domainId).toBe('external');
  });
  it('preserves omitted optional collections on an empty native document', () => {
    const source = createEmptyNativeDocument(defaultDatabaseContext('sqlite'));
    expect(remapNativeDocumentIds(source, { entities: new Map(), nodes: new Map() })).toEqual(
      source,
    );
  });
});
