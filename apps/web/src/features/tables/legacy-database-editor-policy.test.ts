import { describe, expect, it } from 'vitest';
import { postgresTypeNames } from '@ezerd/model';
import { columnTypeOptions, columnTypeValue } from './column-type-options.js';
import {
  applyColumnDefault,
  columnDefaultOptions,
  patchColumnPhysical,
} from './column-defaults.js';
import {
  legacyArrayChangeAllowed,
  legacyTypeSelectionAllowed,
} from './legacy-database-editor-policy.js';

describe('legacy DB UI boundaries preserve compatibility data', () => {
  it.each(['mysql', 'sqlite'] as const)(
    'limits new %s choices while retaining current opaque/PG/ENUM representations',
    (kind) => {
      const enums = [{ id: 'e', name: 'LegacyStatus', schema: 'public', values: ['a'] }];
      const choices = columnTypeOptions(undefined, enums, kind).map((item) => item.value);
      expect(choices).toContain('text');
      expect(choices).toContain('integer');
      for (const value of [
        'uuid',
        'jsonb',
        'bytea',
        'timetz',
        'timestamptz',
        'serial',
        'bigserial',
        'smallserial',
        'enum:e',
      ]) {
        expect(choices).not.toContain(value);
        expect(legacyTypeSelectionAllowed(undefined, value, kind)).toBe(false);
      }
      for (const type of [
        { name: ' Custom.DomainType ', isArray: true, precision: 3 },
        { name: ' TIMESTAMP WITH TIME ZONE ', isArray: true, precision: 4 },
        { name: 'LegacyStatus', enumId: 'e', isArray: false },
        { name: 'MissingEnumName', enumId: 'missing', isArray: true },
      ]) {
        const before = structuredClone(type),
          value = columnTypeValue(type);
        expect(columnTypeOptions(type, enums, kind).some((choice) => choice.value === value)).toBe(
          true,
        );
        expect(legacyTypeSelectionAllowed(type, value, kind)).toBe(true);
        expect(legacyTypeSelectionAllowed(type, 'text', kind)).toBe(true);
        expect(type).toEqual(before);
      }
      expect(legacyTypeSelectionAllowed({ name: 'text', isArray: false }, 'enum:e', kind)).toBe(
        false,
      );
    },
  );
  it.each(['mysql', 'sqlite'] as const)(
    'prevents new %s PG defaults and arrays but retains raw values and allows removal/repair',
    (kind) => {
      const physical = {
          name: 'created_at',
          type: { name: 'timestamp', isArray: false },
          nullable: true,
          defaultExpression: 'now()',
          comment: '',
        },
        before = structuredClone(physical);
      expect(columnDefaultOptions(physical, [], kind).map((item) => item.value)).not.toContain(
        'now()',
      );
      expect(columnDefaultOptions(physical, [], kind).map((item) => item.value)).toContain(
        'CURRENT_TIMESTAMP',
      );
      expect(applyColumnDefault(physical, 'now()', [], kind)).toBe(physical);
      expect(patchColumnPhysical(physical, { comment: 'kept' }).defaultExpression).toBe('now()');
      expect(applyColumnDefault(physical, '', [], kind).defaultExpression).toBeNull();
      expect(
        applyColumnDefault(
          { ...physical, type: { name: 'integer', isArray: false } },
          '@auto',
          [],
          kind,
        ).type.name,
      ).toBe('integer');
      expect(
        columnDefaultOptions(
          { ...physical, type: { name: 'uuid', isArray: false } },
          [],
          kind,
        ).some((item) => item.value === 'gen_random_uuid()'),
      ).toBe(false);
      expect(legacyArrayChangeAllowed(false, true, kind)).toBe(false);
      expect(legacyArrayChangeAllowed(true, false, kind)).toBe(true);
      expect(legacyArrayChangeAllowed(true, true, kind)).toBe(true);
      expect(physical).toEqual(before);
    },
  );
  it('preserves omitted/PG calls, defaults and alias behavior without native mappings', () => {
    expect(columnTypeOptions().map((item) => item.value)).toEqual(postgresTypeNames);
    expect(columnTypeOptions(undefined, [], 'postgresql')).toEqual(columnTypeOptions());
    const physical = {
      name: 'id',
      type: { name: 'int', isArray: false },
      nullable: true,
      defaultExpression: null,
      comment: '',
    };
    expect(applyColumnDefault(physical, '@auto').type.name).toBe('serial');
    expect(applyColumnDefault(physical, '@auto', [], 'postgresql')).toEqual(
      applyColumnDefault(physical, '@auto'),
    );
    expect(legacyArrayChangeAllowed(false, true)).toBe(true);
    expect(physical.type.name).toBe('int');
  });
});
