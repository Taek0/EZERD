import { describe, expect, it } from 'vitest';
import { canonicalPostgresTypeName, columnTypeDisplay } from '@ezerd/model';
import { columnTypeOptions, columnTypeValue } from './column-type-options.js';
import { typeParameterEnabled } from './TableEditor.js';
import { columnDefaultOptions } from './column-defaults.js';

describe('canonical physical type choices', () => {
  it.each([
    ['timestamp with time zone', 'timestamptz'],
    ['timestamp without time zone', 'timestamp'],
    ['time with time zone', 'timetz'],
    ['time without time zone', 'time'],
    [' DECIMAL ', 'numeric'],
    ['character varying', 'varchar'],
    ['character', 'char'],
    ['int', 'integer'],
    ['int4', 'integer'],
    ['int8', 'bigint'],
    ['int2', 'smallint'],
    ['bool', 'boolean'],
    ['float4', 'real'],
    ['float8', 'double precision'],
  ])('offers %s only as %s without changing saved data', (alias, canonical) => {
    const type = { name: alias, isArray: true, precision: 3 };
    const saved = structuredClone(type);
    const options = columnTypeOptions(type);
    expect(canonicalPostgresTypeName(alias)).toBe(canonical);
    expect(columnTypeValue(type)).toBe(canonical);
    expect(options.filter((item) => item.value === canonical)).toEqual([
      { value: canonical, label: `${canonical.toUpperCase()}(3)[]` },
    ]);
    expect(options.some((item) => item.value === alias)).toBe(false);
    expect(type).toEqual(saved);
  });

  it('keeps distinct timezone semantics and only one numeric choice', () => {
    const values = columnTypeOptions().map((item) => item.value);
    expect(values).toEqual(
      expect.arrayContaining(['time', 'timetz', 'timestamp', 'timestamptz', 'numeric']),
    );
    expect(values).not.toContain('decimal');
    expect(new Set(values).size).toBe(values.length);
  });

  it('preserves unknown names and keeps enum names separate from built-ins', () => {
    for (const name of ['MyCustomType', 'public.decimal', 'constructor', 'toString']) {
      const type = { name, isArray: false };
      expect(columnTypeValue(type)).toBe(name);
      expect(columnTypeOptions(type)).toContainEqual({ value: name, label: name.toUpperCase() });
    }
    const type = { name: 'decimal', enumId: 'e', isArray: true };
    const enums = [{ id: 'e', name: 'decimal', schema: 'public', values: ['a'] }];
    expect(columnTypeValue(type)).toBe('enum:e');
    expect(columnTypeDisplay(type, enums)).toBe('DECIMAL[]');
    expect(columnTypeOptions(type, enums)).toContainEqual({
      value: 'enum:e',
      label: 'DECIMAL · ENUM',
    });
    expect(columnTypeOptions(type, enums).some((item) => item.value === 'decimal')).toBe(false);
    expect(typeParameterEnabled(type, 'precision')).toBe(false);
  });

  it('retains alias parameters and enables matching parameter/default controls', () => {
    const numeric = { name: 'DECIMAL', precision: 10, scale: 2, isArray: true };
    expect(columnTypeDisplay(numeric)).toBe('NUMERIC(10,2)[]');
    expect(typeParameterEnabled(numeric, 'scale')).toBe(true);
    const varchar = { name: 'Character Varying', length: 32, isArray: false };
    expect(columnTypeDisplay(varchar)).toBe('VARCHAR(32)');
    expect(typeParameterEnabled(varchar, 'length')).toBe(true);
    const timestamp = { name: ' TIMESTAMP  WITH TIME ZONE ', precision: 3, isArray: false };
    expect(typeParameterEnabled(timestamp, 'precision')).toBe(true);
    expect(columnTypeDisplay(timestamp)).toBe('TIMESTAMPTZ(3)');
    const physical = {
      name: 'created_at',
      type: timestamp,
      nullable: false,
      defaultExpression: null,
      comment: '',
    };
    expect(columnDefaultOptions(physical).map((item) => item.value)).toContain('CURRENT_TIMESTAMP');
  });
});
