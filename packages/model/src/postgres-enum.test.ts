import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type Column, type DesignDocument } from './document.js';
import { exportPostgres } from './postgres.js';
const metadata = () => ({ common: {}, logical: {}, physical: {} });
function fixture(): DesignDocument {
  const column = (id: string, tableId: string): Column => ({
    id,
    tableId,
    scope: 'both',
    logical: { name: id, definition: '', semanticType: '', required: false },
    physical: {
      name: 'state',
      type: { name: 'legacy hint', enumId: 'state', isArray: false },
      nullable: false,
      defaultExpression: "'ready'",
      comment: '',
    },
    customProperties: metadata(),
  });
  return {
    ...createEmptyDocument(),
    domains: [{ id: 'd', name: 'D', description: '' }],
    enums: [
      {
        id: 'state',
        schema: 'types',
        name: 'order_state',
        values: ['ready', "owner's", 'back\\slash', ''],
      },
    ],
    tables: ['a', 'b'].map((id) => ({
      id,
      domainId: 'd',
      scope: 'both',
      logical: { name: id, definition: '' },
      physical: { name: id, schema: 'app', comment: '' },
      customProperties: metadata(),
    })),
    columns: [column('ac', 'a'), column('bc', 'b')],
    keys: [
      { id: 'pk', tableId: 'a', scope: 'both', kind: 'primary', name: 'a_pk', columnIds: ['ac'] },
    ],
    tableRelations: [
      {
        id: 'fk',
        sourceTableId: 'b',
        targetTableId: 'a',
        scope: 'both',
        logical: { name: 'reference', cardinality: 'one-to-many', required: true },
        physical: {
          name: 'b_fk',
          sourceColumnIds: ['bc'],
          targetColumnIds: ['ac'],
          onDelete: 'NO ACTION',
          onUpdate: 'NO ACTION',
        },
      },
    ],
  };
}
describe('PostgreSQL project ENUM DDL', () => {
  it('creates qualified enum types before tables with safe ordered labels and stable ID lookup', () => {
    const doc = fixture();
    doc.enums![0]!.name = 'order"state';
    const result = exportPostgres(doc);
    expect(result.diagnostics).toEqual([]);
    expect(result.sql).toContain('CREATE SCHEMA IF NOT EXISTS "types"');
    expect(result.sql).toContain('CREATE TYPE "types"."order""state" AS ENUM');
    expect(result.sql).toContain("E'ready', E'owner''s', E'back\\\\slash', E''");
    expect(result.sql).toContain('"state" "types"."order""state" NOT NULL DEFAULT');
    expect(result.sql.indexOf('CREATE TYPE')).toBeLessThan(result.sql.indexOf('CREATE TABLE'));
  });
  it('supports enum arrays without unsafe array defaults', () => {
    const doc = fixture();
    for (const column of doc.columns!) {
      column.physical.type.isArray = true;
      column.physical.defaultExpression = null;
    }
    expect(exportPostgres(doc).sql).toContain('"types"."order_state"[]');
    doc.columns![0]!.physical.defaultExpression = "'{ready}'";
    expect(exportPostgres(doc).canExport).toBe(false);
  });
  it('rejects missing enum references, invalid labels, duplicate names and table type collisions', () => {
    for (const mutate of [
      (d: DesignDocument) => {
        d.columns![0]!.physical.type.enumId = 'missing';
      },
      (d: DesignDocument) => {
        d.enums![0]!.values = ['same', 'same'];
      },
      (d: DesignDocument) => {
        d.enums![0]!.values = ['한'.repeat(22)];
      },
      (d: DesignDocument) => {
        d.enums![0]!.values = ['bad\0label'];
      },
      (d: DesignDocument) => {
        d.enums!.push({ ...d.enums![0]!, id: 'duplicate' });
      },
      (d: DesignDocument) => {
        d.enums![0]!.schema = 'app';
        d.enums![0]!.name = 'a';
      },
    ]) {
      const doc = fixture();
      mutate(doc);
      expect(exportPostgres(doc).canExport).toBe(false);
      expect(exportPostgres(doc).sql).toBe('');
    }
  });
  it('rejects enum modifiers and defaults outside the declared labels', () => {
    for (const mutate of [
      (c: Column) => {
        c.physical.type.length = 5;
      },
      (c: Column) => {
        c.physical.type.precision = 3;
      },
      (c: Column) => {
        c.physical.type.scale = 1;
      },
      (c: Column) => {
        c.physical.defaultExpression = "'READY'";
      },
      (c: Column) => {
        c.physical.defaultExpression = "'ready'; DROP TABLE a";
      },
    ]) {
      const doc = fixture();
      mutate(doc.columns![0]!);
      expect(exportPostgres(doc).canExport).toBe(false);
    }
  });
  it('checks enum FK compatibility by ID rather than legacy type names', () => {
    const doc = fixture();
    doc.columns![1]!.physical.type.name = 'different hint';
    expect(exportPostgres(doc).canExport).toBe(true);
    doc.enums!.push({ ...doc.enums![0]!, id: 'other', name: 'other_state' });
    doc.columns![1]!.physical.type.enumId = 'other';
    expect(exportPostgres(doc).diagnostics.some((d) => d.code === 'fk-type-mismatch')).toBe(true);
    delete doc.columns![1]!.physical.type.enumId;
    doc.columns![1]!.physical.type.name = 'text';
    expect(exportPostgres(doc).diagnostics.some((d) => d.code === 'fk-type-mismatch')).toBe(true);
  });
  it('permits NULL and escaped member defaults and does not interpret enum legacy names as builtins', () => {
    const doc = fixture();
    doc.columns![0]!.physical.defaultExpression = "'owner''s'";
    doc.columns![0]!.physical.type.name = 'json';
    doc.columns![1]!.physical.defaultExpression = 'NULL';
    expect(exportPostgres(doc).canExport).toBe(true);
  });
});
it('accepts standard string backslashes as enum label characters and re-escapes output', () => {
  const doc = fixture();
  doc.columns![0]!.physical.defaultExpression = "'back\\slash'";
  const result = exportPostgres(doc);
  expect(result.diagnostics).toEqual([]);
  expect(result.sql).toContain("DEFAULT E'back\\\\slash'");
  doc.columns![0]!.physical.defaultExpression = "E'back\\slash'";
  expect(exportPostgres(doc).canExport).toBe(false);
});
it('diagnoses duplicate enum IDs even when the type names differ', () => {
  const doc = fixture();
  doc.enums!.push({ ...doc.enums![0]!, name: 'different_name' });
  const result = exportPostgres(doc);
  expect(result.canExport).toBe(false);
  expect(result.sql).toBe('');
  expect(result.diagnostics.some((item) => item.code === 'duplicate-enum-id')).toBe(true);
});
