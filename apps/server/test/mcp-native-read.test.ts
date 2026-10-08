import { describe, expect, it } from 'vitest';
import {
  createEmptyNativeDocument,
  defaultDatabaseContext,
  TABLES_VIEW_ID,
  type NativeDesignDocument,
} from '@ezerd/model';
import {
  assertNativeQueryVersion,
  batchTableDetails,
  batchTableDetailsInputSchema,
  batchTableDetailsMetadataSchema,
  listTablesInputSchema,
  projectViewInputSchema,
  listTables,
  listViewRelations,
  projectSummary,
  projectSummarySchema,
  projectView,
  projectViewSchema,
  tableDetails,
  tableDetailsMetadataSchema,
  tableListSchema,
  viewRelationsSchema,
  type NativeProjectState,
} from '../src/mcp/mcp-native-read.js';
import { z } from 'zod';

const properties = { common: {}, logical: {}, physical: {} };
const now = new Date().toISOString();
function fixture(kind: 'postgresql' | 'mysql' | 'sqlite' = 'postgresql'): NativeProjectState {
  const database = defaultDatabaseContext(kind);
  const document = createEmptyNativeDocument(database);
  document.domains = [
    { id: 'sales', name: 'Sales', description: '' },
    { id: 'other', name: 'Other', description: '' },
  ];
  document.views = [
    { id: 'mine', name: 'Mine', domainIds: ['sales'] },
    { id: 'hidden', name: 'Hidden', domainIds: ['sales'] },
  ];
  document.tables = ['a', 'b', 'c'].map((id) => ({
    id,
    domainId: id === 'c' ? null : 'sales',
    scope: id === 'b' ? 'logical' : 'both',
    logical: { name: `Logical ${id}`, definition: 'Long definition' },
    physical: {
      name: `physical_${id}`,
      namespace:
        kind === 'postgresql'
          ? { kind: 'postgresSchema', name: 'public' }
          : kind === 'mysql'
            ? { kind: 'mysqlCurrentDatabase' }
            : { kind: 'sqliteMain' },
      comment: '',
      options:
        kind === 'postgresql'
          ? { database: 'postgresql' }
          : kind === 'mysql'
            ? { database: 'mysql', engine: 'InnoDB' }
            : { database: 'sqlite', strict: false, withoutRowid: false },
    },
    customProperties: properties,
  }));
  document.notes = [
    { id: 'shared', viewId: TABLES_VIEW_ID, text: 'Shared' },
    { id: 'private', viewId: 'mine', text: 'Private' },
  ];
  const node = (id: string, objectId: string, viewId: string, x: number) => ({
    id,
    objectId,
    viewId,
    x,
    y: 0,
    width: 240,
    height: 180,
  });
  document.layout.nodes = [
    node('1-a', 'a', TABLES_VIEW_ID, 0),
    node('2-b', 'b', TABLES_VIEW_ID, 300),
    node('3-c', 'c', TABLES_VIEW_ID, 600),
    node('4-shared', 'shared', TABLES_VIEW_ID, 900),
    node('mine-a', 'a', 'mine', 111),
    node('mine-b', 'b', 'mine', 411),
    node('mine-note', 'private', 'mine', 711),
    node('hidden-a', 'a', 'hidden', 999),
    node('stale-domain-a', 'a', 'sales', 999),
    node('overview-sales', 'sales', 'overview', 0),
  ];
  document.tableRelations = [
    {
      id: 'r-ab',
      sourceTableId: 'a',
      targetTableId: 'b',
      scope: 'both',
      logical: { name: 'Relation', cardinality: 'one-to-many', required: true },
      physical: {
        name: 'fk_ab',
        sourceColumnIds: [],
        targetColumnIds: [],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      deferrable: { initially: 'deferred' },
    },
  ];
  document.layout.relations = [
    { relationId: 'r-ab', viewId: TABLES_VIEW_ID, offset: 12 },
    { relationId: 'r-ab', viewId: 'mine', offset: 99 },
  ];
  document.layout.viewports = [
    { viewId: TABLES_VIEW_ID, x: 12, y: 24, zoom: 0.8 },
    { viewId: 'mine', x: 99, y: 99, zoom: 1 },
  ];
  return {
    project: {
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      name: 'Native',
      status: 'active',
      version: 7,
      databaseKind: kind,
      databaseProfileId: database.profileId,
      databaseRevision: 4,
      createdAt: now,
      updatedAt: now,
    },
    document,
    syncSequence: 12,
    personalViewIds: ['mine'],
  };
}

describe('native MCP scoped queries', () => {
  it('returns ordered unique batch details and rejects missing IDs and excessive batches atomically', () => {
    const state = fixture();
    const result = batchTableDetails(state, {
      projectId: state.project.id,
      tableIds: ['b', 'a', 'b'],
    });
    expect(result.tables.map((item) => item.table.id)).toEqual(['b', 'a']);
    expect(result).toMatchObject({ syncSequence: 12, databaseRevision: 4 });
    expect(result.tables[1]!.relations).toEqual(state.document.tableRelations);
    expect(
      result.tables.every((item) => item.nodes.every((node) => node.viewId !== 'hidden')),
    ).toBe(true);
    expect(() =>
      batchTableDetails(state, { projectId: state.project.id, tableIds: ['a', 'missing'] }),
    ).toThrow('테이블을 찾을 수 없습니다.');
    expect(
      batchTableDetailsInputSchema.safeParse({ projectId: state.project.id, tableIds: [] }).success,
    ).toBe(false);
    expect(
      batchTableDetailsInputSchema.safeParse({
        projectId: state.project.id,
        tableIds: Array(21).fill('a'),
      }).success,
    ).toBe(false);
    expect(() => z.toJSONSchema(batchTableDetailsMetadataSchema)).not.toThrow();
  });

  it('requires paired pagination versions and detects sequence or database changes with HTTP 409', () => {
    const state = fixture();
    const version = { expectedSequence: 12, expectedDatabaseRevision: 4 };
    expect(() => assertNativeQueryVersion(state, version)).not.toThrow();
    for (const changed of [
      { ...version, expectedSequence: 13 },
      { ...version, expectedDatabaseRevision: 5 },
    ]) {
      try {
        assertNativeQueryVersion(state, changed);
        expect.fail('Expected version conflict');
      } catch (error) {
        expect((error as { getStatus(): number }).getStatus()).toBe(409);
      }
    }
    expect(
      listTablesInputSchema.safeParse({ projectId: state.project.id, expectedSequence: 12 })
        .success,
    ).toBe(false);
    expect(
      projectViewInputSchema.safeParse({
        projectId: state.project.id,
        viewId: 'sales',
        expectedDatabaseRevision: 4,
      }).success,
    ).toBe(false);
    expect(() =>
      listTables(state, {
        projectId: state.project.id,
        search: '',
        limit: 1,
        ...version,
        expectedSequence: 11,
      }),
    ).toThrow('프로젝트 버전이 변경되었습니다.');
  });

  it('refreshes indexes for mutable documents and safely reuses fully frozen documents across actors', () => {
    const state = fixture();
    expect(projectSummary(state).domains[0]!.tableCount).toBe(2);
    expect(tableDetails(state, 'a').table.logical.name).toBe('Logical a');
    state.document.tables![0]!.domainId = 'other';
    state.document.tables![0]!.logical.name = 'Changed';
    expect(projectSummary(state).domains[0]!.tableCount).toBe(1);
    expect(tableDetails(state, 'a').table.logical.name).toBe('Changed');
    const freeze = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    };
    freeze(state.document);
    expect(tableDetails(state, 'a').nodes.some((node) => node.viewId === 'mine')).toBe(true);
    const otherActor = { ...state, personalViewIds: [] };
    expect(tableDetails(otherActor, 'a').nodes.some((node) => node.viewId === 'mine')).toBe(false);
    expect(
      batchTableDetails(otherActor, {
        projectId: state.project.id,
        tableIds: ['a'],
      }).tables[0]!.nodes.some((node) => node.viewId === 'mine'),
    ).toBe(false);
  });

  it('includes v2 concurrency context and counts without full definitions or other actor views', () => {
    const result = projectSummary(fixture());
    expect(result).toMatchObject({
      protocolVersion: 2,
      schemaVersion: 2,
      databaseRevision: 4,
      syncSequence: 12,
      counts: { tables: 3, indexes: 0, checks: 0 },
    });
    expect(result.views.map((view) => view.id)).toEqual([
      'overview',
      TABLES_VIEW_ID,
      'sales',
      'other',
      'mine',
    ]);
    expect(JSON.stringify(result)).not.toContain('Long definition');
  });

  it('preserves scopes and paginates table IDs while supporting unassigned/search filters', () => {
    const state = fixture();
    const first = listTables(state, { projectId: state.project.id, search: '', limit: 1 });
    expect(first.tables[0]).toMatchObject({ id: 'a', scope: 'both' });
    expect(first.nextCursor).toBe('a');
    expect(
      listTables(state, {
        projectId: state.project.id,
        search: 'LOGICAL',
        cursor: first.nextCursor!,
        limit: 1,
      }).tables[0],
    ).toMatchObject({ id: 'b', scope: 'logical' });
    expect(
      listTables(state, {
        projectId: state.project.id,
        domainId: null,
        search: '',
        limit: 50,
      }).tables.map((table) => table.id),
    ).toEqual(['c']);
  });

  it('uses shared domain coordinates and paged relations, while private views use actor geometry', () => {
    const state = fixture();
    const result = projectView(state, 'sales');
    expect(result.tables.map((table) => table.id)).toEqual(['a', 'b']);
    expect(result.notes.map((note) => note.id)).toEqual(['shared']);
    expect(result.nodes.every((node) => node.viewId === TABLES_VIEW_ID)).toBe(true);
    expect(result.viewport?.x).toBe(12);
    expect(result.tableRelations[0]).toMatchObject({ scope: 'both' });
    const first = projectView(state, 'sales', 1);
    expect(first.tableRelations).toEqual([]);
    expect(first.nextCursor).toBe('1-a');
    expect(projectView(state, 'sales', 1, first.nextCursor!).nodes[0]!.id).toBe('2-b');
    expect(listViewRelations(state, 'sales').relations[0]?.layout?.offset).toBe(12);
    expect(listViewRelations(state, 'mine').relations[0]?.layout?.offset).toBe(99);
    expect(projectView(state, 'mine').notes.map((note) => note.id)).toEqual(['private']);
    expect(projectView(state, 'other').notes.map((note) => note.id)).toEqual(['shared']);
    expect(projectView(state, 'overview').tables).toEqual([]);
    expect(() => projectView(state, 'hidden')).toThrow('화면을 찾을 수 없습니다.');
  });

  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'returns %s native types/defaults/generation and complete constraints losslessly',
    (kind) => {
      const state = fixture(kind);
      const type: NonNullable<NativeDesignDocument['columns']>[number]['physical']['type'] =
        kind === 'postgresql'
          ? {
              kind: 'projectEnum',
              database: 'postgresql',
              enumId: 'enum',
              array: { dimensions: 2 },
            }
          : kind === 'mysql'
            ? { kind: 'valueList', database: 'mysql', typeId: 'mysql:enum', values: ['a', 'b'] }
            : {
                kind: 'declared',
                database: 'sqlite',
                name: 'CUSTOM',
                numericArguments: ['16', '2'],
              };
      state.document.columns = [
        {
          id: 'col',
          tableId: 'a',
          scope: 'physical',
          logical: { name: 'Col', definition: '', semanticType: '', required: false },
          physical: {
            name: 'col',
            type,
            nullable: true,
            comment: '',
            generation: { kind: 'none' },
            defaultValue: { kind: 'literal', literalType: 'number', value: '9007199254740993' },
            options: { database: kind },
          },
          customProperties: properties,
        },
      ];
      state.document.enums = [
        { id: 'enum', name: 'State', schema: 'public', values: ['open', 'closed'] },
      ];
      state.document.keys = [
        {
          id: 'key',
          tableId: 'a',
          scope: 'physical',
          kind: 'primary',
          name: 'pk',
          columnIds: ['col'],
          deferrable: { initially: 'deferred' },
          nullsNotDistinct: true,
        },
      ];
      state.document.indexes = [
        {
          id: 'index',
          tableId: 'a',
          name: 'idx',
          scope: 'physical',
          unique: false,
          parts: [{ expression: { kind: 'column', columnId: 'col' }, direction: 'desc' }],
          options:
            kind === 'postgresql'
              ? { database: kind, method: 'btree' }
              : kind === 'mysql'
                ? { database: kind, kind: 'btree' }
                : { database: kind },
        },
      ];
      state.document.checks = [
        {
          id: 'check',
          tableId: 'a',
          name: 'valid',
          scope: 'physical',
          expression: {
            kind: 'isNull',
            operand: { kind: 'column', columnId: 'col' },
            negate: true,
          },
        },
      ];
      const result = tableDetails(state, 'a');
      expect(result.columns[0]!.physical).toEqual(state.document.columns[0]!.physical);
      expect(result.keys).toEqual(state.document.keys);
      expect(result.indexes).toEqual(state.document.indexes);
      expect(result.checks).toEqual(state.document.checks);
      expect(result.relations).toEqual(state.document.tableRelations);
      expect(result.columnDisplays[0]!.type).toBe(
        kind === 'postgresql' ? 'State[][]' : kind === 'mysql' ? 'ENUM("a", "b")' : 'CUSTOM(16,2)',
      );
      expect(result.enums.map((value) => value.id)).toEqual(kind === 'postgresql' ? ['enum'] : []);
      expect(result.nodes.some((node) => node.viewId === 'hidden')).toBe(false);
      expect(result.nodes.some((node) => node.viewId === 'sales')).toBe(false);
      expect(() => tableDetails(state, 'missing')).toThrow('테이블을 찾을 수 없습니다.');
    },
  );

  it('exports nonrecursive SDK metadata while runtime projection keeps exact ASTs', () => {
    for (const schema of [
      projectSummarySchema,
      projectViewSchema,
      tableListSchema,
      viewRelationsSchema,
      tableDetailsMetadataSchema,
    ]) {
      expect(() => z.toJSONSchema(schema)).not.toThrow();
    }
  });

  it('keeps native computed/default expressions, unresolved source values and namespace intact', () => {
    const state = fixture();
    const expression = {
      kind: 'call' as const,
      functionId: 'postgresql:abs' as const,
      args: [
        { kind: 'literal' as const, literalType: 'number' as const, value: '-9007199254740993' },
      ],
    };
    state.document.tables![0]!.physical.namespace = {
      kind: 'legacyNamespace',
      source: 'document-v1',
      original: 'retained_schema',
    };
    state.document.columns = [
      {
        id: 'legacy-col',
        tableId: 'a',
        scope: 'both',
        customProperties: properties,
        logical: { name: '', definition: '', semanticType: '', required: false },
        physical: {
          name: 'col',
          type: {
            kind: 'legacy',
            source: 'document-v1',
            original: { name: 'CUSTOM', isArray: false },
          },
          nullable: true,
          comment: '',
          generation: { kind: 'computed', database: 'postgresql', storage: 'stored', expression },
          defaultValue: {
            kind: 'legacyExpression',
            source: 'document-v1',
            original: 'exact_legacy_expression()',
          },
          options: { database: 'postgresql' },
        },
      },
    ];
    const result = tableDetails(state, 'a');
    expect(result.table.physical.namespace).toEqual(state.document.tables![0]!.physical.namespace);
    expect(result.columns).toEqual(state.document.columns);
    expect(result.columnDisplays[0]).toMatchObject({
      type: 'CUSTOM',
      defaultValue: 'exact_legacy_expression()',
      generation: 'STORED AS ABS(-9007199254740993)',
    });
    state.document.columns[0]!.physical.defaultValue = { kind: 'expression', expression };
    expect(tableDetails(state, 'a').columns[0]!.physical.defaultValue).toEqual({
      kind: 'expression',
      expression,
    });
  });

  it('paginates all visible relations independently of card pages and returns overview routes', () => {
    const state = fixture();
    state.document.tableRelations!.push({
      ...state.document.tableRelations![0]!,
      id: 'r-ac',
      targetTableId: 'c',
    });
    const first = listViewRelations(state, TABLES_VIEW_ID, 1);
    expect(first.nextCursor).toBe('r-ab');
    const second = listViewRelations(state, TABLES_VIEW_ID, 1, first.nextCursor!);
    expect(second.relations.map((relation) => relation.id)).toEqual(['r-ac']);
    expect(second.nextCursor).toBeNull();
    expect(listViewRelations(state, 'sales').relations.map((relation) => relation.id)).toEqual([
      'r-ab',
    ]);
    state.document.domainRelations = [
      {
        id: 'domain-relation',
        sourceDomainId: 'sales',
        targetDomainId: 'other',
        name: 'Domain relation',
        direction: 'forward',
        description: '',
      },
    ];
    state.document.layout.nodes.push({
      id: 'overview-other',
      objectId: 'other',
      viewId: 'overview',
      x: 300,
      y: 0,
      width: 240,
      height: 180,
    });
    state.document.layout.relations!.push({
      relationId: 'domain-relation',
      viewId: 'overview',
      offset: 23,
    });
    expect(projectView(state, 'overview').relationLayouts[0]!.offset).toBe(23);
    expect(listViewRelations(state, 'overview').relations[0]).toMatchObject({
      kind: 'domain',
      layout: { offset: 23 },
    });
  });
});
