import { describe, it, expect } from 'vitest';
import {
  createEmptyDocument,
  createEmptyNativeDocument,
  defaultDatabaseContext,
  nativeExpressionColumnIds,
  type DatabaseKind,
  type NativeColumn,
  type NativeDesignDocument,
} from '@ezerd/model';
import {
  copyNativeTableClipboard,
  nativeTableClipboardSchema,
  parseTableClipboardRead,
  planNativeTablePaste,
} from './native-clipboard.js';

const properties = { common: {}, logical: {}, physical: {} };
function fixture(databaseKind: DatabaseKind = 'postgresql'): NativeDesignDocument {
  const document = createEmptyNativeDocument(defaultDatabaseContext(databaseKind));
  document.domains = [{ id: 'd', name: 'domain', description: '' }];
  document.views = [{ id: 'v', name: 'private', domainIds: ['d'] }];
  document.notes = [{ id: 'note', viewId: 'v', text: 'private camera note' }];
  document.tables = ['p', 'c'].map((id) => ({
    id,
    domainId: 'd',
    scope: 'both',
    logical: { name: id, definition: '' },
    physical: {
      name: id,
      comment: '',
      namespace:
        databaseKind === 'postgresql'
          ? { kind: 'postgresSchema', name: 'public' }
          : databaseKind === 'mysql'
            ? { kind: 'mysqlCurrentDatabase' }
            : { kind: 'sqliteMain' },
      options:
        databaseKind === 'postgresql'
          ? { database: 'postgresql' }
          : databaseKind === 'mysql'
            ? { database: 'mysql', engine: 'InnoDB' }
            : { database: 'sqlite', strict: false, withoutRowid: false },
    },
    customProperties: properties,
  }));
  const column = (id: string, tableId: string): NativeColumn => ({
    id,
    tableId,
    scope: 'both',
    logical: { name: id, definition: '', semanticType: '', required: false },
    physical: {
      name: id,
      type:
        databaseKind === 'postgresql'
          ? {
              kind: 'builtin',
              database: 'postgresql',
              typeId: 'postgresql:integer',
              parameters: {},
            }
          : databaseKind === 'mysql'
            ? { kind: 'builtin', database: 'mysql', typeId: 'mysql:int', parameters: {} }
            : { kind: 'builtin', database: 'sqlite', typeId: 'sqlite:integer', parameters: {} },
      nullable: false,
      generation: { kind: 'none' },
      defaultValue: { kind: 'none' },
      options: { database: databaseKind },
      comment: '',
    },
    customProperties: properties,
  });
  const a = column('a', 'p');
  const b = column('b', 'p');
  b.physical.generation = {
    kind: 'computed',
    database: databaseKind,
    storage: 'stored',
    expression: {
      kind: 'binary',
      operator: '+',
      left: { kind: 'column', columnId: 'a' },
      right: { kind: 'literal', literalType: 'number', value: '1' },
    },
  };
  document.columns = [a, b, column('pid', 'c')];
  document.keys = [
    { id: 'k', tableId: 'p', name: 'pk', scope: 'physical', kind: 'primary', columnIds: ['a'] },
  ];
  document.tableRelations = [
    {
      id: 'r',
      sourceTableId: 'c',
      targetTableId: 'p',
      scope: 'both',
      logical: { name: 'r', cardinality: 'one-to-many', required: false },
      physical: {
        name: 'fk',
        sourceColumnIds: ['pid'],
        targetColumnIds: ['a'],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
    },
  ];
  document.indexes = [
    {
      id: 'i',
      tableId: 'p',
      name: 'i',
      unique: false,
      scope: 'physical',
      parts: [{ expression: { kind: 'column', columnId: 'b' }, direction: 'asc' }],
      options:
        databaseKind === 'postgresql'
          ? { database: 'postgresql', method: 'btree', includeColumnIds: ['a'] }
          : databaseKind === 'mysql'
            ? { database: 'mysql', kind: 'btree' }
            : {
                database: 'sqlite',
                predicate: {
                  kind: 'isNull',
                  operand: { kind: 'column', columnId: 'a' },
                  negate: true,
                },
              },
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
        left: { kind: 'column', columnId: 'a' },
        right: { kind: 'literal', literalType: 'number', value: '0' },
      },
    },
  ];
  document.layout.nodes = [
    { id: 'np', objectId: 'p', viewId: '__tables__', x: 10, y: 20, width: 360, height: 280 },
    { id: 'nc', objectId: 'c', viewId: '__tables__', x: 400, y: 20, width: 320, height: 260 },
    { id: 'nn', objectId: 'note', viewId: 'v', x: 1, y: 2, width: 240, height: 160 },
  ];
  document.layout.viewports = [{ viewId: 'v', x: 20, y: 30, zoom: 1.5 }];
  document.layout.relations = [
    {
      relationId: 'r',
      viewId: '__tables__',
      offset: 9,
      bend: { x: 200, y: 50 },
      waypoints: [{ x: 100, y: 20 }],
    },
  ];
  return document;
}
function allocator() {
  let id = 0;
  return () => `new-${++id}`;
}
function file(document: NativeDesignDocument, ids = ['p', 'c']) {
  return nativeTableClipboardSchema.parse(JSON.parse(copyNativeTableClipboard(document, ids).text));
}

