import { describe, expect, it } from 'vitest';
import { createEmptyNativeDocument, type NativeDesignDocument } from './native-document.js';
import { defaultDatabaseContext } from './profiles.js';
import { inspectNativeDatabaseDocument, validateDatabaseDocument } from './validation.js';

function fixture(): NativeDesignDocument {
  const document = createEmptyNativeDocument(defaultDatabaseContext('postgresql'));
  document.domains = [{ id: 'd', name: '', description: '' }];
  document.views = [{ id: 'v', name: '', domainIds: ['d'] }];
  document.tables = ['t', 'other'].map((id) => ({
    id,
    domainId: 'd',
    scope: 'logical',
    logical: { name: id, definition: '' },
    physical: {
      name: id,
      namespace: { kind: 'postgresSchema', name: 'public' },
      comment: '',
      options: { database: 'postgresql' },
    },
    customProperties: { common: {}, logical: {}, physical: {} },
  }));
  document.columns = [
    {
      id: 'c',
      tableId: 't',
      scope: 'logical',
      logical: { name: '', definition: '', semanticType: '', required: false },
      physical: {
        name: '',
        type: {
          kind: 'builtin',
          database: 'postgresql',
          typeId: 'postgresql:integer',
          parameters: {},
        },
        nullable: true,
        defaultValue: { kind: 'none' },
        generation: { kind: 'none' },
        comment: '',
        options: { database: 'postgresql' },
      },
      customProperties: { common: {}, logical: {}, physical: {} },
    },
  ];
  document.tableRelations = [
    {
      id: 'r',
      scope: 'logical',
      sourceTableId: 't',
      targetTableId: 'other',
      logical: { name: '', cardinality: 'one-to-many', required: false },
      physical: null,
    },
  ];
  document.layout.nodes = ['t', 'other'].map((id, index) => ({
    id: `node-${id}`,
    objectId: id,
    viewId: '__tables__',
    x: index * 400,
    y: 0,
    width: 320,
    height: 260,
  }));
  document.layout.relations = [{ relationId: 'r', viewId: '__tables__', offset: 0 }];
  return document;
}
const graphCodes = (doc: NativeDesignDocument) =>
  inspectNativeDatabaseDocument(doc, doc.database)
    .filter((issue) => issue.code.startsWith('document.'))
    .map((issue) => issue.code);
