import { describe, expect, it } from 'vitest';
import { physicalTypeSchema, storedPhysicalTypeSchema } from './relational.js';
import { designDocumentSchema, storedDesignDocumentSchema } from './workspace.js';
import { createEmptyDocument } from '@ezerd/model';

describe('physical type contracts', () => {
  it.each([
    ['real', 'real'],
    ['double precision', 'double precision'],
    ['decimal', 'numeric'],
    [' FLOAT4 ', 'real'],
    ['FLOAT8', 'double precision'],
    [' INT4 ', 'integer'],
    ['character   varying', 'varchar'],
  ])('stores %s as %s', (name, canonical) => {
    const value = { name, isArray: false };
    expect(physicalTypeSchema.parse(value).name).toBe(canonical);
    expect(value.name).toBe(name);
  });
  it.each([
    { name: 'numeric', precision: 0 },
    { name: 'timestamp', precision: 7 },
    { name: 'time', scale: 0 },
    { name: 'integer', length: 2 },
    { name: 'numeric', scale: 1 },
    { name: 'real', precision: 4 },
    { name: 'double precision', precision: 8 },
    { name: 'serial', isArray: true },
    { name: 'varchar', enumId: 'enum', length: 2 },
  ])('rejects incompatible modifiers with a field path', (value) => {
    const result = physicalTypeSchema.safeParse({ isArray: false, ...value });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]!.path).toHaveLength(1);
  });
  it('supports PostgreSQL numeric scale ranges and preserves enum identities', () => {
    for (const scale of [-1000, 1000]) {
      expect(
        physicalTypeSchema.parse({ name: 'decimal', precision: 1, scale, isArray: true }).scale,
      ).toBe(scale);
    }
    expect(physicalTypeSchema.parse({ name: 'FLOAT8', enumId: 'e', isArray: true }).name).toBe(
      'FLOAT8',
    );
    expect(physicalTypeSchema.parse({ name: 'custom_type', isArray: false }).name).toBe(
      'custom_type',
    );
  });
  it('keeps legacy invalid modifiers readable while rejecting them on writes', () => {
    const legacy = { name: ' INT4 ', length: 10, isArray: false };
    expect(storedPhysicalTypeSchema.parse(legacy)).toEqual({ ...legacy, name: 'integer' });
    expect(physicalTypeSchema.safeParse(legacy).success).toBe(false);
    const document = {
      ...createEmptyDocument(),
      columns: [
        {
          id: 'c',
          tableId: 't',
          scope: 'both',
          logical: { name: '', definition: '', semanticType: '', required: false },
          physical: {
            name: 'c',
            type: legacy,
            nullable: true,
            defaultExpression: null,
            comment: '',
          },
          customProperties: { common: {}, logical: {}, physical: {} },
        },
      ],
    };
    expect(storedDesignDocumentSchema.parse(document).columns?.[0]?.physical.type.name).toBe(
      'integer',
    );
    expect(designDocumentSchema.safeParse(document).success).toBe(false);
  });
});
