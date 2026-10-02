import {
  createEmptyNativeDocument,
  createNativeColumn,
  createNativeTable,
  defaultDatabaseContext,
  type DatabaseKind,
  type NativeDesignDocument,
} from '@ezerd/model';

export function deferrableFixture(kind: DatabaseKind = 'postgresql'): NativeDesignDocument {
  const context = defaultDatabaseContext(kind),
    parent = createNativeTable(context, 'parent'),
    child = createNativeTable(context, 'child');
  parent.physical.name = 'parent_records';
  child.physical.name = 'child_records';
  parent.logical.definition = ' Raw logical definition INTEGER ';
  parent.physical.comment = ' 原文 comment ';
  parent.customProperties.common = { raw: '  preserve UUID INTEGER text  ' };
  const a = createNativeColumn(context, parent, 'parent-column'),
    b = createNativeColumn(context, child, 'child-column'),
    legacy = createNativeColumn(context, child, 'raw-column');
  a.physical.name = 'id';
  b.physical.name = 'parent_id';
  legacy.physical.name = 'legacy_raw';
  a.physical.nullable = false;
  a.physical.type =
    kind === 'postgresql'
      ? { kind: 'builtin', database: kind, typeId: 'postgresql:integer', parameters: {} }
      : kind === 'mysql'
        ? { kind: 'builtin', database: kind, typeId: 'mysql:int', parameters: {} }
        : { kind: 'builtin', database: kind, typeId: 'sqlite:integer', parameters: {} };
  b.physical.type = structuredClone(a.physical.type);
  legacy.physical.type = {
    kind: 'legacy',
    source: 'document-v1',
    original: { name: '  UUID old raw  ', isArray: false },
  };
  legacy.physical.defaultValue = {
    kind: 'legacyExpression',
    source: 'document-v1',
    original: ' unchanged_raw_sql() ',
  };
  return {
    ...createEmptyNativeDocument(context),
    tables: [parent, child],
    columns: [a, b, legacy],
    keys: [
      {
        id: 'key/a~b',
        tableId: parent.id,
        name: 'pk_parent',
        scope: 'physical',
        kind: 'primary',
        columnIds: [a.id],
        deferrable: { initially: 'deferred' },
      },
    ],
    tableRelations: [
      {
        id: 'fk/a~b',
        sourceTableId: child.id,
        targetTableId: parent.id,
        scope: 'physical',
        logical: { name: ' Raw relationship ', cardinality: 'one-to-many', required: false },
        physical: {
          name: 'fk_parent',
          sourceColumnIds: [b.id],
          targetColumnIds: [a.id],
          onDelete: 'NO ACTION',
          onUpdate: 'NO ACTION',
        },
        deferrable: { initially: 'immediate' },
      },
    ],
  };
}
