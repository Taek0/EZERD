import { patchColumnPhysical } from './column-defaults.js';
import { type DesignDocument, removeKey, updateColumn, upsertKey } from '@ezerd/model';
import { newId } from '../../shared/api/client.js';

export function primaryKeyChangeReason(doc: DesignDocument, columnId: string): string | undefined {
  const column = doc.columns?.find((c) => c.id === columnId);
  if (!column || column.scope === 'logical') return '물리 컬럼을 선택하세요.';
  const key = doc.keys?.find(
    (k) => k.tableId === column.tableId && k.kind === 'primary' && k.scope !== 'logical',
  );
  if (!key) return;
  const hasAlternative = doc.keys?.some(
    (k) =>
      k.id !== key.id &&
      k.tableId === key.tableId &&
      k.scope !== 'logical' &&
      k.columnIds.length === key.columnIds.length &&
      k.columnIds.every((id, i) => id === key.columnIds[i]),
  );
  if (
    !hasAlternative &&
    doc.tableRelations?.some(
      (r) =>
        r.scope !== 'logical' &&
        r.targetTableId === key.tableId &&
        r.physical?.targetColumnIds.length === key.columnIds.length &&
        r.physical.targetColumnIds.every((id, i) => id === key.columnIds[i]),
    )
  )
    return '이 PK를 참조하는 FK가 있습니다. 관계의 참조 키를 먼저 변경하세요.';
}

export function setColumnPrimaryKey(
  doc: DesignDocument,
  columnId: string,
  checked: boolean,
): DesignDocument {
  const column = doc.columns?.find((c) => c.id === columnId);
  if (!column) return doc;
  const key = doc.keys?.find(
    (k) => k.tableId === column.tableId && k.kind === 'primary' && k.scope !== 'logical',
  );
  if (!!key?.columnIds.includes(columnId) === checked) return doc;
  const reason = primaryKeyChangeReason(doc, columnId);
  if (reason) throw new Error(reason);
  const ids = checked
    ? [...(key?.columnIds ?? []), columnId]
    : key!.columnIds.filter((id) => id !== columnId);
  const next = checked
    ? updateColumn(doc, columnId, {
        physical: patchColumnPhysical(column.physical, { nullable: false }),
      })
    : doc;
  return ids.length
    ? upsertKey(next, {
        ...(key ?? {
          id: newId(),
          tableId: column.tableId,
          scope: column.scope,
          kind: 'primary' as const,
          name: '',
        }),
        columnIds: ids,
      })
    : removeKey(next, key!.id);
}
