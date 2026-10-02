import { describe, expect, it } from 'vitest';
import {
  normalizePhysicalType,
  normalizeDocumentPhysicalTypes,
  validatePhysicalType,
  type PhysicalType,
} from './postgres-types.js';
import { createEmptyDocument } from './document.js';
import { exportPostgres } from './postgres.js';

describe('physical type policy', () => {
  it('preserves missing legacy columns without adding an empty collection', () => {
    const document = { schemaVersion: 1, columns: undefined };
    expect(normalizeDocumentPhysicalTypes(document)).toEqual(document);
    expect(normalizeDocumentPhysicalTypes({})).not.toHaveProperty('columns');
  });
  it.each([
    [' REAL ', 'real'],
    ['double   precision', 'double precision'],
    [' DECIMAL ', 'numeric'],
    ['float4', 'real'],
    ['FLOAT8', 'double precision'],
    ['int4', 'integer'],
    [' Character Varying ', 'varchar'],
    ['timestamp with time zone', 'timestamptz'],
  ])('normalizes %s without mutating input', (name, canonical) => {
    const value = { name, isArray: true };
    expect(normalizePhysicalType(value)).toEqual({ name: canonical, isArray: true });
    expect(value.name).toBe(name);
  });
  it('preserves enum and unknown custom names', () => {
    expect(normalizePhysicalType({ name: 'FLOAT8', enumId: 'e', isArray: false }).name).toBe(
      'FLOAT8',
    );
    expect(normalizePhysicalType({ name: ' MyType ', isArray: false }).name).toBe(' MyType ');
    expect(validatePhysicalType({ name: 'MyType', isArray: false })).toEqual([]);
  });
  it.each<PhysicalType>([
    { name: 'varchar', length: 1, isArray: false },
    { name: 'char', length: 10485760, isArray: false },
    { name: 'decimal', precision: 1, scale: 1000, isArray: false },
    { name: 'numeric', precision: 1000, scale: -1000, isArray: false },
    { name: 'time with time zone', precision: 0, isArray: false },
    { name: 'timestamp', precision: 6, isArray: true },
  ])('accepts PostgreSQL boundary parameters $name', (value) => {
    expect(validatePhysicalType(value)).toEqual([]);
  });
  it.each<PhysicalType>([
    { name: 'varchar', length: 0, isArray: false },
    { name: 'char', length: 10485761, isArray: false },
    { name: 'numeric', precision: 0, isArray: false },
    { name: 'numeric', precision: 1001, isArray: false },
    { name: 'numeric', scale: 1, isArray: false },
    { name: 'numeric', precision: 1, scale: -1001, isArray: false },
    { name: 'numeric', precision: 1, scale: 1001, isArray: false },
    { name: 'timestamp', precision: 7, isArray: false },
    { name: 'time', precision: -1, isArray: false },
    { name: 'text', length: 10, isArray: false },
    { name: 'real', precision: 2, isArray: false },
    { name: 'double precision', scale: 2, isArray: false },
    { name: 'serial', isArray: true },
    { name: 'enum', enumId: 'e', length: 10, isArray: false },
    { name: 'numeric', precision: 1.5, isArray: false },
  ])('rejects unsupported parameter combinations $name', (value) => {
    expect(validatePhysicalType(value).length).toBeGreaterThan(0);
  });
  it.each<PhysicalType>([
    { name: 'real', isArray: false },
    { name: 'double precision', isArray: false },
    { name: ' DECIMAL ', precision: 1, scale: 2, isArray: false },
    { name: 'numeric', precision: 1, scale: -1000, isArray: false },
    { name: 'time with time zone', precision: 6, isArray: true },
    { name: 'numeric', precision: 0, isArray: false },
    { name: 'varchar', precision: 2, isArray: false },
    { name: 'serial', isArray: true },
  ])('uses the same parameter policy in DDL without mutating $name', (type) => {
    const properties = { common: {}, logical: {}, physical: {} };
    const document = {
      ...createEmptyDocument(),
      domains: [{ id: 'd', name: 'domain', description: '' }],
      tables: [
        {
          id: 't',
          domainId: 'd',
          scope: 'both' as const,
          logical: { name: '', definition: '' },
          physical: { name: 'types', schema: 'public', comment: '' },
          customProperties: properties,
        },
      ],
      columns: [
        {
          id: 'c',
          tableId: 't',
          scope: 'both' as const,
          logical: { name: '', definition: '', semanticType: '', required: false },
          physical: { name: 'value', type, nullable: true, defaultExpression: null, comment: '' },
          customProperties: properties,
        },
      ],
    };
    const before = structuredClone(document);
    const result = exportPostgres(document);
    expect(result.canExport).toBe(validatePhysicalType(type).length === 0);
    if (result.canExport) expect(result.sql).toContain(normalizePhysicalType(type).name);
    expect(document).toEqual(before);
  });
});
