import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  defaultDatabaseContext,
  migrateDesignDocumentV1,
  normalizeSharedTableCanvas,
  type DesignDocument,
} from '@ezerd/model';
import {
  readNativeProjectDocument,
  normalizeNativeServerDocument,
} from '../src/shared/native-document-reader.js';
import { normalizeServerDocument } from '../src/shared/normalize-document.js';
import { nativeStoredDesignDocumentSchema } from '@ezerd/contracts';

function fixture(): DesignDocument {
  const doc = createEmptyDocument();
  doc.domains = [{ id: 'd', name: '', description: '' }];
  doc.views = [{ id: 'v', name: 'private', domainIds: ['d'] }];
  doc.tables = ['a', 'b'].map((id) => ({
    id,
    domainId: 'd',
    scope: 'both',
    logical: { name: id, definition: '' },
    physical: { name: id, schema: 'public', comment: '' },
    customProperties: { common: {}, logical: {}, physical: {} },
  }));
  doc.columns = ['a', 'b'].map((tableId) => ({
    id: 'c-' + tableId,
    tableId,
    scope: 'both',
    logical: { name: '', definition: '', required: false, semanticType: '' },
    physical: {
      name: 'id',
      type: { name: ' FLOAT4 ', isArray: false },
      nullable: true,
      defaultExpression: 'old()',
      comment: '',
    },
    customProperties: { common: {}, logical: {}, physical: {} },
  }));
  doc.tableRelations = [
    {
      id: 'r',
      sourceTableId: 'a',
      targetTableId: 'b',
      scope: 'logical',
      logical: { name: '', cardinality: 'one-to-many', required: false },
      physical: null,
    },
  ];
  doc.notes = [
    { id: 'shared', viewId: 'd', text: 'shared' },
    { id: 'private', viewId: 'v', text: 'private' },
  ];
  doc.layout.nodes = [
    { id: 'domain', objectId: 'd', viewId: 'overview', x: 0, y: 0, width: 240, height: 180 },
    { id: 'a-domain', objectId: 'a', viewId: 'd', x: 0, y: 0, width: 320, height: 260 },
    { id: 'b-domain', objectId: 'b', viewId: 'd', x: 400, y: 0, width: 320, height: 260 },
    {
      id: 'a-global',
      objectId: 'a',
      viewId: '__tables__',
      x: 1000,
      y: 2000,
      width: 320,
      height: 260,
    },
    {
      id: 'b-global',
      objectId: 'b',
      viewId: '__tables__',
      x: 1400,
      y: 2000,
      width: 320,
      height: 260,
    },
    { id: 'shared-node', objectId: 'shared', viewId: 'd', x: 100, y: 200, width: 240, height: 160 },
    { id: 'private-node', objectId: 'private', viewId: 'v', x: 30, y: 40, width: 240, height: 160 },
  ];
  doc.layout.relations = [
    {
      relationId: 'r',
      viewId: 'd',
      offset: 7,
      bend: { x: 200, y: 0 },
      waypoints: [{ x: 100, y: 0 }],
    },
  ];
  doc.layout.viewports = [{ viewId: 'v', x: 20, y: 40, zoom: 1.5 }];
  return doc;
}
describe('read-only native project preview', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    'preserves exact v1 %s source aliases/defaults and project context while migrating a separate preview',
    (kind) => {
      const source = fixture();
      const original = structuredClone(source);
      const context = defaultDatabaseContext(kind);
      const result = readNativeProjectDocument(source, { ...context, revision: 7 });
      expect(result.status).toBe('available');
      if (result.status !== 'available') throw new Error('Expected a preview');
      expect(result.rawSource).toEqual(original);
      expect(result.stored).toEqual(original);
      expect(result.preview.schemaVersion).toBe(2);
      expect(result.preview.database).toEqual(context);
      expect(result.database.revision).toBe(7);
      if (kind === 'postgresql') {
        expect(result.preview.columns![0]!.physical.type).toMatchObject({
          kind: 'builtin',
          typeId: 'postgresql:real',
        });
      } else {
        expect(result.preview.columns![0]!.physical.type).toEqual({
          kind: 'legacy',
          source: 'document-v1',
          original: { name: ' FLOAT4 ', isArray: false },
        });
        expect(result.preview.tables![0]!.physical.namespace).toMatchObject({
          kind: 'legacyNamespace',
          original: 'public',
        });
      }
      expect(result.preview.columns![0]!.physical.defaultValue).toMatchObject({
        kind: 'legacyExpression',
        original: 'old()',
      });
      expect(result.issues.some((issue) => issue.code === 'legacy.default-unresolved')).toBe(true);
      expect(result.issues.some((issue) => issue.code.endsWith('not-implemented'))).toBe(false);
      result.preview.columns![0]!.physical.comment = 'preview edit';
      expect(result.stored).toEqual(original);
      expect(result.rawSource).toEqual(original);
      expect(source).toEqual(original);
    },
  );
  it('migrates shared notes/routes with table offset and preserves private state', () => {
    const context = defaultDatabaseContext('postgresql');
    const source = fixture();
    const result = readNativeProjectDocument(source, { ...context, revision: 0 });
    if (result.status !== 'available') throw new Error('Expected a preview');
    expect(result.preview.notes[0]!.viewId).toBe('__tables__');
    expect(result.preview.layout.nodes.find((node) => node.objectId === 'shared')).toMatchObject({
      viewId: '__tables__',
      x: 1100,
      y: 2200,
    });
    expect(result.preview.layout.relations![0]).toMatchObject({
      viewId: '__tables__',
      bend: { x: 1200, y: 2000 },
      waypoints: [{ x: 1100, y: 2000 }],
    });
    expect(result.preview.notes[1]).toEqual(source.notes[1]);
    expect(result.preview.layout.viewports).toEqual(source.layout.viewports);
    expect(result.preview.views).toEqual(source.views);
  });
  it('keeps native expressions/indexes/checks/legacy data exact and detached from stored/source snapshots', () => {
    const context = defaultDatabaseContext('postgresql');
    const source = migrateDesignDocumentV1(fixture(), context).document;
    source.indexes = [
      {
        id: 'i',
        tableId: 'a',
        scope: 'physical',
        name: 'i',
        unique: false,
        parts: [{ direction: 'asc', expression: { kind: 'column', columnId: 'c-a' } }],
        options: { database: 'postgresql', method: 'btree' },
      },
    ];
    source.checks = [
      {
        id: 'check',
        tableId: 'a',
        scope: 'physical',
        name: 'check',
        expression: { kind: 'isNull', operand: { kind: 'column', columnId: 'c-a' }, negate: false },
      },
    ];
    const original = structuredClone(source);
    const result = readNativeProjectDocument(source, { ...context, revision: 3 });
    if (result.status !== 'available') throw new Error('Expected a preview');
    expect(result.preview.indexes).toEqual(source.indexes);
    expect(result.preview.checks).toEqual(source.checks);
    expect(result.preview.columns).toEqual(source.columns);
    expect(result.migrationIssues).toEqual([]);
    result.preview.indexes![0]!.name = 'changed';
    result.preview.columns![0]!.physical.comment = 'changed';
    expect(result.stored).toEqual(original);
    expect(result.rawSource).toEqual(original);
    expect(source).toEqual(original);
  });
  it('normalizes long imported identities with deterministic collision-safe nodes and is idempotent', () => {
    const context = defaultDatabaseContext('postgresql');
    const source = migrateDesignDocumentV1(fixture(), context).document;
    source.tables = source.tables!.map((table, index) => ({
      ...table,
      id: 'x'.repeat(159) + index,
    }));
    source.columns = [];
    source.tableRelations = [];
    source.notes = [];
    source.layout = { nodes: [], viewports: [] };
    const first = normalizeNativeServerDocument(source);
    const second = normalizeNativeServerDocument(first);
    expect(nativeStoredDesignDocumentSchema.safeParse(first).success).toBe(true);
    expect(new Set(first.layout.nodes.map((node) => node.id)).size).toBe(2);
    expect(first.layout.nodes.every((node) => node.id.length <= 160)).toBe(true);
    expect(first.layout.nodes.map((node) => node.objectId)).toEqual(
      source.tables!.map((table) => table.id),
    );
    expect(first).toEqual(second);
    expect(source.layout.nodes).toEqual([]);
  });
  it('keeps the existing v1 canonical canvas output and physical alias normalization unchanged', () => {
    const source = fixture();
    const canvas = normalizeSharedTableCanvas(source);
    const server = normalizeServerDocument(source);
    expect(server.layout).toEqual(canvas.layout);
    expect(server.notes).toEqual(canvas.notes);
    expect(server.columns![0]!.physical.type).toEqual({ name: 'real', isArray: false });
    expect(source.columns![0]!.physical.type.name).toBe(' FLOAT4 ');
  });
  it('preserves a readable original when preview expansion exceeds the native budget', () => {
    const source = createEmptyDocument();
    source.domains = Array.from({ length: 137 }, (_, i) => ({
      id: 'd-' + i,
      name: '',
      description: 'x'.repeat(10000),
    }));
    // Native metadata and canonical table placements push this otherwise valid v1 near-limit file over budget.
    source.tables = Array.from({ length: 170 }, (_, i) => ({
      id: 't-' + i,
      domainId: null,
      scope: 'logical',
      logical: { name: '', definition: '' },
      physical: { name: '', schema: 'public', comment: '' },
      customProperties: { common: {}, logical: {}, physical: {} },
    }));
    source.columns = source.tables.map((table, i) => ({
      id: 'c-' + i,
      tableId: table.id,
      scope: 'logical',
      logical: { name: '', definition: '', semanticType: '', required: false },
      physical: {
        name: '',
        type: { name: 'integer', isArray: false },
        nullable: true,
        defaultExpression: null,
        comment: '',
      },
      customProperties: { common: {}, logical: {}, physical: {} },
    }));
    const result = readNativeProjectDocument(source, {
      ...defaultDatabaseContext('postgresql'),
      revision: 0,
    });
    expect(result).toMatchObject({
      status: 'unavailable',
      code: 'document.native-preview-invalid',
      rawSource: source,
    });
    expect(source.schemaVersion).toBe(1);
    expect(source.layout.nodes).toEqual([]);
  });
  it('rejects malformed sources and keeps a mismatched native DB as unavailable raw data', () => {
    const context = defaultDatabaseContext('postgresql');
    expect(() =>
      readNativeProjectDocument({ schemaVersion: 9 }, { ...context, revision: 0 }),
    ).toThrow(BadRequestException);
    const source = migrateDesignDocumentV1(fixture(), context).document;
    const result = readNativeProjectDocument(source, {
      ...defaultDatabaseContext('mysql'),
      revision: 0,
    });
    expect(result).toMatchObject({
      status: 'unavailable',
      code: 'database.context-changed',
      rawSource: source,
    });
    expect(source.database).toEqual(context);
  });
});
