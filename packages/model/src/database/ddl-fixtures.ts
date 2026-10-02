import { createNativeColumn, createNativeTable } from './editing.js';
import { createEmptyNativeDocument, type NativeDesignDocument } from './native-document.js';
import { defaultDatabaseContext } from './profiles.js';
import type { DatabaseKind } from './definitions.js';

/** Shared execution fixture: unassigned parent and domain-owned child, not view-filtered. */
export function nativeDDLFixture(kind: DatabaseKind): NativeDesignDocument {
  const database = defaultDatabaseContext(kind),
    parent = createNativeTable(database, 'parent'),
    child = createNativeTable(database, 'child', 'domain');
  parent.physical.name = 'parent';
  child.physical.name = 'child';
  const id = createNativeColumn(database, parent, 'parent-id'),
    ref = createNativeColumn(database, child, 'parent-ref'),
    label = createNativeColumn(database, parent, 'label');
  id.physical.name = 'id';
  ref.physical.name = 'parent_id';
  label.physical.name = 'label';
  id.physical.nullable = false;
  id.physical.type =
    kind === 'postgresql'
      ? { kind: 'builtin', database: kind, typeId: 'postgresql:integer', parameters: {} }
      : kind === 'mysql'
        ? { kind: 'builtin', database: kind, typeId: 'mysql:int', parameters: { unsigned: true } }
        : { kind: 'builtin', database: kind, typeId: 'sqlite:integer', parameters: {} };
  ref.physical.type = JSON.parse(JSON.stringify(id.physical.type));
  id.physical.generation =
    kind === 'postgresql'
      ? {
          kind: 'identity',
          database: kind,
          mode: 'byDefault',
          sequence: { start: '1', increment: '1' },
        }
      : { kind: 'autoIncrement', database: kind };
  label.physical.defaultValue = {
    kind: 'literal',
    literalType: 'string',
    value: "quote' and slash\\ 한글",
  };
  parent.physical.comment = "Parent's description\nDROP TABLE harmless;";
  label.physical.comment = 'Label 설명';
  const score = createNativeColumn(database, child, 'score');
  score.physical.name = 'score';
  score.physical.defaultValue = { kind: 'literal', literalType: 'number', value: '1' };
  score.physical.type =
    kind === 'postgresql'
      ? { kind: 'builtin', database: kind, typeId: 'postgresql:integer', parameters: {} }
      : kind === 'mysql'
        ? { kind: 'builtin', database: kind, typeId: 'mysql:int', parameters: {} }
        : { kind: 'builtin', database: kind, typeId: 'sqlite:integer', parameters: {} };
  return {
    ...createEmptyNativeDocument(database),
    domains: [{ id: 'domain', name: 'Domain', description: '' }],
    tables: [parent, child],
    columns: [id, label, ref, score],
    keys: [
      {
        id: 'pk',
        tableId: parent.id,
        kind: 'primary',
        scope: 'both',
        name: 'parent_pk',
        columnIds: [id.id],
      },
    ],
    tableRelations: [
      {
        id: 'fk',
        sourceTableId: child.id,
        targetTableId: parent.id,
        scope: 'both',
        logical: { name: 'Parent', cardinality: 'one-to-many', required: false },
        physical: {
          name: 'child_parent_fk',
          sourceColumnIds: [ref.id],
          targetColumnIds: [id.id],
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
      },
    ],
    indexes: [
      {
        id: 'ix',
        tableId: parent.id,
        name: 'parent_label_ix',
        scope: 'both',
        unique: false,
        parts: [{ expression: { kind: 'column', columnId: label.id }, direction: 'asc' }],
        options:
          kind === 'postgresql'
            ? { database: kind, method: 'btree' }
            : kind === 'mysql'
              ? { database: kind, kind: 'btree' }
              : { database: kind },
      },
    ],
    checks: [
      {
        id: 'ck',
        tableId: child.id,
        scope: 'both',
        name: 'child_positive_ck',
        expression: {
          kind: 'binary',
          operator: '>',
          left: { kind: 'column', columnId: score.id },
          right: { kind: 'literal', literalType: 'number', value: '0' },
        },
      },
    ],
  };
}
