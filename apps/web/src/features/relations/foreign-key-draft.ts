import { translate as tr } from '../../shared/i18n/index.js';
import '../canvas/translations.js';
import { type DesignDocument, type RelationCardinality, upsertKey } from '@ezerd/model';

export type CardinalityChoice = '0..1' | '1' | '0..N' | '1..N';
export function cardinalityValue(value: CardinalityChoice): RelationCardinality {
  return { min: value.startsWith('0') ? 0 : 1, max: value.endsWith('N') ? 'many' : 1 };
}

/** Finish a generated preview atomically, including the physical one-to-one constraint. */
export function applyForeignKeyDraft(
  preview: DesignDocument,
  relationId: string,
  names: string[],
  primary: '0..1' | '1',
  foreign: CardinalityChoice,
  uniqueKeyId: string,
): DesignDocument {
  const relation = preview.tableRelations?.find((r) => r.id === relationId);
  if (!relation?.physical) throw new Error('관계 정보를 찾을 수 없습니다.');
  const ids = relation.physical.sourceColumnIds;
  const trimmed = names.map((name) => name.trim());
  if (trimmed.length !== ids.length || trimmed.some((name) => !name))
    throw new Error('새 FK 컬럼 이름을 입력하세요.');
  if (trimmed.some((name) => name.includes('\0') || name.length > 120))
    throw new Error('컬럼 이름은 NUL 문자 없이 120자 이하로 입력하세요.');
  const used = new Set(
    preview.columns
      ?.filter((c) => c.tableId === relation.sourceTableId && !ids.includes(c.id))
      .map((c) => c.physical.name),
  );
  for (const name of trimmed) {
    if (used.has(name)) throw new Error(tr('컬럼 이름 ‘{name}’이 중복됩니다.', { name }));
    used.add(name);
  }
  const sourceCardinality = cardinalityValue(foreign);
  const targetCardinality = cardinalityValue(primary);
  let result: DesignDocument = {
    ...preview,
    columns: preview.columns?.map((column) => {
      const index = ids.indexOf(column.id);
      return index < 0
        ? column
        : {
            ...column,
            physical: { ...column.physical, name: trimmed[index]!, nullable: primary === '0..1' },
          };
    }),
    tableRelations: preview.tableRelations?.map((r) =>
      r.id !== relationId
        ? r
        : {
            ...r,
            logical: {
              ...r.logical,
              cardinality: sourceCardinality.max === 1 ? 'one-to-one' : 'one-to-many',
              required: targetCardinality.min === 1,
              sourceCardinality,
              targetCardinality,
            },
          },
    ),
  };
  if (sourceCardinality.max === 1) {
    result = upsertKey(result, {
      id: uniqueKeyId,
      tableId: relation.sourceTableId,
      kind: 'unique',
      scope: relation.scope,
      name: '',
      columnIds: [...ids],
    });
  }
  return result;
}