describe('native graph references survive all model scopes', () => {
  it('rejects dangling logical table/column/key/relation and owner scope references', () => {
    const doc = fixture();
    expect(graphCodes(doc)).toEqual([]);
    doc.tables![0]!.domainId = 'missing';
    doc.columns![0]!.tableId = 'missing';
    doc.keys = [
      { id: 'k', tableId: 'other', name: '', kind: 'primary', scope: 'physical', columnIds: ['c'] },
    ];
    doc.tableRelations![0]!.targetTableId = 'missing';
    expect(graphCodes(doc)).toEqual(
      expect.arrayContaining([
        'document.table-domain-not-found',
        'document.owner-table-not-found',
        'document.scope-mismatch',
        'document.column-reference-invalid',
        'document.relation-table-not-found',
      ]),
    );
  });
  it('covers logical ENUM, generation/default AST, index parts/predicate/include and CHECK references', () => {
    const doc = fixture();
    doc.columns![0]!.physical.type = {
      kind: 'projectEnum',
      database: 'postgresql',
      enumId: 'missing',
    };
    doc.columns![0]!.physical.generation = {
      kind: 'computed',
      database: 'postgresql',
      storage: 'stored',
      expression: { kind: 'column', columnId: 'missing' },
    };
    doc.columns![0]!.physical.defaultValue = {
      kind: 'expression',
      expression: { kind: 'column', columnId: 'missing' },
    };
    doc.indexes = [
      {
        id: 'i',
        tableId: 't',
        name: '',
        scope: 'logical',
        unique: false,
        parts: [{ expression: { kind: 'column', columnId: 'missing' }, direction: 'asc' }],
        options: {
          database: 'postgresql',
          method: 'btree',
          predicate: { kind: 'column', columnId: 'missing' },
          includeColumnIds: ['missing'],
        },
      },
    ];
    doc.checks = [
      {
        id: 'check',
        tableId: 'other',
        scope: 'logical',
        name: '',
        expression: { kind: 'column', columnId: 'c' },
      },
    ];
    const issues = inspectNativeDatabaseDocument(doc, doc.database).filter((issue) =>
      issue.code.startsWith('document.'),
    );
    expect(
      issues.filter((issue) => issue.code === 'document.column-reference-invalid'),
    ).toHaveLength(6);
    expect(issues.some((issue) => issue.code === 'document.enum-not-found')).toBe(true);
    expect(issues.every((issue) => !('cause' in issue))).toBe(true);
  });
  it('checks ON UPDATE ownership independently of whether a table is exported', () => {
    const doc = fixture();
    doc.columns![0]!.physical.options = {
      database: 'mysql',
      onUpdate: { kind: 'column', columnId: 'missing' },
    };
    expect(graphCodes(doc)).toContain('document.column-reference-invalid');
  });
  it('checks domain/view/note/viewport and layout references', () => {
    const doc = fixture();
    doc.views![0]!.domainIds = ['missing'];
    doc.domainRelations = [
      {
        id: 'dr',
        sourceDomainId: 'd',
        targetDomainId: 'missing',
        name: '',
        direction: 'both',
        description: '',
      },
    ];
    doc.notes = [{ id: 'note', viewId: 'missing', text: '' }];
    doc.layout.viewports.push({ viewId: 'missing', x: 0, y: 0, zoom: 1 });
    doc.layout.nodes[0]!.viewId = 'v';
    expect(graphCodes(doc)).toEqual(
      expect.arrayContaining([
        'document.view-domain-not-found',
        'document.relation-domain-not-found',
        'document.note-view-not-found',
        'document.viewport-view-not-found',
        'document.layout-target-invalid',
        'document.relation-layout-invalid',
      ]),
    );
  });
  it('preserves incomplete drafts but rejects dangling and duplicated key/FK references', () => {
    const doc = fixture();
    doc.keys = [
      { id: 'k', tableId: 't', name: '', scope: 'logical', kind: 'primary', columnIds: [] },
    ];
    expect(graphCodes(doc)).toEqual([]);
    doc.keys![0]!.columnIds = ['c', 'c'];
    doc.tableRelations![0]!.physical = {
      name: '',
      sourceColumnIds: ['c', 'c'],
      targetColumnIds: ['missing'],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    };
    expect(graphCodes(doc)).toEqual(
      expect.arrayContaining([
        'document.key-columns-duplicate',
        'document.logical-relation-has-fk',
        'document.fk-columns-duplicate',
        'document.column-reference-invalid',
      ]),
    );
  });
  it('retains old graph problems on safe edits but rejects copying or switching a failed dependency', () => {
    const before = fixture();
    before.domainRelations = [
      {
        id: 'dr',
        sourceDomainId: 'missing',
        targetDomainId: 'd',
        name: '',
        direction: 'both',
        description: '',
      },
    ];
    const after = structuredClone(before);
    after.domainRelations[0]!.description = 'safe';
    expect(
      validateDatabaseDocument(after, after.database, { mode: 'write', previous: before }),
    ).toEqual([]);
    after.domains = [];
    after.domains.push({ id: 'missing', name: '', description: '' });
    expect(
      validateDatabaseDocument(after, after.database, { mode: 'write', previous: before }).some(
        (issue) => issue.code === 'document.relation-domain-not-found',
      ),
    ).toBe(true);
    const copied = structuredClone(before);
    copied.domainRelations.push({ ...before.domainRelations[0]!, id: 'copy' });
    expect(
      validateDatabaseDocument(copied, copied.database, { mode: 'write', previous: before }).some(
        (issue) => issue.code === 'document.relation-domain-not-found' && issue.objectId === 'copy',
      ),
    ).toBe(true);
  });
  it('does not waive a newly missing route endpoint because the other endpoint was already missing', () => {
    const before = fixture();
    before.layout.nodes = before.layout.nodes.filter((node) => node.objectId !== 't');
    const after = structuredClone(before);
    after.layout.nodes = [
      { id: 'node-t', objectId: 't', viewId: '__tables__', x: 0, y: 0, width: 320, height: 260 },
    ];
    expect(
      validateDatabaseDocument(after, after.database, { mode: 'write', previous: before }).some(
        (issue) => issue.code === 'document.relation-layout-invalid',
      ),
    ).toBe(true);
  });
  it('enforces one primary key per logical/physical facet without merging their separate definitions', () => {
    const doc = fixture();
    doc.tables![0]!.scope = 'both';
    doc.columns![0]!.scope = 'both';
    doc.keys = [
      {
        id: 'logical',
        tableId: 't',
        name: '',
        scope: 'logical',
        kind: 'primary',
        columnIds: ['c'],
      },
      {
        id: 'physical',
        tableId: 't',
        name: '',
        scope: 'physical',
        kind: 'primary',
        columnIds: ['c'],
      },
    ];
    expect(graphCodes(doc)).toEqual([]);
    doc.keys!.push({ ...doc.keys![0]!, id: 'both', scope: 'both' });
    expect(
      graphCodes(doc).filter((code) => code === 'document.multiple-primary-keys'),
    ).toHaveLength(4);
  });
});