describe('native table clipboard consumer preparation', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'copies/pastes a complete %s graph, while preserving original inputs and product readiness gates',
    (kind) => {
      const source = fixture(kind);
      const original = structuredClone(source);
      const clipboard = file(source);
      const target = createEmptyNativeDocument(defaultDatabaseContext(kind));
      target.domains = [{ id: 'destination', name: 'destination', description: '' }];
      const targetBefore = structuredClone(target);
      const plan = planNativeTablePaste(
        target,
        clipboard,
        'destination',
        { x: 100, y: 200 },
        allocator(),
      );
      const p = plan.document.tables![0]!.id;
      const c = plan.document.tables![1]!.id;
      const a = plan.document.columns![0]!.id;
      const b = plan.document.columns![1]!.id;
      const pid = plan.document.columns![2]!.id;
      expect(plan.document.tables!.map((table) => table.domainId)).toEqual([
        'destination',
        'destination',
      ]);
      expect(plan.document.keys![0]).toMatchObject({ tableId: p, columnIds: [a] });
      expect(plan.document.tableRelations![0]).toMatchObject({
        sourceTableId: c,
        targetTableId: p,
        physical: { sourceColumnIds: [pid], targetColumnIds: [a] },
      });
      expect(plan.document.columns![1]!.physical.generation).toMatchObject({
        expression: { left: { columnId: a } },
      });
      expect(nativeExpressionColumnIds(plan.document.indexes![0]!.parts[0]!.expression)).toEqual([
        b,
      ]);
      expect(nativeExpressionColumnIds(plan.document.checks![0]!.expression)).toEqual([a]);
      expect(plan.document.layout.nodes[0]).toMatchObject({
        objectId: p,
        viewId: '__tables__',
        x: 100,
        y: 200,
        width: 360,
      });
      expect(plan.document.layout.nodes[1]).toMatchObject({ objectId: c, x: 490, y: 200 });
      expect(plan.document.layout.relations![0]).toMatchObject({
        relationId: plan.document.tableRelations![0]!.id,
        bend: { x: 290, y: 230 },
        waypoints: [{ x: 190, y: 200 }],
      });
      expect(plan.canApply).toBe(false);
      expect(plan.issues.some((issue) => issue.code.endsWith('not-implemented'))).toBe(true);
      expect(source).toEqual(original);
      expect(target).toEqual(targetBefore);
      expect(clipboard.document.domains).toEqual([]);
      expect(clipboard.document.notes).toEqual([]);
      expect(clipboard.document.layout.viewports).toEqual([]);
      expect(clipboard.document.views).toBeUndefined();
    },
  );
  it('omits external FKs explicitly and supports an active-view position snapshot without copying view identity', () => {
    const source = fixture();
    const copied = copyNativeTableClipboard(
      source,
      ['p'],
      [{ ...source.layout.nodes[0]!, viewId: 'v', x: 75, y: 85 }],
    );
    expect(copied.omittedRelationIds).toEqual(['r']);
    const clipboard = nativeTableClipboardSchema.parse(JSON.parse(copied.text));
    expect(clipboard.document.tableRelations).toEqual([]);
    expect(clipboard.document.layout.nodes[0]).toMatchObject({
      viewId: '__tables__',
      x: 75,
      y: 85,
    });
    expect(() => copyNativeTableClipboard(source, ['missing'])).toThrow(
      'clipboard.selection-invalid',
    );
  });
  it('keeps v1 data readable without guessing a source database or normalizing legacy aliases', () => {
    const old = createEmptyDocument();
    old.columns = [
      {
        id: 'c',
        tableId: 't',
        scope: 'physical',
        logical: { name: '', definition: '', semanticType: '', required: false },
        physical: {
          name: 'c',
          type: { name: ' FLOAT4 ', isArray: false },
          nullable: true,
          defaultExpression: null,
          comment: '',
        },
        customProperties: properties,
      },
    ];
    const text = JSON.stringify({ format: 'ezerd/tables-v1', document: old });
    expect(parseTableClipboardRead(text)).toEqual(JSON.parse(text));
    expect(nativeTableClipboardSchema.safeParse(JSON.parse(text)).success).toBe(false);
    expect(parseTableClipboardRead('{')).toBeNull();
  });
  it('rejects another engine/profile, missing fragment references, private payloads and new legacy copies', () => {
    const source = fixture();
    const clipboard = file(source);
    expect(() =>
      planNativeTablePaste(
        createEmptyNativeDocument(defaultDatabaseContext('mysql')),
        clipboard,
        null,
        { x: 0, y: 0 },
        allocator(),
      ),
    ).toThrow('clipboard.database-mismatch');
    expect(
      nativeTableClipboardSchema.safeParse({
        ...clipboard,
        sourceDatabase: defaultDatabaseContext('mysql'),
      }).success,
    ).toBe(false);
    const bad = structuredClone(clipboard);
    bad.document.indexes![0]!.parts[0]!.expression = { kind: 'column', columnId: 'external' };
    expect(parseTableClipboardRead(JSON.stringify(bad))).toBeNull();
    const privatePayload = structuredClone(clipboard);
    privatePayload.document.notes = [{ id: 'note', viewId: '__tables__', text: 'private' }];
    expect(parseTableClipboardRead(JSON.stringify(privatePayload))).toBeNull();
    const legacy = structuredClone(source);
    legacy.columns![0]!.physical.type = {
      kind: 'legacy',
      source: 'document-v1',
      original: { name: 'weird', isArray: false },
    };
    expect(() => copyNativeTableClipboard(legacy, ['p'])).toThrow(
      'clipboard.legacy-copy-not-supported',
    );
    legacy.columns![0]!.physical.type = source.columns![0]!.physical.type;
    legacy.columns![0]!.physical.defaultValue = {
      kind: 'legacyExpression',
      source: 'document-v1',
      original: 'raw()',
    };
    expect(() => copyNativeTableClipboard(legacy, ['p'])).toThrow(
      'clipboard.legacy-copy-not-supported',
    );
    legacy.columns![0]!.physical.defaultValue = { kind: 'none' };
    legacy.tables![0]!.physical.namespace = {
      kind: 'legacyNamespace',
      source: 'document-v1',
      original: 'public',
    };
    expect(() => copyNativeTableClipboard(legacy, ['p'])).toThrow(
      'clipboard.legacy-copy-not-supported',
    );
  });
  it('reuses only identical ENUM definitions and keeps renamed identifiers within the PostgreSQL byte limit', () => {
    const source = fixture();
    source.enums = [{ id: 'e', name: 'state', schema: 'public', values: ['ok', 'ng'] }];
    source.columns![0]!.physical.type = {
      kind: 'projectEnum',
      database: 'postgresql',
      enumId: 'e',
    };
    source.columns![2]!.physical.type = {
      kind: 'projectEnum',
      database: 'postgresql',
      enumId: 'e',
    };
    source.checks![0]!.expression = {
      kind: 'binary',
      operator: '>',
      left: { kind: 'column', columnId: 'b' },
      right: { kind: 'literal', literalType: 'number', value: '0' },
    };
    // The computed arithmetic column must not read the ENUM column in this clipboard.
    source.columns![1]!.physical.generation = { kind: 'none' };
    source.tables![0]!.physical.name = '값'.repeat(21);
    const clipboard = file(source);
    const target = structuredClone(source);
    target.views = [];
    target.notes = [];
    target.layout.nodes = target.layout.nodes.filter((node) => node.viewId === '__tables__');
    target.layout.viewports = [];
    const plan = planNativeTablePaste(target, clipboard, null, { x: 0, y: 0 }, allocator());
    expect(plan.document.enums).toHaveLength(1);
    expect(plan.document.columns![3]!.physical.type).toMatchObject({ enumId: 'e' });
    const name = plan.document.tables![2]!.physical.name;
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(63);
    expect(name.endsWith('_copy')).toBe(true);
    const changed = structuredClone(target);
    changed.enums![0]!.values = ['other'];
    const second = planNativeTablePaste(changed, clipboard, null, { x: 0, y: 0 }, allocator());
    expect(second.document.enums).toHaveLength(2);
    expect(second.document.enums![1]!.name).toBe('state_copy');
    expect(second.document.columns![3]!.physical.type).not.toMatchObject({ enumId: 'e' });
  });
  it('rejects allocator/destination/coordinate problems and preserves existing unrelated legacy problems', () => {
    const clipboard = file(fixture());
    const target = createEmptyNativeDocument(defaultDatabaseContext('postgresql'));
    expect(() =>
      planNativeTablePaste(target, clipboard, null, { x: 0, y: 0 }, () => 'same'),
    ).toThrow('clipboard.identity-collision');
    expect(() =>
      planNativeTablePaste(target, clipboard, 'missing', { x: 0, y: 0 }, allocator()),
    ).toThrow('clipboard.destination-invalid');
    expect(() =>
      planNativeTablePaste(target, clipboard, null, { x: 10_000_001, y: 0 }, allocator()),
    ).toThrow();
    // All translated nodes must fit, even if the first node itself is in range.
    expect(() =>
      planNativeTablePaste(target, clipboard, null, { x: 10_000_000, y: 0 }, allocator()),
    ).toThrow();
    const legacy = fixture();
    legacy.columns![0]!.physical.type = {
      kind: 'legacy',
      source: 'document-v1',
      original: { name: 'unknown', isArray: false },
    };
    const result = planNativeTablePaste(legacy, clipboard, null, { x: 0, y: 0 }, allocator());
    expect(result.document.columns![0]!.physical.type).toEqual(legacy.columns![0]!.physical.type);
    expect(
      result.issues.some(
        (issue) => issue.objectId === 'a' && issue.code === 'legacy.type-unresolved',
      ),
    ).toBe(false);
  });
  it('avoids case-folded MySQL name collisions and validates the copied SQLite table mode', () => {
    const source = fixture('mysql');
    source.tables![0]!.logical.name = 'P';
    source.tables![0]!.physical.name = 'P';
    const target = fixture('mysql');
    const plan = planNativeTablePaste(target, file(source), 'd', { x: 0, y: 0 }, allocator());
    expect(plan.document.tables![2]!.logical.name).toBe('P_copy');
    expect(plan.document.tables![2]!.physical.name).toBe('P_copy');
    const sqlite = fixture('sqlite');
    sqlite.tables![0]!.physical.options = { database: 'sqlite', strict: true, withoutRowid: false };
    sqlite.columns![0]!.physical.type = {
      kind: 'builtin',
      database: 'sqlite',
      typeId: 'sqlite:varchar',
      parameters: {},
    };
    expect(() => copyNativeTableClipboard(sqlite, ['p'])).toThrow('type.strict-not-supported');
  });
  it('checks UTF-8/envelope limits and full merged document capacity before exposing a candidate', () => {
    expect(parseTableClipboardRead('🙂'.repeat(500_001))).toBeNull();
    const source = fixture();
    source.tables![0]!.physical.comment = 'x'.repeat(10_000);
    const clipboard = file(source);
    const target = createEmptyNativeDocument(defaultDatabaseContext('postgresql'));
    target.domains = Array.from({ length: 149 }, (_, index) => ({
      id: 'd' + index,
      name: '',
      description: 'x'.repeat(10_000),
    }));
    expect(() =>
      planNativeTablePaste(target, clipboard, null, { x: 0, y: 0 }, allocator()),
    ).toThrow('document.size-limit');
    expect(target.tables).toBeUndefined();
  });
});
