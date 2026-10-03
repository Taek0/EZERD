import { describe, expect, it } from 'vitest';
import {
  createEmptyNativeDocument,
  createNativeTable,
  createNativeColumn,
  defaultDatabaseContext,
  type DatabaseKind,
  type NativeColumnType,
} from '@ezerd/model';
import { nativeKeyColumnPolicies } from './native-editor-option-policy.js';

function fixture(kind: DatabaseKind) {
  const context = defaultDatabaseContext(kind),
    table = createNativeTable(context, 't', null, 'physical'),
    column = createNativeColumn(context, table, 'c');
  table.physical.name = 'items';
  column.physical.name = 'item_id';
  column.physical.type = {
    kind: 'builtin',
    database: kind,
    typeId:
      kind === 'postgresql'
        ? 'postgresql:integer'
        : kind === 'mysql'
          ? 'mysql:int'
          : 'sqlite:integer',
    parameters: {},
  } as NativeColumnType;
  const document = { ...createEmptyNativeDocument(context), tables: [table], columns: [column] };
  return { document, table, column };
}
describe('native key readiness UI uses actual kind and table mode', () => {
  it.each(['postgresql', 'mysql', 'sqlite'] as const)(
    '%s ready builtin keys have no unready diagnostic',
    (kind) => {
      const f = fixture(kind),
        before = structuredClone(f.document);
      for (const keyKind of ['primary', 'unique'] as const) {
        const choice = nativeKeyColumnPolicies(f.document, f.table, keyKind)[0]!;
        expect(choice.engineAllowed).toBe(true);
        expect(choice.productUsable).toBe(true);
        expect(choice.code).toBeUndefined();
      }
      expect(f.document).toEqual(before);
    },
  );
  it('does not block MySQL virtual-generated UNIQUE by borrowing PRIMARY eligibility', () => {
    const f = fixture('mysql');
    f.column.physical.generation = {
      kind: 'computed',
      database: 'mysql',
      storage: 'virtual',
      expression: { kind: 'literal', literalType: 'number', value: '7' },
    };
    expect(nativeKeyColumnPolicies(f.document, f.table, 'unique')[0]).toMatchObject({
      engineAllowed: true,
      productUsable: true,
    });
    expect(nativeKeyColumnPolicies(f.document, f.table, 'primary')[0]).toMatchObject({
      engineAllowed: false,
      productUsable: false,
      code: 'key.generated-not-supported',
    });
  });
  it('rejects incompatible SQLite STRICT types while preserving the currently selected raw object', () => {
    const f = fixture('sqlite');
    f.table.physical.options = { database: 'sqlite', strict: true, withoutRowid: false };
    f.column.physical.type = {
      kind: 'builtin',
      database: 'sqlite',
      typeId: 'sqlite:varchar',
      parameters: {},
    };
    const before = structuredClone(f.document);
    const choice = nativeKeyColumnPolicies(f.document, f.table, 'unique', ['c'])[0]!;
    expect(choice.productUsable).toBe(false);
    expect(choice.preserved).toBe(true);
    expect(f.document).toEqual(before);
  });
});
