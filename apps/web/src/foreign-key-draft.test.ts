import { expect, it } from 'vitest';
import {
  createEmptyDocument,
  createForeignKeyFromPrimaryKey,
  type Column,
  type DesignDocument,
} from '@ezerd/model';
import { applyForeignKeyDraft } from './foreign-key-draft.js';

function preview() {
  const properties = { common: {}, logical: {}, physical: {} };
  const columns: Column[] = ['p1', 'p2', 'existing'].map((id) => ({
    id,
    tableId: id === 'existing' ? 'child' : 'parent',
    scope: 'both',
    logical: { name: id, definition: '', semanticType: '', required: true },
    physical: {
      name: id === 'existing' ? 'p1' : id,
      type: { name: 'integer', isArray: false },
      nullable: false,
      defaultExpression: null,
      comment: '',
    },
    customProperties: properties,
  }));
  const doc: DesignDocument = {
    ...createEmptyDocument(),
    tables: ['parent', 'child'].map((id) => ({
      id,
      domainId: 'domain',
      scope: 'both',
      logical: { name: id, definition: '' },
      physical: { name: id, schema: 'public', comment: '' },
      customProperties: properties,
    })),
    columns,
    keys: [
      {
        id: 'pk',
        tableId: 'parent',
        kind: 'primary',
        scope: 'both',
        name: 'pk',
        columnIds: ['p1', 'p2'],
      },
    ],
  };
  return createForeignKeyFromPrimaryKey(doc, {
    primaryTableId: 'parent',
    foreignTableId: 'child',
    primaryKeyId: 'pk',
    relationId: 'fk',
    columnIds: ['f1', 'f2'],
  });
}
it('keeps generated defaults and edits compound FK names without changing SQL direction', () => {
  const before = preview();
  expect(before.columns?.find((c) => c.id === 'f1')?.physical.name).toBe('p1_2');
  const next = applyForeignKeyDraft(
    before,
    'fk',
    [' custom_id ', 'custom_part'],
    '1',
    '0..N',
    'uk',
  );
  expect(
    next.columns?.filter((c) => ['f1', 'f2'].includes(c.id)).map((c) => c.physical.name),
  ).toEqual(['custom_id', 'custom_part']);
  expect(next.tableRelations?.[0]?.physical?.sourceColumnIds).toEqual(['f1', 'f2']);
  expect(next.tableRelations?.[0]?.physical?.targetColumnIds).toEqual(['p1', 'p2']);
  expect(next.keys).toHaveLength(1);
  expect(before.columns?.find((c) => c.id === 'f1')?.physical.name).toBe('p1_2');
});
it('applies optional PK and one-to-one FK with one compound UNIQUE constraint', () => {
  const next = applyForeignKeyDraft(preview(), 'fk', ['f_one', 'f_two'], '0..1', '1', 'uk');
  expect(
    next.columns?.filter((c) => ['f1', 'f2'].includes(c.id)).every((c) => c.physical.nullable),
  ).toBe(true);
  expect(next.keys?.find((k) => k.id === 'uk')).toMatchObject({
    kind: 'unique',
    tableId: 'child',
    columnIds: ['f1', 'f2'],
  });
  expect(next.tableRelations?.[0]?.logical).toMatchObject({
    sourceCardinality: { min: 1, max: 1 },
    targetCardinality: { min: 0, max: 1 },
    cardinality: 'one-to-one',
  });
});
it('rejects empty, duplicate and existing column names', () => {
  for (const names of [
    [' ', 'second'],
    ['same', 'same'],
    ['p1', 'second'],
  ])
    expect(() => applyForeignKeyDraft(preview(), 'fk', names, '1', '0..N', 'uk')).toThrow();
});
